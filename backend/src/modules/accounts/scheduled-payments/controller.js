const { z } = require("zod");
const prisma = require("../../../config/db");
const { studioDateKey } = require("../../../services/studioTime");
const { projectAccessWhere, readableProject } = require("../../../services/projectScope");
const { projectClientNames, clientNameOf } = require("../../../services/projectClientNames");
const { handleError: handleCashEntryError, toRow: cashEntryRow } = require("../cash-entries/controller");
const { projectHoldSources, projectPaymentsDue } = require("../../../services/projectHolds");
const { scheduleSelect, toPayment, projectAccountsStatus, money, setPaymentHold, clearPayment, partPayPayment, projectSchedule } = require("./service");

/*
 * Accounts Manager's Due / Overdue / On Hold tabs: every payment the projects in reach are still owed,
 * one row each, with where it stands; and the work on one - a hold, clearing it, or clearing
 * part of it and scheduling the rest.
 *
 * Guarded by ACCOUNTS / Cash Management, the screen's own permission (routes.js). Which projects is
 * the project register's own rule asked with it (`projectAccessWhere`), so an id typed into a URL
 * reaches exactly what the list shows.
 */

const projectSelect = {
  id: true, eventId: true, projectStatus: true, initialConvertedValue: true, clientMainNumber: true,
  whatsappGroupName: true, whatsappGroupNameId: true, sourceBranch: true,
  branch: { select: { name: true } },
};

const nonEmpty = (label) => z.string({ error: `${label} is required.` }).trim().min(1, `${label} is required.`).max(2000);
const dateKey = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.");
const notPast = (key) => key >= studioDateKey();

const holdSchema = z.object({
  hold: z.boolean(),
  remarks: z.string().trim().max(2000).optional().nullable(),
}).strict().superRefine((value, context) => {
  if (value.hold && !String(value.remarks || "").trim()) context.addIssue({ code: "custom", path: ["remarks"], message: "Add the remarks for the hold." });
});
const clearSchema = z.object({ entry: z.record(z.string(), z.unknown()) }).strict();
const partialSchema = z.object({
  paidAmount: z.coerce.number().positive("Enter the amount paid."),
  pendingDueDate: dateKey.refine(notPast, "The pending amount's due date cannot be in the past."),
  entry: z.record(z.string(), z.unknown()),
}).strict();

const fail = (status, message) => Object.assign(new Error(message), { status });
const reply = (res, error, fallback) => {
  // A refused cash entry names the field that was wrong; the Accounts reporter says it as it does there.
  if (error?.fieldErrors) return handleCashEntryError(res, error, fallback);
  if (error?.status) return res.status(error.status).json({ message: error.message });
  console.error(`${fallback}:`, error);
  return res.status(500).json({ message: `${fallback}.` });
};

/** The projects this request reaches, read or write, as a `where` on the payment. */
async function inReach(req, { forWrite = false } = {}) {
  return { deletedAt: null, project: { deletedAt: null, AND: [await projectAccessWhere({ userId: Number(req.user.id), permissions: req.permission, forWrite })] } };
}

const dayKey = (value) => (value ? new Date(value).toISOString().slice(0, 10) : null);
/** One payment with its project, as the list and the panel read it. */
function toListRow(row, clientNames, todayKey, projectStatus) {
  const project = row.project;
  return {
    ...toPayment(row, project.initialConvertedValue, todayKey),
    eventId: project.eventId,
    clientName: clientNameOf(project, clientNames),
    clientMainNumber: project.clientMainNumber || null,
    branch: project.branch?.name || project.sourceBranch || null,
    projectStatus: project.projectStatus || null,
    projectAccountsStatus: projectStatus,
  };
}

/** The project's Accounts status for each project among `rows`, from all its live payments. */
function accountsStatusByProject(rows, todayKey) {
  const byProject = new Map();
  for (const row of rows) {
    const status = toPayment(row, row.project.initialConvertedValue, todayKey).status;
    byProject.set(row.projectId, [...(byProject.get(row.projectId) || []), status]);
  }
  return new Map([...byProject].map(([id, statuses]) => [id, projectAccountsStatus(statuses)]));
}

const listInclude = {
  ...scheduleSelect,
  project: { select: projectSelect },
};

async function listPayments(req, res) {
  try {
    // `?projectId=` - one project's dues, for its Payments tab. Still inside the caller's reach.
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId.trim() : "";
    const rows = await prisma.projectPaymentSchedule.findMany({
      where: { ...(await inReach(req)), ...(projectId ? { projectId } : {}) },
      orderBy: [{ dueDate: "asc" }, { sortOrder: "asc" }],
      select: listInclude,
    });
    const todayKey = studioDateKey();
    const clientNames = await projectClientNames(rows.map((row) => row.project));
    const statuses = accountsStatusByProject(rows, todayKey);
    // A payment received in full is its cash entry under Received now; only what is still owed is listed.
    const owed = rows.map((row) => toListRow(row, clientNames, todayKey, statuses.get(row.projectId))).filter((row) => row.status !== "Cleared");
    return res.json({ data: owed });
  } catch (error) { return reply(res, error, "Unable to load the scheduled payments"); }
}

