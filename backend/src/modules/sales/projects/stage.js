const prisma = require("../../../config/db");
const { SHOOT_DATE_ASC } = require("../../../services/shootOrder");
const { projectAccessWhere } = require("../../../services/projectScope");
const { verticalName } = require("../../../services/salesVertical");
const { pendingLabel, DONE } = require("../../project-management/production/steps");
const { projectHandedFrom, withHandedFrom } = require("../../../services/handoverNames");

/**
 * Which stage a project is at, for the Status tab of Project Management's project panel.
 *
 * A project has no stage column. It is read from what the project already holds: its status, the
 * people staffed to it, and each shoot's production record.
 *
 * - **Project Initiation** once the status has left "Yet to Start".
 * - **Pre Production** is done for a shoot once that shoot's production plan has been submitted -
 *   the plan is where pre production hands the shoot over. (A shoot's pre production "Completed"
 *   is worked out on the board from its form, not stored, so it cannot be asked here.)
 * - **Production** is done once every shoot's production has reached its last step.
 * - **Post Production** runs from then until the project is Completed (or the old Delivered). The
 *   project's status never finishes Pre Production or Production, which answer to their own
 *   statuses only.
 * - **Delivered** is the status.
 *
 * Rejected, On Hold, Cancelled and the rest stop a project rather than move it, so they come back
 * as a `flag` beside the stages, which still show how far it got.
 *
 * A Pre Production or Production status set on the project by hand (Update status on either board)
 * overrides the stage's own reading, as it overrides the board's: **Planned** set on Pre Production
 * marks that stage done, and every hand-set status comes back on its stage as `setStatus` - with its
 * remarks, who set it and when - for the stage's details to say. Production set to Planned is shown
 * but does not finish Production: that takes the shoots being shot. The shoots are never changed by it.
 */
const STAGES = [
  ["STARTED", "Project Initiation"],
  ["PRE_PRODUCTION", "Pre Production"],
  ["PRODUCTION", "Production"],
  ["POST_PRODUCTION", "Post Production"],
  ["DELIVERED", "Delivered"],
];
const STAGE_LABELS = Object.fromEntries(STAGES);
/** The stages that have an editor of their own to update them from the Status tab. */
const UPDATABLE_STAGES = new Set(["STARTED", "PRE_PRODUCTION", "PRODUCTION"]);
const FLAG_STATUSES = new Set(["Rejected", "Cancelled & Refunded", "Client not Turned", "On Hold", "Duplicated", "Date Elapsed"]);

const nameOf = (employee, text) => employee?.employeeName || text || null;

/**
 * The project's CRD document for the Pre Production stage, only when the project needs one - its CRD
 * Document answered and not "Not Applicable"; null otherwise, and the stage says nothing about it.
 * Whether the client has submitted it, and the document's id for the read-only View.
 */
function crdOf(project) {
  if (!project.crdDocumentStatus || project.crdDocumentStatus === "Not Applicable") return null;
  const document = project.crdDocument;
  return {
    documentId: document?.id || null,
    submitted: Boolean(document?.submittedAt),
    submittedAt: document?.submittedAt || null,
  };
}

/**
 * A stage's facts for the Status tab's detail pane, each with the kind of value it holds so the
 * screen can format it (`date`, `money`, `text`). Nothing is left out for being empty: the screen
 * says "Not assigned" or "—", which is itself worth knowing.
 */
const fact = (label, value, kind = "text") => ({ label, value: value ?? null, kind });

// `handed` is the project's offboarding hand-overs (`projectHandedFrom`): a role still held by the
// person it was handed to reads "New (Old)".
/** Whether a board's stage is finished: its own status set by hand where there is one, else the shoots'. */
function departmentDone(setByHand, doneStatus, fromShoots) {
  if (setByHand === doneStatus) return true;
  if (setByHand === "YET_TO_START") return false;
  return fromShoots;
}

