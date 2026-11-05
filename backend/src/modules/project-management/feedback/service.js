const prisma = require("../../../config/db");
const iamService = require("../../../services/iam.service");
const { projectClientNames, clientNameOf } = require("../../../services/projectClientNames");
const { DONE: PRODUCTION_DONE } = require("../production/steps");
const { listPhotoUrl } = require("../../../services/employeeOptionLists");
const tasks = require("../../hrm/tasks/service");
const whatsappActivity = require("../../../services/whatsappActivity");
const messageSwitches = require("../../../services/messageTemplateSwitches");
const { sendWhatsAppToPerson } = require("../../sales/whatsapp-chat/directSend");
const { ISSUE_REVIEWS, REVIEW_LABELS, ANSWER_LABELS } = require("./issues");

/*
 * Project Management → Customer Issues and Feedback: a review of a project - a rating and what the
 * reviewer wrote - and the Average and Poor reviews given to somebody as a task.
 *
 * **Every project created in Bookings & Converted (Create Project) waits for its New Project
 * Feedback**, **every shoot Production completes waits for a Shoot Completion Feedback of its
 * own**, and **once the project is Delivered - under Projects → Completed - with every shoot completed
 * and its feedback given, the project waits for its Overall Feedback** (`overallFeedbackOpen`) - on
 * the Yet to be done tab (`pendingFeedback`), for
 * anybody holding PROJECT / Feedback, each given from its own row's Give Feedback, with no project
 * or shoot to pick. The waiting list is not
 * narrowed to the projects a person is named on, by the studio's decision: feedback on a wedding
 * comes from people who were not staffed to it. Which people may give feedback at all is the
 * permission, granted per role.
 *
 * Feedback was once asked for in further stages (`FEEDBACK_STAGES`) - Production Completion
 * Feedback once Production completed a project's shoots, then Project Completed Feedback. Those were
 * removed by the studio's decision; the rows they wrote stay and are read with the stage they were
 * given at.
 *
 * What is narrowed is the list of feedback. By default a reader sees **only the feedback they gave**;
 * `PROJECT / View All Feedback` (an action permission under Project Management in Role Management)
 * widens that to everybody's - see `feedbackScope`.
 */

/** The action permission that shows everybody's feedback rather than only one's own. */
const VIEW_ALL_FEEDBACK = { module: "PROJECT", feature: "View All Feedback" };

/**
 * A project's feedbacks by the names the studio reads them by, in the order they are asked for. New
 * Project, Shoot Completion and Overall Feedback are asked for (`OPEN_STAGES`); the other two are
 * read back on the rows given before they were removed.
 */
const FEEDBACK_STAGES = {
  NEW_PROJECT: "New Project Feedback",
  SHOOT_COMPLETION: "Shoot Completion Feedback",
  OVERALL: "Overall Feedback",
  PRODUCTION_COMPLETION: "Production Completion Feedback",
  PROJECT_COMPLETED: "Project Completed Feedback",
};
const NEW_PROJECT_STAGE = "NEW_PROJECT";
const SHOOT_STAGE = "SHOOT_COMPLETION";
const OVERALL_STAGE = "OVERALL";
const OPEN_STAGES = [NEW_PROJECT_STAGE, SHOOT_STAGE, OVERALL_STAGE];

/** Whether a shoot is Completed on the Production board: its plan submitted and its last step done. */
const shootCompleted = (production) => Boolean(production?.planSubmittedAt) && production.currentStep === PRODUCTION_DONE;

/**
 * Whether Production has completed all of a project's shoots: every live shoot Completed on the
 * board, a Rejected shoot set aside (it never completes), and at least one left that did. A shoot not
 * on the board yet (no production record) is not completed. `shoots` are the project's live shoots
 * with their production (`OVERALL_READ`).
 */
function productionComplete(shoots = []) {
  const counted = shoots.filter((shoot) => shoot.production?.shootStatus !== "REJECT");
  return counted.length > 0 && counted.every((shoot) => shootCompleted(shoot.production));
}
/** The project statuses that list a project under Projects → Completed - what its Overall Feedback waits for. "Delivered" is the old word for it. */
const DELIVERED_STATUSES = ["Completed", "Delivered"];
/**
 * Why a project's Overall Feedback is not open yet, or null when it is: Production has completed all
 * its shoots, every one of them has its Shoot Completion Feedback - so the Overall Feedback is the
 * project's last, the highest version of its Feedback ID, when it is given - and the project is
 * Delivered, under Projects → Completed. A shoot added to the project after that still gets its own
 * feedback, numbered after the Overall Feedback; nothing is renumbered. `project` carries its
 * `projectStatus` and its live shoots (`OVERALL_READ`).
 */
function overallFeedbackRefusal({ projectStatus, shoots = [] } = {}) {
  if (!productionComplete(shoots)) return "Production has not completed all of this project's shoots yet, so its Overall Feedback is not open.";
  if (!shoots.filter((shoot) => shoot.production?.shootStatus !== "REJECT").every((shoot) => (shoot.feedback || []).length > 0)) {
    return "Give every shoot's Shoot Completion Feedback first - the Overall Feedback is the project's last.";
  }
  if (!DELIVERED_STATUSES.includes(projectStatus)) return "This project is not under Projects → Completed yet, so its Overall Feedback is not open.";
  return null;
}
const overallFeedbackOpen = (project) => overallFeedbackRefusal(project) === null;
/** What `overallFeedbackOpen` reads of a project: its status and its live shoots. */
const OVERALL_READ = { projectStatus: true, shoots: { where: { deletedAt: null }, select: {
  production: { select: { planSubmittedAt: true, currentStep: true, shootStatus: true } },
  feedback: { where: { stage: "SHOOT_COMPLETION" }, select: { id: true } },
} } };
const stageFields = (stage) => ({ stage, stageLabel: FEEDBACK_STAGES[stage] || stage });

