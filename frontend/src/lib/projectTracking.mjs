import { CLIENT_GIFT_STATUSES } from "../constants/clientGifts.js";
import { formatWhen } from "./productionSteps.mjs";
import { PROGRESS_COLORS } from "./progressStatus.mjs";
import { isCompletedStatus, isInProgressStatus } from "./projectStatuses.mjs";

/**
 * Where a project stands, as the client's portal draws it.
 *
 * The stages are the studio's own: the server works them out with the same rule Edit Project →
 * Status uses (`backend/src/modules/sales/projects/stage.js`) and sends them cut down to what a
 * client is told (`client/portal/controller.js`). So this decides no stage of its own - it only
 * words them for the client and lays each one's card out. A `tracking` is the portal endpoint's
 * answer:
 *
 *   {
 *     projectStatus, flag, eventId, projectName,
 *     stages: [{ id: STARTED | PRE_PRODUCTION | PRODUCTION | POST_PRODUCTION | DELIVERED,
 *                label, state: done | current | upcoming, done, total,
 *                facts: [{ label, value }],
 *                shoots?: [{ id, name, date, planned, plannedOn, finished,
 *                            progress: { steps: [{ key: PLAN | ON_THE_WAY | REACHED | STARTED | COMPLETED,
 *                                                  done, at }] } }] }],
 *     welcomeGift, shootCompletedGift: { status, sentOn, receivedOn } | null,
 *   }
 */

/** What the client calls the first stage: the project itself, not the act of starting it. */
const CLIENT_LABELS = { STARTED: "Project" };

/** The status chip's colour: the product's one progress palette, never a colour of its own. */
export function projectStatusColor(status) {
  if (isCompletedStatus(status)) return PROGRESS_COLORS.completed;
  if (isInProgressStatus(status)) return PROGRESS_COLORS.inProgress;
  return PROGRESS_COLORS.notStarted;
}

