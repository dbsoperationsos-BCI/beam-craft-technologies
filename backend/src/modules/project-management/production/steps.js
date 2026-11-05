/**
 * The steps a Production Coordinator works through on one shoot, and the rules about them.
 *
 * Pure: no database, no clock. The service reads a record and asks these questions of it, so the
 * order of the day is written once and the tests can hold it without MySQL.
 *
 * Strictly one after another: only the current step can be completed, and a finished step is never
 * reopened.
 *
 * **Happy clients is the end of the shoot.** Completing it stamps the shoot Completed and sends the
 * Shoot completed message - nobody is asked to say so a second time - and File in, the footage, is
 * the one thing left after it.
 *
 * **A shoot in progress can be paused**, which is not a step but a switch across the one the shoot is
 * on: `pauseRefusal` says when, `PAUSABLE_STEPS` where - from Shoot started being done until Happy
 * clients - and a pause carries the reason it stopped. A paused shoot completes nothing until it is
 * resumed.
 *
 * ── What went, in November 2026 ──
 *
 * The **shoot status** step - a step of its own, worked in order, where the coordinator picked
 * Paused, On hold, Rejected or Completed - and the **trip back** - Started from venue and Reached
 * studio - are no longer worked. The studio's day ends when the client is happy and the footage is
 * in; the rest was paperwork about a drive. On hold and Rejected went with the step. Pausing stayed,
 * as the switch above rather than a place in the order, because a shoot really does stop for an hour
 * and everybody reading the board needs to see it.
 *
 * The columns of the steps that went are left alone so a finished shoot keeps its own history, and a
 * shoot standing on one of those steps when this arrived reads as being on the next step it still
 * has (`effectiveStep`), which is File in: the shooting is over, and the footage is what is left.
 */

const STEPS = [
  "STARTED_FROM_STUDIO", "REACHED_SHOOT_PLACE", "PINEAPPLE_MEETING", "SHOOT_STARTED", "HAPPENING_NOW", "HAPPY_CLIENTS",
  "PHOTO_COPY",
];
/** The steps that were worked until November 2026, for reading an older record's stored step. */
const RETIRED_STEPS = new Set(["SHOOT_STATUS", "STARTED_FROM_VENUE", "REACHED_STUDIO"]);
const DONE = "DONE";

const STEP_LABELS = {
  STARTED_FROM_STUDIO: "Started to shoot",
  REACHED_SHOOT_PLACE: "Reached venue",
  PINEAPPLE_MEETING: "Pineapple meeting",
  SHOOT_STARTED: "Shoot started",
  HAPPENING_NOW: "Happening now",
  HAPPY_CLIENTS: "Happy clients",
  PHOTO_COPY: "File in",
  // Read only where an older record is still standing on one of them.
  SHOOT_STATUS: "Shoot status",
  STARTED_FROM_VENUE: "Started from venue",
  REACHED_STUDIO: "Reached studio",
};

/**
 * What an **indoor** shoot calls a step where it differs: its first is **Ready**, not Shoot started.
 * Nothing goes out to a venue, so "started" would be the only thing said about a day that has not
 * begun; Ready is the crew saying the studio is set.
 */
const INDOOR_STEP_LABELS = { SHOOT_STARTED: "Ready" };
const labelFor = (step, indoor = false) => (indoor && INDOOR_STEP_LABELS[step]) || STEP_LABELS[step] || step;

/**
 * What File in asks for each service, remarks aside.
 *
 * Completing the step wants every one of them, for every service the shoot booked: a footage row is
 * the record that a copy was made, and one without its count or its file names says that about
 * nothing. A Mark as pending save holds a service's answers as they stand, so the count it reports
 * as done - and the count the step is waiting on - is the services that pass this.
 */
const FOOTAGE_ANSWERS = ["footageUrl", "backedUpByEmployeeId", "fileCount", "size", "firstFileName", "lastFileName"];

