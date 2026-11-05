const { z } = require("zod");
const service = require("./service");
const recoveryService = require("../payroll-recovery/service");
const { MAX_MONTHS } = require("../payroll-recovery/controller");

/*
 * HTTP for HRM → Payroll → Advance Salary. Validation and status codes here; what an advance is, and
 * how it reaches the payroll, in `service.js`.
 */

const advanceSchema = z.object({
  // A real day, not just its shape: 2026-02-31 is refused here rather than failing in the database.
  advanceDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date it was given.")
    .refine((value) => { const date = new Date(`${value}T00:00:00Z`); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value; }, "Enter a real date."),
  employeeId: z.coerce.number().int().positive(),
  amount: z.coerce.number().positive("Enter the amount.").max(100000000),
  deductMonth: z.coerce.number().int().min(1).max(12),
  deductYear: z.coerce.number().int().min(2000).max(2100),
  reason: z.string().trim().max(2000).nullable().optional(),
});

// Missing and empty are the same mistake to the person removing it, so both get the readable message.
const removeSchema = z.object({
  reason: z.preprocess((value) => value ?? "", z.string().trim().min(1, "Say why this advance is being removed.").max(2000)),
});

/** Convert to Recovery: the advances ticked (one employee's), and the recovery's start and length. */
const convertSchema = z.object({
  advanceIds: z.array(z.coerce.number().int().positive()).min(1, "Choose the advances to convert.").max(100),
  startMonth: z.coerce.number().int().min(1).max(12),
  startYear: z.coerce.number().int().min(2000).max(2100),
  months: z.coerce.number().int().min(1, "Choose the number of months.").max(MAX_MONTHS),
  reason: z.string().trim().max(2000).nullable().optional(),
}).strict();

const idOf = (req) => {
  const id = Number(req.params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
};

/** A deliberate error keeps its message; anything unexpected is logged here and never echoed. */
function handleError(res, error, fallback, action) {
  if (error.status) return res.status(error.status).json({ message: error.message });
  console.error(`Payroll advance ${action} failed:`, error);
  return res.status(500).json({ message: fallback });
}

const validationError = (res, error) => res.status(400).json({ message: error.issues?.[0]?.message || "Validation failed", errors: error.issues });

// The branches this caller reaches through `HRM / Payroll Advance` - `null` for everywhere.
const reachOf = (req) => service.reachFor(req.user?.id);
// And through `HRM / Payroll Recovery`, which converting writes to as well.
const recoveryReachOf = (req) => recoveryService.reachFor(req.user?.id);

async function list(req, res) {
  try {
    return res.json({ data: await service.listAdvances(await reachOf(req)) });
  } catch (error) { return handleError(res, error, "Unable to load the advances.", "list"); }
}

async function employees(req, res) {
  try {
    return res.json({ data: await service.advanceEmployees(await reachOf(req)) });
  } catch (error) { return handleError(res, error, "Unable to load the employees.", "employees"); }
}

async function create(req, res) {
  const parsed = advanceSchema.safeParse(req.body || {});
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    return res.status(201).json({ data: await service.createAdvance(parsed.data, Number(req.user?.id) || null, { reach: await reachOf(req) }) });
  } catch (error) { return handleError(res, error, "Unable to save this advance.", "create"); }
}

async function update(req, res) {
  const id = idOf(req);
  if (!id) return res.status(404).json({ message: "This advance could not be found." });
  const parsed = advanceSchema.safeParse(req.body || {});
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    return res.json({ data: await service.updateAdvance(id, parsed.data, Number(req.user?.id) || null, { reach: await reachOf(req) }) });
  } catch (error) { return handleError(res, error, "Unable to save this advance.", "update"); }
}

async function remove(req, res) {
  const id = idOf(req);
  if (!id) return res.status(404).json({ message: "This advance could not be found." });
  const parsed = removeSchema.safeParse(req.body || {});
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    await service.removeAdvance(id, parsed.data.reason, Number(req.user?.id) || null, { reach: await reachOf(req) });
    return res.json({ message: "Advance removed." });
  } catch (error) { return handleError(res, error, "Unable to remove this advance.", "remove"); }
}

/** An advance's payment history: given, then whether - and when - the payroll took it back. */
async function history(req, res) {
  const id = idOf(req);
  if (!id) return res.status(404).json({ message: "This advance could not be found." });
  try {
    return res.json({ data: await service.advanceHistory(id, await reachOf(req)) });
  } catch (error) { return handleError(res, error, "Unable to load this advance's history.", "history"); }
}

async function convertToRecovery(req, res) {
  const parsed = convertSchema.safeParse(req.body || {});
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    const data = await service.convertToRecovery(parsed.data, Number(req.user?.id) || null, { reach: await reachOf(req), recoveryReach: await recoveryReachOf(req) });
    return res.status(201).json({ data });
  } catch (error) { return handleError(res, error, "Unable to convert these advances.", "convert"); }
}

module.exports = { advanceSchema, removeSchema, convertSchema, list, employees, history, create, update, remove, convertToRecovery };
