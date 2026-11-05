/**
 * The production steps as the screens name them. The order is the server's
 * (backend/src/modules/project-management/production/steps.js) and is repeated here only because
 * the browser cannot import the backend; the server stays the authority on what may happen next.
 */
export const PRODUCTION_STEPS = [
  ["STARTED_FROM_STUDIO", "Started to shoot"],
  ["REACHED_SHOOT_PLACE", "Reached venue"],
  ["PINEAPPLE_MEETING", "Pineapple meeting"],
  ["SHOOT_STARTED", "Shoot started"],
  ["HAPPENING_NOW", "Happening now"],
  ["HAPPY_CLIENTS", "Happy clients"],
  ["PHOTO_COPY", "File in"],
];

/**
 * An indoor shoot has no travel and no pineapple meeting, so its first step is not "Started to
 * shoot" but the studio being ready (`INDOOR_STEP_LABELS` on the server).
 */
export const INDOOR_STEP_LABELS = { SHOOT_STARTED: "Ready" };

/** Which step sends which WhatsApp message. Happy clients both finishes the shoot and tells the group. */
export const MESSAGE_STEP_FOR = { STARTED_FROM_STUDIO: "STARTED_FROM_STUDIO", REACHED_SHOOT_PLACE: "REACHED_SHOOT_PLACE", HAPPY_CLIENTS: "SHOOT_COMPLETED" };
export const MESSAGE_LABELS = { STARTED_FROM_STUDIO: "Started to shoot", REACHED_SHOOT_PLACE: "Reached venue", SHOOT_COMPLETED: "Shoot completed" };

export const ACTIVITY_LABELS = {
  PLAN_SAVED: "Plan saved",
  PLAN_SUBMITTED: "Plan submitted",
  STEP_COMPLETED: "Step completed",
  // The shoot being paused where it stands, and started again - not a step (`ProductionPauseControl`).
  SHOOT_STATUS_CHANGED: "Shoot status changed",
  FILE_ADDED: "File added",
  FILE_REMOVED: "File removed",
  WHATSAPP_SENT: "WhatsApp sent",
  WHATSAPP_FAILED: "WhatsApp not sent",
  WHATSAPP_RETRIED: "WhatsApp retried",
  // File in filled in for some of the shoot's services, the step left where it is.
  FOOTAGE_SAVED: "File in saved",
};

/** What each placeholder of the three production messages is filled with (Settings → Templates). */
export const PRODUCTION_MESSAGE_PLACEHOLDERS = {
  "project name": "The project's WhatsApp group name, or its Event ID",
  shoot: "The shoot's name, as Reception",
  date: "The shoot's date, as 02 Oct 2026",
  location: "Pre production's location, or the shoot place, with the district",
  coordinator: "The Production Coordinator named in the plan",
};

/**
 * The steps one shoot has, in order, from the server's list (`execution.steps`): all seven, or four
 * for an indoor shoot, which has no travel and no pineapple meeting. Without a list, all seven.
 * `indoor` relabels the steps an indoor shoot names differently, so the rail, the list and the step's
 * own heading all read the same words.
 */
export function stepsOf(ids, indoor = false) {
  const own = Array.isArray(ids) && ids.length ? PRODUCTION_STEPS.filter(([id]) => ids.includes(id)) : PRODUCTION_STEPS;
  return indoor ? own.map(([id, label]) => [id, INDOOR_STEP_LABELS[id] || label]) : own;
}

export function stepIndex(step, steps = PRODUCTION_STEPS) {
  if (step === "DONE") return steps.length;
  return steps.findIndex(([id]) => id === step);
}

export const stepLabel = (step, indoor = false) =>
  (indoor && INDOOR_STEP_LABELS[step]) || PRODUCTION_STEPS.find(([id]) => id === step)?.[1] || step;

export function formatDay(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

export function formatWhen(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

export function activityText(entry) {
  const label = ACTIVITY_LABELS[entry.action] || entry.action;
  if (entry.action === "STEP_COMPLETED") return `${label}: ${stepLabel(entry.detail)}`;
  return entry.detail ? `${label}: ${entry.detail}` : label;
}

export const messageFor = (messages = [], messageStep) => (messages || []).find((message) => message.step === messageStep) || null;


/**
 * What the coordinator is told when a step saved but its WhatsApp message did not go, so the client's
 * group getting nothing is never hidden behind a "done". Null when the message went (or there is none).
 */
// The step a message's Retry sits on, named in the notice, since the rail has moved on past it.
const RETRY_STEP = { STARTED_FROM_STUDIO: "Started to shoot", REACHED_SHOOT_PLACE: "Reached venue", SHOOT_COMPLETED: "Happy clients" };

export function unsentNotice(message) {
  const step = RETRY_STEP[message?.step] || "the finished step";
  if (message?.status === "FAILED") return `Done — WhatsApp not sent: ${message.reason || "Send failed"}. Retry it on ${step}.`;
  if (message?.status === "SENDING") return `Done — WhatsApp is still sending. Check ${step} for the result.`;
  return null;
}
