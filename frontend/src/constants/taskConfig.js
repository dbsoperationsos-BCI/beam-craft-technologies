/**
 * Tasks, described as data for the shared components to draw: the views in the dropdown beside the
 * heading, the status filters in the tab row under it, the table's own columns, the info panel, and
 * the form that gives a task.
 *
 * The strings here are the server's, not labels invented for the screen — `STATUSES` and
 * `PRIORITIES` mirror `backend/src/modules/hrm/tasks/service.js`, and the labels below are the only
 * place either is turned into something a person reads. A status typed differently on the two sides
 * would filter to an empty table with nothing on screen to say why.
 */

export const TASK_STATUSES = ["PENDING", "IN_PROGRESS", "COMPLETED", "REASSIGNED", "CANCELLED", "SUBMITTED"];
/**
 * The two a task is over in. Mirrors `CLOSED_STATUSES` in the module, which is what the server
 * refuses every further verb with — so a task in one of these has nothing left anybody can do to it.
 *
 * `REASSIGNED` is not among them, where the `REVERTED` it replaced was: a reassigned task has landed
 * on somebody new and is waiting to be picked up, so it is still very much open.
 */
export const CLOSED_TASK_STATUSES = ["COMPLETED", "CANCELLED"];
export const taskIsClosed = (task) => CLOSED_TASK_STATUSES.includes(task?.status);
export const TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
/**
 * The type that asks a question back: every other option names the work, this one only says the
 * list did not cover it, so the form asks what it was. Mirrors `OTHER_TASK_TYPE` on the server -
 * the string is the test both sides make, and the two disagreeing would show the box on neither.
 */
export const OTHER_TASK_TYPE = "Other";
/** Mirrors `TASK_TYPES` in the module; the options endpoint sends the live list, this is the fallback. */
export const TASK_TYPES = ["Client", "Internal", "Administrative", "Follow Up", "Escalation", OTHER_TASK_TYPE];

/** True while the form should be asking what the other type was. */
/**
 * Whether this task type asks what the work actually was.
 *
 * It was `values.taskType === OTHER_TASK_TYPE` - the literal word, compared here and again in the
 * tasks service, so renaming "Other" in Settings stopped the form asking and the server accepting.
 * The types that ask are `asks_for_details` on the row now, sent down beside the list itself, and
 * `OTHER_TASK_TYPE` below is what a caller with no options to hand falls back to.
 */
export const taskTypeIsOther = (values, context) =>
  (context?.options?.taskTypesAskingForDetails || [OTHER_TASK_TYPE]).includes(values.taskType);

export const STATUS_LABELS = {
  PENDING: "Pending",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  REASSIGNED: "Reassigned",
  CANCELLED: "Cancelled",
  // Finished by its holder and sent back, waiting for whoever assigned it. Its tab sits after Cancelled.
  SUBMITTED: "Finish & Send Back",
};

export const PRIORITY_LABELS = { LOW: "Low", MEDIUM: "Medium", HIGH: "High", CRITICAL: "Critical" };

export const statusLabel = (status) => STATUS_LABELS[status] || status || "—";

/**
 * The three views, which are three different questions rather than three filters of one list.
 *
 * `permission` is set only on All Tasks: the other two are already scoped to the person asking, so
 * the screen's own permission is the whole answer for them. The page drops a view whose permission
 * the viewer does not hold, rather than listing one that would answer with a refusal.
 */
// In this order on screen (the dropdown is not sorted): Dashboard, All Tasks, My Tasks, Tasks Given.
export const TASK_VIEWS = [
  // Everybody's: their own tasks as figures - and the studio's too for whoever holds All Tasks.
  { id: "dashboard", label: "Dashboard", dashboard: true },
  {
    id: "all",
    label: "All Tasks",
    emptyMessage: "No tasks in the studio yet.",
    permission: { module: "HRM", feature: "All Tasks" },
  },
  { id: "mine", label: "My Tasks", emptyMessage: "Nothing has been assigned to you." },
  { id: "given", label: "Tasks Given", emptyMessage: "You have not given anybody a task yet." },
];

