const prisma = require("../../../config/db");
const { rangeBounds } = require("../../../services/dashboardRange");
const { CLOSED_STATUSES, STATUS_LABELS, allTasksScope, NOT_ON_A_BINNED_PROJECT } = require("./service");

/**
 * HRM → Tasks → Dashboard: the reader's own tasks as figures, the way Image Selection's dashboard
 * reads its projects.
 *
 * Two sides, one row of cards each. **My Tasks** is the work assigned to the reader; **Tasks Given**
 * is the work they assigned to somebody else. Every figure is a **position** - the tasks as they
 * stand now - and the arrow beside it is how far it has moved since the start of the range picked,
 * read off each task's own activity log, so nothing new is stored for it.
 *
 * A reader who also holds `HRM / All Tasks` gets a third row first: **All Tasks**, every task their
 * All Tasks list reaches - the same data scope (`allTasksScope`), so the dashboard never counts a
 * task that list would not show them.
 */

/** The All Tasks row, only for a reader of All Tasks. Sent-back work counts as Completed here. */
const ALL_CARD_KEYS = ["allTotal", "allPending", "allInProgress", "allOverdue", "allCompleted"];

/** The ten cards everybody has, in the order the page draws them: five for My Tasks, five for Tasks Given. */
const CARD_KEYS = [
  "myTotal", "myPending", "myInProgress", "myOverdue", "myCompleted",
  "givenTotal", "givenPending", "givenInProgress", "givenSentBack", "givenCompleted",
];

// The status each logged action leaves a task in; actions not listed (an edit, a file) change nothing.
const STATUS_AFTER = {
  CREATED: "PENDING",
  ASSIGNED: "PENDING",
  REASSIGNED: "PENDING",
  REVOKED: "PENDING",
  SUBMITTED: "SUBMITTED",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
};

/**
 * Where a task's status stood at `at`, replayed from its activity log; null for a task that did
 * not exist yet. Starting it is the one STATUS_CHANGED line, and it always moves it to In Progress.
 */
function statusAt(task, at) {
  if (new Date(task.createdAt) >= at) return null;
  let status = "PENDING";
  for (const activity of task.activities) {
    if (new Date(activity.createdAt) > at) break;
    if (activity.action === "STATUS_CHANGED" && /to In Progress/.test(activity.detail || "")) status = "IN_PROGRESS";
    else if (STATUS_AFTER[activity.action]) status = STATUS_AFTER[activity.action];
  }
  return status;
}

const isOpen = (status) => !CLOSED_STATUSES.includes(status) && status !== "SUBMITTED";

/**
 * The cards one task counts towards, given its status and the day it is measured on. For the
 * holder, work they finished and sent back is Completed - their part is done; for the giver it is
 * Finish & Send Back, waiting on them.
 */
function cardsFor(task, status, userId, dayStart) {
  if (!status) return [];
  const cards = [];
  const overdue = isOpen(status) && task.dueOn && new Date(task.dueOn) < dayStart;
  if (task.assignedToUserId === userId) {
    cards.push("myTotal");
    if (status === "PENDING" || status === "REASSIGNED") cards.push("myPending");
    if (status === "IN_PROGRESS") cards.push("myInProgress");
    if (overdue) cards.push("myOverdue");
    if (status === "COMPLETED" || status === "SUBMITTED") cards.push("myCompleted");
  } else if (task.assignedByUserId === userId) {
    cards.push("givenTotal");
    if (status === "PENDING" || status === "REASSIGNED") cards.push("givenPending");
    if (status === "IN_PROGRESS") cards.push("givenInProgress");
    if (status === "SUBMITTED") cards.push("givenSentBack");
    if (status === "COMPLETED") cards.push("givenCompleted");
  }
  return cards;
}

/** The All Tasks cards one task counts towards. */
function allCardsFor(task, status, dayStart) {
  if (!status) return [];
  const cards = ["allTotal"];
  if (status === "PENDING" || status === "REASSIGNED") cards.push("allPending");
  if (status === "IN_PROGRESS") cards.push("allInProgress");
  if (isOpen(status) && task.dueOn && new Date(task.dueOn) < dayStart) cards.push("allOverdue");
  if (status === "COMPLETED" || status === "SUBMITTED") cards.push("allCompleted");
  return cards;
}

