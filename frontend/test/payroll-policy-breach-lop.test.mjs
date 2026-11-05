import test from "node:test";
import assert from "node:assert/strict";
import { emptyRecoveryForm, lopDaysPerMonthText, lopDaysSplit, recoveryFieldErrors, recoveryFormFor, recoveryFormProblem, recoveryPayload, recoveryPreview } from "../src/lib/payrollRecovery.mjs";
import { payrollFigures } from "../src/lib/payrollRegister.mjs";

/*
 * Create Policy Breach: Deduct by Amount (as before) or LOP, where Total Amount becomes Total Days.
 * A recovery shares these helpers and never leaves Amount, so what it sends must not change.
 */

const form = (over = {}) => ({ ...emptyRecoveryForm(new Date(2026, 9, 1)), employeeId: "7", months: "4", ...over });

test("a new form starts on Amount, and an amount sends exactly what it always did", () => {
  // No `deductBy` is Amount - a recovery's form never gains one.
  assert.equal(emptyRecoveryForm().deductBy, undefined);
  assert.deepEqual(recoveryPayload(form({ totalAmount: "40000" })), { employeeId: 7, totalAmount: 40000, startMonth: 10, startYear: 2026, months: 4, reason: null });
});

test("LOP sends its days and says so, and no amount", () => {
  assert.deepEqual(recoveryPayload(form({ deductBy: "LOP", totalDays: "10", totalAmount: "40000" })), { employeeId: 7, deductBy: "LOP", totalDays: 10, startMonth: 10, startYear: 2026, months: 4, reason: null });
});

test("each way checks its own figure; LOP days are whole or half", () => {
  assert.equal(recoveryFormProblem(form({ deductBy: "LOP", totalDays: "" })), "Enter the total days, in whole or half days.");
  assert.equal(recoveryFormProblem(form({ deductBy: "LOP", totalDays: "2.3" })), "Enter the total days, in whole or half days.");
  assert.equal(recoveryFormProblem(form({ deductBy: "LOP", totalDays: "2.5" })), "");
  assert.equal(recoveryFieldErrors(form({ deductBy: "LOP", totalDays: "3" })).totalAmount, "", "an LOP breach asks no amount");
  assert.equal(recoveryFormProblem(form({ totalAmount: "" })), "Enter the total amount.");
  assert.equal(recoveryFieldErrors(form({ totalAmount: "5" })).totalDays, undefined, "an amount asks no days");
});

test("the summary shows the days a month - one figure when even, each in turn when not", () => {
  assert.equal(recoveryPreview(form({ deductBy: "LOP", totalDays: "10" })).monthlyDays, "2.5 days");
  assert.equal(recoveryPreview(form({ deductBy: "LOP", totalDays: "10", months: "3" })).monthlyDays, "3.5, 3.5, 3 days");
  assert.equal(recoveryPreview(form({ deductBy: "LOP", totalDays: "" })).monthlyDays, null);
  assert.equal(recoveryPreview(form({ totalAmount: "40000" })).monthlyDeduction, 10000);
  assert.equal(lopDaysPerMonthText([1]), "1 day");
  assert.deepEqual(lopDaysSplit(10, 3), [3.5, 3.5, 3]);
});

test("editing an LOP breach opens on LOP with its days, an amount one on Amount", () => {
  const lop = recoveryFormFor({ employeeId: 7, deductBy: "LOP", totalAmount: 0, totalDays: 4, startMonth: 10, startYear: 2026, months: 2, reason: "" });
  assert.equal(lop.deductBy, "LOP");
  assert.equal(lop.totalDays, "4");
  assert.equal(lop.totalAmount, "");
  const amount = recoveryFormFor({ employeeId: 7, totalAmount: 500, startMonth: 10, startYear: 2026, months: 2, reason: "" });
  assert.equal(amount.deductBy, undefined, "an amount opens on Amount, the form's default");
  assert.equal(amount.totalAmount, "500");
});

test("the Main Page counts an LOP breach's days in Total Leaves, as the server does", () => {
  const entry = { baseSalary: 30000, workingDays: 30, periodDays: 30, attendanceLeaves: 1, policyBreachLeaves: 1, policyBreachLopDays: 2.5 };
  assert.equal(payrollFigures(entry, { lopDivisor: "WORKING_DAYS", rounding: "NEAREST_10" }).totalLeaves, 4.5);
});