/**
 * The view the screen opens on: the Dashboard, which every reader of Tasks has - their own figures
 * first, the way Image Selection opens. All Tasks is listed above My Tasks but most roles do not
 * hold it, so it is never the default.
 */
export const DEFAULT_TASK_VIEW = "dashboard";

/**
 * The tab row's "no filter" entry — the whole of whichever view is open.
 *
 * The status is narrowed by the server, not here: each view is its own endpoint and takes the status
 * as a query, so a long list is cut before it is sent rather than fetched in full and filtered in
 * the browser. This id is what the page swaps for the empty string that endpoint reads as "any".
 */
export const ALL_STATUSES = "ALL";

/**
 * The statuses worth filtering a list down to, which is now every one of them.
 *
 * Cancelled had no tab of its own, on the reading that a cancelled task is over and has nothing
 * owing on it either way. That was true of the *task* and wrong about the *reader*: calling a task
 * off is the one thing only the person who set it can do, and they are exactly who wants to see
 * what they have called off. It cost nothing to leave out and nothing to put back, since a
 * cancelled task was always visible under All regardless.
 */
export const FILTERABLE_STATUSES = [...TASK_STATUSES];

/*
 * Not a status - an overlay, like the repository's Review Pending: a task whose due day has passed
 * while it is still owed (Pending, In Progress, or Finished & Sent Back and waiting for its setter's
 * approval). It shows under Overdue and under its own status tab too. The same rule as the Task
 * Dashboard's Overdue card (`hrm/tasks/dashboard.js`), so the two always count the same.
 */
export const OVERDUE = "OVERDUE";
const OWED_TABS = ["PENDING", "IN_PROGRESS", "SUBMITTED"];

/** Today in the browser's own calendar, "YYYY-MM-DD" - what a due day is compared with. */
export function todayKey(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** How many whole days past its due day an owed task is, for this reader; 0 when it is not overdue. */
export function daysOverdue(task, viewId, today = todayKey()) {
  const due = String(task?.dueOn || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || due >= today || !OWED_TABS.includes(taskTab(task, viewId))) return 0;
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86_400_000);
}
export const taskIsOverdue = (task, viewId, today) => daysOverdue(task, viewId, today) > 0;

export const TASK_STATUS_FILTERS = [
  // A named id rather than an empty string: it is a tab's React key and its `aria-selected` test,
  // and "" is a poor value for both. The page sends "" to the server for it.
  { id: ALL_STATUSES, label: "All" },
  { id: OVERDUE, label: "Overdue" },
  ...FILTERABLE_STATUSES.map((status) => ({ id: status, label: STATUS_LABELS[status] })),
];

/**
 * The tasks one status tab shows. `All` is everything, cancelled tasks included.
 *
 * The filtering is here rather than sent to the server, and that is what makes the counts possible:
 * asking the server per status left the browser holding only the status it was showing, so every
 * other tab had nothing to count and showed nothing at all. This endpoint does not paginate, so the
 * All tab was already fetching the whole view — filtering it here costs nothing and saves a round
 * trip on every tab change.
 */
/*
 * Finish & Send Back is the assigner's tab: it lives in Tasks Given (and All Tasks), where the
 * person who gave the work follows it. My Tasks is the work given *to* you, so a task you finished
 * and sent back is simply Completed there - your part of it is done.
 */
export const taskStatusFiltersFor = (viewId) => (viewId === "mine"
  ? TASK_STATUS_FILTERS.filter((filter) => filter.id !== "SUBMITTED")
  : TASK_STATUS_FILTERS);

export const tasksForStatus = (tasks, statusFilter, viewId) => (statusFilter === ALL_STATUSES
  ? [...(tasks || [])]
  : statusFilter === OVERDUE
    ? (tasks || []).filter((task) => taskIsOverdue(task, viewId))
    : (tasks || []).filter((task) => taskTab(task, viewId) === statusFilter));