const tally = (lists, keys = CARD_KEYS) => {
  const summary = Object.fromEntries(keys.map((key) => [key, 0]));
  for (const cards of lists) for (const key of cards) summary[key] += 1;
  return summary;
};

async function taskDashboard({ userId, range: rangeKey, canSeeAll = false, now = new Date() }) {
  const range = rangeBounds(rangeKey, now);
  // The start of the studio's today: a task due before it and still open is overdue.
  const today = rangeBounds("week", now).to;
  const todayStart = new Date(today.getTime() - 24 * 60 * 60 * 1000);

  const own = { OR: [{ assignedToUserId: userId }, { assignedByUserId: userId }] };
  // A reader of All Tasks reads everything their All Tasks scope reaches, as well as their own.
  const scope = canSeeAll ? await allTasksScope(userId) : null;
  const tasks = await prisma.hrmTask.findMany({
    // An unlimited scope's `where` is `{}`, which inside an OR matches nothing - so it filters nothing instead.
    where: { deletedAt: null, ...NOT_ON_A_BINNED_PROJECT, ...(scope?.unlimited ? {} : scope ? { OR: [own, scope.where] } : own) },
    select: {
      id: true, taskCode: true, title: true, status: true, priority: true, dueOn: true, createdAt: true, updatedAt: true, completedAt: true,
      assignedToUserId: true, assignedToName: true, assignedByUserId: true, assignedByName: true,
      // What the All Tasks scope reads to decide whether a task is the reader's to count.
      branchId: true, ownerEmployeeId: true, createdByUserId: true,
      activities: { select: { action: true, detail: true, createdAt: true }, orderBy: { createdAt: "asc" } },
    },
    orderBy: { updatedAt: "desc" },
  });

  const rows = tasks.map((task) => ({
    id: task.id,
    taskCode: task.taskCode,
    title: task.title,
    status: task.status,
    statusLabel: STATUS_LABELS[task.status] || task.status,
    priority: task.priority,
    side: task.assignedToUserId === userId ? "mine" : task.assignedByUserId === userId ? "given" : "studio",
    assignedToName: task.assignedToName,
    assignedByName: task.assignedByName,
    dueOn: task.dueOn,
    lastActivityAt: task.activities.at(-1)?.createdAt || task.updatedAt,
    cards: [...(scope && scope.allows(task) ? allCardsFor(task, task.status, todayStart) : []), ...cardsFor(task, task.status, userId, todayStart)],
  }));
  const keys = scope ? [...ALL_CARD_KEYS, ...CARD_KEYS] : CARD_KEYS;
  const summary = tally(rows.map((row) => row.cards), keys);

  /*
   * The same ten figures at the start of the range, from the same tasks, each at the status its
   * activity log had reached by then. Lifetime has no start, so there is nothing to compare with.
   * The tasks are today's - one that has since moved to somebody else is not counted then either.
   */
  const previous = range.key === "lifetime" ? null : tally(tasks.map((task) => {
    const status = statusAt(task, range.from);
    return [...(scope && scope.allows(task) ? allCardsFor(task, status, range.from) : []), ...cardsFor(task, status, userId, range.from)];
  }), keys);
  const trend = previous && Object.fromEntries(keys.map((key) => [key, { before: previous[key], delta: summary[key] - previous[key] }]));

  const inRange = (value) => value && new Date(value) >= range.from && new Date(value) < range.to;
  return {
    range: { key: range.key, label: range.label, from: range.from, to: range.to },
    period: {
      key: range.key,
      label: range.label,
      assignedToMe: tasks.filter((task) => task.assignedToUserId === userId && inRange(task.createdAt)).length,
      given: tasks.filter((task) => task.assignedByUserId === userId && task.assignedToUserId !== userId && inRange(task.createdAt)).length,
      completed: tasks.filter((task) => inRange(task.completedAt)).length,
    },
    totalTasks: tasks.length,
    summary,
    trend,
    recentTasks: rows,
  };
}

module.exports = { CARD_KEYS, ALL_CARD_KEYS, statusAt, cardsFor, allCardsFor, taskDashboard };
