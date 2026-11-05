const { z } = require("zod");
const service = require("./service");
const components = require("./components");
const skips = require("./skips");
const advanceService = require("../payroll-advance/service");
const recoveryService = require("../payroll-recovery/service");
const policyBreachService = require("../payroll-policy-breach/service");
const { payslipGenerateDaysAfter } = require("../../../services/payslipHeading");
const iamService = require("../../../services/iam.service");
const monthLock = require("./monthLock");

/*
 * HTTP for HRM → Payroll → Main Page and Settings → Payroll rules. Validation and status codes here;
 * the register and its figures in `service.js`.
 */

const monthSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

const amount = z.coerce.number().min(0).max(100000000);
const days = z.coerce.number().min(0).max(62);
const optionalText = (max) => z.string().trim().max(max).nullable().optional();

// A real day, not just its shape: 2026-02-31 is refused here rather than failing in the database.
const paymentDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the payment date.")
  .refine((value) => { const date = new Date(`${value}T00:00:00Z`); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value; }, "Enter a real payment date.");
// Mark Paid's rows per request: each is checked and saved on its own, so a request stays well inside a timeout.
const MARK_PAID_LIMIT = 100;

/** What may be typed on a row. Every key optional: a save sends what changed. */
const entrySchema = z.object({
  // Brought in from the employee's salary on generate and refresh, and correctable by hand.
  baseSalary: amount.optional(),
  incentive: amount.optional(),
  attendanceLeaves: days.optional(),
  policyBreachLeaves: days.optional(),
  otherDeductions: amount.optional(),
  remarks: optionalText(2000),
  paymentStatus: z.enum(service.PAYMENT_STATUSES).optional(),
  paymentModeId: z.coerce.number().int().positive().nullable().optional(),
  paymentFrom: optionalText(120),
  paymentDate: paymentDateSchema.nullable().optional(),
  paymentRemarks: optionalText(2000),
  // Payment → Cost Centre: a branch's id, or null to clear it.
  costCentreBranchId: z.coerce.number().int().positive().nullable().optional(),
  // Payment → Freeze: settles the row's figures until it is unfrozen.
  frozen: z.boolean().optional(),
  // Hands a Base Salary or Attendance Leaves typed by hand back to attendance and the salary on record.
  useCalculated: z.literal(true).optional(),
  // The extra columns' amounts, by column id: `{ "3": 1500 }`. 0 clears one.
  components: z.record(z.string().regex(/^\d{1,9}$/, "Unknown column."), amount).optional(),
}).strict();

const columnName = z.string().trim().min(1, "Name the column.").max(60, "Keep the name to 60 characters.");
/** A new extra column: its name, and whether it is an earning or a deduction. */
const componentSchema = z.object({ name: columnName, kind: z.enum(components.KINDS) }).strict();
/** A rename, an archive or a restore - never its kind. */
const componentUpdateSchema = z.object({ name: columnName.optional(), archived: z.boolean().optional(), shownOnPayslip: z.boolean().optional() }).strict()
  .refine((value) => value.name !== undefined || value.archived !== undefined || value.shownOnPayslip !== undefined, "Nothing to change.");

/** Mark Paid over the ticked rows: which, and the one payment they share. */
const markPaidSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1, "Select at least one row.").max(MARK_PAID_LIMIT),
  paymentModeId: z.coerce.number().int().positive("Choose the payment mode."),
  paymentDate: paymentDateSchema,
  paymentFrom: z.string().trim().max(120).nullable().optional(),
  paymentRemarks: z.string().trim().max(2000).nullable().optional(),
}).strict();

const rulesSchema = z.object({
  lopDivisor: z.enum(service.LOP_DIVISORS),
  rounding: z.enum(service.ROUNDING_RULES),
});

