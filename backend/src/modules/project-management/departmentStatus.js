const { z } = require("zod");
const prisma = require("../../config/db");
const dataScope = require("../../services/dataScope.service");
const iamService = require("../../services/iam.service");
const { logProjectActivity } = require("../../services/projectActivity");

/*
 * A project's overall Pre Production or Production status, set by hand - from a project row's ⋮
 * Update status, or Update over the ticked projects on either board.
 *
 * Both statuses are otherwise worked out from the project's shoots; this lets a department say where
 * the project as a whole stands - Yet to Start, Planned, Production's Completed - or hold or reject
 * it, or put it back to automatic. Hold and Rejected are exceptions and ask for their remarks; the
 * rest are not, and carry none.
 * **Only the project's column is written - never a shoot.**
 *
 * Who may set it is each board's own rule for the projects it shows as theirs: Pre Production - the
 * project's Pre Production Coordinator; Production - its Production Manager. Somebody who sees every
 * project (`Show All Projects` at Read / Write, or no hierarchy at all) may set it for any. A project
 * outside that is left alone and counted, never an error for the rest.
 */
const DEPARTMENTS = {
  preProduction: {
    column: "preProductionStatus",
    // Each board's own statuses: Pre Production is done at Planned, Production at Completed, and
    // either can be put back to Yet to Start - the board that has not been picked up yet.
    statuses: ["YET_TO_START", "WORK_IN_PROGRESS", "PLANNED", "HOLD", "REJECTED"],
    ownerField: "preProductionCoordinatorEmployeeId",
  },
  production: {
    column: "productionStatus",
    statuses: ["YET_TO_START", "WORK_IN_PROGRESS", "PLANNED", "COMPLETED", "HOLD", "REJECTED"],
    ownerField: "productionManagerEmployeeId",
  },
};
const LABELS = { YET_TO_START: "Yet to Start", WORK_IN_PROGRESS: "Work in Progress", PLANNED: "Planned", COMPLETED: "Completed", HOLD: "Hold", REJECTED: "Rejected" };
/** The exceptions, and the only statuses that carry remarks - Planned and automatic keep none. */
const NEEDS_REMARKS = new Set(["HOLD", "REJECTED"]);

function schemaFor(department) {
  const { statuses } = DEPARTMENTS[department];
  return z.object({
    projectIds: z.array(z.string().trim().min(1).max(191)).min(1, "Select at least one project.").max(500),
    status: z.enum(statuses, { message: "Choose a status." }).nullable(),
    remarks: z.string().trim().max(2000).optional().nullable(),
  }).strict().superRefine((value, context) => {
    if (NEEDS_REMARKS.has(value.status) && !String(value.remarks || "").trim()) {
      context.addIssue({ code: "custom", path: ["remarks"], message: `Write the remarks for ${LABELS[value.status]}.` });
    }
  });
}

/** Whether this person sees every project on the boards - and so may set any project's status. */
async function seesEveryProject(userId) {
  const [unlimited, allProjects] = await Promise.all([
    dataScope.bypassesHierarchy(userId),
    iamService.hasPermission(userId, "PROJECT", "Show All Projects", "READ_WRITE"),
  ]);
  return Boolean(unlimited || allProjects);
}

async function setDepartmentStatus(department, input, userId, { client = prisma } = {}) {
  const { column, ownerField } = DEPARTMENTS[department];
  const ids = [...new Set(input.projectIds)];
  const [account, everyProject] = await Promise.all([
    client.user.findUnique({ where: { id: userId }, select: { linkedEmployeeId: true } }),
    seesEveryProject(userId),
  ]);
  const found = await client.salesProject.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true, [ownerField]: true } });
  const me = account?.linkedEmployeeId || null;
  const allowed = found.filter((project) => everyProject || (me && project[ownerField] === me)).map((project) => project.id);
  if (allowed.length) {
    const status = input.status || null;
    await client.salesProject.updateMany({
      where: { id: { in: allowed } },
      data: {
        [column]: status,
        [`${column}Remarks`]: NEEDS_REMARKS.has(status) ? String(input.remarks || "").trim() || null : null,
        [`${column}At`]: new Date(),
        [`${column}ByUserId`]: userId,
      },
    });
    // The project's Activity: Pre Production's status on Pre Production's, Production's on Projects'.
    const label = { PLANNED: "Planned", HOLD: "Hold", REJECTED: "Rejected" }[status] || "automatic";
    for (const projectId of allowed) {
      await logProjectActivity({
        projectId,
        area: department === "preProduction" ? "PRE_PRODUCTION" : "PROJECT",
        action: department === "preProduction" ? "PROJECT_STATUS_CHANGED" : "PRODUCTION_STATUS_CHANGED",
        detail: [`${department === "preProduction" ? "Pre Production" : "Production"} status set to ${label}`, NEEDS_REMARKS.has(status) && String(input.remarks || "").trim()].filter(Boolean).join(" · "),
        userId,
      }, { client });
    }
  }
  return { updated: allowed.length, refused: found.length - allowed.length, missing: ids.length - found.length };
}

/** The route handler for one department's board. */
function handlerFor(department) {
  const schema = schemaFor(department);
  return async function setProjectStatus(req, res) {
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Choose a status." });
    try {
      return res.json({ data: await setDepartmentStatus(department, parsed.data, Number(req.user.id)) });
    } catch (error) {
      console.error(`Unable to set the projects' ${department} status:`, error);
      return res.status(500).json({ message: "Unable to update the selected projects." });
    }
  };
}

module.exports = { DEPARTMENTS, schemaFor, setDepartmentStatus, handlerFor };