/**
 * The areas of the work, in order: a Production Completion Feedback rated them one by one, and a
 * Shoot Completion Feedback names the people who worked in them (`shootPeople`).
 */
const FEEDBACK_AREAS = { SALES: "Sales", PRE_PRODUCTION: "Pre Production", PRODUCTION: "Production" };
/** Every area a feedback can rate, in order: Production Completion's three, then Project Completed's Post Production. */
const AREA_LABELS = { ...FEEDBACK_AREAS, POST_PRODUCTION: "Post Production" };

/** The ratings a review can carry, best first - the order the form lists them in. */
const REVIEWS = ["Excellent", "Good", "Average", "Poor"];

/**
 * Where a feedback has got to, in the order the page's status bar lists them. Yet to be done is a
 * project still waiting for its feedback.
 */
const STATUSES = ["Yet to be done", "Issues", "Issues sorted", "Completed", "Rejected"];

/**
 * Where a feedback goes the moment it is given, by its review: a good one is Completed, and one
 * that says something went wrong is an Issue for the team to sort out.
 */
const STATUS_FOR_REVIEW = { Excellent: "Completed", Good: "Completed", Average: "Issues", Poor: "Issues" };

/** Where a feedback under Issues can go next, from its ⋮ menu: the team sorted it, or it was rejected. */
const ISSUE_OUTCOMES = ["Issues sorted", "Rejected"];

/**
 * One Feedback ID per project, and a version of it per feedback: `DBS-FB-00001` is the project's,
 * from the counter every generated identifier in the application comes from - the `DBS-` shape every
 * business id wears, with five digits as a task's `DBS-TK-00001` has - and `DBS-FB-00001-01` is its
 * New Project Feedback, `-02`, `-03` ... its Shoot Completion Feedbacks in the order given, and the
 * last its Overall Feedback. Read and matched as text, never parsed back, so nothing breaks when either
 * part grows a digit.
 *
 * Both are taken inside the save's transaction, after the project row is locked, so a refused save
 * spends no number and two saves for one project cannot take the same version.
 */
const FEEDBACK_CODE_PREFIX = "DBS-FB-";
/** The project's Feedback ID, minted on its first feedback and kept on the project from then on. */
async function projectFeedbackCode(client, projectId) {
  const project = await client.salesProject.findUnique({ where: { id: projectId }, select: { feedbackCode: true } });
  if (project?.feedbackCode) return project.feedbackCode;
  const row = await client.appSequence.upsert({
    where: { key: "PROJECT_FEEDBACK_ID" },
    create: { key: "PROJECT_FEEDBACK_ID", currentValue: 1 },
    update: { currentValue: { increment: 1 } },
  });
  const code = `${FEEDBACK_CODE_PREFIX}${String(row.currentValue).padStart(5, "0")}`;
  await client.salesProject.update({ where: { id: projectId }, data: { feedbackCode: code } });
  return code;
}
/**
 * The version a feedback of `stage` takes: 1 for the New Project Feedback, whenever it is given; any
 * other the next after the highest the project has - never 1, which is kept for the New Project's.
 */
async function nextFeedbackVersion(client, projectId, stage) {
  if (stage === NEW_PROJECT_STAGE) return 1;
  const { _max: highest } = await client.projectFeedback.aggregate({ where: { projectId }, _max: { feedbackVersion: true } });
  return Math.max(Number(highest?.feedbackVersion) || 0, 1) + 1;
}
const versionedFeedbackCode = (code, version) => `${code}-${String(version).padStart(2, "0")}`;

/**
 * What the thank-you message a Completed feedback is answered with draws on from the branch: its
 * Google Review URL and the social media links the studio added (Settings → Organization → Branches).
 */
const SOCIAL_LINK_SELECT = { googleReviewUrl: true, customSocialLinks: true };

/** The project, as every feedback row and every waiting row reads it. */
const projectSelect = {
  id: true,
  eventId: true,
  whatsappGroupNameId: true,
  whatsappGroupName: true,
  projectStatus: true,
  mainEventDate: true,
  // Text copies beside their links. A nested read is not resolved by the Prisma extension, so
  // the linked names are asked for here and win over the text (`resolvedNames.js`).
  sourceBranch: true,
  crmName: true,
  branch: { select: { name: true } },
  crmEmployee: { select: { employeeName: true } },
};

/**
 * A project's details as the table, the info panel and Give Feedback's Project Description read
 * them - the same details Cash Spent pulls in for a project (`cash-entries` `toProjectOption`).
 */
function projectFields(project, names) {
  return {
    projectKey: project.id,
    eventId: project.eventId,
    // The project's main event date - what the project screens call Event Date.
    eventDate: project.mainEventDate,
    projectName: project.whatsappGroupName,
    clientName: clientNameOf(project, names),
    projectStatus: project.projectStatus,
    branch: project.branch?.name || project.sourceBranch || null,
    crmName: project.crmEmployee?.employeeName || project.crmName || null,
  };
}

/** The shoot a Shoot Completion Feedback is about, as every row reads it. */
const shootSelect = { id: true, shootId: true, shoot: true, dateCreated: true };