const idOf = (req) => {
  const id = Number(req.params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
};
const userIdOf = (req) => Number(req.user?.id) || null;
// The branches this caller reaches through `HRM / Payroll Register` - `null` for everywhere.
const reachOf = (req) => service.reachFor(req.user?.id);
// And through the module a Skip changes as well: Advance Salary's, Recovery's or Policy Breach's, by kind.
const KIND_SERVICES = { advance: advanceService, recovery: recoveryService, "policy-breach": policyBreachService };
const kindReachOf = (req, kind) => KIND_SERVICES[kind].reachFor(req.user?.id);

/*
 * A month past its payable date is locked (`monthLock`): only somebody holding `HRM / Payroll After
 * Payday` - the Super Admin - may change it. Asked before every write below.
 */
const canEditLocked = (req) => iamService.hasPermission(userIdOf(req), monthLock.LOCK_PERMISSION.module, monthLock.LOCK_PERMISSION.feature, "READ_WRITE");
const rowOpen = async (req, id) => monthLock.assertRowOpen(id, await canEditLocked(req));

/** A deliberate error keeps its message; anything unexpected is logged here and never echoed. */
function handleError(res, error, fallback, action) {
  if (error.status) return res.status(error.status).json({ message: error.message });
  console.error(`Payroll register ${action} failed:`, error);
  return res.status(500).json({ message: fallback });
}

const validationError = (res, error) => res.status(400).json({ message: error.issues?.[0]?.message || "Validation failed", errors: error.issues });

async function list(req, res) {
  const parsed = monthSchema.safeParse(req.query || {});
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    const [data, lock, canEdit] = await Promise.all([service.listEntries(parsed.data, await reachOf(req)), monthLock.monthLock(parsed.data.year, parsed.data.month), canEditLocked(req)]);
    // Whether the month is locked, and whether this reader may still change it - so the page can hide
    // what would be refused.
    return res.json({ data, lock: { locked: lock.locked, payableOn: lock.payableOn, canEdit: !lock.locked || canEdit } });
  } catch (error) { return handleError(res, error, "Unable to load the payroll.", "list"); }
}

/**
 * The month brought up to date as the Main Page opens it (`syncMonth`): the month still being paid and
 * every later one read again and filled in, an earlier one only filled in where it has no rows.
 */
async function sync(req, res) {
  const parsed = monthSchema.safeParse(req.body || {});
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    // A locked month is only filled in - never read again - and only by somebody who may change it.
    const { locked } = await monthLock.monthLock(parsed.data.year, parsed.data.month);
    if (locked && !(await canEditLocked(req))) return res.json({ data: { earlier: true, ahead: false, locked: true, added: 0, refreshed: 0 } });
    return res.json({ data: await service.syncMonth(parsed.data, userIdOf(req), await reachOf(req)) });
  } catch (error) { return handleError(res, error, "Unable to bring the payroll up to date.", "sync"); }
}

/** Skips a row's Salary Advance, Recovery or Policy Breach Deduction (`:kind` advance | recovery | policy-breach) for its month. */
async function skip(req, res) {
  const id = idOf(req);
  const { kind } = req.params;
  if (!id || !skips.KINDS.includes(kind)) return res.status(404).json({ message: "This payroll row could not be found." });
  try {
    await rowOpen(req, id);
    return res.json({ data: await skips.skipDeduction(id, kind, userIdOf(req), { reach: await reachOf(req), kindReach: await kindReachOf(req, kind) }) });
  } catch (error) { return handleError(res, error, "Unable to skip this deduction.", "skip"); }
}

/** Undoes the skip of a row's Salary Advance, Recovery or Policy Breach Deduction for its month. */
async function undoSkip(req, res) {
  const id = idOf(req);
  const { kind } = req.params;
  if (!id || !skips.KINDS.includes(kind)) return res.status(404).json({ message: "This payroll row could not be found." });
  try {
    await rowOpen(req, id);
    return res.json({ data: await skips.undoSkip(id, kind, userIdOf(req), { reach: await reachOf(req), kindReach: await kindReachOf(req, kind) }) });
  } catch (error) { return handleError(res, error, "Unable to undo this skip.", "undo skip"); }
}

async function update(req, res) {
  const id = idOf(req);
  if (!id) return res.status(404).json({ message: "This payroll row could not be found." });
  const parsed = entrySchema.safeParse(req.body || {});
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    await rowOpen(req, id);
    return res.json({ data: await service.updateEntry(id, parsed.data, userIdOf(req), await reachOf(req)) });
  } catch (error) { return handleError(res, error, "Unable to save this row.", "update"); }
}

