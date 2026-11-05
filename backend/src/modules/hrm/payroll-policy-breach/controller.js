const { z } = require("zod");
const service = require("./service");
const { MAX_MONTHS } = require("../payroll-recovery/controller");

/*
 * HTTP for HRM → Payroll → Policy Breach. Validation and status codes here; what a policy breach is,
 * and the figures worked out from it, in `service.js`.
 */

const blankIsAbsent = (value) => (value === "" || value === null ? undefined : value);

// Deducted by AMOUNT (the default, so a client that sends none is unchanged) or by LOP days - each
// asks for its own figure, in whole or half days for LOP; the other one, left blank, is ignored.
const policyBreachSchema = z.object({
  employeeId: z.coerce.number().int().positive(),
  deductBy: z.enum(service.DEDUCT_BY).default("AMOUNT"),
  totalAmount: z.preprocess(blankIsAbsent, z.coerce.number().positive("Enter the amount.").max(100000000).optional()),
  totalDays: z.preprocess(blankIsAbsent, z.coerce.number().positive("Enter the total days.").max(366).refine((value) => Number.isInteger(value * 2), "Enter the days in whole or half days.").optional()),
  startMonth: z.coerce.number().int().min(1).max(12),
  startYear: z.coerce.number().int().min(2000).max(2100),
  months: z.coerce.number().int().min(1).max(MAX_MONTHS),
  reason: z.string().trim().max(2000).nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.deductBy === "LOP" && value.totalDays === undefined) ctx.addIssue({ code: "custom", path: ["totalDays"], message: "Enter the total days." });
  if (value.deductBy === "AMOUNT" && value.totalAmount === undefined) ctx.addIssue({ code: "custom", path: ["totalAmount"], message: "Enter the amount." });
});

// Missing and empty are the same mistake to the person removing it, so both get the readable message.
const removeSchema = z.object({
  reason: z.preprocess((value) => value ?? "", z.string().trim().min(1, "Say why this policy breach is being removed.").max(2000)),
});

const idOf = (req) => {
  const id = Number(req.params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
};

/** A deliberate error keeps its message; anything unexpected is logged here and never echoed. */
function handleError(res, error, fallback, action) {
  if (error.status) return res.status(error.status).json({ message: error.message });
  console.error(`Payroll policy breach ${action} failed:`, error);
  return res.status(500).json({ message: fallback });
}

const validationError = (res, error) => res.status(400).json({ message: error.issues?.[0]?.message || "Validation failed", errors: error.issues });

// The branches this caller reaches through `HRM / Payroll Policy Breach` - `null` for everywhere.
const reachOf = (req) => service.reachFor(req.user?.id);

async function list(req, res) {
  try {
    return res.json({ data: await service.listPolicyBreaches(await reachOf(req)) });
  } catch (error) { return handleError(res, error, "Unable to load the policy breaches.", "list"); }
}

async function employees(req, res) {
  try {
    return res.json({ data: await service.policyBreachEmployees(await reachOf(req)) });
  } catch (error) { return handleError(res, error, "Unable to load the employees.", "employees"); }
}

async function create(req, res) {
  const parsed = policyBreachSchema.safeParse(req.body || {});
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    return res.status(201).json({ data: await service.createPolicyBreach(parsed.data, Number(req.user?.id) || null, { reach: await reachOf(req) }) });
  } catch (error) { return handleError(res, error, "Unable to save this policy breach.", "create"); }
}

async function update(req, res) {
  const id = idOf(req);
  if (!id) return res.status(404).json({ message: "This policy breach could not be found." });
  const parsed = policyBreachSchema.safeParse(req.body || {});
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    return res.json({ data: await service.updatePolicyBreach(id, parsed.data, Number(req.user?.id) || null, { reach: await reachOf(req) }) });
  } catch (error) { return handleError(res, error, "Unable to save this policy breach.", "update"); }
}

async function remove(req, res) {
  const id = idOf(req);
  if (!id) return res.status(404).json({ message: "This policy breach could not be found." });
  const parsed = removeSchema.safeParse(req.body || {});
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    await service.removePolicyBreach(id, parsed.data.reason, Number(req.user?.id) || null, { reach: await reachOf(req) });
    return res.json({ message: "Policy breach removed." });
  } catch (error) { return handleError(res, error, "Unable to remove this policy breach.", "remove"); }
}

/** A policy breach's payment history: each month of its run, what it took, and the balance. */
async function history(req, res) {
  const id = idOf(req);
  if (!id) return res.status(404).json({ message: "This policy breach could not be found." });
  try {
    return res.json({ data: await service.policyBreachHistory(id, await reachOf(req)) });
  } catch (error) { return handleError(res, error, "Unable to load this policy breach's history.", "history"); }
}

module.exports = { policyBreachSchema, removeSchema, list, employees, history, create, update, remove };
