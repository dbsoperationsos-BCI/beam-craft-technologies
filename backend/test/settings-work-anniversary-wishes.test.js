const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { celebrationsOn } = require("../src/modules/hrm/attendance/service");
const controller = require("../src/modules/settings/wishes/controller");
const sender = require("../src/modules/settings/wishes/sender");

/*
 * Settings → Templates → Work Anniversary Wishes: each year an employee completes with the studio,
 * counted from their Date Of Joining, one of ten wishes goes the way the birthday wishes go, with
 * `{years}` reading "3 years".
 */

const at = (iso) => new Date(`${iso}T00:00:00.000Z`);
const person = (id, dateOfJoining, extra = {}) => ({ id, employeeName: `Person ${id}`, employmentStatus: "Active", archivedAt: null, branchId: null, dateOfJoining: at(dateOfJoining), ...extra });

test("a work anniversary is the joining day's month and day, from the 1st year on", () => {
  const { workAnniversaries } = celebrationsOn("2026-11-03", [
    person(1, "2023-11-03"),
    person(2, "2025-11-03"),
    person(3, "2026-11-03"), // joined today: not an anniversary yet
    person(4, "2023-11-04"),
    person(5, "2020-11-03", { employmentStatus: "Relieved" }),
    person(6, "2020-11-03", { archivedAt: new Date() }),
  ], new Map());
  assert.deepEqual(workAnniversaries.map((row) => [row.employeeId, row.years]), [[1, 3], [2, 1]]);
});

test("somebody who joined on 29 February is wished on the 28th in a year without one", () => {
  const { workAnniversaries } = celebrationsOn("2026-02-28", [person(1, "2024-02-29")], new Map());
  assert.deepEqual(workAnniversaries.map((row) => [row.employeeId, row.years]), [[1, 2]]);
});

test("a caller that did not read the joining date gets no work anniversaries, and its other lists are unchanged", () => {
  const celebrations = celebrationsOn("2026-11-03", [{ id: 1, employeeName: "A", employmentStatus: "Active", archivedAt: null, dateOfBirth: at("1990-11-03") }], new Map());
  assert.deepEqual(celebrations.workAnniversaries, []);
  assert.equal(celebrations.birthdays.length, 1);
});

test("{years} reads as a person says it", () => {
  const template = [{ key: "WORK_ANNIVERSARY_WISH_01", body: "Happy Work Anniversary, {employee name}! Thank you for {years}." }];
  const first = (list) => list[0];
  assert.equal(sender.wishFor({ employeeName: "Asha", years: 3 }, template, first).body, "Happy Work Anniversary, Asha! Thank you for 3 years.");
  assert.equal(sender.wishFor({ employeeName: "Asha", years: 1 }, template, first).body, "Happy Work Anniversary, Asha! Thank you for 1 year.");
});

test("today's work anniversaries are due once, beside birthdays and wedding anniversaries", async () => {
  const client = {
    employee: { findMany: async () => [person(1, "2023-11-03"), person(2, "2024-05-01", { dateOfBirth: at("1995-11-03") })] },
    employeeWish: { findMany: async () => [{ employeeId: 2, kind: "BIRTHDAY" }] },
  };
  const due = await sender.wishesDue("2026-11-03", { client });
  assert.deepEqual(due.map((wish) => [wish.employeeId, wish.kind, wish.years]), [[1, "WORK_ANNIVERSARY", 3]], "the birthday already sent today is not due again");
});

test("ten Work Anniversary Wishes are a wish kind of their own, written by migration and never over a reworded one", () => {
  assert.equal(controller.KINDS.workAnniversary, "WORK_ANNIVERSARY_WISH");
  assert.ok(controller.WISH_KEY.test("WORK_ANNIVERSARY_WISH_10"));
  assert.ok(!controller.WISH_KEY.test("WORK_ANNIVERSARY_WISH_11"));
  const sql = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20261103120000_work_anniversary_wishes", "migration.sql"), "utf8");
  assert.match(sql, /INSERT IGNORE INTO `message_template`/);
  for (let number = 1; number <= 10; number += 1) assert.match(sql, new RegExp(`'WORK_ANNIVERSARY_WISH_${String(number).padStart(2, "0")}', 'Work Anniversary Wish ${number}'`));
  assert.doesNotMatch(sql, /^\s*(DELETE|UPDATE)\b/m, "it only adds");
});

test("the WhatsApp Activity Log names it", () => {
  const activity = fs.readFileSync(path.join(__dirname, "..", "src", "services", "whatsappActivity.js"), "utf8");
  assert.match(activity, /WISH_WORK_ANNIVERSARY: \{ module: "SETTINGS", label: "Work anniversary wish" \}/);
  assert.match(fs.readFileSync(path.join(__dirname, "..", "src", "modules", "settings", "wishes", "sender.js"), "utf8"), /activity: \{ trigger: DETAILS_OF\[person\.kind\]\?\.trigger,/);
});

test("it follows the Wishes Scheduler's own Sender or Rotation, group and time - the same as every wish", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "settings", "wishes", "sender.js"), "utf8");
  // One delivery for every kind, to the scheduler's target - the `WISHES` sender policy and its group.
  assert.equal((source.match(/reportGroup\.deliverToGroup\(/g) || []).length, 1);
  assert.match(source, /reportGroup\.deliverToGroup\(scheduler\.wishesTarget\(row\), wish\.body,/);
  assert.match(fs.readFileSync(path.join(__dirname, "..", "src", "modules", "settings", "wishes", "scheduler.js"), "utf8"), /const wishesTarget = \(row\) => \(\{ messageKey: senderPolicy\.MESSAGE_KEYS\.WISHES, groupName: row\?\.wishesGroupName \}\);/);
});