/** A shoot's details beside its project's - empty for a feedback that names no shoot. */
function shootFields(shoot) {
  return {
    shootKey: shoot?.id || null,
    // DBS-SID-..., the Shoot ID the studio reads.
    shootCode: shoot?.shootId || null,
    shootName: shoot?.shoot || null,
    // The day the shoot runs (`date_created` holds it).
    shootDate: shoot?.dateCreated || null,
  };
}

/**
 * Feedback as the table, its info panel and its View read it: its stage, the review and the project
 * it is about. Names are read through the links, never stored beside them.
 */
function toFeedback(row, names) {
  return {
    id: row.id,
    feedbackCode: row.feedbackCode,
    // Which version of the project's Feedback ID it is - the table folds a project's feedbacks by it.
    feedbackVersion: row.feedbackVersion,
    ...stageFields(row.stage),
    ...projectFields(row.project, names),
    ...shootFields(row.shoot),
    review: row.review,
    // A Production Completion or Project Completed Feedback has no words of its own; the table reads
    // what it was given instead.
    feedback: row.feedback ?? areaSummary(row),
    status: row.status,
    givenBy: row.createdByUser?.name || "",
    createdAt: row.createdAt,
    // A Production Completion Feedback's own parts - each area's review, the referral, the people named -
    // and a Project Completed Feedback's: Post Production, the Overall Experience and the Suggestion.
    ...productionCompletionFields(row),
    ...projectCompletedFields(row),
    // The people a Production Completion or Shoot Completion Feedback appreciates or is not satisfied with.
    ...mentionFields(row),
    // Its Average and Poor reviews, each given to somebody as a task, and how each was answered.
    ...issueFields(row.issues),
    // Set when it was moved on from Issues: the remark (required for Rejected), by whom, and when.
    issueRemarks: row.issueRemarks || "",
    issueResolvedBy: row.issueResolvedByUser?.name || "",
    issueResolvedAt: row.issueResolvedAt,
  };
}

const feedbackSelect = {
  id: true,
  feedbackCode: true,
  feedbackVersion: true,
  stage: true,
  review: true,
  feedback: true,
  status: true,
  createdAt: true,
  issueRemarks: true,
  issueResolvedAt: true,
  referralName: true,
  referralMobile: true,
  overallExperience: true,
  suggestion: true,
  areas: { select: { area: true, review: true, feedback: true } },
  issues: { select: { reviewKey: true, review: true, status: true, remarks: true, task: { select: { taskCode: true, assignedToName: true, status: true } } }, orderBy: { id: "asc" } },
  employees: { select: { kind: true, employee: { select: { id: true, employeeName: true } } }, orderBy: { id: "asc" } },
  project: { select: projectSelect },
  shoot: { select: shootSelect },
  createdByUser: { select: { id: true, name: true } },
  issueResolvedByUser: { select: { id: true, name: true } },
};

/** Each area's words, then the Overall Experience and Suggestion, one line each, for the table's Feedback column. */
function areaSummary(row) {
  const byArea = Object.fromEntries((row.areas || []).map((area) => [area.area, area]));
  const lines = [
    ...Object.keys(AREA_LABELS).filter((area) => byArea[area]).map((area) => `${AREA_LABELS[area]} (${byArea[area].review}): ${byArea[area].feedback}`),
    ...(row.overallExperience ? [`Overall Experience: ${row.overallExperience}`] : []),
    ...(row.suggestion ? [`Suggestion: ${row.suggestion}`] : []),
  ];
  return lines.length ? lines.join("\n") : null;
}

/**
 * A feedback's issues - its Average and Poor reviews, each a task for the person it was assigned to -
 * as the table, info panel and View read them: the list, one line each for reading, and whether it has
 * any (a feedback with issues is answered through their tasks, never moved by hand).
 */
function issueFields(issues = []) {
  const list = (issues || []).map((issue) => ({
    reviewKey: issue.reviewKey,
    reviewLabel: REVIEW_LABELS[issue.reviewKey] || issue.reviewKey,
    review: issue.review,
    assignedTo: issue.task?.assignedToName || "",
    taskCode: issue.task?.taskCode || "",
    // Where the assignee has got to with it - the task's own progress, as HRM → Tasks names it.
    taskStatus: issue.task?.status ? (tasks.STATUS_LABELS[issue.task.status] || issue.task.status) : "",
    // The issue's outcome: still open, or answered sorted / rejected.
    status: ANSWER_LABELS[issue.status] || issue.status,
    remarks: issue.remarks || "",
  }));
  return {
    issues: list,
    hasIssues: list.length > 0,
    issuesSummary: list.map((issue) => `${issue.reviewLabel} (${issue.review}) - ${issue.assignedTo || "nobody"}, ${issue.taskCode}: ${issue.status}${issue.remarks ? ` - ${issue.remarks}` : ""}`).join("\n"),
  };
}

/**
 * The New Project Feedback's Average or Poor review, with the active login it is given to - required
 * then. Refused when it has nobody, or somebody who cannot take a task.
 */
async function issuesOf(input) {
  if (!ISSUE_REVIEWS.includes(input.review)) return [];
  const chosen = Number(input.assignees?.REVIEW);
  if (!chosen) throw Object.assign(new Error(`Assign someone to the review - it is ${input.review}.`), { status: 400 });
  const user = await prisma.user.findFirst({
    where: { id: chosen, status: "ACTIVE" },
    select: { id: true, name: true, username: true, email: true, status: true, linkedEmployeeId: true },
  });
  // Only somebody who can open their Tasks and answer it - HRM / Task Management with write.
  if (!user || !(await tasks.canAnswerTasks(user.id))) {
    throw Object.assign(new Error("The person chosen for the review cannot answer it - they need an active login with HRM / Task Management. Choose somebody else."), { status: 400 });
  }
  return [{ key: "REVIEW", review: input.review, words: input.feedback, assignee: user }];
}