/** One payment the request reaches, with all its project's payments for the Accounts status. */
async function paymentFor(req, id, { forWrite = false, client = prisma } = {}) {
  const row = await client.projectPaymentSchedule.findFirst({ where: { id: String(id), ...(await inReach(req, { forWrite })) }, select: listInclude });
  if (!row) throw fail(404, "That scheduled payment could not be found.");
  return row;
}

async function detail(req, id) {
  const row = await paymentFor(req, id);
  const todayKey = studioDateKey();
  const [siblings, receipts, clientNames] = await Promise.all([
    prisma.projectPaymentSchedule.findMany({ where: { projectId: row.projectId, deletedAt: null }, select: { ...scheduleSelect, project: { select: projectSelect } } }),
    prisma.cashEntry.findMany({ where: { paymentScheduleId: row.id, deletedAt: null }, orderBy: { entryDate: "asc" }, select: { id: true, entryId: true, amount: true, entryDate: true, paymentMode: true } }),
    projectClientNames([row.project]),
  ]);
  const accountsStatus = accountsStatusByProject(siblings, todayKey).get(row.projectId) || null;
  const [holds, paymentsDue] = await Promise.all([projectHoldSources([row.projectId]), projectPaymentsDue([row.projectId])]);
  return {
    ...toListRow(row, clientNames, todayKey, accountsStatus),
    // For the badge beside the title, as every panel on the project shows it.
    holds: holds[row.projectId] || [],
    paymentsDue: paymentsDue[row.projectId] || null,
    receipts: receipts.map((entry) => ({ id: entry.id, entryId: entry.entryId, amount: money(entry.amount), entryDate: dayKey(entry.entryDate), paymentMode: entry.paymentMode })),
  };
}

async function getPayment(req, res) {
  try { return res.json({ data: await detail(req, req.params.id) }); } catch (error) { return reply(res, error, "Unable to load this scheduled payment"); }
}

async function setHold(req, res) {
  const parsed = holdSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Check the hold." });
  try {
    const row = await paymentFor(req, req.params.id, { forWrite: true });
    await setPaymentHold(row.id, parsed.data, Number(req.user.id) || null);
    return res.json({ data: await detail(req, row.id) });
  } catch (error) { return reply(res, error, "Unable to change this payment's hold"); }
}

// Money received here is sent to the project's WhatsApp group as Add Entry's is - after answering.
const receiptToGroup = (created) => {
  require("../cash-entries/controller").sendReceiptToGroup(created).catch((error) => console.warn(`[cash-receipt] ${error.message}`));
};

/** Clear: the whole pending amount received in one cash entry (`service.clearPayment`). */
async function clear(req, res) {
  const parsed = clearSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: "Fill in the cash received." });
  try {
    const row = await paymentFor(req, req.params.id, { forWrite: true });
    const created = await clearPayment(row.id, parsed.data.entry, Number(req.user.id) || null);
    receiptToGroup(created);
    return res.status(201).json({ data: await detail(req, row.id), entry: cashEntryRow(created) });
  } catch (error) { return reply(res, error, "Unable to clear this payment"); }
}

/** Partially paid: the part received now, and the rest as a payment of its own (`service.partPayPayment`). */
async function partPayment(req, res) {
  const parsed = partialSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Check the part payment." });
  try {
    const row = await paymentFor(req, req.params.id, { forWrite: true });
    const created = await partPayPayment(row.id, parsed.data, Number(req.user.id) || null);
    receiptToGroup(created);
    return res.status(201).json({ data: await detail(req, row.id), entry: cashEntryRow(created) });
  } catch (error) { return reply(res, error, "Unable to record this part payment"); }
}

/**
 * A project's payments still to be received, for Add Entry's "Settles payment": what the person
 * recording money against the project chooses it settles, oldest first. The project is one the
 * caller reaches through Cash Management, or one they see on their board - the Payments tab's rule.
 */
async function openForProject(req, res) {
  const projectId = String(req.params.projectId || "").trim();
  if (!projectId) return res.status(400).json({ message: "A project id is required." });
  try {
    const userId = Number(req.user.id);
    const [throughAccounts, onBoard] = await Promise.all([
      prisma.salesProject.findFirst({ where: { id: projectId, deletedAt: null, AND: [await projectAccessWhere({ userId, permissions: req.permission })] }, select: { id: true } }),
      readableProject({ userId, projectId }),
    ]);
    if (!throughAccounts && !onBoard) return res.status(404).json({ message: "That project could not be found." });
    const open = (await projectSchedule(projectId)).filter((payment) => payment.status !== "Cleared" && payment.pending > 0);
    return res.json({ data: open.map(({ id, category, dueDate, amount, received, pending, status }) => ({ id, category, dueDate, amount, received, pending, status })) });
  } catch (error) { return reply(res, error, "Unable to load this project's scheduled payments"); }
}

module.exports = { holdSchema, partialSchema, listPayments, getPayment, setHold, clearPayment: clear, partPayment, openForProject };