function projectStage(project, handed = {}, canUpdateStarted = false) {
  const status = project.projectStatus || "Yet to Start";
  const shoots = (project.shoots || []).map((shoot) => {
    const production = shoot.production || null;
    return {
      id: shoot.id,
      name: shoot.shoot || "Shoot",
      date: shoot.dateCreated || null,
      planned: Boolean(production?.planSubmittedAt),
      plannedAt: production?.planSubmittedAt || null,
      done: production?.currentStep === DONE,
      // A shoot's production can only be opened once it has been raised.
      hasProduction: Boolean(production),
      // The shoot's type says whether it has the travel steps (an indoor one does not).
      pending: production ? pendingLabel({ ...production, shoot }) : "Not raised yet",
    };
  });
  const total = shoots.length;
  const planned = shoots.filter((shoot) => shoot.planned).length;
  const produced = shoots.filter((shoot) => shoot.done).length;

  const started = status !== "Yet to Start";
  const delivered = status === "Completed" || status === "Delivered";
  const done = {
    STARTED: started,
    /*
     * Pre Production and Production answer to their own statuses only - the project's status never
     * finishes them, as it never changes them on their boards. A status set by hand on either board
     * decides its own stage: its done status (Pre Production's Planned, Production's Completed)
     * finishes it, and Yet to Start says plainly that it is not, whatever the shoots have reached.
     */
    PRE_PRODUCTION: started && departmentDone(project.preProductionStatus, "PLANNED", total > 0 && planned === total),
    PRODUCTION: started && departmentDone(project.productionStatus, "COMPLETED", total > 0 && produced === total),
    POST_PRODUCTION: delivered,
    DELIVERED: delivered,
  };
  const currentIndex = STAGES.findIndex(([id]) => !done[id]);
  const setStatus = (status, remarks, at, byUser) => (status ? { status, remarks: remarks || null, at: at || null, by: byUser?.name || null } : null);

  const projectManager = withHandedFrom(nameOf(project.projectManagerEmployee, project.projectManager), handed.projectManager);
  const preCoordinator = withHandedFrom(nameOf(project.preProductionCoordinatorEmployee, project.preProductionCoordinator), handed.preProductionCoordinator);
  const productionManager = withHandedFrom(nameOf(project.productionManagerEmployee, project.productionManager), handed.productionManager);
  const postCoordinator = withHandedFrom(nameOf(project.postProductionCoordinatorEmployee, project.postProductionCoordinator), handed.postProductionCoordinator);
  const details = {
    STARTED: {
      person: projectManager,
      role: "Project manager",
      facts: [
        fact("Converted by", project.crmEmployee?.employeeName),
        fact("Converted on", project.createdAt, "date"),
        fact("Converted value", project.initialConvertedValue != null ? Number(project.initialConvertedValue) : null, "money"),
        fact("Enquiry ID", project.enquiryId),
        fact("Branch", project.branch?.name || project.sourceBranch),
        // Named, never the stored code: "WED" is for the WhatsApp group name only.
        fact("Vertical", project.verticalRef?.name || verticalName(project.vertical) || project.vertical),
        fact("Main event date", project.mainEventDateKnown ? project.mainEventDate : null, "date"),
        fact("Project manager", projectManager),
        fact("Recorded by", project.createdByUser?.name),
      ],
    },
    PRE_PRODUCTION: {
      person: preCoordinator,
      role: "Coordinator",
      done: planned,
      total,
      shoots,
      setStatus: setStatus(project.preProductionStatus, project.preProductionStatusRemarks, project.preProductionStatusAt, project.preProductionStatusByUser),
      crd: crdOf(project),
      facts: [
        fact("Pre-production coordinator", preCoordinator),
        fact("Creative manager", withHandedFrom(nameOf(project.creativeManagerEmployee, project.creativeManager), handed.creativeManager)),
        fact("Production plans submitted", total ? `${planned} of ${total}` : null),
      ],
    },
    PRODUCTION: {
      person: productionManager,
      role: "Production Manager",
      done: produced,
      total,
      shoots,
      setStatus: setStatus(project.productionStatus, project.productionStatusRemarks, project.productionStatusAt, project.productionStatusByUser),
      facts: [
        fact("Production manager", productionManager),
        fact("Shoots finished", total ? `${produced} of ${total}` : null),
      ],
    },
    POST_PRODUCTION: { person: postCoordinator, role: "Coordinator", facts: [fact("Post-production coordinator", postCoordinator)] },
    DELIVERED: { facts: [] },
  };

  return {
    projectStatus: status,
    /*
     * Whether this caller may change the project's own details - the **Project Initiation** stage's
     * Update, which opens the project's form.
     *
     * Answered here rather than worked out in the browser, because it is two rules and the browser
     * knows neither: the route's own permission (`PROJECT / Projects` or `PROJECT / Show All
     * Projects` at Read & Write) **and**, once the project has started, being its Project Manager, a
     * branch administrator or a holder of Show All Projects - `mayEditStartedProject`, the same
     * answer the save itself gives. A reader who holds neither simply gets no Update, rather than a
     * button that opens onto a refusal.
     */
    canUpdateStarted,
    updates: (project.stageUpdates || []).map((update) => ({
      id: update.id,
      stage: update.stage,
      stageLabel: STAGE_LABELS[update.stage] || update.stage,
      remark: update.remark,
      by: update.user?.name || update.userName,
      at: update.createdAt,
    })),
    flag: FLAG_STATUSES.has(status) ? status : null,
    stages: STAGES.map(([id, label], index) => ({
      id,
      label,
      state: done[id] ? "done" : index === currentIndex ? "current" : "upcoming",
      ...details[id],
    })),
  };
}

