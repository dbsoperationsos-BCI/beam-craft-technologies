import { pendingDetailsText } from "./pendingDetails.mjs";

/**
 * The Production board's project rows: its shoots folded into one row per project, each carrying its
 * shoots for the tiles its panel shows.
 */
export const PROJECT_TABS = ["All", "Yet to Start", "Work in Progress", "Planned", "Execution", "Follow-up", "Hold", "Rejected", "Completed"];
/**
 * What somebody who is only crew on a project sees of it: from Planned on. A project's Production
 * Manager, Project Manager and Coordinator - and whoever runs every project - see it at every status
 * (`viewerManages`, decided by the server per row); everybody else sees it only once it is one of these.
 * Every status tab is offered only to somebody who **leads** a project - its Production Manager or
 * Project Manager, or whoever runs every project (`viewerLeads`); a Coordinator and the crew are
 * offered only these tabs, a Coordinator's own project still listed at every status under All.
 */
export const CREW_STATUSES = ["Planned", "Execution", "Hold", "Rejected", "Completed"];
export const CREW_TABS = ["All", ...CREW_STATUSES];

/*
 * A shoot is settled for its crew once its own plan is - not while it is untouched, being planned or
 * waiting for the client's reply. A project's shoots are planned one by one, often weeks apart, so the
 * crew of a shoot planned today is shown it without waiting for the project's last shoot to be.
 */
const UNSETTLED_SHOOT = new Set(["Yet to Start", "Work in Progress", "WCR"]);
export const crewSeesShoot = (shoot) => Boolean(shoot?.viewerOnShoot) && !UNSETTLED_SHOOT.has(shootProductionStatus(shoot));

/**
 * The projects a viewer is shown, and the tabs they are offered.
 *
 * A project they run, or one Planned on as a whole, as it is. Before that, somebody only on its crew
 * is shown it with the shoots of theirs that are planned (`crewSeesShoot`) and nothing else, and its
 * status is read from those shoots - so two planned shoots stand under Planned, not only under All.
 */
export function boardForViewer(projects = []) {
  const leadsAny = projects.some((project) => project.viewerLeads);
  return {
    projects: projects.flatMap((project) => {
      if (project.viewerManages || CREW_STATUSES.includes(project.status)) return [project];
      const shoots = (project.shoots || []).filter(crewSeesShoot);
      if (!shoots.length) return [];
      // A Rejected shoot stands under Rejected on its own, as the tabs and the Board list it, and moves
      // nothing else: a Planned shoot beside it is still Planned, not Work in Progress. Only when every
      // shoot they are shown is Rejected is the project.
      const live = shoots.filter((shoot) => shootTabStatus(shoot) !== "Rejected");
      const handSet = PRODUCTION_STATUS_LABELS[shoots[0].productionStatus];
      return [{ ...project, shoots, status: live.length || handSet ? projectProductionStatus(live.length ? live : shoots) : "Rejected" }];
    }),
    tabs: leadsAny ? PROJECT_TABS : CREW_TABS,
  };
}

/**
 * The Board's statuses: the viewer's status tabs less All and Follow-up (a due date, not a status),
 * and every status one of their cards (`projectBoardCards`) stands under - so every project their
 * table lists has a column. A Coordinator is offered only the crew's tabs, yet sees their own project
 * at every status: before Planned it gets its Yet to Start or Work in Progress column all the same.
 */
export function boardStatuses(tabs = [], cards = []) {
  return [...new Set([...tabs.filter((tab) => tab !== "All" && tab !== "Follow-up"), ...cards.map((card) => card.boardStatus)])];
}

/**
 * A follow-up date that has come: today or already gone by. One still ahead is not yet anybody's call
 * to make. The date is read as the stored day (`YYYY-MM-DD`, or the day an ISO date starts with).
 */
