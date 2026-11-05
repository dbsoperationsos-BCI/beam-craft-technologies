const test = require("node:test");
const assert = require("node:assert/strict");
const { lopDaysSplit, policyBreachDueIn, toRow } = require("../src/modules/hrm/payroll-policy-breach/service");
const { policyBreachSchema } = require("../src/modules/hrm/payroll-policy-breach/controller");

/*
 * A policy breach taken as LOP: `totalDays` of loss of pay over its months, in half days, each month's
 * share brought into that payroll row as Policy Breach LOP Days. An AMOUNT breach is exactly as before.
 */

const breach = (over = {}) => ({ policyBreachId: "PB-1", deductBy: "AMOUNT", totalAmount: 40000, totalDays: null, startYear: 2026, startMonth: 10, months: 4, deletedAt: null, skips: [], ...over });

test("the days are split in half days, the extra halves to the earliest months, and add up exactly", () => {
  assert.deepEqual(lopDaysSplit(10, 4), [2.5, 2.5, 2.5, 2.5]);
  assert.deepEqual(lopDaysSplit(10, 3), [3.5, 3.5, 3]);
  assert.deepEqual(lopDaysSplit(4, 2), [2, 2]);
  assert.deepEqual(lopDaysSplit(0, 3), []);
  for (const [days, months] of [[10, 3], [7.5, 4], [1, 4], [31, 6]]) {
    assert.equal(lopDaysSplit(days, months).reduce((sum, value) => sum + value, 0), days);
  }
});

test("an AMOUNT breach takes the amount it always did, and no days", () => {
  assert.deepEqual(policyBreachDueIn(2026, 10, [breach()]), { amount: 10000, lopDays: 0, policyBreachIds: ["PB-1"] });
  // A row written before the column existed reads as AMOUNT.
  assert.equal(policyBreachDueIn(2026, 10, [breach({ deductBy: undefined })]).amount, 10000);
});

test("an LOP breach takes its month's share of days, and no amount", () => {
  const lop = breach({ deductBy: "LOP", totalAmount: 0, totalDays: 10, months: 3 });
  assert.deepEqual(policyBreachDueIn(2026, 10, [lop]), { amount: 0, lopDays: 3.5, policyBreachIds: ["PB-1"] });
  assert.equal(policyBreachDueIn(2026, 12, [lop]).lopDays, 3);
  assert.deepEqual(policyBreachDueIn(2027, 1, [lop]), { amount: 0, lopDays: 0, policyBreachIds: [] });
  // Both kinds in one month: each adds to its own figure.
  const both = policyBreachDueIn(2026, 10, [breach({ policyBreachId: "PB-2" }), lop]);
  assert.equal(both.amount, 10000);
  assert.equal(both.lopDays, 3.5);
});

test("a skipped month takes nothing, and the share it would have taken moves to the month after", () => {
  const lop = breach({ deductBy: "LOP", totalAmount: 0, totalDays: 10, months: 3, skips: [{ year: 2026, month: 10 }] });
  assert.equal(policyBreachDueIn(2026, 10, [lop]).lopDays, 0);
  assert.deepEqual([11, 12].map((month) => policyBreachDueIn(2026, month, [lop]).lopDays), [3.5, 3.5]);
  assert.equal(policyBreachDueIn(2027, 1, [lop]).lopDays, 3);
});

test("the register row says how it is taken, in the unit it is taken in", () => {
  const row = toRow(breach({ deductBy: "LOP", totalAmount: 0, totalDays: 10, months: 3, employee: {} }));
  assert.equal(row.deductBy, "LOP");
  assert.equal(row.totalDays, 10);
  assert.equal(row.monthlyDeduction, 0);
  assert.deepEqual(row.lopDaysPerMonth, [3.5, 3.5, 3]);
  const amount = toRow(breach({ employee: {} }));
  assert.equal(amount.deductBy, "AMOUNT");
  assert.equal(amount.totalDays, null);
  assert.equal(amount.monthlyDeduction, 10000);
  assert.deepEqual(amount.lopDaysPerMonth, []);
});

test("each way asks for its own figure; days are whole or half; a client sending neither kind is AMOUNT", () => {
  const base = { employeeId: 1, startMonth: 10, startYear: 2026, months: 4 };
  assert.equal(policyBreachSchema.safeParse({ ...base, totalAmount: 40000 }).data.deductBy, "AMOUNT");
  assert.equal(policyBreachSchema.safeParse({ ...base }).success, false, "an amount breach needs its amount");
  assert.equal(policyBreachSchema.safeParse({ ...base, deductBy: "LOP" }).success, false, "an LOP breach needs its days");
  assert.equal(policyBreachSchema.safeParse({ ...base, deductBy: "LOP", totalDays: 2.5 }).success, true);
  assert.equal(policyBreachSchema.safeParse({ ...base, deductBy: "LOP", totalDays: 2.3 }).success, false);
  assert.equal(policyBreachSchema.safeParse({ ...base, deductBy: "LOP", totalDays: 0 }).success, false);
  assert.equal(policyBreachSchema.safeParse({ ...base, deductBy: "OTHER", totalAmount: 5 }).success, false);
});

test("the figure for the way not chosen, left blank, is ignored rather than refused", () => {
  const base = { employeeId: 1, startMonth: 10, startYear: 2026, months: 4 };
  assert.equal(policyBreachSchema.safeParse({ ...base, deductBy: "LOP", totalDays: 4, totalAmount: "" }).success, true);
  assert.equal(policyBreachSchema.safeParse({ ...base, deductBy: "LOP", totalDays: 4, totalAmount: null }).success, true);
  assert.equal(policyBreachSchema.safeParse({ ...base, totalAmount: 500, totalDays: "" }).success, true);
  assert.equal(policyBreachSchema.safeParse({ ...base, totalAmount: "" }).success, false, "the chosen figure is still required");
});