const employeeName = { select: { employeeName: true } };

/**
 * Whether to offer the Project Initiation stage's Update at all.
 *
 * Both halves of what the save answers to, asked in the same order: the permission that opens the
 * project's form (`plansAProject` on the routes - `PROJECT / Projects`, or `PROJECT / Show All
 * Projects`, at Read & Write), and then `mayEditStartedProject` - which lets anybody with that
 * permission plan a project that has not started, and narrows a started one to its Project Manager,
 * a branch administrator, or whoever works every project.
 *
 * Required lazily: `projects/controller.js` requires this module, so taking it at the top would be
 * a cycle.
 */
async function maySeeStartedEditor(project, user) {
  const { mayEditStartedProject, SHOW_ALL_PROJECTS_WRITE } = require("./controller");
  const iamService = require("../../../services/iam.service");
  const [plansProjects, everyProject] = await Promise.all([
    iamService.hasPermission(user.id, "PROJECT", "Projects", "READ_WRITE"),
    iamService.hasPermission(user.id, SHOW_ALL_PROJECTS_WRITE.module, SHOW_ALL_PROJECTS_WRITE.feature, SHOW_ALL_PROJECTS_WRITE.level),
  ]);
  if (!plansProjects && !everyProject) return false;
  return mayEditStartedProject(project, user);
}