/**
 * The department an issue's task is filed under, by the feedback it came from - the part of the work
 * the client was answering about: a project's New Project Feedback is the sale, a shoot's is
 * Production, and the Overall Feedback is Post Production. Names from the studio's `department` list.
 */
const STAGE_DEPARTMENTS = { NEW_PROJECT: "Sales", SHOOT_COMPLETION: "Production", OVERALL: "Post Production" };

/** The task an issue becomes: what the client said, about which project, and what is asked of the assignee. */
function issueTask(issue, feedback, project, shoot) {
  const projectName = [project.whatsappGroupName, project.eventId && `(${project.eventId})`].filter(Boolean).join(" ");
  const shootName = shoot ? `, shoot ${[shoot.shootId, shoot.shoot && `(${shoot.shoot})`].filter(Boolean).join(" ")}` : "";
  const label = REVIEW_LABELS[issue.key];
  return {
    title: `Feedback issue: ${label} rated ${issue.review} - ${shoot?.shootId || project.eventId || project.whatsappGroupName}`.slice(0, 200),
    description: [
      `${FEEDBACK_STAGES[feedback.stage]} ${feedback.feedbackCode} on ${projectName}${shootName}.`,
      `The client rated ${label} ${issue.review}.`,
      issue.words ? `What they said: ${issue.words}` : "",
      "Sort it out and answer this task as Issues sorted, or as Rejected with the reason.",
    ].filter(Boolean).join("\n\n"),
    // Its own type, so a feedback issue reads as one on every task list, and always high priority:
    // a client is waiting on the answer.
    taskType: "Feedback",
    priority: "HIGH",
    department: STAGE_DEPARTMENTS[feedback.stage] || null,
    branch: project.branch?.name || project.sourceBranch || null,
    branchId: project.branchId ?? null,
  };
}

/** A Project Completed Feedback's parts as the info panel and View read them. Empty for any other. */
function projectCompletedFields(row) {
  if (row.stage !== "PROJECT_COMPLETED") return {};
  const postProduction = (row.areas || []).find((area) => area.area === "POST_PRODUCTION");
  return {
    postProductionReview: postProduction?.review || "",
    postProductionFeedback: postProduction?.feedback || "",
    overallExperience: row.overallExperience || "",
    suggestion: row.suggestion || "",
  };
}

/**
 * A Production Completion Feedback's parts as the info panel and View read them: each area's review
 * and words (`salesReview`, `preProductionFeedback`, ...) and the referral; the employees it names are
 * `mentionFields`'. Empty for any other.
 */
function productionCompletionFields(row) {
  if (row.stage !== "PRODUCTION_COMPLETION") return {};
  const byArea = Object.fromEntries((row.areas || []).map((area) => [area.area, area]));
  return {
    salesReview: byArea.SALES?.review || "",
    salesFeedback: byArea.SALES?.feedback || "",
    preProductionReview: byArea.PRE_PRODUCTION?.review || "",
    preProductionFeedback: byArea.PRE_PRODUCTION?.feedback || "",
    productionReview: byArea.PRODUCTION?.review || "",
    productionFeedback: byArea.PRODUCTION?.feedback || "",
    referralName: row.referralName || "",
    referralMobile: row.referralMobile || "",
  };
}

/**
 * The employees a feedback names - Appreciation and Not Satisfied - as names for reading and as
 * `{ id, name }` for anything that needs the person: a Production Completion Feedback's, and a Shoot
 * Completion Feedback's. Empty for any other.
 */
function mentionFields(row) {
  if (!["PRODUCTION_COMPLETION", SHOOT_STAGE].includes(row.stage)) return {};
  const named = (kind) => (row.employees || []).filter((entry) => entry.kind === kind && entry.employee)
    .map((entry) => ({ id: entry.employee.id, name: entry.employee.employeeName }));
  const appreciated = named("APPRECIATED");
  const notSatisfied = named("NOT_SATISFIED");
  return {
    appreciatedEmployees: appreciated,
    notSatisfiedEmployees: notSatisfied,
    appreciated: appreciated.map((person) => person.name).join(", "),
    notSatisfied: notSatisfied.map((person) => person.name).join(", "),
  };
}

/**
 * The people who worked on a shoot, by area - who its Shoot Completion Feedback may appreciate, or
 * name as not satisfied with. Read from the project's and the shoot's own roles, never sent by the
 * browser:
 *
 *   Sales           the project's CRM
 *   Pre Production  the project's Pre Production Coordinator, Creative Manager and Project Manager
 *   Production      the project's Production Manager, and the shoot's Production Coordinator,
 *                   Production Team and service crew
 *
 * `null` for a shoot that is gone, or not of that project. Somebody in two areas is listed under both.
 */
