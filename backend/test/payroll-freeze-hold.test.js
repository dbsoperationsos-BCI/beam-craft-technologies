const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const hold = require("../src/modules/hrm/payroll-register/freezeHold");
const recoveries = require("../src/modules/hrm/payroll-recovery/service");

/*
 * A frozen payroll month holds still until it is paid out: no Attendance Regularization for a day in
 * its pay cycle, and no new Salary Advance or Recovery for its employee, until after its payable date.
 */

const day = (iso) => new Date(`${iso}T00:00:00.000Z`);
// Noon in India on the day named.
const at = (iso) => new Date(`${iso}T06:30:00.000Z`);

// Kavya's October 2026 payroll is frozen: cycle 25 Aug - 24 Sep, paid out on 10 Oct. So is her
// September (paid out on 10 Sep, long gone) and her January 2027 (paid out on 10 Jan 2027). Arun's
// October is not frozen.
const ENTRIES = [
  { employeeId: 1, year: 2026, month: 9, frozen: true, periodFrom: day("2026-07-25"), periodTo: day("2026-08-24") },
  { employeeId: 1, year: 2026, month: 10, frozen: true, periodFrom: day("2026-08-25"), periodTo: day("2026-09-24") },
  { employeeId: 1, year: 2027, month: 1, frozen: true, periodFrom: day("2026-11-25"), periodTo: day("2026-12-24") },
  { employeeId: 2, year: 2026, month: 10, frozen: false, periodFrom: day("2026-08-25"), periodTo: day("2026-09-24") },
];

// Reads as the database would: the employees, frozen, and from this calendar month on (`OR`).
const onOrAfter = (entry, OR) => OR.some((clause) => (clause.year?.gt !== undefined ? entry.year > clause.year.gt : entry.year === clause.year && entry.month >= clause.month.gte));

function fakeClient() {
  return {
    payrollRuleVersion: { findMany: async () => [] },
    hrmSettings: { findUnique: async () => ({ payrollLopDivisor: "WORKING_DAYS", payrollRounding: "NEAREST_10", payCycleDay: 25, paybackDay: 10 }) },
    payrollEntry: {
      findMany: async ({ where }) => ENTRIES.filter((entry) => where.employeeId.in.includes(entry.employeeId) && entry.frozen === where.frozen && onOrAfter(entry, where.OR)),
    },
    employee: {
      findMany: async () => [{ id: 1, employeeId: "EMP-1", employeeName: "Kavya" }, { id: 2, employeeId: "EMP-2", employeeName: "Arun" }],
    },
  };
}

test("a frozen month holds until its payable date, and lets go the day after", async () => {
  const client = fakeClient();
  const onPayableDay = await hold.frozenHolds([1, 2], { client, now: at("2026-10-10") });
  // September is long paid out and not read at all; October holds to its payable day; January ahead holds.
  assert.deepEqual(onPayableDay.get(1).map((entry) => entry.label), ["October 2026", "January 2027"]);
  assert.deepEqual(onPayableDay.get(1)[0], { year: 2026, month: 10, label: "October 2026", from: "2026-08-25", to: "2026-09-24", payableOn: "2026-10-10" });
  assert.equal(onPayableDay.has(2), false, "a row not frozen holds nothing");
  assert.deepEqual((await hold.frozenHolds([1], { client, now: at("2026-10-11") })).get(1).map((entry) => entry.label), ["January 2027"]);
});

test("a day in the frozen pay cycle can't be regularized until the day after the payable date", async () => {
  const client = fakeClient();
  const message = await hold.regularizationHoldMessage(1, "2026-09-10", { client, now: at("2026-10-05") });
  assert.equal(message, "The October 2026 payroll (25 Aug 2026 to 24 Sept 2026) is frozen until it is paid out on 10 Oct 2026. Days in it can be regularized from 11 Oct 2026.");
  // Outside the cycle, somebody not frozen, or after the payable date: nothing holds.
  assert.equal(await hold.regularizationHoldMessage(1, "2026-09-25", { client, now: at("2026-10-05") }), "");
  assert.equal(await hold.regularizationHoldMessage(2, "2026-09-10", { client, now: at("2026-10-05") }), "");
  assert.equal(await hold.regularizationHoldMessage(1, "2026-09-10", { client, now: at("2026-10-11") }), "");
});

test("no new salary advance or recovery for a frozen employee until the day after the payable date", async () => {
  const client = fakeClient();
  await assert.rejects(
    hold.assertNoDeductionHold(client, 1, "salary advance", { now: at("2026-10-05") }),
    (error) => error.status === 409 && error.message === "This employee's October 2026 payroll is frozen until it is paid out on 10 Oct 2026. A new salary advance can be added from 11 Oct 2026.",
  );
  await hold.assertNoDeductionHold(client, 2, "recovery", { now: at("2026-10-05") });
  // On 11 Oct October has let go - but January 2027, frozen ahead, still holds.
  await assert.rejects(hold.assertNoDeductionHold(client, 1, "recovery", { now: at("2026-10-11") }), /January 2027 payroll is frozen until it is paid out on 10 Jan 2027/);
});

test("the employee pickers say who is held, so the form can say it as they are chosen", async () => {
  const rows = await recoveries.recoveryEmployees(null, { client: fakeClient(), statuses: async () => ["Active"] });
  // January 2027 holds whenever this runs before 11 Jan 2027; October too until 11 Oct 2026.
  assert.match(rows.find((row) => row.id === 1).frozenHold.month, /^(October 2026|January 2027)$/);
  assert.equal(rows.find((row) => row.id === 2).frozenHold, null);
});

test("every way in is checked: the regularization day, a new advance, a new recovery, and a conversion", () => {
  const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", ...parts), "utf8");
  assert.match(read("attendance", "controller.js"), /const held = await regularizationHoldMessage\(employeeId, localIsoDate\(day\)\);/);
  const ADVANCE = read("payroll-advance", "service.js");
  assert.match(ADVANCE, /await assertNoDeductionHold\(tx, input\.employeeId, "salary advance"\);/);
  assert.match(ADVANCE, /await assertNoDeductionHold\(tx, employeeId, "recovery"\);/);
  assert.match(read("payroll-recovery", "service.js"), /assertNoDeductionHold\(tx, input\.employeeId, "recovery"\);/);
});