/**
 * The status tab a task sits under for this reader. A task they passed on to somebody else is under
 * Reassigned, and only there - it is no longer theirs to do, so it is not Pending for them. Its new
 * holder gets it as Pending, which is what the server sends it as. One reassigned before that rule
 * may still say `REASSIGNED`; it is somebody's pending work all the same.
 */
export const taskTab = (task, viewId) => {
  if (task?.passedOn) return "REASSIGNED";
  if (viewId === "mine" && task?.status === "SUBMITTED") return "COMPLETED";
  return task?.status === "REASSIGNED" ? "PENDING" : task?.status;
};

/**
 * How many tasks sit behind each tab, keyed by the tab's own id.
 *
 * Counted from the whole view rather than from what is on screen, which is the point of a count: it
 * is read to decide whether a tab is worth opening, so it has to answer for the tab it labels rather
 * than for the one already open.
 *
 * `All` counts everything, Cancelled included. Cancelled has no tab of its own — a called-off task
 * owes nobody anything — but its tasks are still in the list, so a total that left them out would
 * disagree with the rows underneath it.
 */
/**
 * A row as the open view reads it, so its Status always says the tab it sits under: a task you
 * passed on reads Reassigned, and in My Tasks work you sent back reads Completed.
 */
export const rowForView = (task, viewId) => {
  const tab = taskTab(task, viewId);
  return tab === task?.status ? task : { ...task, statusLabel: STATUS_LABELS[tab] || task?.statusLabel };
};

export function taskStatusCounts(tasks, viewId) {
  const rows = Array.isArray(tasks) ? tasks : [];
  const counts = { [ALL_STATUSES]: rows.length, [OVERDUE]: 0 };
  const today = todayKey();
  for (const task of rows) {
    counts[taskTab(task, viewId)] = (counts[taskTab(task, viewId)] || 0) + 1;
    if (taskIsOverdue(task, viewId, today)) counts[OVERDUE] += 1;
  }
  return counts;
}

/**
 * Amber while it waits, blue while somebody is on it, green done, violet handed on, slate called off
 * — the same reading the payment request dots give, so a status means the same colour everywhere.
 *
 * Reassigned is violet rather than the rose the rolled-back status wore: rose reads as a problem,
 * and a task being passed to the right person is the system working. Called off keeps the quiet
 * slate, being the one that means nothing further will happen.
 */
export const taskStatusStyles = {
  Pending: "bg-amber-500",
  "In Progress": "bg-blue-500",
  Completed: "bg-emerald-500",
  Reassigned: "bg-violet-500",
  Cancelled: "bg-slate-400",
  "Finish & Send Back": "bg-teal-500",
};

/** `[key, header, type, size, minSize]`, the same shape every other module table uses. */
export const taskTableFields = [
  ["taskCode", "Task ID", undefined, 140, 120],
  ["statusLabel", "Status", "status", 140, 120],
  ["title", "Task", undefined, 260, 180],
  ["taskTypeLabel", "Type", undefined, 150, 120],
  ["priorityLabel", "Priority", undefined, 120, 100],
  ["department", "Department", undefined, 170, 130],
  ["branch", "Branch", undefined, 150, 120],
  ["assignedToName", "Assigned To", undefined, 190, 150],
  ["assignedByName", "Assigned By", undefined, 190, 150],
  ["createdAt", "Created", "date", 140, 120],
  ["dueOn", "Due", "date", 140, 120],
  ["completedAt", "Completed", "date", 140, 120],
  ["updatedAt", "Last Updated", "date", 150, 130],
];

/**
 * The columns a table opens with. Everything is available in Manage Columns; the ones hidden here
 * are the second-order dates, which crowd out the answer most readings of this screen are after —
 * who owes what, and where it has got to.
 */
export const taskDefaultHiddenColumns = ["completedAt", "updatedAt"];