async function shootPeople(projectId, shootId, client = prisma) {
  const shoot = await client.projectShoot.findFirst({
    where: { id: String(shootId || ""), projectId: String(projectId || ""), deletedAt: null, project: { deletedAt: null } },
    select: {
      project: { select: { crmEmployeeId: true, preProductionCoordinatorEmployeeId: true, creativeManagerEmployeeId: true, projectManagerEmployeeId: true, productionManagerEmployeeId: true } },
      production: { select: { productionCoordinatorEmployeeId: true, teamMembers: { select: { employeeId: true } }, serviceCrew: { select: { employeeId: true } } } },
    },
  });
  if (!shoot) return null;
  const { project, production } = shoot;
  const ids = {
    SALES: [project.crmEmployeeId],
    PRE_PRODUCTION: [project.preProductionCoordinatorEmployeeId, project.creativeManagerEmployeeId, project.projectManagerEmployeeId],
    PRODUCTION: [
      project.productionManagerEmployeeId,
      production?.productionCoordinatorEmployeeId,
      ...(production?.teamMembers || []).map((member) => member.employeeId),
      ...(production?.serviceCrew || []).map((member) => member.employeeId),
    ],
  };
  const everyone = [...new Set(Object.values(ids).flat().filter(Boolean))];
  const employees = everyone.length
    ? await client.employee.findMany({ where: { id: { in: everyone } }, select: { id: true, employeeName: true, profilePhotoUrl: true } })
    : [];
  const byId = new Map(employees.map((employee) => [employee.id, { id: employee.id, employeeName: employee.employeeName, profilePhotoUrl: listPhotoUrl(employee.profilePhotoUrl) }]));
  return Object.entries(FEEDBACK_AREAS).map(([area, label]) => ({
    area,
    label,
    people: [...new Set(ids[area].filter(Boolean))].map((id) => byId.get(id)).filter(Boolean)
      .sort((a, b) => a.employeeName.localeCompare(b.employeeName)),
  }));
}

/** A feedback still shown: its project not deleted, nor the shoot it is about. */
const LIVE_FEEDBACK = { project: { deletedAt: null }, OR: [{ shootId: null }, { shoot: { deletedAt: null } }] };

/**
 * Whose feedback a reader sees.
 *
 * Their own, always. With View All Feedback, everybody's as well - as far as the roles granting it
 * reach, the way Show All Projects widens the register (`projectScope.js`): a role naming every
 * branch shows all of it, a role naming one shows that branch's projects' feedback, and a Super
 * Admin (`reachableBranchIds` answers `null`) sees everything. Added to the reader's own, never in
 * place of it, so the grant can only show more.
 */
async function feedbackScope(userId) {
  const own = { createdByUserId: userId };
  const viewsAll = await iamService.hasPermission(userId, VIEW_ALL_FEEDBACK.module, VIEW_ALL_FEEDBACK.feature, "READ").catch(() => false);
  if (!viewsAll) return own;
  const branchIds = await iamService.reachableBranchIds(userId, VIEW_ALL_FEEDBACK);
  if (branchIds === null) return {};
  if (!branchIds.length) return own;
  return { OR: [own, { project: { branchId: { in: branchIds } } }] };
}

/** The feedback this reader may see (`feedbackScope`), newest first. */
async function listFeedback({ userId }) {
  const rows = await prisma.projectFeedback.findMany({
    where: { ...LIVE_FEEDBACK, AND: [await feedbackScope(userId)] },
    select: feedbackSelect,
    orderBy: { createdAt: "desc" },
  });
  const names = await projectClientNames(rows.map((row) => row.project));
  return rows.map((row) => toFeedback(row, names));
}

/**
 * The feedback waiting to be given, for the page's Yet to be done tab:
 *
 * - every shoot Production has completed - Completed on its board (`boardStatus`: the plan
 *   submitted and the last step done) - with no Shoot Completion Feedback yet, newest shoot first;
 * - every project whose shoots Production has all completed, each with its Shoot Completion Feedback
 *   given, that is Delivered - under Projects → Completed (`overallFeedbackOpen`) - with no Overall
 *   Feedback yet, newest first;
 * - every project created in Bookings & Converted with no New Project Feedback yet, newest first.
 *
 * Neither a deleted project nor a deleted shoot waits. Once given, a row leaves this list and its
 * feedback row takes its place. Not narrowed to the reader's projects (see the top of this file):
 * anybody holding PROJECT / Feedback may review any of them.
 */