/** The column each step's completion time is kept in. */
const STEP_TIME_FIELDS = {
  STARTED_FROM_STUDIO: "startedFromStudioAt",
  REACHED_SHOOT_PLACE: "reachedShootPlaceAt",
  PINEAPPLE_MEETING: "pineappleMeetingAt",
  SHOOT_STARTED: "shootStartedAt",
  HAPPENING_NOW: "happeningNowAt",
  HAPPY_CLIENTS: "happyClientsAt",
  SHOOT_STATUS: "shootStatusAt",
  STARTED_FROM_VENUE: "startedFromVenueAt",
  REACHED_STUDIO: "reachedStudioAt",
  PHOTO_COPY: "photoCopyAt",
};

/** The steps that take an optional remark, and where it is kept. (Pineapple meeting's is required.) */
const OPTIONAL_REMARK_FIELDS = {
  STARTED_FROM_STUDIO: "startedFromStudioRemarks",
  REACHED_SHOOT_PLACE: "reachedShootPlaceRemarks",
  SHOOT_STARTED: "shootStartedRemarks",
  HAPPENING_NOW: "happeningNowRemarks",
  HAPPY_CLIENTS: "happyClientsRemarks",
  STARTED_FROM_VENUE: "startedFromVenueRemarks",
  REACHED_STUDIO: "reachedStudioRemarks",
};

/*
 * What the shoot's own status says, and who writes it.
 *
 * Three values are written now: **Paused** and **Started** by the coordinator pausing and resuming
 * the shoot, and **Completed** by Happy clients, which nobody is asked to confirm. On hold and
 * Rejected were the retired step's and are named here only so a record written before it reads back
 * in words - and so the spreadsheet import can read an old sheet that names one.
 */
const COMPLETED_STATUS = "COMPLETED";
const PAUSED_STATUS = "PAUSED";
/** What a resumed shoot is: running again, which is what it was before it stopped. */
const RESUMED_STATUS = "STARTED";
const SHOOT_STATUSES = ["STARTED", "PAUSED", "HOLD", "REJECT", "COMPLETED"];
const SHOOT_STATUS_LABELS = { STARTED: "Started", PAUSED: "Paused", HOLD: "Hold", REJECT: "Rejected", COMPLETED: "Completed" };
/** The step that completes the shoot, and so the one that stamps the status and sends the message. */
const COMPLETES_SHOOT = "HAPPY_CLIENTS";

/**
 * Where the shoot can be paused: once Shoot started (Ready, indoors) is done and until Happy
 * clients finishes it. Before that nothing has begun, and after it the shoot is over - what is left
 * is the footage, and a copy being made is not a shoot stopping.
 */
const PAUSABLE_STEPS = new Set(["HAPPENING_NOW", "HAPPY_CLIENTS"]);
const isPaused = (record) => record?.shootStatus === PAUSED_STATUS;

/**
 * Why the shoot cannot be paused or resumed now, or null when it can. `paused` is what is being
 * asked for, so pausing a paused shoot - two taps, or two phones - is refused rather than logged
 * twice.
 */
function pauseRefusal(record, paused) {
  if (!record.planSubmittedAt) return "The plan has not been submitted yet.";
  const current = effectiveStep(record.currentStep, indoorOf(record));
  if (!PAUSABLE_STEPS.has(current)) {
    return current === DONE || current === "PHOTO_COPY"
      ? "This shoot is over - only its File in is left, and that is not a shoot to pause."
      : `The shoot can be paused once "${labelFor("SHOOT_STARTED", indoorOf(record))}" is done.`;
  }
  if (isPaused(record) === paused) return paused ? "This shoot is already paused." : "This shoot is not paused.";
  return null;
}

/** The three WhatsApp messages, and which step sends each. */
const MESSAGE_STEPS = ["STARTED_FROM_STUDIO", "REACHED_SHOOT_PLACE", "SHOOT_COMPLETED"];
const MESSAGE_LABELS = { STARTED_FROM_STUDIO: "Started to shoot", REACHED_SHOOT_PLACE: "Reached venue", SHOOT_COMPLETED: "Shoot completed" };
// Shoot completed goes out with Happy clients, which is where the shoot now ends.
const MESSAGE_FOR_STEP = { STARTED_FROM_STUDIO: "STARTED_FROM_STUDIO", REACHED_SHOOT_PLACE: "REACHED_SHOOT_PLACE", HAPPY_CLIENTS: "SHOOT_COMPLETED" };

