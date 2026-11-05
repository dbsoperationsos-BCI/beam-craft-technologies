const { z } = require("zod");
const service = require("./service");
// Undoing a conversion hands advances back to Advance Salary, whose service does it.
const advanceService = require("../payroll-advance/service");

/*
 * HTTP for HRM → Payroll → Recovery. Validation and status codes here; what a recovery is, and the
 * figures worked out from it, in `service.js`.
 */

const MAX_MONTHS = 60;

const recoverySchema = z.object({
  employeeId: z.coerce.number().int().positive(),
  totalAmount: z.coerce.number().positive("Enter the total amount.").max(100000000),
  startMonth: z.coerce.number().int().min(1).max(12),
  startYear: z.coerce.number().int().min(2000).max(2100),
  months: z.coerce.number().int().min(1).max(MAX_MONTHS),
  reason: z.string().trim().max(2000).nullable().optional(),
});

// Missing and empty are the same mistake to the person removing it, so both get the readable message.
const removeSchema = z.object({
  reason: z.preprocess((value) => value ?? "", z.string().trim().min(1, "Say why this recovery is being removed.").max(2000)),
});

const idOf = (req) => {
  const id = Number(req.params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
};

/** A deliberate error keeps its message; anything unexpected is logged here and never echoed. */
function handleError(res, error, fallback, action) {
  if (error.status) return res.status(error.status).json({ message: error.message });
  console.error(`Payroll recovery ${action} failed:`, error);
  return res.status(500).json({ message: fallback });
}

const validationError = (res, error) => res.status(400).json({ message: error.issues?.[0]?.message || "Validation failed", errors: error.issues });

// The branches this caller reaches through `HRM / Payroll Recovery` - `null` for everywhere.
const reachOf = (req) => service.reachFor(req.user?.id);

async function list(req, res) {
  try {
    return res.json({ data: await service.listRecoveries(await reachOf(req)) });
  } catch (error) { return handleError(res, error, "Unable to load the recoveries.", "list"); }
}

async function employees(req, res) {
  try {
    return res.json({ data: await service.recoveryEmployees(await reachOf(req)) });
  } catch (error) { return handleError(res, error, "Unable to load the employees.", "employees"); }
}

async function create(req, res) {
  const parsed = recoverySchema.safeParse(req.body || {});
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    return res.status(201).json({ data: await service.createRecovery(parsed.data, Number(req.user?.id) || null, { reach: await reachOf(req) }) });
  } catch (error) { return handleError(res, error, "Unable to save this recovery.", "create"); }
}

async function update(req, res) {
  const id = idOf(req);
  if (!id) return res.status(404).json({ message: "This recovery could not be found." });
  const parsed = recoverySchema.safeParse(req.body || {});
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    return res.json({ data: await service.updateRecovery(id, parsed.data, Number(req.user?.id) || null, { reach: await reachOf(req) }) });
  } catch (error) { return handleError(res, error, "Unable to save this recovery.", "update"); }
}

async function remove(req, res) {
  const id = idOf(req);
  if (!id) return res.status(404).json({ message: "This recovery could not be found." });
  const parsed = removeSchema.safeParse(req.body || {});
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    await service.removeRecovery(id, parsed.data.reason, Number(req.user?.id) || null, { reach: await reachOf(req) });
    return res.json({ message: "Recovery removed." });
  } catch (error) { return handleError(res, error, "Unable to remove this recovery.", "remove"); }
}

/** A recovery's payment history: each month of its run, what it took, and the balance. */
async function history(req, res) {
  const id = idOf(req);
  if (!id) return res.status(404).json({ message: "This recovery could not be found." });
  try {
    return res.json({ data: await service.recoveryHistory(id, await reachOf(req)) });
  } catch (error) { return handleError(res, error, "Unable to load this recovery's history.", "history"); }
}

/** Undoes Convert to Recovery: removes this recovery and hands its advances back to Advance Salary. */
async function undoConversion(req, res) {
  const id = idOf(req);
  if (!id) return res.status(404).json({ message: "This recovery could not be found." });
  try {
    const data = await advanceService.undoConversion(id, Number(req.user?.id) || null, {
      recoveryReach: await reachOf(req),
      reach: await advanceService.reachFor(req.user?.id),
    });
    return res.json({ data });
  } catch (error) { return handleError(res, error, "Unable to undo this conversion.", "undo conversion"); }
}

module.exports = { MAX_MONTHS, recoverySchema, removeSchema, list, employees, history, create, update, remove, undoConversion };