async function pendingFeedback() {
  const [shoots, finished, projects] = await Promise.all([
    prisma.projectShoot.findMany({
      where: {
        deletedAt: null,
        project: { deletedAt: null },
        production: { planSubmittedAt: { not: null }, currentStep: PRODUCTION_DONE },
        feedback: { none: { stage: SHOOT_STAGE } },
      },
      select: { ...shootSelect, project: { select: projectSelect } },
      orderBy: [{ dateCreated: "desc" }, { createdAt: "desc" }],
    }),
    // Narrowed to a Completed project with a completed shoot here; the rest is `overallFeedbackOpen`'s.
    prisma.salesProject.findMany({
      where: { deletedAt: null, projectStatus: { in: DELIVERED_STATUSES }, feedback: { none: { stage: OVERALL_STAGE } }, shoots: { some: { deletedAt: null, production: { currentStep: PRODUCTION_DONE } } } },
      select: { ...projectSelect, ...OVERALL_READ },
      orderBy: { createdAt: "desc" },
    }),
    prisma.salesProject.findMany({
      where: { deletedAt: null, feedback: { none: { stage: NEW_PROJECT_STAGE } } },
      select: projectSelect,
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const overall = finished.filter(overallFeedbackOpen);
  const names = await projectClientNames([...shoots.map((shoot) => shoot.project), ...overall, ...projects]);
  // Not a feedback id: the row is the project or shoot waiting, keyed apart from the feedback rows beside it.
  const waiting = (stage, project, shoot) => ({
    id: shoot ? `shoot:${shoot.id}:${stage}` : `project:${project.id}:${stage}`,
    pending: true,
    ...stageFields(stage),
    ...projectFields(project, names),
    ...shootFields(shoot),
    status: STATUSES[0],
  });
  return [
    ...shoots.map((shoot) => waiting(SHOOT_STAGE, shoot.project, shoot)),
    ...overall.map((project) => waiting(OVERALL_STAGE, project, null)),
    ...projects.map((project) => waiting(NEW_PROJECT_STAGE, project, null)),
  ];
}

/** What the Give Feedback form's Review dropdown offers. The project is not chosen on the form. */
function feedbackOptions() {
  return { reviews: REVIEWS };
}

/**
 * Saves a feedback and files it by its review (`STATUS_FOR_REVIEW`): `input.stage` of the project -
 * its New Project Feedback, a Shoot Completion Feedback for the shoot `input.shootId`, or its Overall
 * Feedback once Production has completed all its shoots. A shoot's may name the people who worked on
 * it the client appreciates (`appreciatedEmployeeIds`) or is not satisfied with
 * (`notSatisfiedEmployeeIds`), checked against `shootPeople`. An
 * Average or Poor review is given, in the same write, to the person chosen for it as an HRM task.
 *
 * The answer carries what the message to the client is written from: the branch's social media
 * links (`socialLinks`, Settings → Organization → Branches) - the thank-you for a Completed feedback
 * asks for a review and a follow on them.
 *
 * The project and shoot sent are looked up again rather than trusted - any live project, as the
 * waiting list offers, and a live shoot of that project - so an id for a deleted one, one that never
 * existed, or a shoot of another project is answered as not found. A shoot Production has not
 * completed - or, for the Overall Feedback, a project whose shoots it has not all completed - is
 * refused. One per project per stage per shoot: the save locks the project row before
 * looking, so two saves at the same moment are taken one after the other and the second is refused,
 * naming the Feedback ID already given.
 */
async function createFeedback({ input, userId }) {
  const issues = await issuesOf(input);
  const actor = issues.length ? await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, username: true, email: true } }) : null;
  return withSocialLinks(await saveFeedback({ input, userId, issues, actor }));
}

/**
 * Saves one feedback and answers its row as read - the checks and the write `createFeedback`
 * describes, with the review's assignee (`issues`) and the actor already looked up, so a bulk save
 * asks for those once rather than once per row.
 */
async function saveFeedback({ input, userId, issues, actor }) {
  const stage = input.stage ?? NEW_PROJECT_STAGE;
  if (!OPEN_STAGES.includes(stage)) throw Object.assign(new Error("Choose which feedback this is."), { status: 400 });
  // A shoot's feedback names its shoot - an empty id would match any shoot of the project - and only it does.
  if (stage === SHOOT_STAGE && !input.shootId) throw Object.assign(new Error("Choose the shoot."), { status: 400 });
  if (stage !== SHOOT_STAGE && input.shootId) throw Object.assign(new Error("Only a Shoot Completion Feedback names a shoot."), { status: 400 });
  const project = await prisma.salesProject.findFirst({
    where: { id: input.projectId, deletedAt: null },
    select: { id: true, eventId: true, whatsappGroupName: true, sourceBranch: true, branchId: true, branch: { select: { name: true } } },
  });
  if (!project) throw Object.assign(new Error("That project was not found. Choose it again from the list."), { status: 404 });
  // The shoot, live, of this project, and completed - asked before anything else is checked, and
  // again once the project is locked, so one deleted or reopened in between is not reviewed.
  const loadShoot = async (client) => {
    if (stage !== SHOOT_STAGE) return null;
    const found = await client.projectShoot.findFirst({
      where: { id: input.shootId, projectId: project.id, deletedAt: null },
      select: { ...shootSelect, production: { select: { planSubmittedAt: true, currentStep: true } } },
    });
    if (!found) throw Object.assign(new Error("That shoot was not found on this project. Reload to see the shoots waiting."), { status: 404 });
    if (!shootCompleted(found.production)) {
      throw Object.assign(new Error("Production has not completed this shoot yet, so its feedback is not open."), { status: 409 });
    }
    return found;
  };
  const shoot = await loadShoot(prisma);
  // The Overall Feedback waits for every shoot and every shoot's feedback, so it is the project's
  // last, and for the project to be Delivered - asked again under the lock, like the shoot.
  const checkOverall = async (client) => {
    if (stage !== OVERALL_STAGE) return;
    const refusal = overallFeedbackRefusal(await client.salesProject.findUnique({ where: { id: project.id }, select: OVERALL_READ }));
    if (refusal) throw Object.assign(new Error(refusal), { status: 409 });
  };
  await checkOverall(prisma);
  // A shoot's feedback may name only people who worked on that shoot, and never one in both lists.
  const appreciatedIds = stage === SHOOT_STAGE ? [...new Set(input.appreciatedEmployeeIds || [])] : [];
  const notSatisfiedIds = stage === SHOOT_STAGE ? [...new Set(input.notSatisfiedEmployeeIds || [])] : [];
  if (stage !== SHOOT_STAGE && ((input.appreciatedEmployeeIds || []).length || (input.notSatisfiedEmployeeIds || []).length)) {
    throw Object.assign(new Error("Only a Shoot Completion Feedback names the people appreciated or not satisfied with."), { status: 400 });
  }
  if (notSatisfiedIds.some((id) => appreciatedIds.includes(id))) throw Object.assign(new Error("Somebody cannot be both appreciated and not satisfied with."), { status: 400 });
  // Asked before anything else is checked, and again once the project is locked, so somebody taken
  // off the shoot in between is not named.
  const checkPeople = async (client) => {
    if (!appreciatedIds.length && !notSatisfiedIds.length) return;
    const people = await shootPeople(project.id, shoot.id, client);
    const allowed = new Set((people || []).flatMap((area) => area.people.map((person) => person.id)));
    if ([...appreciatedIds, ...notSatisfiedIds].some((id) => !allowed.has(id))) {
      throw Object.assign(new Error("Only people who worked on this shoot in Sales, Pre Production or Production can be named."), { status: 400 });
    }
  };
  await checkPeople(prisma);
  const given = (client) => client.projectFeedback.findFirst({ where: { projectId: project.id, stage, shootId: shoot?.id ?? null }, select: { feedbackCode: true } });
  const alreadyGiven = (found) => Object.assign(new Error(`${shoot ? `Shoot ${shoot.shootId}` : "This project"} already has its ${FEEDBACK_STAGES[stage]}${found ? ` (${found.feedbackCode})` : ""}. Reload to see it.`), { status: 409 });
  const row = await prisma.$transaction(async (tx) => {
    // One save per project at a time: the second waits here, then finds the first's feedback below.
    await tx.$queryRaw`SELECT id FROM sales_project WHERE id = ${project.id} FOR UPDATE`;
    await loadShoot(tx);
    await checkOverall(tx);
    await checkPeople(tx);
    const found = await given(tx);
    if (found) throw alreadyGiven(found);
    // The Feedback ID is taken in the same transaction as the row, so a refused save spends no number.
    const select = { ...feedbackSelect, project: { select: { ...projectSelect, branch: { select: { name: true, ...SOCIAL_LINK_SELECT } } } } };
    const feedbackVersion = await nextFeedbackVersion(tx, project.id, stage);
    const created = await tx.projectFeedback.create({
      data: {
        feedbackCode: versionedFeedbackCode(await projectFeedbackCode(tx, project.id), feedbackVersion),
        feedbackVersion,
        projectId: project.id,
        stage,
        shootId: shoot?.id ?? null,
        review: input.review,
        feedback: input.feedback,
        status: STATUS_FOR_REVIEW[input.review],
        createdByUserId: userId,
        ...(appreciatedIds.length || notSatisfiedIds.length ? { employees: { create: [
          ...appreciatedIds.map((employeeId) => ({ employeeId, kind: "APPRECIATED" })),
          ...notSatisfiedIds.map((employeeId) => ({ employeeId, kind: "NOT_SATISFIED" })),
        ] } } : {}),
      },
      select,
    });
    for (const issue of issues) {
      const task = await tasks.insertTask(tx, issueTask(issue, created, project, shoot), issue.assignee, actor);
      await tx.projectFeedbackIssue.create({ data: { feedbackId: created.id, reviewKey: issue.key, review: issue.review, taskId: task.id } });
    }
    return issues.length ? tx.projectFeedback.findUnique({ where: { id: created.id }, select }) : created;
  });
  return row;
}

/** A saved feedback as the table reads it, with the branch links its thank-you message draws on. */
async function withSocialLinks(row, names) {
  const links = row.project.branch || {};
  return {
    ...toFeedback(row, names || await projectClientNames([row.project])),
    socialLinks: {
      googleReviewUrl: links.googleReviewUrl || null,
      // The links added in Settings with their labels - always a list.
      customSocialLinks: Array.isArray(links.customSocialLinks) ? links.customSocialLinks : [],
    },
  };
}

/**
 * Gives every project of a bulk save that has no Feedback ID yet its ID, in one step: the counter
 * is moved on once by how many are needed, rather than once inside each row's save - where every
 * save waited on the one counter row, and the rows went in one after another however many were
 * saved at once. An ID is the project's for good (`projectFeedbackCode`), so one given to a row
 * that is then refused is simply the ID its feedback will carry later. Two bulk saves at once each
 * take their own range; a project both give an ID to keeps the first (`feedbackCode: null` guard).
 */
async function reserveFeedbackCodes(projectIds) {
  if (!projectIds.length) return;
  const missing = await prisma.salesProject.findMany({ where: { id: { in: projectIds }, deletedAt: null, feedbackCode: null }, select: { id: true } });
  if (!missing.length) return;
  const row = await prisma.appSequence.upsert({
    where: { key: "PROJECT_FEEDBACK_ID" },
    create: { key: "PROJECT_FEEDBACK_ID", currentValue: missing.length },
    update: { currentValue: { increment: missing.length } },
  });
  const first = row.currentValue - missing.length + 1;
  await prisma.$transaction(missing.map((project, index) => prisma.salesProject.updateMany({
    where: { id: project.id, feedbackCode: null },
    data: { feedbackCode: `${FEEDBACK_CODE_PREFIX}${String(first + index).padStart(5, "0")}` },
  })));
}

/** How many rows a bulk Give Feedback saves at the same time - each still in its own transaction. */
const BULK_CONCURRENCY = 8;

/**
 * Give Feedback over many waiting rows at once - the same review and feedback to each.
 *
 * It used to be one request per ticked row from the browser, one after another: three thousand
 * rows took ten minutes. Now the screen sends them in batches, and here the shared part - the
 * review's assignee and who is giving it - is checked once, the rows are saved `BULK_CONCURRENCY`
 * at a time (each with every check and lock `createFeedback` has, so a row already given is still
 * refused), and the client names are read once for the lot. A refused row does not stop the rest:
 * it comes back in `refused` with its reason, and the screen keeps it ticked.
 */
async function createFeedbackMany({ items, common, userId }) {
  await reserveFeedbackCodes([...new Set(items.map((item) => item.projectId))]);
  const issues = await issuesOf(common);
  const actor = issues.length ? await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, username: true, email: true } }) : null;
  const rows = new Array(items.length);
  const refused = [];
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      const item = items[index];
      try {
        rows[index] = await saveFeedback({ input: { ...common, ...item }, userId, issues, actor });
      } catch (error) {
        if (!error.status) console.error("Unable to save a feedback in bulk:", error);
        refused.push({ ...item, message: error.status ? error.message : "Unable to save the feedback." });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(BULK_CONCURRENCY, items.length) }, worker));
  const savedRows = rows.filter(Boolean);
  const names = savedRows.length ? await projectClientNames(savedRows.map((row) => row.project)) : null;
  return { saved: savedRows.map((row) => toFeedback(row, names)), refused };
}