const FILE_KINDS = ["TICKET", "STARTED_FROM_STUDIO", "REACHED_SHOOT_PLACE", "PINEAPPLE_GROUP", "SHOOT_STARTED", "HAPPENING_NOW", "HAPPY_CLIENTS", "STARTED_FROM_VENUE", "REACHED_STUDIO"];
const FILE_KIND_LABELS = {
  TICKET: "Ticket",
  STARTED_FROM_STUDIO: "Started to shoot photo",
  REACHED_SHOOT_PLACE: "Reached venue photo",
  PINEAPPLE_GROUP: "Pineapple meeting photo",
  SHOOT_STARTED: "Shoot started photo",
  HAPPENING_NOW: "Happening-now photo",
  HAPPY_CLIENTS: "Happy clients photo",
  STARTED_FROM_VENUE: "Started from venue photo",
  REACHED_STUDIO: "Reached studio photo",
};
/** How many of each a shoot may hold. */
const FILE_LIMITS = { TICKET: 10, STARTED_FROM_STUDIO: 5, REACHED_SHOOT_PLACE: 5, PINEAPPLE_GROUP: 5, SHOOT_STARTED: 5, HAPPENING_NOW: 30, HAPPY_CLIENTS: 10, STARTED_FROM_VENUE: 5, REACHED_STUDIO: 5 };
/**
 * The photo kinds that belong to one step: added and removed only while that step is the current
 * one, and `minPhotos` of them are needed to complete it - one, or two for Happening now.
 */
const STEP_PHOTO_KINDS = {
  STARTED_FROM_STUDIO: "STARTED_FROM_STUDIO",
  REACHED_SHOOT_PLACE: "REACHED_SHOOT_PLACE",
  PINEAPPLE_MEETING: "PINEAPPLE_GROUP",
  SHOOT_STARTED: "SHOOT_STARTED",
  HAPPENING_NOW: "HAPPENING_NOW",
  HAPPY_CLIENTS: "HAPPY_CLIENTS",
  STARTED_FROM_VENUE: "STARTED_FROM_VENUE",
  REACHED_STUDIO: "REACHED_STUDIO",
};
const STEP_FOR_PHOTO_KIND = Object.fromEntries(Object.entries(STEP_PHOTO_KINDS).map(([step, kind]) => [kind, step]));
const MIN_HAPPENING_NOW = 2;
const minPhotos = (step) => (step === "HAPPENING_NOW" ? MIN_HAPPENING_NOW : 1);

/*
 * Indoor shoots - Shoot Type "Studio / In-House" - have no travel: no Started from studio, Reached
 * shoot place. Nor a Pineapple meeting, the crew's huddle on arriving at the venue - so four steps
 * instead of seven, starting at Ready (what it calls Shoot started). A shoot with no type, or one the
 * studio's old sheets wrote as something else, is treated as outdoor and keeps all
 * seven. The stored step is never rewritten for this: a shoot raised on Started to shoot, or whose
 * type is changed to Studio later, simply reads as being on its next indoor step (`effectiveStep`),
 * and every rule below asks about that one.
 */
const INDOOR_TYPE = "Studio / In-House";
const TRAVEL_STEPS = new Set(["STARTED_FROM_STUDIO", "REACHED_SHOOT_PLACE", "STARTED_FROM_VENUE", "REACHED_STUDIO"]);
// The steps an indoor shoot does not have.
const NOT_INDOOR_STEPS = new Set([...TRAVEL_STEPS, "PINEAPPLE_MEETING"]);
const INDOOR_STEPS = STEPS.filter((step) => !NOT_INDOOR_STEPS.has(step));
/** Every step this shoot does not have: the retired ones, and indoors the travel and the huddle. */
const missingFor = (indoor) => (indoor ? new Set([...RETIRED_STEPS, ...NOT_INDOOR_STEPS]) : RETIRED_STEPS);

