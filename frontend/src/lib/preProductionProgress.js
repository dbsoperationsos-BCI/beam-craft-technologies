import { preProductionVerticalFieldRuns, preProductionVerticalOf } from "../constants/preProductionVerticalFields.js";

// Switches that only decide whether the fields after them are asked - answered either way, so not
// counted themselves - and the fields each one opens.
const checklistGates = { eventScheduleMeeting: ["meetingDate", "meetingTime", "meetingLink"], invitationSoftCopy: ["invitationLink"] };
const gatedFields = new Set(Object.values(checklistGates).flat());

/**
 * The vertical checklist's answers, as the tile counts them. A chased question is done once it is
 * Completed - Pending is work still left - and an action toggle once it is on. Remarks are never
 * required, so they are not counted.
 */
function checklistAnswers(row) {
  const opened = new Set(Object.entries(checklistGates).filter(([gate]) => row[gate]).flatMap(([, fields]) => fields));
  return preProductionVerticalFieldRuns[preProductionVerticalOf(row.product)]
    .filter((field) => !checklistGates[field.id] && !field.id.endsWith("Remarks"))
    .filter((field) => !gatedFields.has(field.id) || opened.has(field.id))
    .map((field) => {
      if (field.type === "yesno") return row[field.id] === "Completed" ? "yes" : "";
      if (field.type === "toggle") return row[field.id] ? "yes" : "";
      return row[field.id];
    });
}

/**
 * How much of this shoot has been filled in.
 *
 * It answers "is there work left here?" — the question the card exists for — without spelling out
 * which fields are blank. Seven answers are asked of an outdoor shoot (five of an indoor one), and they
 * are the ones the form marks with an asterisk;
 * the conditional ones are counted only when they apply, so a studio shoot that needs no hotel is
 * never stuck short of complete, and a shoot with no concept is not marked down for having no
 * reference.
 *
 * Reported as a percentage rather than a fraction on purpose. The denominator legitimately differs
 * between two shoots of the same project — one needs accommodation, the next does not — and cards
 * sitting side by side reading "0 of 8" and "0 of 9" look like a fault rather than a difference.
 * A percentage compares cleanly whatever each shoot happens to be asked; `pending` says how much is
 * actually left, which is the number a coordinator acts on.
 */
/**
 * The answers a shoot is **required** to give, and the only ones the percentage is of: when the event
 * runs, when the crew reports, and where the shoot is - the venue and the journey to it for an
 * outdoor shoot, the studio's branch for an indoor one.
 *
 * Everything else on the form - the Location Link, the accommodation, the concepts, the vertical
 * checklist - is work to do rather than an answer the shoot is held short for. They were counted, so
 * a shoot with every mandatory answer still read 60-something per cent and never reached Planned
 * until somebody had ticked a dozen chased questions.
 */
function mandatoryAnswers(row) {
  // Every shoot is counted on its day - `subEventDate` on the row the board reads, Shoot Date on the
  // form - and then on where it is: the branch for an indoor shoot, the venue for an outdoor one.
  return row.indoor
    ? [row.subEventDate, row.eventStartTime, row.eventEndTime, row.reportingTime, row.shootBranchId]
    // A shoot held at several places owes a venue under each name, not one between them.
    : [row.subEventDate, row.eventStartTime, row.eventEndTime, row.reportingTime, ...(row.locations?.length ? row.locations.map((venue) => venue.locationAddress) : [row.locationAddress])];
}

const given = (value) => value !== null && value !== undefined && value !== "";

export function shootProgress(row) {
  const answers = mandatoryAnswers(row);
  const filled = answers.filter(given).length;
  return { filled, total: answers.length, pending: answers.length - filled, percent: answers.length ? Math.round((filled / answers.length) * 100) : 0 };
}

/**
 * Whether anybody has worked on this shoot in Pre Production: any of its details filled other than
 * the event's start and end times, which arrive with the sale and so say nothing about work begun.
 *
 * Asked of **everything** on the form, not only the mandatory answers the percentage counts: a
 * coordinator who has made the intro call and nothing else has started this shoot, and the board
 * saying Yet to Start would be telling them their afternoon did not happen.
 */
export function shootStarted(row) {
  const worked = [
    row.reportingTime, row.locationAddress, row.locationLink, row.shootBranchId,
    row.scheduleRemarks,
    ...(row.travelAccommodationNeeded ? [row.accommodationAddress, row.accommodationLink, row.accommodationRemarks] : []),
    ...((row.concepts || []).length ? ["yes"] : []),
    ...checklistAnswers(row),
  ];
  return worked.some(given);
}

/**
 * A shoot's pre production status from its details alone: **Yet to Start** until a detail is filled
 * in Pre Production (`shootStarted`), **Work in Progress** from then, and **Planned** once everything
 * is filled. It moves the moment a detail is saved.
 */
export function shootPlanStatus(row) {
  if (shootProgress(row).pending === 0) return "Planned";
  return shootStarted(row) ? "Work in Progress" : "Yet to Start";
}

/** The statuses a shoot is given by hand, with their remarks (`shoot_status` on the server). */
export const SHOOT_STATUS_LABELS = { WCR: "WCR", HOLD: "Hold", REJECTED: "Rejected" };

/**
 * The status a shoot shows: the one set by hand - WCR (waiting for the client's reply), Hold or
 * Rejected - and otherwise what its details say: **Planned** once everything is filled
 * (`shootPlanStatus`), **Work in Progress** until then. How far the shoot has got in Production is
 * Production's to show.
 */
export function shootCompletionStatus(row) {
  return SHOOT_STATUS_LABELS[row?.shootStatus] || shootPlanStatus(row || {});
}