/**
 * Moves a feedback under Issues on to Issues sorted or Rejected (`ISSUE_OUTCOMES`).
 *
 * Only for a feedback the caller may see (`feedbackScope`), and only while it is still under Issues
 * - written as one conditional update, so two people answering the same feedback at once cannot
 * both move it: the second is told it has already moved. Answers the feedback as the table reads it.
 * The remark (`remarks`, already checked by the controller - required for Rejected) is kept with who
 * moved it and when; a blank one is stored as none.
 */
async function resolveIssue({ feedbackId, status, remarks, userId }) {
  // Checked here as well as by the controller, so no caller can reject without a reason.
  if (status === "Rejected" && !String(remarks || "").trim()) throw Object.assign(new Error("Give the reason for rejecting it."), { status: 400 });
  const found = await prisma.projectFeedback.findFirst({
    where: { id: String(feedbackId || ""), ...LIVE_FEEDBACK, AND: [await feedbackScope(userId)] },
    select: { id: true },
  });
  if (!found) throw Object.assign(new Error("That feedback was not found."), { status: 404 });
  // A feedback whose reviews were given to people as tasks is answered there, not moved by hand.
  if (await prisma.projectFeedbackIssue.count({ where: { feedbackId: found.id } })) {
    throw Object.assign(new Error("This feedback is answered through its assigned tasks - each person answers theirs as Issues sorted or Rejected."), { status: 409 });
  }
  const { count } = await prisma.projectFeedback.updateMany({
    where: { id: found.id, status: "Issues" },
    data: { status, issueRemarks: String(remarks || "").trim() || null, issueResolvedByUserId: userId, issueResolvedAt: new Date() },
  });
  if (!count) throw Object.assign(new Error("This feedback is no longer under Issues. Reload to see where it is now."), { status: 409 });
  const row = await prisma.projectFeedback.findUnique({ where: { id: found.id }, select: feedbackSelect });
  return toFeedback(row, await projectClientNames([row.project]));
}