/** Whether a shoot is indoor, from its Shoot Type (one of two, picked with a radio). */
function isIndoorShoot(shoot) {
  const listed = Array.isArray(shoot?.shootTypes) ? shoot.shootTypes.filter(Boolean) : [];
  return (listed[0] || shoot?.shootType || null) === INDOOR_TYPE;
}
/** A production record's answer: `indoor` when the caller worked it out, else its `shoot`'s type. */
const indoorOf = (record) => Boolean(record?.indoor ?? isIndoorShoot(record?.shoot));
const stepsFor = (indoor) => (indoor ? INDOOR_STEPS : STEPS);

/**
 * The step a shoot is **really** on: one stored on a step it does not have reads as the next step it
 * does.
 *
 * Two kinds of record arrive here. An indoor shoot raised outdoors, or whose type was changed later,
 * is stored on a travel step it has no use for. And a shoot that was standing on the shoot status or
 * the trip back when those were retired is stored on a step nobody works any more - which reads as
 * File in, the one thing still owed. Neither is rewritten: the stored step is history, and this is
 * how it is read.
 */
const ALL_STEPS = ["STARTED_FROM_STUDIO", "REACHED_SHOOT_PLACE", "PINEAPPLE_MEETING", "SHOOT_STARTED", "HAPPENING_NOW", "HAPPY_CLIENTS", "SHOOT_STATUS", "STARTED_FROM_VENUE", "REACHED_STUDIO", "PHOTO_COPY"];
function effectiveStep(step, indoor) {
  const missing = missingFor(Boolean(indoor));
  if (!missing.has(step)) return step;
  return ALL_STEPS.slice(ALL_STEPS.indexOf(step)).find((candidate) => !missing.has(candidate)) || DONE;
}

const stepIndex = (step, indoor = false) => {
  const steps = stepsFor(indoor);
  return step === DONE ? steps.length : steps.indexOf(effectiveStep(step, indoor));
};

function nextStep(step, indoor = false) {
  const steps = stepsFor(indoor);
  const index = steps.indexOf(step);
  if (index === -1) return null;
  return steps[index + 1] || DONE;
}

/*
 * When the shoot's steps open: once the plan is submitted **and** the shoot is three days away - the
 * crew works its day, not its paperwork weeks ahead. A shoot with no date opens on its plan alone; one
 * whose day has already begun stays open whatever its date says now.
 */
const EXECUTION_DAYS_BEFORE = 3;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `YYYY-MM-DD` the steps open on - three days before the shoot's date - or null with no date. */
function executionOpensOn(record) {
  const date = record?.shoot?.dateCreated ? new Date(record.shoot.dateCreated) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() - EXECUTION_DAYS_BEFORE);
  return date.toISOString().slice(0, 10);
}

/**
 * Why the shoot's steps cannot be worked yet, or null when they can. `todayKey` is the studio's
 * today as `YYYY-MM-DD` - passed in, since this module keeps no clock.
 */
function executionRefusal(record, todayKey) {
  if (!record.planSubmittedAt) return "The plan has not been submitted yet.";
  const begun = stepIndex(effectiveStep(record.currentStep, indoorOf(record)), indoorOf(record)) > 0;
  const opensOn = executionOpensOn(record);
  if (begun || !opensOn || !todayKey || todayKey >= opensOn) return null;
  const [year, month, day] = opensOn.split("-").map(Number);
  return `The steps open on ${String(day).padStart(2, "0")} ${MONTHS[month - 1]} ${year}, three days before the shoot.`;
}

/** The board's pill: what this shoot is waiting on right now. */
function pendingLabel(record) {
  if (!record.planSubmittedAt) return "Plan pending";
  const indoor = indoorOf(record);
  const current = effectiveStep(record.currentStep, indoor);
  if (current === DONE) return "Done";
  // A paused shoot is waiting on being resumed, not on its step.
  if (isPaused(record) && PAUSABLE_STEPS.has(current)) return "Paused";
  const steps = stepsFor(indoor);
  return `Step ${steps.indexOf(current) + 1}/${steps.length} · ${labelFor(current, indoor)}`;
}

/**
 * Where a shoot stands, for the board's status tabs - one answer per shoot. On hold is only an older
 * record's, from the step that went, and the tab stays so those rows are not lost.
 */