async function getProjectStage(req, res) {
  try {
    const project = await prisma.salesProject.findFirst({
      where: { id: req.params.id, deletedAt: null, AND: [await projectAccessWhere({ userId: Number(req.user.id) })] },
      select: {
        id: true,
        // The code the board filters by, for the Update that hands Project Initiation to Projects.
        eventId: true,
        projectStatus: true,
        // Who may change a started project (`mayEditStartedProject`).
        projectManagerEmployeeId: true,
        enquiryId: true,
        createdAt: true,
        initialConvertedValue: true,
        sourceBranch: true,
        vertical: true,
        mainEventDate: true,
        mainEventDateKnown: true,
        creativeManager: true,
        crmEmployee: employeeName,
        creativeManagerEmployee: employeeName,
        createdByUser: { select: { name: true } },
        branch: { select: { name: true } },
        verticalRef: { select: { name: true } },
        projectManager: true,
        preProductionCoordinator: true,
        productionManager: true,
        postProductionCoordinator: true,
        projectManagerEmployee: employeeName,
        preProductionCoordinatorEmployee: employeeName,
        productionManagerEmployee: employeeName,
        postProductionCoordinatorEmployee: employeeName,
        // The overall Pre Production and Production statuses set by hand, which override the stages'.
        preProductionStatus: true,
        preProductionStatusRemarks: true,
        preProductionStatusAt: true,
        preProductionStatusByUser: { select: { name: true } },
        productionStatus: true,
        productionStatusRemarks: true,
        productionStatusAt: true,
        productionStatusByUser: { select: { name: true } },
        // The CRD document, for the Pre Production stage: its state, and its id for the View.
        crdDocumentStatus: true,
        crdDocument: { select: { id: true, submittedAt: true } },
        shoots: {
          where: { deletedAt: null },
          orderBy: [{ dateCreated: SHOOT_DATE_ASC }, { createdAt: "asc" }],
          select: { id: true, shoot: true, dateCreated: true, shootType: true, shootTypes: true, production: { select: { planSubmittedAt: true, currentStep: true, shootStatus: true } } },
        },
        stageUpdates: {
          orderBy: { createdAt: "desc" },
          take: 50,
          select: { id: true, stage: true, remark: true, userName: true, createdAt: true, user: { select: { name: true } } },
        },
      },
    });
    if (!project) return res.status(404).json({ message: "Project not found." });
    const handed = (await projectHandedFrom([project.id])).get(project.id) || {};
    return res.json({ data: { eventId: project.eventId || null, ...projectStage(project, handed, await maySeeStartedEditor(project, req.user)) } });
  } catch (error) {
    console.error("Unable to load the project stage:", error);
    return res.status(500).json({ message: "Unable to load the project stage." });
  }
}

/**
 * The remark left after a stage was updated from the Status tab. The edit itself went through that
 * stage's own screen and endpoint; this records why, by whom and when. Mounted behind the same two
 * guards as every other write to a started project, which also find the project in the caller's
 * scope (404 otherwise).
 */
async function recordStageUpdate(req, res) {
  const stage = String(req.body?.stage || "");
  const remark = String(req.body?.remark || "").trim();
  if (!UPDATABLE_STAGES.has(stage)) return res.status(400).json({ message: "Choose the stage that was updated." });
  if (!remark) return res.status(400).json({ message: "Add a remark saying what was updated." });
  if (remark.length > 2000) return res.status(400).json({ message: "Keep the remark under 2000 characters." });
  try {
    const userId = Number(req.user.id);
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    await prisma.projectStageUpdate.create({
      data: { projectId: req.params.id, stage, remark, userId, userName: String(user?.name || "Unknown").slice(0, 191) },
    });
    return getProjectStage(req, res);
  } catch (error) {
    console.error("Unable to record the stage update:", error);
    return res.status(500).json({ message: "Unable to record the stage update." });
  }
}

/**
 * The project's submitted CRD document, read-only - the Overall Status's View, on every screen that
 * shows it. Behind the same readers as the stage, and the project held to the same scope; the
 * document is read through the CRD module's own `readResponse`, which refuses one not yet submitted.
 * Nothing here issues or shares a link: that stays on the CRD Documents page.
 */
async function getProjectCrdResponse(req, res) {
  try {
    const access = await projectAccessWhere({ userId: Number(req.user.id) });
    const project = await prisma.salesProject.findFirst({
      where: { id: req.params.id, deletedAt: null, AND: [access] },
      select: { crdDocument: { select: { id: true } } },
    });
    if (!project?.crdDocument) return res.status(404).json({ message: "This project has no CRD document." });
    const { readResponse } = require("../crd-documents/service");
    return res.json({ data: await readResponse(project.crdDocument.id, { access }) });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    console.error("Unable to load the project's CRD document:", error);
    return res.status(500).json({ message: "Unable to load the CRD document." });
  }
}

module.exports = { projectStage, getProjectStage, getProjectCrdResponse, recordStageUpdate, STAGES };
