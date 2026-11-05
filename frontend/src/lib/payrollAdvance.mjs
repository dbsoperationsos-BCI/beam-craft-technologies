import { MONTH_NAMES, recoveryPreview } from "./payrollRecovery.mjs";

/**
 * HRM → Payroll → Advance Salary's form: an amount paid ahead of salary, taken back in full from one
 * month's payroll - the month it is "from". The server works the status out on every read, from
 * the payroll (Pending until that month's payroll is Paid, Deducted from then; one converted into a
 * recovery is the recovery's and is not listed); this only fills, checks and sends the forms - an advance's, and Convert to
 * Recovery's.
 */

export const ADVANCE_STATUSES = ["Pending", "Deducted"];

/** Today as `YYYY-MM-DD`, on this device's own calendar. */
export function localToday(today = new Date()) {
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

/** "October 2026" - the salary an advance comes out of. */
export const deductionMonthLabel = (year, month) => (month && year ? `${MONTH_NAMES[Number(month) - 1]} ${year}` : "");

/** A fresh form: given today, taken back from this month's salary. */
export function emptyAdvanceForm(today = new Date()) {
  return { advanceDate: localToday(today), employeeId: "", amount: "", deductMonth: String(today.getMonth() + 1), deductYear: String(today.getFullYear()), reason: "" };
}

/** The form for correcting a row the register holds. */
export const advanceFormFor = (row) => ({
  advanceDate: row.advanceDate || "",
  employeeId: String(row.employeeId),
  amount: String(row.amount),
  deductMonth: String(row.deductMonth),
  deductYear: String(row.deductYear),
  reason: row.reason || "",
});

/** What each field is missing, by field - the messages drawn under the fields themselves. */
export function advanceFieldErrors(form) {
  return {
    advanceDate: form.advanceDate ? "" : "Enter the date it was given.",
    employeeId: form.employeeId ? "" : "Choose the employee.",
    amount: Number(form.amount) > 0 ? "" : "Enter the amount.",
    deductMonth: form.deductMonth ? "" : "Choose the month.",
    deductYear: form.deductYear ? "" : "Choose the year.",
  };
}

/** What the form is missing, or "" once it can be saved. */
export function advanceFormProblem(form) {
  const errors = advanceFieldErrors(form);
  return Object.values(errors).find(Boolean) || "";
}

/** The total of some advances, to the paisa - what the recovery they are converted into takes back. */
export const advancesTotal = (advances) => Math.round(advances.reduce((sum, row) => sum + (Number(row.amount) || 0), 0) * 100) / 100;

/**
 * The form Convert to Recovery opens on: starting with the earliest month the advances were to come
 * out of - or this month, if that has passed - with the number of months left to choose, and a
 * reason that names them.
 */
export function conversionFormFor(advances, today = new Date()) {
  const earliest = Math.min(...advances.map((row) => (Number(row.deductYear) * 12) + Number(row.deductMonth) - 1));
  const start = Math.max(earliest, (today.getFullYear() * 12) + today.getMonth());
  return {
    startMonth: String((start % 12) + 1),
    startYear: String(Math.floor(start / 12)),
    months: "",
    reason: `Converted from ${advances.map((row) => row.advanceId).join(", ")}`,
  };
}

/** What the conversion form is missing, by field. */
export const conversionFieldErrors = (form) => ({
  startMonth: form.startMonth ? "" : "Choose the start month.",
  startYear: form.startYear ? "" : "Choose the start year.",
  months: Number(form.months) >= 1 ? "" : "Choose the number of months.",
});

/** The recovery's figures as the form stands - the Recovery form's own preview, over the advances' total. */
export const conversionPreview = (advances, form) => recoveryPreview({ ...form, totalAmount: String(advancesTotal(advances)) });

/** The conversion as the server takes it: the advances, never their employee or total - those are theirs. */
export const conversionPayload = (advances, form) => ({
  advanceIds: advances.map((row) => row.id),
  startMonth: Number(form.startMonth),
  startYear: Number(form.startYear),
  months: Number(form.months),
  reason: form.reason.trim() || null,
});

/** The form as the server takes it. */
export const advancePayload = (form) => ({
  advanceDate: form.advanceDate,
  employeeId: Number(form.employeeId),
  amount: Number(form.amount),
  deductMonth: Number(form.deductMonth),
  deductYear: Number(form.deductYear),
  reason: form.reason.trim() || null,
});
