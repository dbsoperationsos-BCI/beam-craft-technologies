/**
 * HRM → Payroll → Recovery's figures, worked out from what is entered - the same rule the server
 * reads every row with (`backend/src/modules/hrm/payroll-recovery/service.js`), repeated here only
 * so the create form can show them while they are being typed. What the register shows is the
 * server's answer.
 *
 *   Monthly Deduction  the total over the months, to the paisa.
 *   Start Date         the 1st of the start month.
 *   End Date           the start moved on by the months: July 2026 over 4 is 1 Nov 2026.
 *   Status             the server's, from the payroll: Completed once every instalment month is
 *                      Paid on the Main Page, Active until then.
 */

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The most months one recovery may run over - the server's `MAX_MONTHS`. */
export const MAX_RECOVERY_MONTHS = 60;

export const RECOVERY_STATUSES = ["Active", "Completed"];

export function monthlyDeduction(totalAmount, months) {
  const count = Number(months) || 0;
  const total = Number(totalAmount) || 0;
  if (count < 1 || total <= 0) return 0;
  return Math.round((total / count) * 100) / 100;
}

function firstOfMonth(year, month) {
  const index = (Number(year) * 12) + (Number(month) - 1);
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01`;
}

export const startDateOf = (startYear, startMonth) => firstOfMonth(startYear, startMonth);
export const endDateOf = (startYear, startMonth, months) => firstOfMonth(startYear, Number(startMonth) + Number(months));

/** `2026-11-01` as "1 Nov 2026", the way the studio's sheet writes it. */
export function recoveryDate(key) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(key || ""));
  if (!match) return "";
  return `${Number(match[3])} ${SHORT_MONTHS[Number(match[2]) - 1]} ${match[1]}`;
}

/**
 * Why nothing new can be raised for an employee whose payroll month is frozen until it is paid out
 * (`frozenHold` on the employee pickers), as the server says it, with the day it can - or "" where
 * nothing holds. `what` is the term in running text: "salary advance", "recovery".
 */
export function frozenHoldMessage(hold, what) {
  if (!hold?.month || !hold?.payableOn) return "";
  const next = new Date(`${hold.payableOn}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return `This employee's ${hold.month} payroll is frozen until it is paid out on ${recoveryDate(hold.payableOn)}. A new ${what} can be added from ${recoveryDate(next.toISOString())}.`;
}

export const rupees = (value) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(value) || 0);

export const monthOptions = MONTH_NAMES.map((label, index) => ({ label, value: String(index + 1) }));

/**
 * The years a picker offers, oldest first: by default last year to two years on - a recovery or an
 * advance is set up around now, not decades away - plus the year a record being corrected already
 * starts in, so an older one never opens on a blank year. `back` and `ahead` widen it; `first` fixes
 * where it starts instead - the payroll register runs from the studio's first payroll year
 * (`REGISTER_YEARS`).
 */
export function yearOptions(today = new Date(), keep = null, { back = 1, ahead = 2, first = null } = {}) {
  const year = today.getFullYear();
  const start = first ?? year - back;
  const years = Array.from({ length: Math.max(0, year + ahead - start) + 1 }, (_, index) => start + index);
  if (keep && !years.includes(Number(keep))) years.push(Number(keep));
  return years.sort((a, b) => a - b).map((value) => ({ label: String(value), value: String(value) }));
}

/** The payroll register's years: from 2026, the studio's first payroll year, to ten years on - 2026 to 2036 in 2026. */
export const REGISTER_YEARS = { first: 2026, ahead: 10 };

export const monthCountOptions = Array.from({ length: MAX_RECOVERY_MONTHS }, (_, index) => ({ label: String(index + 1), value: String(index + 1) }));

/** A fresh form: this month, this year, one month. */
export function emptyRecoveryForm(today = new Date()) {
  return { employeeId: "", totalAmount: "", startMonth: String(today.getMonth() + 1), startYear: String(today.getFullYear()), months: "1", reason: "" };
}

/*
 * A policy breach is taken as an AMOUNT - the fine, as a recovery is - or as LOP: loss-of-pay days
 * spread over the months in half days, the extra halves to the earliest months, as the server splits
 * them (`payroll-policy-breach/service.js`). A form with no `deductBy` is an amount - a recovery's always
 * is - and the LOP keys are added only once LOP is chosen, so a recovery's form, errors and preview are
 * exactly as they were.
 */
export const DEDUCT_BY_OPTIONS = [{ label: "Amount", value: "AMOUNT" }, { label: "LOP", value: "LOP" }];
export const isLopForm = (form) => form?.deductBy === "LOP";