// Why a row is taken off its month - kept with it, for whoever looks at the Removed rows later.
const removeSchema = z.object({ reason: z.string().trim().min(1, "Say why this row is removed.").max(500, "Keep the reason to 500 characters.") }).strict();

async function remove(req, res) {
  const id = idOf(req);
  if (!id) return res.status(404).json({ message: "This payroll row could not be found." });
  const parsed = removeSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Say why this row is removed." });
  try {
    await rowOpen(req, id);
    await service.removeEntry(id, await reachOf(req), { userId: userIdOf(req), reason: parsed.data.reason });
    return res.json({ message: "Payroll row removed." });
  } catch (error) { return handleError(res, error, "Unable to remove this row.", "remove"); }
}

/** One row of a bulk delete: the single Remove, so a paid row is refused the same way. */
async function removeRow(req, id) {
  const rowId = Number(id);
  if (!Number.isInteger(rowId) || rowId < 1) throw Object.assign(new Error("This payroll row could not be found."), { status: 404 });
  await rowOpen(req, rowId);
  await service.removeEntry(rowId, await reachOf(req), { userId: userIdOf(req), reason: "Removed with the other ticked rows." });
}

/** Brings a removed row back onto its month. */
async function restore(req, res) {
  const id = idOf(req);
  if (!id) return res.status(404).json({ message: "This removed row could not be found." });
  try {
    await rowOpen(req, id);
    await service.restoreEntry(id, await reachOf(req), { userId: userIdOf(req) });
    return res.json({ message: "Payroll row restored." });
  } catch (error) { return handleError(res, error, "Unable to restore this row.", "restore"); }
}


/** Marks the ticked rows Paid with one payment: `{ paidIds, missed: [{ id, message }] }`. */
async function markPaid(req, res) {
  const parsed = markPaidSchema.safeParse(req.body || {});
  if (!parsed.success) return validationError(res, parsed.error);
  const { ids, ...payment } = parsed.data;
  try {
    // A row in a locked month is left out and said, as any other row that cannot be marked is.
    const editLocked = await canEditLocked(req);
    const open = [];
    const lockedOut = [];
    for (const id of [...new Set(ids)]) {
      try { await monthLock.assertRowOpen(id, editLocked); open.push(id); } catch (error) { if (!error.status) throw error; lockedOut.push({ id, message: error.message }); }
    }
    const result = open.length ? await service.markPaid(open, payment, userIdOf(req), await reachOf(req)) : { paidIds: [], missed: [] };
    return res.json({ data: { ...result, missed: [...lockedOut, ...result.missed] } });
  } catch (error) { return handleError(res, error, "Unable to mark these rows Paid.", "mark paid"); }
}

/** A month's pay cycle and payable date, under its own settings. */
async function period(req, res) {
  const parsed = monthSchema.safeParse(req.query || {});
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    return res.json({ data: await service.monthSchedule(parsed.data) });
  } catch (error) { return handleError(res, error, "Unable to read the pay cycle.", "period"); }
}

async function options(req, res) {
  try {
    return res.json({ data: await service.paymentOptions() });
  } catch (error) { return handleError(res, error, "Unable to load the payment options.", "options"); }
}

async function getRules(req, res) {
  try {
    // With the month a change would start from, which the confirmation names before saving.
    return res.json({ data: { ...await service.readRules(), changesFrom: await service.runningPayrollMonth() } });
  } catch (error) { return handleError(res, error, "Unable to load the payroll rules.", "rules"); }
}

// Settings → Payroll rules → Generate payslips on: 0-30 days after the payable date, or null - once the cycle ends.
const payslipGenerationSchema = z.object({
  generateDaysAfter: z.number().int().min(0, "Choose 0 to 30 days.").max(30, "Choose 0 to 30 days.").nullable(),
}).strict();

async function getPayslipGeneration(req, res) {
  try {
    return res.json({ data: { generateDaysAfter: await payslipGenerateDaysAfter() } });
  } catch (error) { return handleError(res, error, "Unable to load when payslips are generated.", "payslip generation"); }
}