/** A stored day (`YYYY-MM-DD…`) as "20 Nov 2026", read as the day written down, not a moment. */
export function dayLabel(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
  if (!match) return "";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${match[3]} ${months[Number(match[2]) - 1]} ${match[1]}`;
}

const text = (value) => String(value ?? "").trim();

const [GIFT_YET_TO_SEND, GIFT_SENT, GIFT_RECEIVED] = CLIENT_GIFT_STATUSES;
const GIFT_COLORS = { [GIFT_YET_TO_SEND]: PROGRESS_COLORS.notStarted, [GIFT_SENT]: PROGRESS_COLORS.inProgress, [GIFT_RECEIVED]: PROGRESS_COLORS.completed };
// Client Gifts' own reading of a stored status: blank, and the old spelling, both mean not sent yet.
const giftStatus = (value) => (!text(value) || text(value) === "Yet To Receive" ? GIFT_YET_TO_SEND : text(value));

/** A gift as its own card: its status chip, and the day it went or arrived - received beats sent. */
function giftCard(label, gift) {
  if (!gift) return [];
  const status = giftStatus(gift.status);
  return [{
    label,
    chip: status,
    color: GIFT_COLORS[status] || PROGRESS_COLORS.notStarted,
    detail: gift.receivedOn ? `Received ${dayLabel(gift.receivedOn)}` : gift.sentOn ? `Sent ${dayLabel(gift.sentOn)}` : "On its way soon",
  }];
}

// The people on a stage are a team, drawn by name; the rest of its facts are details.
const isPerson = (label) => /manager|coordinator/i.test(label);
// Counted in the stage's progress line already, so not repeated as a detail.
const COUNTED = new Set(["Production plans submitted", "Shoots finished"]);

/** A stage detail, worded for the client: a day not yet fixed says so. */
function detail({ label, value }) {
  if (label === "Main event date") return { label, value: dayLabel(value) || "To be fixed" };
  return { label, value: text(value) || "—" };
}

/*
 * A shoot's production as the client follows it, step by step: each step as it is written on the
 * shoot's timeline once it has happened, and where the shoot stands while it is the latest - the
 * chip on the shoot. The plan reads pending until it is in.
 */
const SHOOT_STEPS = {
  PLAN: { label: "Plan ready", pending: "Plan pending", now: "Plan ready" },
  ON_THE_WAY: { label: "Team left the studio", now: "Team on the way" },
  REACHED: { label: "Team reached shoot place", now: "Team reached shoot place" },
  STARTED: { label: "Shoot started", now: "Shoot started" },
  COMPLETED: { label: "Shoot completed", now: "Shoot completed" },
};

/**
 * A shoot's production timeline - each step done (with when), the one coming next, or still to
 * come - and its chip: where it stands now, every state of it a chip, so the cards read alike.
 */
function shootProgress(progress) {
  const steps = (progress?.steps || []).filter((step) => SHOOT_STEPS[step.key]);
  const next = steps.findIndex((step) => !step.done);
  const timeline = steps.map((step, index) => {
    const words = SHOOT_STEPS[step.key];
    return {
      key: step.key,
      label: !step.done && words.pending ? words.pending : words.label,
      state: step.done ? "done" : index === next ? "current" : "upcoming",
      when: step.done ? formatWhen(step.at) : "",
    };
  });
  const latest = next === -1 ? steps.at(-1) : steps[next - 1];
  if (!latest) return { timeline, status: SHOOT_STEPS.PLAN.pending, color: PROGRESS_COLORS.notStarted };
  if (latest.key === "PLAN") return { timeline, status: SHOOT_STEPS.PLAN.now, color: PROGRESS_COLORS.inProgress };
  return { timeline, status: SHOOT_STEPS[latest.key].now, color: latest.key === "COMPLETED" ? PROGRESS_COLORS.completed : PROGRESS_COLORS.inProgress };
}

/**
 * A shoot's line on its stage's card: before the shoot, its plan as a chip - submitted, with the day
 * as `detail` under it, or still awaited; on Production, its timeline and where it stands.
 */
function shootLine(shoot, stageId) {
  const note = dayLabel(shoot.date);
  if (stageId === "PRODUCTION") return { id: shoot.id, name: shoot.name, note, ...shootProgress(shoot.progress) };
  if (shoot.planned) return { id: shoot.id, name: shoot.name, note, status: "Plan submitted", color: PROGRESS_COLORS.completed, detail: shoot.plannedOn ? `on ${dayLabel(shoot.plannedOn)}` : "" };
  return { id: shoot.id, name: shoot.name, note, status: "Awaiting plan", color: PROGRESS_COLORS.notStarted };
}

/**
 * Everything the tracker draws: the five steps, and one stage's sheet - its team (who is looking
 * after it, by name), its details (the project's status and Event ID on the first), the client
 * gifts, its shoots, and how far through them it is.
 *
 * The sheet is the current stage's, or the last one's once the project is delivered - unless
 * `chosenKey` names another stage the client has picked on the strip. Only a stage reached so far
 * (done or current) can be picked, so a finished stage stays readable after it is over; a stage
 * still to come has nothing to show yet, and naming one falls back to the stage the project is at.
 */
export function projectTrackingView(tracking, chosenKey = "") {
  const status = tracking?.projectStatus || "Yet to Start";
  const stages = Array.isArray(tracking?.stages) ? tracking.stages : [];
  const index = stages.findIndex((stage) => stage.state === "current");
  const delivered = stages.length > 0 && index === -1;
  const chosen = stages.findIndex((stage) => stage.id === chosenKey && stage.state !== "upcoming");
  const at = chosen !== -1 ? chosen : index === -1 ? stages.length - 1 : index;
  const steps = stages.map((stage, position) => ({ key: stage.id, label: CLIENT_LABELS[stage.id] || stage.label, state: stage.state, selected: position === at }));
  const current = stages[at] || { id: "STARTED", label: "Project", facts: [] };
  const finished = delivered || current.state === "done";
  const stageFacts = current.facts || [];
  const team = stageFacts.filter((fact) => isPerson(fact.label)).map((fact) => ({ role: fact.label, name: text(fact.value) }));
  const otherFacts = stageFacts.filter((fact) => !isPerson(fact.label) && !COUNTED.has(fact.label)).map(detail);
  // The project's own status and Event ID head the first stage's details.
  const facts = current.id === "STARTED"
    ? [{ label: "Status", chip: status, color: projectStatusColor(status) }, { label: "Event ID", value: text(tracking?.eventId) || "—" }, ...otherFacts]
    : otherFacts;
  // Each gift on the stage it belongs to: the welcome gift on Pre Production, the shoot completed
  // gift on Production - given once the shoot is done, so not before it and not repeated after.
  const welcomeGift = giftCard("Welcome gift", tracking?.welcomeGift);
  const shootCompletedGift = giftCard("Shoot completed gift", tracking?.shootCompletedGift);
  const gifts = current.id === "PRE_PRODUCTION" ? welcomeGift : current.id === "PRODUCTION" ? shootCompletedGift : [];

  return {
    steps,
    status,
    statusColor: projectStatusColor(status),
    stage: {
      key: current.id,
      label: CLIENT_LABELS[current.id] || current.label,
      position: `Stage ${stages.length ? at + 1 : 1} of ${stages.length || 5}`,
      // The Project card states the status as its first row, so its header carries no chip as well.
      state: current.id === "STARTED" ? "" : finished ? "Completed" : "In progress",
      stateColor: finished ? PROGRESS_COLORS.completed : PROGRESS_COLORS.inProgress,
      team,
      facts,
      gifts,
      showShoots: Array.isArray(current.shoots),
      // How far the stage is through its shoots - planned for Pre Production, shot for Production -
      // for the bar under its card's heading; null for a stage that is not counted in shoots.
      progress: (current.id === "PRE_PRODUCTION" || current.id === "PRODUCTION") && current.total
        ? { done: current.done, total: current.total, label: `${current.done} of ${current.total} ${current.id === "PRODUCTION" ? "shot" : "planned"}` }
        : null,
      shoots: (current.shoots || []).map((shoot) => shootLine(shoot, current.id)),
    },
  };
}