const BOARD_STATUSES = ["Plan pending", "Not started", "Travelling", "Setting up", "Shoot in progress", "Paused", "File in pending", "Shoot completed", "On hold"];
/**
 * What the shoot is doing while it stands on a step - named by what is **done**, not by what is next:
 * standing on Reached venue, the crew has left and is travelling; standing on the pineapple meeting
 * or Shoot started, it has arrived and is setting up. An indoor shoot has neither, and its first step
 * reads Not started like any other.
 */
const STEP_BOARD_STATUS = {
  REACHED_SHOOT_PLACE: "Travelling",
  PINEAPPLE_MEETING: "Setting up",
  SHOOT_STARTED: "Setting up",
  HAPPENING_NOW: "Shoot in progress",
  HAPPY_CLIENTS: "Shoot in progress",
  PHOTO_COPY: "File in pending",
};
function boardStatus(record) {
  if (!record.planSubmittedAt) return "Plan pending";
  const indoor = indoorOf(record);
  const current = effectiveStep(record.currentStep, indoor);
  if (current === DONE) return "Shoot completed";
  if (current === stepsFor(indoor)[0]) return "Not started";
  if (isPaused(record)) return "Paused";
  // Only an older record carries this, from the step that went; it is still answered for.
  if (record.shootStatus === "HOLD") return "On hold";
  return STEP_BOARD_STATUS[current] || "Shoot in progress";
}

/** Why a file of this kind cannot be added now, or null when it can. Who may add it is access.js's. */
function fileAddRefusal(record, kind, todayKey) {
  if (!FILE_KINDS.includes(kind)) return "Unknown kind of file.";
  if (kind === "TICKET") return record.currentStep === DONE ? "This shoot is done; its tickets can no longer change." : null;
  if (!record.planSubmittedAt) return "The plan has not been submitted yet.";
  if (todayKey !== undefined) {
    const closed = executionRefusal(record, todayKey);
    if (closed) return closed;
  }
  const ownStep = STEP_FOR_PHOTO_KIND[kind];
  const indoor = indoorOf(record);
  return effectiveStep(record.currentStep, indoor) === ownStep ? null : `This photo is added at the ${labelFor(ownStep, indoor)} step.`;
}

/** Why a file of this kind cannot be removed now: once its step is done, it stays. */
function fileRemoveRefusal(record, kind) {
  if (kind === "TICKET") return record.currentStep === DONE ? "This shoot is done; its tickets can no longer change." : null;
  const ownStep = STEP_FOR_PHOTO_KIND[kind];
  if (!ownStep) return "Unknown kind of file.";
  const indoor = indoorOf(record);
  if (effectiveStep(record.currentStep, indoor) === ownStep) return null;
  // A shoot older than its step can hold photos for a step it has not reached yet.
  return STEPS.indexOf(effectiveStep(record.currentStep, indoor)) > STEPS.indexOf(ownStep) || effectiveStep(record.currentStep, indoor) === DONE ? `${labelFor(ownStep, indoor)} is done; its photo stays.` : `This photo can be changed at the ${labelFor(ownStep, indoor)} step.`;
}

module.exports = { FOOTAGE_ANSWERS,
  STEPS, RETIRED_STEPS, ALL_STEPS, DONE, STEP_LABELS, INDOOR_STEP_LABELS, labelFor, STEP_TIME_FIELDS, SHOOT_STATUSES, SHOOT_STATUS_LABELS, COMPLETED_STATUS, PAUSED_STATUS, RESUMED_STATUS, COMPLETES_SHOOT, PAUSABLE_STEPS, isPaused, pauseRefusal,
  MESSAGE_STEPS, MESSAGE_LABELS, MESSAGE_FOR_STEP, FILE_KINDS, FILE_KIND_LABELS, FILE_LIMITS, STEP_PHOTO_KINDS, MIN_HAPPENING_NOW, minPhotos,
  OPTIONAL_REMARK_FIELDS, BOARD_STATUSES, boardStatus, stepIndex, nextStep,
  INDOOR_TYPE, TRAVEL_STEPS, NOT_INDOOR_STEPS, INDOOR_STEPS, isIndoorShoot, indoorOf, stepsFor, effectiveStep, pendingLabel, fileAddRefusal, fileRemoveRefusal,
  EXECUTION_DAYS_BEFORE, executionOpensOn, executionRefusal,
};