export const taskInfoSections = [
  { title: "Task", fields: [["taskCode", "Task ID"], ["title", "Task"], ["statusLabel", "Status"], ["priorityLabel", "Priority"], ["taskTypeLabel", "Type"], ["department", "Department"], ["branch", "Branch"]] },
  { title: "People", fields: [["assignedToName", "Assigned To"], ["assignedByName", "Assigned By"]] },
  { title: "Dates", fields: [["createdAt", "Created", "date"], ["dueOn", "Due", "date"], ["completedAt", "Completed", "date"], ["reassignedAt", "Reassigned", "date"], ["cancelledAt", "Cancelled", "date"], ["updatedAt", "Last Updated", "date"]] },
  { title: "Details", fields: [["description", "Description"], ["reassignedFromName", "Reassigned From"], ["reassignReason", "Reason Reassigned"], ["completedByName", "Completed By"]] },
];

/**
 * The form that gives a task.
 *
 * `assignedToUserId` reads its options from `context.options.users`, which the page fills from the
 * options endpoint — a narrow list of ids and names, so being able to give a task never becomes a
 * way to read the user directory.
 *
 * A title as well as the description: the list, the bell and the notification all need one line to
 * show, and a table of 500-character descriptions is a table nobody can read. The description below
 * it is where the actual instructions go.
 */
export const taskFormSections = [
  {
    id: "assignment",
    title: "Assignment",
    fields: [
      /*
       * Not shown when correcting a task. Handing one to somebody else is `POST /:id/reassign` -
       * it records the hand-over in the holder chain and tells the new person - so an edit that
       * offered this box would be a second, quieter way of doing it, and the server's update schema
       * would refuse the field anyway. On a duplicate it is a fresh choice like any other.
       */
      { name: "assignedToUserId", label: "Assigned To", helperText: "The person who will do this task; they are notified once it is given.", type: "select", required: true, when: (values, context) => !context?.editing, options: "users", placeholder: "Select a person", props: { searchable: true }, colSpan: 2 },
      // `clears` empties the box below on every change of type, so a detail typed under "Other" and
      // then switched away cannot be submitted against a type that never showed it.
      { name: "taskType", label: "Task Type", helperText: "The kind of work this is; choose Other to describe it yourself.", type: "select", required: true, options: "taskTypes", placeholder: "Select a type", clears: ["taskTypeOther"] },
      { name: "taskTypeOther", label: "What Kind of Task", helperText: "A few words naming the kind of task, since it is not on the list.", required: true, when: taskTypeIsOther, props: { placeholder: "e.g. Vendor coordination", maxLength: 120 } },
      // `sorted: false` because the order of a priority scale *is* its meaning — alphabetically it
      // would read Critical, High, Low, Medium, which says nothing about which is which.
      { name: "priority", label: "Priority", helperText: "How urgent the task is, so the assignee knows what to do first.", type: "select", required: true, options: "priorities", props: { sorted: false } },
      /*
       * Required, which it was not. A task with no due date is in nobody's "due this week" and
       * nothing chases it: it sits in the list being neither done nor overdue. The server asks for
       * it too - this marks the box and refuses the submit, that refuses the request.
       *
       * `minDate` is today, so a task cannot be given a deadline that has already passed. It is left
       * in place for an edit as well: correcting a task is not a way to backdate what was asked for.
       *
       * **`minDate`, not `min`.** `DateField` is this application's own calendar, not an `<input
       * type="date">`, and it reads `minDate`/`maxDate`. Written as `min` the prop went nowhere: the
       * calendar offered every past day, and the comment above claimed a bound that neither side
       * enforced.
       */
      { name: "dueOn", label: "Due Date", helperText: "The day it must be done by; past dates cannot be chosen.", type: "date", required: true, props: { minDate: new Date().toISOString().slice(0, 10) } },
      /*
       * Where the work sits, asked rather than read off the assignee: a task crosses those lines
       * often enough that reading them off the person would file it under the wrong one. Both are
       * closed lists from the studio's own master data, and both are required - a task nobody said
       * a department for is a row that every reading by department has to leave out.
       */
      { name: "department", label: "Department", helperText: "The department this work belongs to, used to sort and report tasks.", type: "select", required: true, options: "departments", placeholder: "Select a department", props: { searchable: true } },
      { name: "branch", label: "Branch", helperText: "The branch this work belongs to, used to sort and report tasks.", type: "select", required: true, options: "branches", placeholder: "Select a branch", props: { searchable: true } },
    ],
  },
  {
    id: "the-task",
    title: "The Task",
    fields: [
      { name: "title", label: "Task Title", helperText: "One short line naming the task, shown in lists and notifications.", type: "text", required: true, placeholder: "e.g. Send the Sharma wedding album for review", colSpan: 2 },
      { name: "description", label: "Detailed Description", helperText: "What needs doing, what is needed for it and what finished looks like.", type: "textarea", required: true, placeholder: "What needs doing, anything needed to do it, and what finished looks like.", props: { rows: 8 }, colSpan: 2 },
    ],
  },
];

