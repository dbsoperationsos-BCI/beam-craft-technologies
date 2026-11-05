const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { dueDateFromShoot, syncShootLinkedDueDates } = require("../src/services/shootLinkedDueDates");

/*
 * Schedule Payment, date not known: the payment follows a shoot - its own or the main event - so many
 * days before, on or after it, and its due date moves when the shoot's does.
 */

const SQL = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20261031140000_payment_due_on_shoot", "migration.sql"), "utf8");
const day = (key) => new Date(`${key}T00:00:00.000Z`);

function fakeClient({ payments, shoots }) {
  const updates = [];
  return {
    updates,
    projectPaymentSchedule: {
      async findMany() { return payments; },
      async update({ where, data }) { updates.push({ id: where.id, dueDate: data.dueDate }); },
    },
    projectShoot: { async findMany() { return shoots.filter((shoot) => !shoot.deletedAt); } },
  };
}
const payment = (id, extra = {}) => ({ id, dueShootId: null, dueOffsetDays: 0, dueDate: null, holdAt: null, splitFromId: null, _count: { receipts: 0, splits: 0 }, ...extra });

test("the migration adds the shoot link as three nullable columns and a key that lets a shoot go", () => {
  assert.match(SQL, /ADD COLUMN `due_rule` VARCHAR\(10\) NULL/);
  assert.match(SQL, /ADD COLUMN `due_offset_days` INTEGER NULL/);
  assert.match(SQL, /REFERENCES `project_shoot`\(`id`\) ON DELETE SET NULL/);
});

test("the due date is the shoot's day in studio time, moved by the days", () => {
  // 10 Dec 2026, 1:00 am in Kolkata, is still 9 Dec in UTC - the studio's day is what counts.
  const shoot = new Date("2026-12-09T19:30:00.000Z");
  assert.equal(dueDateFromShoot(shoot, -3).toISOString(), day("2026-12-07").toISOString());
  assert.equal(dueDateFromShoot(shoot, 0).toISOString(), day("2026-12-10").toISOString());
  assert.equal(dueDateFromShoot(shoot, 7).toISOString(), day("2026-12-17").toISOString());
  assert.equal(dueDateFromShoot(null, 3), null);
});

test("a shoot's date moving moves the payments that follow it; the main event is the fallback", async () => {
  const client = fakeClient({
    shoots: [{ id: "s1", dateCreated: day("2026-12-10"), isMainEvent: false }, { id: "main", dateCreated: day("2026-12-20"), isMainEvent: true }],
    payments: [payment("on-s1", { dueShootId: "s1", dueOffsetDays: -2 }), payment("on-main", { dueOffsetDays: 1 }), payment("already", { dueShootId: "s1", dueOffsetDays: 0, dueDate: day("2026-12-10") })],
  });
  assert.equal(await syncShootLinkedDueDates(client, "p1"), 2);
  assert.deepEqual(client.updates.map((row) => [row.id, row.dueDate.toISOString().slice(0, 10)]), [["on-s1", "2026-12-08"], ["on-main", "2026-12-21"]]);
});

test("a removed shoot, or one with no date, leaves the payment waiting - not moved onto the main event", async () => {
  const client = fakeClient({
    shoots: [{ id: "gone", dateCreated: day("2026-12-10"), deletedAt: new Date() }, { id: "main", dateCreated: day("2026-12-20"), isMainEvent: true }, { id: "undated", dateCreated: null }],
    payments: [payment("followed-gone", { dueShootId: "gone", dueDate: day("2026-12-10") }), payment("followed-undated", { dueShootId: "undated", dueDate: day("2026-11-01") })],
  });
  await syncShootLinkedDueDates(client, "p1");
  assert.deepEqual(client.updates.map((row) => [row.id, row.dueDate]), [["followed-gone", null], ["followed-undated", null]]);
});

test("a payment Accounts has worked keeps its date whatever the shoot does", async () => {
  const client = fakeClient({
    shoots: [{ id: "main", dateCreated: day("2026-12-20"), isMainEvent: true }],
    payments: [payment("received", { _count: { receipts: 1, splits: 0 } }), payment("held", { holdAt: new Date() }), payment("split", { splitFromId: "x" })],
  });
  assert.equal(await syncShootLinkedDueDates(client, "p1"), 0);
});

test("every shoot write keeps the payments in step", () => {
  const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", "src", ...parts), "utf8");
  assert.match(read("modules", "sales", "projects", "controller.js"), /async function syncProjectMainEvent\(transaction, projectId, shoot\) \{\n  await syncMainEventDate\(transaction, projectId, shoot\);\n  await syncShootLinkedDueDates\(transaction, projectId\);/);
  assert.match(read("modules", "project-management", "pre-production", "controller.js"), /if \("shootDate" in parsed\.data\) await syncShootLinkedDueDates\(transaction, shoot\.projectId\);/);
  assert.match(read("modules", "client", "portal", "preProduction.js"), /if \("dateCreated" in shootData\) await syncShootLinkedDueDates\(transaction, shoot\.projectId\);/);
});