/**
 * The client's answer to a feedback, on WhatsApp: Feedback Thank You for one filed Completed,
 * Feedback Issues otherwise (the screen's `feedbackTemplateKey`), sent from the sender's own WhatsApp
 * to the project's client main number - and only a feedback this reader may see, while that message
 * is switched on under Settings → Templates. The text is what the screen shows.
 */
async function sendFeedbackWhatsApp({ feedbackId, message, userId }) {
  const found = await prisma.projectFeedback.findFirst({
    where: { id: String(feedbackId || ""), ...LIVE_FEEDBACK, AND: [await feedbackScope(userId)] },
    select: { id: true, status: true, feedbackCode: true, project: { select: { id: true, clientMainNumber: true } } },
  });
  if (!found) throw Object.assign(new Error("That feedback was not found."), { status: 404 });
  const key = found.status === "Completed" ? "FEEDBACK_THANK_YOU" : "FEEDBACK_ISSUES";
  await messageSwitches.assertEnabled(key);
  await whatsappActivity.track({
    mode: "MANUAL", provider: "baileys", trigger: key, eventRef: `feedback:${found.id}`,
    initiatedByUserId: userId, senderUserId: userId,
    recipient: { kind: "PERSON", address: found.project?.clientMainNumber || "", name: null },
    templateKey: key, body: message, resendable: true, links: { salesProjectId: found.project?.id || null },
  }, () => sendWhatsAppToPerson({
    userId,
    phone: found.project?.clientMainNumber,
    body: message,
    noNumberMessage: "This project has no client main number. Add one in Bookings & Converted before sending on WhatsApp.",
  }));
  return { sent: true, feedbackCode: found.feedbackCode };
}

/**
 * Who a feedback's Average or Poor review can be given to: the active logins that can answer it
 * (`canAnswerTasks` in the tasks service). A task given to anybody else could never be answered,
 * and the feedback would wait in Issues for good.
 */
const feedbackAssignees = () => tasks.taskAnswerers();

module.exports = { sendFeedbackWhatsApp, shootPeople, FEEDBACK_CODE_PREFIX, OPEN_STAGES, productionComplete, overallFeedbackOpen, REVIEWS, STATUSES, STATUS_FOR_REVIEW, feedbackAssignees, pendingFeedback, feedbackOptions, createFeedback, createFeedbackMany, ISSUE_OUTCOMES, VIEW_ALL_FEEDBACK, resolveIssue, feedbackScope, listFeedback };