/**
 * An existing task, as the form holds it - for correcting one and for duplicating one.
 *
 * Beside `emptyTaskValues` and naming the same fields, so the two cannot drift: a field added to a
 * task has to appear in both or a duplicate quietly drops it.
 *
 * `dueOn` is trimmed to the day. It comes back as a full timestamp and the date input takes
 * `YYYY-MM-DD` only - handed the whole thing it shows nothing at all, which on a field that is now
 * required reads as a form that lost the value.
 *
 * The assignee is carried because a duplicate starts from the same person, and an edit does not
 * offer the field at all - reassigning is its own verb.
 */
export const taskFormValues = (task = {}) => ({
  assignedToUserId: task.assignedToUserId ? String(task.assignedToUserId) : "",
  taskType: task.taskType || "",
  taskTypeOther: task.taskTypeOther || "",
  priority: task.priority || "MEDIUM",
  department: task.department || "",
  branch: task.branch || "",
  dueOn: String(task.dueOn || "").slice(0, 10),
  title: task.title || "",
  description: task.description || "",
});

/** A new, empty task as the form opens it. Medium priority because most tasks are. */
export const emptyTaskValues = () => ({
  assignedToUserId: "",
  taskType: "",
  taskTypeOther: "",
  priority: "MEDIUM",
  department: "",
  branch: "",
  dueOn: "",
  title: "",
  description: "",
});

/** What each activity row is called on screen. The keys are the server's `action` values. */
export const ACTIVITY_LABELS = {
  CREATED: "Task created",
  ASSIGNED: "Task assigned",
  STATUS_CHANGED: "Status changed",
  COMPLETED: "Task completed",
  SUBMITTED: "Finished & sent back",
  REVOKED: "Task revoked",
  REASSIGNED: "Task reassigned",
  // Kept for the tasks rolled back before reassigning replaced it: the history says what happened
  // at the time, in the words it happened in, and rewriting it would be a lie about the record.
  REVERTED: "Task rolled back",
  CANCELLED: "Task cancelled",
  // A file arriving or leaving is logged like anything else that happens to a task: the detail is
  // the file's name, so the history says which one.
  ATTACHED: "File attached",
  ATTACHMENT_REMOVED: "File removed",
};

export const activityLabel = (action) => ACTIVITY_LABELS[action] || action;

/** The dot beside an activity row, so the history reads at a glance the way the status column does. */
export const activityStyles = {
  ATTACHED: "bg-blue-500",
  ATTACHMENT_REMOVED: "bg-slate-400",
  CREATED: "bg-slate-400",
  ASSIGNED: "bg-blue-500",
  STATUS_CHANGED: "bg-blue-500",
  COMPLETED: "bg-emerald-500",
  SUBMITTED: "bg-teal-500",
  REVOKED: "bg-rose-500",
  REASSIGNED: "bg-violet-500",
  REVERTED: "bg-rose-500",
  CANCELLED: "bg-slate-400",
};
