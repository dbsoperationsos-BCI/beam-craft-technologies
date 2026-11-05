/**
 * HRM → Tasks → Dashboard: what each card counts and how the Recent Tasks table follows it.
 *
 * The figures come from `GET /api/hrm/tasks/dashboard` (`backend/src/modules/hrm/tasks/dashboard.js`),
 * which also says which cards each task counts towards (`cards` on the row), so pressing a card
 * narrows the table to exactly the tasks behind its number - the screen never recounts.
 */

import { periodPhrase, previousPhrase } from "./dashboardRange.mjs";

/*
 * The All Tasks row, first on the page and only for a reader of HRM / All Tasks: the server sends
 * these figures only to them (`summary.allTotal` is absent for everybody else).
 */
export const ALL_TASK_CARDS = [
  { key: "allTotal", label: "All Tasks", unit: "Task", view: "allTotal" },
  { key: "allPending", label: "All Pending", unit: "Task", view: "allPending" },
  { key: "allInProgress", label: "All In Progress", unit: "Task", view: "allInProgress" },
  { key: "allOverdue", label: "All Overdue", unit: "Task", view: "allOverdue" },
  { key: "allCompleted", label: "All Completed", unit: "Task", view: "allCompleted" },
];

export const TASK_SUMMARY_CARDS = [
  // My Tasks: the work assigned to you.
  { key: "myTotal", label: "My Tasks", unit: "Task", view: "myTotal" },
  { key: "myPending", label: "Pending", unit: "Task", view: "myPending" },
  { key: "myInProgress", label: "In Progress", unit: "Task", view: "myInProgress" },
  { key: "myOverdue", label: "Overdue", unit: "Task", view: "myOverdue" },
  { key: "myCompleted", label: "Completed", unit: "Task", view: "myCompleted" },
  // Tasks Given: the work you assigned to somebody else.
  { key: "givenTotal", label: "Tasks Given", unit: "Task", view: "givenTotal" },
  { key: "givenPending", label: "Not Started", unit: "Task", view: "givenPending" },
  { key: "givenInProgress", label: "Given In Progress", unit: "Task", view: "givenInProgress" },
  { key: "givenSentBack", label: "Finish & Send Back", unit: "Task", view: "givenSentBack" },
  { key: "givenCompleted", label: "Given Completed", unit: "Task", view: "givenCompleted" },
];

/** The cards this reader's figures carry: the All Tasks row first when the server sent it. */
export const taskDashboardCards = (summary) => (summary && "allTotal" in summary ? [...ALL_TASK_CARDS, ...TASK_SUMMARY_CARDS] : TASK_SUMMARY_CARDS);

/** The words for a pressed card, for the table's heading. */
export const taskViewLabel = (view) => [...ALL_TASK_CARDS, ...TASK_SUMMARY_CARDS].find((card) => card.view === view)?.label || "All tasks";

/** The rows a pressed card keeps; every row when nothing is pressed. */
export const tasksForCard = (rows, view) => (view ? (rows || []).filter((row) => (row.cards || []).includes(view)) : [...(rows || [])]);

/** The line above the cards: what they show, what the arrows measure, and what the range added. */
export function taskDashboardCaption(data) {
  const count = (value) => Number(value || 0).toLocaleString("en-IN");
  const period = data?.period;
  return [
    data?.summary && "allTotal" in data.summary ? "The studio's tasks and yours as they stand" : "Your tasks as they stand",
    data?.trend ? `each arrow is the change ${previousPhrase(period?.key)}` : null,
    period ? `${periodPhrase(period.key)}: ${count(period.assignedToMe)} assigned to you, ${count(period.given)} given, ${count(period.completed)} completed` : null,
  ].filter(Boolean).join(" · ");
}