/** The days of an LOP breach month by month, in half days: 10 over 3 is 3.5, 3.5, 3. */
export function lopDaysSplit(totalDays, months) {
  const count = Number(months) || 0;
  const halves = Math.round((Number(totalDays) || 0) * 2);
  if (count < 1 || halves <= 0) return [];
  const base = Math.floor(halves / count);
  const extra = halves % count;
  return Array.from({ length: count }, (_, index) => (base + (index < extra ? 1 : 0)) / 2);
}

/** "2.5 days", "1 day". */
export const dayCount = (value) => `${Number(value) || 0} ${Number(value) === 1 ? "day" : "days"}`;

/** A month's share of an LOP breach: one figure when every month is the same, else each in turn. */
export function lopDaysPerMonthText(split = []) {
  if (!split.length) return "";
  return split.every((value) => value === split[0]) ? dayCount(split[0]) : `${split.join(", ")} days`;
}

/** Whole or half days - what an LOP breach can be entered in. */
const halfDays = (value) => Number(value) > 0 && Number.isInteger(Number(value) * 2);

/** The form for correcting a row the register holds. */
export const recoveryFormFor = (row) => ({
  employeeId: String(row.employeeId),
  ...(row.deductBy === "LOP"
    ? { deductBy: "LOP", totalAmount: "", totalDays: row.totalDays === null || row.totalDays === undefined ? "" : String(row.totalDays) }
    : { totalAmount: String(row.totalAmount) }),
  startMonth: String(row.startMonth),
  startYear: String(row.startYear),
  months: String(row.months),
  reason: row.reason || "",
});

/** What each field is missing, by field - the messages drawn under the fields themselves. */
export function recoveryFieldErrors(form) {
  return {
    employeeId: form.employeeId ? "" : "Choose the employee.",
    totalAmount: isLopForm(form) || Number(form.totalAmount) > 0 ? "" : "Enter the total amount.",
    ...(isLopForm(form) ? { totalDays: halfDays(form.totalDays) ? "" : "Enter the total days, in whole or half days." } : {}),
    startMonth: form.startMonth ? "" : "Choose the start month.",
    startYear: form.startYear ? "" : "Choose the start year.",
    months: Number(form.months) >= 1 ? "" : "Choose the number of months.",
  };
}

/** What the form is missing, or "" once it can be saved. */
export function recoveryFormProblem(form) {
  if (!form.employeeId) return "Choose the employee.";
  if (isLopForm(form) ? !halfDays(form.totalDays) : !(Number(form.totalAmount) > 0)) return isLopForm(form) ? "Enter the total days, in whole or half days." : "Enter the total amount.";
  if (!form.startMonth || !form.startYear) return "Choose the start month and year.";
  if (!(Number(form.months) >= 1)) return "Choose the number of months.";
  return "";
}

/** The form as the server takes it. */
// An LOP breach sends its days and says so; an amount sends exactly what it always has.
export const recoveryPayload = (form) => ({
  employeeId: Number(form.employeeId),
  ...(isLopForm(form) ? { deductBy: "LOP", totalDays: Number(form.totalDays) } : { totalAmount: Number(form.totalAmount) }),
  startMonth: Number(form.startMonth),
  startYear: Number(form.startYear),
  months: Number(form.months),
  reason: form.reason.trim() || null,
});

/** `2026-07-01` as "Jul 2026" - a month, for saying which salaries a deduction comes out of. */
export function monthLabel(key) {
  const match = /^(\d{4})-(\d{2})/.exec(String(key || ""));
  return match ? `${SHORT_MONTHS[Number(match[2]) - 1]} ${match[1]}` : "";
}

/**
 * What the form shows under the fields as they are typed: the three worked-out figures, and the
 * salaries the deductions come out of - the start month to the month before the end date, which is
 * the 1st after the last deduction (July 2026 over 4 ends 1 Nov 2026, deducted Jul-Oct). The monthly
 * figure is `null` until there is an amount, so nothing reads as a real ₹0.
 */
export function recoveryPreview(form) {
  if (!form.startMonth || !form.startYear || !(Number(form.months) >= 1)) return null;
  const startDate = startDateOf(form.startYear, form.startMonth);
  const lastMonth = firstOfMonth(form.startYear, Number(form.startMonth) + Number(form.months) - 1);
  return {
    monthlyDeduction: Number(form.totalAmount) > 0 ? monthlyDeduction(form.totalAmount, form.months) : null,
    // An LOP breach's days a month, as the summary shows them - a dash until days are typed.
    ...(isLopForm(form) ? { monthlyDays: halfDays(form.totalDays) ? lopDaysPerMonthText(lopDaysSplit(form.totalDays, form.months)) : null } : {}),
    startDate,
    endDate: endDateOf(form.startYear, form.startMonth, form.months),
    deducted: Number(form.months) === 1 ? `Deducted from the ${monthLabel(startDate)} salary.` : `Deducted from the ${monthLabel(startDate)} to ${monthLabel(lastMonth)} salaries.`,
  };
}
