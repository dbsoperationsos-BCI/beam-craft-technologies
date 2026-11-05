/**
 * HRM → Payroll → Main Page's figures - the same rule the server reads every row with
 * (`backend/src/modules/hrm/payroll-register/service.js`), repeated here only so the edit form can
 * show them while they are being typed. What the register shows is the server's answer.
 *
 *   Total Earned      base salary + incentive + the extra earnings
 *   Total Leaves      attendance leaves + policy breach leaves
 *   LOP Deduction     a day's pay × total leaves - a day's pay being the base salary over the pay
 *                     cycle's working days, its calendar days or a fixed 30 (Settings → Payroll rules)
 *   Total Deductions  LOP + salary advance + recovery deduction + policy breach deduction + other
 *                     deductions + the extra deductions
 *
 * The extra columns are the ones Settings → Payroll rules adds under Earnings or Deductions: a row
 * holds their amounts by column id (`componentAmounts`), and the month says which kind each is.
 *   Net Salary        total earned − total deductions
 *   Rounded Salary    the net rounded by the rule
 */

export const PAYMENT_STATUSES = ["Pending", "Paid", "On Hold"];

export const LOP_DIVISOR_OPTIONS = [
  { value: "WORKING_DAYS", label: "Working days in the pay cycle" },
  { value: "CALENDAR_DAYS", label: "Calendar days in the pay cycle" },
  { value: "FIXED_30", label: "A fixed 30 days" },
];

export const ROUNDING_OPTIONS = [
  { value: "NEAREST_100", label: "Nearest ₹100" },
  { value: "NEAREST_50", label: "Nearest ₹50" },
  { value: "NEAREST_10", label: "Nearest ₹10" },
  { value: "NEAREST_1", label: "Nearest ₹1" },
  { value: "DOWN_1", label: "Down to the ₹1" },
];

const number = (value) => Number(value) || 0;
const money = (value) => Math.round(Number(value) * 100) / 100;

export function roundedSalary(net, rounding) {
  if (rounding === "NEAREST_100") return Math.round(net / 100) * 100;
  if (rounding === "NEAREST_50") return Math.round(net / 50) * 50;
  if (rounding === "NEAREST_1") return Math.round(net);
  if (rounding === "DOWN_1") return Math.floor(net);
  return Math.round(net / 10) * 10;
}

/** A row's extra columns totalled by kind: `amounts` by column id, `columns` the month's `{ id, kind }`. */
export function extrasOf(amounts = {}, columns = []) {
  const totals = { EARNING: 0, DEDUCTION: 0 };
  for (const column of columns) {
    if (column.kind in totals) totals[column.kind] += number(amounts?.[column.id]);
  }
  return { earnings: totals.EARNING, deductions: totals.DEDUCTION };
}

export function payrollFigures(entry, rules = { lopDivisor: "WORKING_DAYS", rounding: "NEAREST_10" }, columns = []) {
  const divisor = rules.lopDivisor === "CALENDAR_DAYS" ? number(entry.periodDays) : rules.lopDivisor === "FIXED_30" ? 30 : number(entry.workingDays);
  const dayRate = divisor > 0 ? number(entry.baseSalary) / divisor : 0;
  const extras = extrasOf(entry.componentAmounts, columns);
  const totalEarned = number(entry.baseSalary) + number(entry.incentive) + extras.earnings;
  // Every day away and every policy breach, less the leave Casual Leave covered - as the server counts it.
  // Days before joining and after relieving are unpaid days like any other loss of pay - the server's
  // figures, previewed alike.
  // The irregularity penalty is loss of pay too, on top of the absent days it was for.
  // An LOP policy breach's days are loss of pay as well, beside the typed Policy Breach Leaves.
  const totalLeaves = Math.max(0, number(entry.attendanceLeaves) + number(entry.policyBreachLeaves) + number(entry.policyBreachLopDays) + number(entry.irregularityPenaltyDays) + number(entry.daysBeforeJoining) + number(entry.daysAfterRelieving) - number(entry.casualLeaveDays));
  const lopDeduction = dayRate * totalLeaves;
  const totalDeductions = lopDeduction + number(entry.salaryAdvance) + number(entry.recoveryDeduction) + number(entry.policyBreachDeduction) + number(entry.otherDeductions) + extras.deductions;
  // An approved late change to an earlier month, paid or taken back here.
  const netSalary = totalEarned - totalDeductions;
  return {
    totalEarned: money(totalEarned),
    totalLeaves: money(totalLeaves),
    dayRate: money(dayRate),
    lopDeduction: money(lopDeduction),
    totalDeductions: money(totalDeductions),
    netSalary: money(netSalary),
    roundedSalary: roundedSalary(netSalary, rules.rounding),
  };
}

/** What a day's pay is divided by, in words, for the form's note. */
export function divisorText(entry, rules) {
  if (rules?.lopDivisor === "CALENDAR_DAYS") return `${entry.periodDays} calendar days`;
  if (rules?.lopDivisor === "FIXED_30") return "30 days";
  return `${entry.workingDays} working days`;
}