export function followupDue(date, todayKey = localDayKey()) {
  const day = String(date ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && day <= todayKey;
}

/**
 * Which projects a tab lists. Each status tab is the projects with that status; **Follow-up** is
 * every project with a shoot whose plan is on WCR (waiting for the client's reply) and whose follow-up
 * date is today or past - listed there as well as under its own status, not instead of it.
 */
export function inProjectTab(project, tab, todayKey = localDayKey()) {
  if (tab === "All") return true;
  if (tab === "Follow-up") return (project.shoots || []).some((shoot) => shoot.planStatus === "WCR" && followupDue(shoot.planFollowupDate, todayKey));
  return projectTabStatuses(project).includes(tab);
}

/**
 * The tab a shoot stands under: Hold or Rejected - the plan's - Completed, Execution once its day has
 * begun (travelling, setting up, shooting, paused, waiting for the footage), else what its plan says
 * (Yet to Start, Work in Progress, Planned). WCR is a follow-up, not a status of its own: the shoot is
 * Work in Progress, and Follow-up lists it by its date.
 */
export function shootTabStatus(shoot) {
  const status = shootProductionStatus(shoot);
  if (status === "Hold") return "Hold";
  if (status === "Rejected") return "Rejected";
  if (status === "Shoot completed") return "Completed";
  if (executionStarted(shoot)) return "Execution";
  if (status === "WCR") return "Work in Progress";
  return status;
}

/**
 * Every status a project stands under on the tabs and the Board: one per status its shoots are at, so
 * a project with one shoot Planned and another under way is under Planned and Execution both. A status
 * set by hand on the project as a whole (`productionStatus`) is the one answer.
 */
export function projectTabStatuses(project) {
  const shoots = project.shoots || [];
  if (!shoots.length || PRODUCTION_STATUS_LABELS[shoots[0].productionStatus]) return [project.status];
  return [...new Set(shoots.map(shootTabStatus))];
}

/** The project's shoots that stand under `tab` - all of them for All, Follow-up, or a status set on the project by hand. */
export function shootsInTab(project, tab) {
  const shoots = project.shoots || [];
  if (!shoots.length || PRODUCTION_STATUS_LABELS[shoots[0].productionStatus] || !projectTabStatuses(project).includes(tab)) return shoots;
  return shoots.filter((shoot) => shootTabStatus(shoot) === tab);
}

/** One Board card per status a project stands under, each with only that status's shoots. */
export function projectBoardCards(projects = []) {
  return projects.flatMap((project) => projectTabStatuses(project).map((status) => ({ ...project, id: `${project.id}:${status}`, boardStatus: status, shoots: shootsInTab(project, status) })));
}

/** The project's overall Production status set by hand (`sales_project.production_status`). */
export const PRODUCTION_STATUS_LABELS = { YET_TO_START: "Yet to Start", WORK_IN_PROGRESS: "Work in Progress", PLANNED: "Planned", COMPLETED: "Completed", HOLD: "Hold", REJECTED: "Rejected" };

/*
 * A shoot's Production status, first that applies:
 *   WCR / Hold / Rejected         the plan, set by hand (Plan → Status), each with its remarks - WCR
 *                                 (waiting for the client's reply) with its next follow-up date too
 *   Shoot completed               File in done - every step finished
 *   File in pending               Happy clients done, which completes the shoot; the footage is next
 *   Paused                        the shoot has stopped where it stands, with the reason it stopped
 *   Shoot in progress             from Happening now until Happy clients completes the shoot
 *   Setting up                    the crew has reached the venue: the huddle and getting ready
 *   Travelling                    the crew has left the studio (an outdoor shoot's; indoors neither)
 *   Work in Progress              something is on the plan, but it is not submitted, or still lacks a
 *                                 part (`planMissing`)
 *   Planned                       the plan is submitted and complete, and nothing done on the day yet
 *   Yet to Start                  nothing on the plan
 */
const PLAN_STATUS = { WCR: "WCR", HOLD: "Hold", REJECTED: "Rejected" };
// Steps the day no longer has: a shoot still sitting on one of them is as far as File in (the
// server's `effectiveStep`), so it reads the same as a shoot waiting for its footage.
const RETIRED_STEPS = new Set(["SHOOT_STATUS", "STARTED_FROM_VENUE", "REACHED_STUDIO"]);
/**
 * What the shoot is doing while it stands on a step - named by what is **done**, not by what is next
 * (the server's `STEP_BOARD_STATUS`): standing on Reached venue, the crew has left and is
 * travelling; standing on the pineapple meeting or Shoot started, it has arrived and is setting up.
 */
const STEP_STATUS = {
  REACHED_SHOOT_PLACE: "Travelling",
  PINEAPPLE_MEETING: "Setting up",
  SHOOT_STARTED: "Setting up",
  HAPPENING_NOW: "Shoot in progress",
  HAPPY_CLIENTS: "Shoot in progress",
};
// Where a shoot may be paused, so a status left on an older record never reads as a stop anywhere else.
const PAUSABLE_STEPS = new Set(["HAPPENING_NOW", "HAPPY_CLIENTS"]);
// Complete: nothing the server lists as still missing - coordinator, team, travel, each service's
// person and camera (`planCompleteness.js`).
const planComplete = (shoot) => !(shoot.planMissing || []).length;
// The day's first step: an indoor shoot has no travel and no pineapple meeting, so it starts at Shoot started.
const firstStep = (shoot) => (shoot.indoor ? "SHOOT_STARTED" : "STARTED_FROM_STUDIO");

export function shootProductionStatus(shoot) {
  if (PLAN_STATUS[shoot.planStatus]) return PLAN_STATUS[shoot.planStatus];
  if (shoot.currentStep === "DONE") return "Shoot completed";
  if (shoot.currentStep === "PHOTO_COPY" || RETIRED_STEPS.has(shoot.currentStep)) return "File in pending";
  // The day's own status, once it has begun - a paused shoot before whatever it stopped in the middle of.
  if (shoot.currentStep !== firstStep(shoot)) {
    if (shoot.shootStatus === "PAUSED" && PAUSABLE_STEPS.has(shoot.currentStep)) return "Paused";
    if (STEP_STATUS[shoot.currentStep]) return STEP_STATUS[shoot.currentStep];
  }
  if (shoot.planSubmittedAt) return planComplete(shoot) && (!shoot.currentStep || shoot.currentStep === firstStep(shoot)) ? "Planned" : "Work in Progress";
  return shoot.planStarted ? "Work in Progress" : "Yet to Start";
}

/**
 * Whether a shoot's day has begun: a step past its first is done - Started from Studio for an outdoor
 * shoot, Shoot started for an indoor one - up to and including File in.
 */
export const executionStarted = (shoot) => Boolean(shoot?.currentStep) && shoot.currentStep !== firstStep(shoot);

/**
 * A project's production status, from its shoots' alone - the project's own status never changes it:
 * Completed when every shoot is, Hold when any shoot's plan or shoot day is held, Execution once any
 * shoot's day has begun (until every shoot is Completed), Planned when every shoot is planned and none
 * has started, Yet to Start while none has been touched, Work in Progress otherwise - shown with its
 * percentage (`projectProductionLabel`).
 */
export function projectProductionStatus(shoots) {
  // Set by hand for the project as a whole, it is the answer - its shoots keep their own.
  if (PRODUCTION_STATUS_LABELS[shoots[0]?.productionStatus]) return PRODUCTION_STATUS_LABELS[shoots[0].productionStatus];
  const statuses = shoots.map(shootProductionStatus);
  // One shoot's plan held holds the project's production.
  if (statuses.some((status) => status === "Hold")) return "Hold";
  if (statuses.length && statuses.every((status) => status === "Shoot completed")) return "Completed";
  // A shoot on its day - travelling, shooting, or back with the footage - or one done while
  // others are still to come: the project is being executed, not planned.
  if (shoots.some(executionStarted)) return "Execution";
  if (!statuses.length || statuses.every((status) => status === "Yet to Start")) return "Yet to Start";
  if (statuses.every((status) => status === "Planned")) return "Planned";
  return "Work in Progress";
}

const dayValue = (value) => (value ? new Date(value).getTime() : Number.POSITIVE_INFINITY);

/** Shoots in the order they happen; the main event first among a day's. */
export function shootsInOrder(shoots) {
  return [...shoots].sort((a, b) => dayValue(a.shootDate) - dayValue(b.shootDate) || Number(Boolean(b.isMainEvent)) - Number(Boolean(a.isMainEvent)) || String(a.startTime || "").localeCompare(String(b.startTime || "")));
}

export function productionProjects(rows) {
  const byProject = new Map();
  for (const row of rows) {
    if (!byProject.has(row.projectId)) byProject.set(row.projectId, []);
    byProject.get(row.projectId).push(row);
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return [...byProject.values()].map((list) => {
    const shoots = shootsInOrder(list);
    const first = shoots[0];
    const done = shoots.filter((shoot) => shootProductionStatus(shoot) === "Shoot completed").length;
    // The next shoot still to happen: the earliest not done, today or later.
    const next = shoots.find((shoot) => shootProductionStatus(shoot) !== "Shoot completed" && shoot.shootDate && new Date(shoot.shootDate) >= today);
    return {
      id: first.projectId,
      projectId: first.projectId,
      // Which of the five screens this project is on, for the row menu's "Navigate to" entries: this
      // row is built from the project's shoots, so the server's answer has to be carried over.
      boards: first.boards || [],
      eventId: first.eventId,
      clientName: first.clientName,
      vertical: first.vertical,
      productionManager: first.productionManager,
      shootCount: shoots.length,
      shootsDone: `${done}/${shoots.length} Done`,
      nextShootDate: next?.shootDate || null,
      status: projectProductionStatus(shoots),
      // Whether the viewer runs this project (any of its shoots says so) - see `boardForViewer`.
      viewerManages: list.some((row) => row.viewerManages),
      viewerLeads: list.some((row) => row.viewerLeads),
      shoots,
    };
  });
}

// The steps an indoor shoot does not have: travel, and the pineapple meeting (the server's `steps.js`).
const NOT_INDOOR_STEPS = new Set(["STARTED_FROM_STUDIO", "REACHED_SHOOT_PLACE", "PINEAPPLE_MEETING"]);

/**
 * How far a shoot has got, for its tile: its plan's parts filled until it is Planned, then its own
 * steps - those done of its total (four for an indoor shoot, seven otherwise), the next one, and a
 * percentage.
 * `steps` is the full step list, `[[id, label]]` (`PRODUCTION_STEPS`).
 */
export function shootStepProgress(shoot, steps) {
  const own = shoot.indoor ? steps.filter(([id]) => !NOT_INDOOR_STEPS.has(id)) : steps;
  const total = own.length;
  // Until the shoot is Planned - its plan submitted and complete - the progress is the plan's own:
  // how many of its parts are filled (`planProgress`). The day's steps count only after that, or once
  // a step has been done on a plan submitted short.
  const dayBegun = shoot.planSubmittedAt && shoot.currentStep && shoot.currentStep !== firstStep(shoot);
  if (!dayBegun && !(shoot.planSubmittedAt && planComplete(shoot))) {
    const plan = shoot.planProgress || { filled: 0, total: 0, percent: 0 };
    const text = !plan.total ? "Plan pending"
      : plan.filled === plan.total ? "Plan filled - submit it"
        // Said as Pre Production's tiles say it: what is still owed, not a fraction.
        : pendingDetailsText(plan.total - plan.filled);
    return { done: plan.filled, total: plan.total, percent: plan.percent, text, phase: "plan" };
  }
  if (shoot.currentStep === "DONE") return { done: total, total, percent: 100, text: "All steps done" };
  const index = Math.max(0, own.findIndex(([id]) => id === shoot.currentStep));
  return { done: index, total, percent: Math.round((index / total) * 100), text: `Next: ${own[index]?.[1] || "—"}` };
}

/**
 * The project's production status as it is shown, like Pre Production's: "Work in Progress (45%)" while under way,
 * the percentage the average of its shoots' own step progress; Yet to Start and Completed as they are.
 */
export function projectProductionLabel(shoots, steps) {
  const status = projectProductionStatus(shoots);
  if (status !== "Work in Progress" && status !== "Execution") return status;
  const percent = Math.round(shoots.reduce((sum, shoot) => sum + shootStepProgress(shoot, steps).percent, 0) / shoots.length);
  return `${status} (${percent}%)`;
}

/**
 * A shoot's status as its tile and row say it: WCR names when the client is to be followed up -
 * "WCR · follow up 20 Oct 2026" - every other status reads as it is.
 */
export function shootStatusLabel(shoot) {
  const status = shootProductionStatus(shoot);
  if (status !== "WCR" || !shoot.planFollowupDate) return status;
  const day = new Date(`${shoot.planFollowupDate}T00:00:00`);
  return Number.isNaN(day.getTime()) ? status : `WCR · follow up ${new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(day)}`;
}

/** The plan's status from the plan alone - Yet to Start, Work in Progress, or Planned once submitted and complete - what "automatic" means on its form. */
export function planPhaseStatus(shoot) {
  if (shoot?.planSubmittedAt && planComplete(shoot)) return "Planned";
  if (shoot?.planSubmittedAt) return "Work in Progress";
  return shoot?.planStarted ? "Work in Progress" : "Yet to Start";
}

/**
 * What the plan form's Save also has to write for the plan's status, or null when nothing changed -
 * and why it cannot be saved yet. Hold and Rejected need remarks. `problems` says the same per box
 * (`remarks`, `followupDate`), so each is marked under its own field; `problem` is the first.
 */
export function planStatusChange(detail, value, todayKey = localDayKey()) {
  const startChoice = detail?.planStatus || "AUTO";
  const startRemarks = String(detail?.planStatusRemarks || "").trim();
  const startFollowup = detail?.planFollowupDate || "";
  const choice = value?.choice || "AUTO";
  const remarks = String(value?.remarks || "").trim();
  const followupDate = choice === "WCR" ? String(value?.followupDate || "") : "";
  if (choice === startChoice && (choice === "AUTO" || (remarks === startRemarks && followupDate === startFollowup))) return { change: null, problem: "" };
  // Every status set by hand needs its remarks; WCR also the next follow-up with the client.
  const problems = {
    remarks: choice !== "AUTO" && !remarks ? `Write the remarks for ${PLAN_STATUS[choice] || choice}.` : "",
    followupDate: choice !== "WCR" ? ""
      : !followupDate ? "Choose the Next Followup Date."
        : followupDate !== startFollowup && followupDate < todayKey ? "The Next Followup Date cannot be in the past." : "",
  };
  const problem = problems.remarks || problems.followupDate;
  if (problem) return { change: null, problem, problems };
  if (choice === "AUTO") return { change: { status: null, remarks: null }, problem: "" };
  return { change: { status: choice, remarks, ...(choice === "WCR" ? { followupDate } : {}) }, problem: "" };
}

/** Today as YYYY-MM-DD in the browser's own day - what a date picker offers as its earliest day. */
function localDayKey() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
