const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { separationEffect, servesNotice } = require("../src/modules/hrm/separations/controller");
const { relieveServedNotices } = require("../src/modules/hrm/separations/relieve");

/*
 * Offboarding with a last working day still to come: the person keeps working - status and login as
 * they were - and is relieved the day after it.
 */

const SQL = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20261012220000_serving_notice", "migration.sql"), "utf8");
const NOON_12_OCT = new Date("2026-10-12T06:30:00Z"); // 12:00 pm in Kolkata
const RELIEVED_ON = new Date("2026-10-01T00:00:00Z");

function fakeClient(separations) {
  const writes = { employees: [], logins: [] };
  const client = {
    writes,
    employeeSeparation: {
      async findMany({ where }) { return separations.filter((row) => row.relievedAt === null && row.proposedLastWorkingDate < where.proposedLastWorkingDate.lt); },
      async updateMany({ where, data }) {
        const row = separations.find((entry) => entry.id === where.id && entry.relievedAt === null);
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
    employee: { async update({ where, data }) { writes.employees.push([where.id, data.employmentStatus]); } },
    user: { async updateMany({ where, data }) { writes.logins.push([where.linkedEmployeeId, data.status]); return { count: 1 }; } },
    async $transaction(work) { return work(client); },
  };
  return client;
}

test("the day after the last working day, the separation's status lands and the login closes - once", async () => {
  const separations = [
    { id: 1, employeeId: 11, employmentStatus: "Relieved", proposedLastWorkingDate: new Date("2026-10-11T00:00:00Z"), relievedAt: null },
    { id: 2, employeeId: 12, employmentStatus: "Fired", proposedLastWorkingDate: new Date("2026-10-12T00:00:00Z"), relievedAt: null },
    { id: 3, employeeId: 13, employmentStatus: "Relieved", proposedLastWorkingDate: new Date("2026-09-30T00:00:00Z"), relievedAt: new Date("2026-10-01T00:00:00Z") },
  ];
  const client = fakeClient(separations);
  assert.equal(await relieveServedNotices({ now: NOON_12_OCT, client }), 1);
  assert.deepEqual(client.writes.employees, [[11, "Relieved"]]);
  assert.deepEqual(client.writes.logins, [[11, "INACTIVE"]]);
  assert.equal(separations[0].relievedAt, NOON_12_OCT);
  // Again the same day: nothing more. The next day: the one whose last day was the 12th.
  assert.equal(await relieveServedNotices({ now: NOON_12_OCT, client }), 0);
  assert.equal(await relieveServedNotices({ now: new Date("2026-10-13T00:05:00Z"), client }), 1);
  assert.deepEqual(client.writes.employees, [[11, "Relieved"], [12, "Fired"]]);
});

test("notice is served through the last working day itself, on the studio's calendar", () => {
  const on = (lastWorkingDate, now = NOON_12_OCT) => servesNotice({ previousStatus: "Active", lastWorkingDate: new Date(lastWorkingDate), now });
  assert.equal(on("2026-10-31"), true);
  assert.equal(on("2026-10-12"), true, "their last day is today - they still work it");
  assert.equal(on("2026-10-11"), false);
  // Just past midnight in Kolkata is already the 13th, though the server's UTC clock still says the 12th.
  assert.equal(on("2026-10-12", new Date("2026-10-12T19:00:00Z")), false);
  // Never taken on: nothing to serve notice from.
  assert.equal(servesNotice({ previousStatus: "Employee Submission Pending", lastWorkingDate: new Date("2026-10-31"), now: NOON_12_OCT }), false);
  assert.equal(servesNotice({ previousStatus: "HR Onboarding Pending", lastWorkingDate: new Date("2026-10-31"), now: NOON_12_OCT }), false);
});

test("saving an offboarding: notice served leaves status and login alone; the date decides either way", () => {
  const effect = (lastWorkingDate, extra = {}) => separationEffect({ previousStatus: "Active", separationStatus: "Relieved", lastWorkingDate: new Date(lastWorkingDate), now: NOON_12_OCT, ...extra });
  // New, last day ahead: nothing changes yet.
  assert.deepEqual(effect("2026-10-31"), { relievedAt: null, employmentStatus: undefined, closeLogin: false, reopenLogin: false });
  // New, last day already gone: relieved now.
  assert.deepEqual(effect("2026-10-11"), { relievedAt: NOON_12_OCT, employmentStatus: "Relieved", closeLogin: true, reopenLogin: false });
  // Already relieved, date pushed past today: back to work for the notice left.
  assert.deepEqual(effect("2026-10-31", { relievedAt: RELIEVED_ON, previousStatus: "PIP" }), { relievedAt: null, employmentStatus: "PIP", closeLogin: false, reopenLogin: true });
  // Already relieved, date still past: stays relieved, login not closed twice.
  assert.deepEqual(effect("2026-10-05", { relievedAt: RELIEVED_ON }), { relievedAt: RELIEVED_ON, employmentStatus: "Relieved", closeLogin: false, reopenLogin: false });
  // Never taken on: relieved at once, whatever the date.
  assert.equal(effect("2026-10-31", { previousStatus: "Employee Submission Pending" }).closeLogin, true);
});

test("withdrawing a notice removes the offboarding and leaves status and login as they are", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "employees", "controller.js"), "utf8");
  assert.match(source, /const withdrawingNotice = Boolean\(separation && !separation\.relievedAt\);/);
  assert.match(source, /if \(working\.includes\(employee\.employmentStatus\) && !withdrawingNotice\) \{/);
  assert.match(source, /const employmentStatus = withdrawingNotice \? employee\.employmentStatus : await returningStatus/);
  assert.match(source, /if \(withdrawingNotice\) return \{ updated, login: null \};\n\s+await reopenLogin\(tx, id\);/);
});

test("the migration marks every earlier separation relieved, and the server runs the relieving", () => {
  assert.match(SQL, /ADD COLUMN `relieved_at` DATETIME\(3\) NULL/);
  assert.match(SQL, /UPDATE `employee_separation` SET `relieved_at` = `created_at` WHERE `relieved_at` IS NULL;/);
  assert.match(fs.readFileSync(path.join(__dirname, "..", "src", "server.js"), "utf8"), /startSeparationRelieving\(\);/);
});
