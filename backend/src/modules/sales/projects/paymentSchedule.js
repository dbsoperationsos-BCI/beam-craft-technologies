const { z } = require("zod");
const prisma = require("../../../config/db");
const { projectAccessWhere } = require("../../../services/projectScope");
const { projectSchedule, projectLedger, saveProjectSchedule } = require("../../accounts/scheduled-payments/service");
const { logProjectActivity } = require("../../../services/projectActivity");
const { buildProjectFlow } = require("../../../services/projectFlow");

/*
 * A project's Schedule Payment, read and saved by Create Project and Start / Edit Project.
 *
 * The rows used to live only in the open form; these routes are what keep them. Which project is
 * the caller's is the register's own rule (`projectAccessWhere`) - at write for a save - so an id in
 * the URL reaches exactly the projects the caller could open. Every payment is the save's to change,
 * worked ones included; removing a paid one only unlinks its receipts (`saveProjectSchedule`).
 */
const isCalendarDay = (key) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const date = new Date(`${key}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === key;
};
const rowSchema = z.object({
  id: z.string().trim().max(191).optional().nullable(),
  category: z.string().trim().max(120).optional().nullable(),
  // A real calendar day, or nothing: "2026-13-45" is refused here rather than failing in the database.
  date: z.string().trim().max(30).optional().nullable().refine((value) => !value || isCalendarDay(value.slice(0, 10)), "A scheduled payment's date is not a date."),
  remarks: z.string().trim().max(2000).optional().nullable(),
  // Date not known: it follows a shoot - this project's (`dueShootId`), or its main event where none
  // is picked - so many days before (negative), on (0) or after it.
  dueRule: z.enum(["DATE", "SHOOT"]).optional().nullable(),
  dueShootId: z.string().trim().max(191).optional().nullable(),
  dueOffsetDays: z.number().int().min(-365).max(365).optional().nullable(),
  percentage: z.union([z.number(), z.string().trim().max(30)]).optional().nullable()
    .refine((value) => value === null || value === undefined || String(value).trim() === "" || (Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100), "A scheduled payment's percentage must be between 0 and 100."),
}).strip();
const saveSchema = z.object({ rows: z.array(rowSchema).max(100) }).strict();

async function reachableProject(req, forWrite) {
  return prisma.salesProject.findFirst({
    where: { id: String(req.params.id || ""), deletedAt: null, AND: [await projectAccessWhere({ userId: Number(req.user.id), forWrite })] },
    select: { id: true },
  });
}

async function getProjectPaymentSchedule(req, res) {
  try {
    const project = await reachableProject(req, false);
    if (!project) return res.status(404).json({ message: "That project could not be found." });
    const data = await projectSchedule(project.id);
    // Beside the rows: each one's running balance and the project's Balance Amount, from the books.
    return res.json({ data, ledger: await projectLedger(project.id, data) });
  } catch (error) {
    console.error("Unable to load the payment schedule:", error);
    return res.status(500).json({ message: "Unable to load the payment schedule." });
  }
}

/**
 * `creating` is Create Project's save, under the permission that booked it rather than the plan's
 * pair of guards - so it may only lay down a project's **first** schedule. Changing one afterwards is
 * Start / Edit Project's (the PUT), which asks who may still change a started project.
 */
function saveProjectPaymentSchedule(req, res) {
  return saveSchedule(req, res, { creating: req.method === "POST" });
}

async function saveSchedule(req, res, { creating }) {
  const parsed = saveSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Check the payment schedule." });
  try {
    const project = await reachableProject(req, true);
    if (!project) return res.status(404).json({ message: "That project could not be found." });
    if (creating && await prisma.projectPaymentSchedule.count({ where: { projectId: project.id, deletedAt: null } })) {
      return res.status(409).json({ message: "This project already has a payment schedule. Change it on Projects → Edit Project." });
    }
    const actorId = Number(req.user.id) || null;
    const data = await prisma.$transaction((tx) => saveProjectSchedule(project.id, parsed.data.rows, actorId, { client: tx }));
    await logProjectActivity({ projectId: project.id, area: "PROJECT", action: "SCHEDULE_SAVED", detail: `Payment schedule saved (${data.length} payment${data.length === 1 ? "" : "s"})`, userId: actorId });
    return res.json({ data });
  } catch (error) {
    if (error?.status) return res.status(error.status).json({ message: error.message });
    console.error("Unable to save the payment schedule:", error);
    return res.status(500).json({ message: "Unable to save the payment schedule." });
  }
}

/**
 * A project's Activity tab: its whole flow from enquiry to feedback, newest first (`projectFlow.js`) -
 * for a project the caller can open, each stage only for whoever holds that stage's permission.
 */
async function getProjectActivity(req, res) {
  try {
    const project = await reachableProject(req, false);
    if (!project) return res.status(404).json({ message: "That project could not be found." });
    return res.json({ data: await buildProjectFlow({ projectId: project.id, userId: req.user.id }) });
  } catch (error) {
    console.error("Unable to load the project's activity:", error);
    return res.status(500).json({ message: "Unable to load the project's activity." });
  }
}

module.exports = { saveSchema, getProjectPaymentSchedule, saveProjectPaymentSchedule, getProjectActivity };