/** The form for one row: what may be typed on it, as text for the fields - each extra column by its id. */
export const payrollFormFor = (row, columns = []) => ({
  incentive: String(row.incentive ?? 0),
  attendanceLeaves: String(row.attendanceLeaves ?? 0),
  policyBreachLeaves: String(row.policyBreachLeaves ?? 0),
  otherDeductions: String(row.otherDeductions ?? 0),
  remarks: row.remarks || "",
  paymentStatus: row.paymentStatus || "Pending",
  paymentModeId: row.paymentModeId ? String(row.paymentModeId) : "",
  costCentreBranchId: row.costCentreBranchId ? String(row.costCentreBranchId) : "",
  paymentFrom: row.paymentFrom || "",
  paymentDate: row.paymentDate || "",
  paymentRemarks: row.paymentRemarks || "",
  components: Object.fromEntries(columns.map((column) => [String(column.id), String(row.componentAmounts?.[column.id] ?? 0)])),
});

/** The extra columns' amounts the form holds, as numbers by column id. */
export const formComponentAmounts = (form) => Object.fromEntries(Object.entries(form?.components || {}).map(([id, value]) => [id, Number(value) || 0]));

/** What the form is missing, by field, or nothing once it can be saved. */
export function payrollFormErrors(form) {
  const errors = {};
  for (const field of ["incentive", "attendanceLeaves", "policyBreachLeaves", "otherDeductions"]) {
    if (form[field] !== "" && !(Number(form[field]) >= 0)) errors[field] = "Enter 0 or more.";
  }
  for (const [id, value] of Object.entries(form.components || {})) {
    if (value !== "" && !(Number(value) >= 0)) errors[`component:${id}`] = "Enter 0 or more.";
  }
  if (!form.paymentStatus) errors.paymentStatus = "Choose the payment status.";
  if (form.paymentStatus === "Paid") {
    if (!form.paymentModeId) errors.paymentModeId = "Choose how it was paid.";
    if (!form.paymentDate) errors.paymentDate = "Enter the payment date.";
  }
  return errors;
}

/**
 * The form as the server takes it. A paid row sends only its payment - its figures are settled - so
 * correcting how a paid month was paid never trips over figures nobody changed.
 */
export function payrollPayload(form, { paid = false, force = false } = {}) {
  const payment = {
    paymentStatus: form.paymentStatus,
    paymentModeId: form.paymentModeId ? Number(form.paymentModeId) : null,
    costCentreBranchId: form.costCentreBranchId ? Number(form.costCentreBranchId) : null,
    paymentFrom: form.paymentFrom || null,
    paymentDate: form.paymentDate || null,
    paymentRemarks: form.paymentRemarks.trim() || null,
  };
  // A paid row staying paid, or a frozen one (`force`), sends its payment only: its figures are settled.
  if ((paid && form.paymentStatus === "Paid") || force) return payment;
  return {
    incentive: Number(form.incentive) || 0,
    attendanceLeaves: Number(form.attendanceLeaves) || 0,
    policyBreachLeaves: Number(form.policyBreachLeaves) || 0,
    otherDeductions: Number(form.otherDeductions) || 0,
    remarks: form.remarks.trim() || null,
    ...(Object.keys(form.components || {}).length ? { components: formComponentAmounts(form) } : {}),
    ...payment,
  };
}

/*
 * Payroll rules → Hold salary during notice, as the server read it for a row (`row.noticeHold`): null for
 * nearly everybody. A held month is paid only by the leaver's full and final settlement - the month
 * holding their last working day - which pays its own salary and every held month's together.
 */
const HOLD_STATUS = { held: "Held for notice", settlement: "Final settlement", settled: "Settled" };

/** `{ status, detail }` for a row's hold, or null. */
export function noticeHoldOf(row, money = String) {
  const hold = row?.noticeHold;
  if (!hold?.state || !HOLD_STATUS[hold.state]) return null;
  if (hold.state === "held") {
    return { status: HOLD_STATUS.held, detail: `Paid with the ${hold.settlesIn?.label ? `${hold.settlesIn.label} ` : ""}final settlement` };
  }
  if (hold.state === "settled") {
    return { status: HOLD_STATUS.settled, detail: `Paid in the ${hold.settlesIn?.label ? `${hold.settlesIn.label} ` : ""}final settlement` };
  }
  const months = (hold.released || []).map((held) => held.label);
  return {
    status: HOLD_STATUS.settlement,
    detail: months.length
      ? `${money(hold.finalSettlement)}: this month and ${months.length === 1 ? months[0] : `${months.length} held months (${months.join(", ")})`}`
      : `${money(hold.finalSettlement)}: no months were held`,
  };
}

/** What paying a row pays out: a final settlement its held months as well, any other row its own salary. */
export const amountToPay = (row) => Number(row?.noticeHold?.state === "settlement" ? row.noticeHold.finalSettlement : row?.roundedSalary) || 0;

/** A held month is paid by its settlement, never on its own. */
export const heldForNotice = (row) => row?.noticeHold?.state === "held";

/*
 * The payment status the register shows and files a row under: a month held for the notice reads
 * On Hold, though it stays Pending on record - the final settlement is what pays it, and marking that
 * Paid settles it with the rest. Every other row reads as it is stored.
 */
/** The name the register shows: "(Serving Notice)" after it while the month is held for the notice. */
export const shownEmployeeName = (row) => (row?.employeeName ? `${row.employeeName}${heldForNotice(row) ? " (Serving Notice)" : ""}` : "-");

export const shownPaymentStatus = (row) => (heldForNotice(row) && row?.paymentStatus !== "Paid" ? "On Hold" : row?.paymentStatus);