/** How far a project's pre production has got: the average of its shoots' own progress, 0-100. */
export function projectProgressPercent(shoots) {
  if (!shoots.length) return 0;
  return Math.round(shoots.reduce((sum, shoot) => sum + shootProgress(shoot).percent, 0) / shoots.length);
}

/**
 * One project's pre production status, from its shoots' details - never from the statuses set by
 * hand, which are the shoots' alone:
 *
 *   (by hand)    — Hold or Rejected set on the project (⋮ Update status, or Update over the
 *                  ticked projects) is the answer while it is set; "Automatic" clears it.
 *   Hold         — any shoot is on Hold. A Rejected shoot is not carried up. The project's own status
 *                  never changes this - it is the project's alone.
 *   Planned      — every shoot is planned, and only then.
 *   Yet to Start — every shoot is Yet to Start (`shootPlanStatus`): nothing worked on in Pre
 *                  Production yet.
 *   Work in Progress — anything else: any shoot in Work in Progress, or some planned and some not
 *                  (shown with its percentage, `projectProgressPercent`). Adding a shoot to a planned
 *                  project drops it back here on its own: the new shoot is Yet to Start.
 *
 * Derived on every read rather than stored, so it is never stale.
 */
/** The project's overall Pre Production status set by hand (`sales_project.pre_production_status`). */
export const PRE_PRODUCTION_STATUS_LABELS = { YET_TO_START: "Yet to Start", WORK_IN_PROGRESS: "Work in Progress", PLANNED: "Planned", HOLD: "Hold", REJECTED: "Rejected" };

export function projectCompletionStatus(shoots) {
  if (!shoots.length) return "Yet to Start";
  // Set by hand for the project as a whole, it is the answer - its shoots keep their own.
  if (PRE_PRODUCTION_STATUS_LABELS[shoots[0].preProductionStatus]) return PRE_PRODUCTION_STATUS_LABELS[shoots[0].preProductionStatus];
  // One shoot on Hold holds the project's pre production. A Rejected shoot stays the shoot's own.
  if (shoots.some((shoot) => shoot.shootStatus === "HOLD")) return "Hold";
  const statuses = shoots.map(shootPlanStatus);
  if (statuses.every((status) => status === "Planned")) return "Planned";
  if (statuses.every((status) => status === "Yet to Start")) return "Yet to Start";
  return "Work in Progress";
}

/**
 * The tab a shoot stands under: Hold or Rejected set on it by hand, else what its details say (Yet to
 * Start, Work in Progress, Planned). WCR is a follow-up, not a status of its own - the shoot stands
 * where its details put it, and Follow-up lists it by its date.
 */
export function shootTabStatus(row) {
  if (row?.shootStatus === "HOLD") return "Hold";
  if (row?.shootStatus === "REJECTED") return "Rejected";
  return shootPlanStatus(row || {});
}

/**
 * Every status a project stands under on the board's tabs and columns: one per status its shoots are
 * at, so a project with a shoot Planned and another in Work in Progress is under both. A status set by
 * hand on the project as a whole is the one answer, as it is for `projectCompletionStatus`.
 */
export function projectTabStatuses(shoots = []) {
  if (!shoots.length) return ["Yet to Start"];
  if (PRE_PRODUCTION_STATUS_LABELS[shoots[0].preProductionStatus]) return [PRE_PRODUCTION_STATUS_LABELS[shoots[0].preProductionStatus]];
  return [...new Set(shoots.map(shootTabStatus))];
}

/** The project's shoots that stand under `tab` - all of them for All, Follow-up, or a status set on the project by hand. */
export function shootsInTab(shoots = [], tab) {
  if (!shoots.length || PRE_PRODUCTION_STATUS_LABELS[shoots[0].preProductionStatus] || !projectTabStatuses(shoots).includes(tab)) return shoots;
  return shoots.filter((shoot) => shootTabStatus(shoot) === tab);
}

/** The project's status as it is shown: "Work in Progress (45%)" while in progress. */
export function projectCompletionLabel(shoots) {
  const status = projectCompletionStatus(shoots);
  return status === "Work in Progress" ? `Work in Progress (${projectProgressPercent(shoots)}%)` : status;
}

/** The status field's "from the details" choice (no status set by hand). */
export const AUTO = "AUTO";

/** The field's starting value: the status set by hand, or automatic, and its remarks. */
export const shootStatusValue = (row) => ({ choice: row?.shootStatus || AUTO, remarks: row?.shootStatusRemarks || "", followupDate: "" });

/**
 * What the form's Save also has to write for the status, or null when nothing changed - and why it
 * cannot be saved yet, if it cannot. Hold and Rejected need remarks; a shoot newly put on WCR needs its
 * Next Followup Date.
 */
export function shootStatusChange(row, value) {
  const start = shootStatusValue(row);
  const choice = value?.choice || AUTO;
  const remarks = String(value?.remarks || "").trim();
  if (choice === start.choice && (choice === AUTO || remarks === start.remarks.trim())) return { change: null, problem: "" };
  if ((choice === "HOLD" || choice === "REJECTED") && !remarks) return { change: null, problem: `Write the remarks for ${choice === "HOLD" ? "Hold" : "Rejected"}.` };
  if (choice === "WCR" && start.choice !== "WCR" && !value?.followupDate) return { change: null, problem: "Choose the Next Followup Date for WCR." };
  return {
    change: { status: choice === AUTO ? null : choice, remarks: choice === AUTO ? null : remarks || null, followupDate: choice === "WCR" ? value?.followupDate || null : null },
    problem: "",
  };
}