async function savePayslipGeneration(req, res) {
  const parsed = payslipGenerationSchema.safeParse(req.body || {});
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    return res.json({ data: await service.savePayslipGeneration(parsed.data.generateDaysAfter, userIdOf(req), await reachOf(req)) });
  } catch (error) { return handleError(res, error, "Unable to save when payslips are generated.", "save payslip generation"); }
}

// Settings → Payroll rules → Hold salary during notice: on or off.
const noticeHoldSchema = z.object({ enabled: z.boolean() }).strict();

async function getNoticeHold(req, res) {
  try {
    return res.json({ data: { enabled: await require("./noticeHold").holdSwitchOn() } });
  } catch (error) { return handleError(res, error, "Unable to load whether salary is held during notice.", "notice hold"); }
}

async function saveNoticeHold(req, res) {
  const parsed = noticeHoldSchema.safeParse(req.body || {});
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    return res.json({ data: await service.saveNoticeHold(parsed.data.enabled, userIdOf(req), await reachOf(req)) });
  } catch (error) { return handleError(res, error, "Unable to save whether salary is held during notice.", "save notice hold"); }
}

// Settings → Payroll rules → Payroll starts from: "YYYY-MM", or null back to attendance's start.
const payrollStartSchema = z.object({
  startsFrom: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose a month.").nullable(),
}).strict();

async function getPayrollStart(req, res) {
  try {
    return res.json({ data: await require("./payrollStart").payrollStart() });
  } catch (error) { return handleError(res, error, "Unable to load when payroll starts.", "payroll start"); }
}

async function savePayrollStart(req, res) {
  const parsed = payrollStartSchema.safeParse(req.body || {});
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    return res.json({ data: await require("./payrollStart").savePayrollStart(parsed.data.startsFrom, userIdOf(req), await reachOf(req)) });
  } catch (error) { return handleError(res, error, "Unable to save when payroll starts.", "save payroll start"); }
}

async function listComponents(req, res) {
  try {
    return res.json({ data: await components.listComponents() });
  } catch (error) { return handleError(res, error, "Unable to load the extra columns.", "list columns"); }
}

async function createComponent(req, res) {
  const parsed = componentSchema.safeParse(req.body || {});
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    return res.status(201).json({ data: await components.createComponent(parsed.data, userIdOf(req), await reachOf(req)) });
  } catch (error) { return handleError(res, error, "Unable to add this column.", "add column"); }
}

async function updateComponent(req, res) {
  const id = idOf(req);
  if (!id) return res.status(404).json({ message: "This column could not be found." });
  const parsed = componentUpdateSchema.safeParse(req.body || {});
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    return res.json({ data: await components.updateComponent(id, parsed.data, userIdOf(req), await reachOf(req)) });
  } catch (error) { return handleError(res, error, "Unable to save this column.", "update column"); }
}

async function removeComponent(req, res) {
  const id = idOf(req);
  if (!id) return res.status(404).json({ message: "This column could not be found." });
  try {
    return res.json({ data: await components.removeComponent(id, await reachOf(req)), message: "Column removed." });
  } catch (error) { return handleError(res, error, "Unable to delete this column.", "delete column"); }
}

async function saveRules(req, res) {
  const parsed = rulesSchema.safeParse(req.body || {});
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    return res.json({ data: await service.saveRules(parsed.data, userIdOf(req), await reachOf(req)) });
  } catch (error) { return handleError(res, error, "Unable to save the payroll rules.", "save rules"); }
}

module.exports = {
  monthSchema, entrySchema, rulesSchema, payslipGenerationSchema, payrollStartSchema, componentSchema, componentUpdateSchema,
  markPaidSchema, MARK_PAID_LIMIT,
  removeSchema,
  list, sync, skip, undoSkip, update, remove, removeRow, restore, markPaid, options, period, getRules, saveRules, getPayslipGeneration, savePayslipGeneration, getNoticeHold, saveNoticeHold, getPayrollStart, savePayrollStart,
  listComponents, createComponent, updateComponent, removeComponent,
};
