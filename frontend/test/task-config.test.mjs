import test from "node:test";
import assert from "node:assert/strict";

import {
  ALL_STATUSES,
  CLOSED_TASK_STATUSES,
  DEFAULT_TASK_VIEW,
  FILTERABLE_STATUSES,
  PRIORITY_LABELS,
  STATUS_LABELS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_STATUS_FILTERS,
  OTHER_TASK_TYPE,
  TASK_TYPES,
  TASK_VIEWS,
  activityLabel,
  emptyTaskValues,
  statusLabel,
  taskDefaultHiddenColumns,
  taskFormSections,
  taskInfoSections,
  taskIsClosed,
  taskStatusStyles,
  taskTableFields,
  taskTypeIsOther,
} from "../src/constants/taskConfig.js";

/*
 * The Tasks screen is drawn entirely from this file, and its failure mode is quiet: a status the
 * server sends and this file does not name filters to an empty table with nothing on screen to say
 * why, and a column keyed on a field the API never returns is a column of dashes.
 *
 * So the assertions below are mostly about agreement - with the server's vocabulary, and between
 * the parts of this file that have to describe the same record.
 */

/** The values `backend/src/modules/hrm/tasks/service.js` stores. Kept in step by hand, so asserted. */
const SERVER_STATUSES = ["PENDING", "IN_PROGRESS", "COMPLETED", "REASSIGNED", "CANCELLED"];
const SERVER_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const SERVER_TASK_TYPES = ["Client", "Internal", "Administrative", "Follow Up", "Escalation", "Other"];

test("the statuses, priorities and types are the ones the server stores", () => {
  assert.deepEqual(TASK_STATUSES, SERVER_STATUSES);
  assert.deepEqual(TASK_PRIORITIES, SERVER_PRIORITIES);
  assert.deepEqual(TASK_TYPES, SERVER_TASK_TYPES);
});

test("every status and priority has a label, so none reads as its raw key on screen", () => {
  for (const status of TASK_STATUSES) {
    assert.ok(STATUS_LABELS[status], `${status} has no label`);
    assert.notEqual(STATUS_LABELS[status], status.toUpperCase(), `${status} still reads as its key`);
  }
  for (const priority of TASK_PRIORITIES) assert.ok(PRIORITY_LABELS[priority], `${priority} has no label`);
});

test("every status has a colour, keyed on the label the table cell actually receives", () => {
  // The status column reads `statusLabel`, not `status`, so the style map has to be keyed on the
  // label — keyed on the raw value every dot would silently fall back to grey.
  for (const status of TASK_STATUSES) {
    assert.ok(taskStatusStyles[STATUS_LABELS[status]], `${STATUS_LABELS[status]} has no dot colour`);
  }
});

test("the status filter offers All plus the statuses worth filtering by", () => {
  assert.equal(TASK_STATUS_FILTERS[0].id, ALL_STATUSES);
  assert.notEqual(ALL_STATUSES, "", "All needs a real id: it is a React key and an aria-selected test");
  assert.deepEqual(TASK_STATUS_FILTERS.slice(1).map((filter) => filter.id), FILTERABLE_STATUSES);
  assert.equal(TASK_STATUS_FILTERS.length, FILTERABLE_STATUSES.length + 1);
});

/*
 * Every status now has a tab, Cancelled included.
 *
 * It was the one held back, on the reading that a cancelled task is over and has nothing owing on
 * it. That was true of the task and wrong about the reader: calling a task off is the one thing only
 * the person who set it can do, and they are exactly who wants to see what they have called off.
 */
test("every status the server can return has a tab of its own", () => {
  for (const status of TASK_STATUSES) {
    assert.ok(FILTERABLE_STATUSES.includes(status), `${status} must be filterable`);
    assert.ok(TASK_STATUS_FILTERS.some((filter) => filter.id === status), `${status} must have a tab`);
  }
  // Plus All, which is not a status.
  assert.equal(TASK_STATUS_FILTERS.length, TASK_STATUSES.length + 1);
});

test("every status reads and colours, so none shows as a grey blank", () => {
  for (const status of TASK_STATUSES) {
    assert.ok(STATUS_LABELS[status], `${status} has no label`);
    assert.ok(taskStatusStyles[STATUS_LABELS[status]], `${STATUS_LABELS[status]} has no dot colour`);
  }
});

test("the bar reads All Tasks, My Tasks, Tasks Given, and only the first is gated", () => {
  assert.deepEqual(TASK_VIEWS.map((view) => view.id), ["all", "mine", "given"]);
  // All Tasks is a separate permission on a separate endpoint; the tab is dropped without it.
  assert.deepEqual(TASK_VIEWS[0].permission, { module: "HRM", feature: "All Tasks" });
  assert.equal(TASK_VIEWS[1].permission, undefined);
  assert.equal(TASK_VIEWS[2].permission, undefined);
});

test("the screen opens on a view every role has, not on the first tab", () => {
  // All Tasks leads the bar but most roles do not hold it: opening there would land them on a tab
  // that is not even listed for them.
  assert.equal(DEFAULT_TASK_VIEW, "mine");
  const fallback = TASK_VIEWS.find((view) => view.id === DEFAULT_TASK_VIEW);
  assert.ok(fallback, "the default view must be one of the views");
  assert.equal(fallback.permission, undefined, "the default view must need no permission of its own");
});

test("every view says what an empty one means, so no list reads as a failure", () => {
  for (const view of TASK_VIEWS) assert.ok(view.emptyMessage, `${view.id} has no empty message`);
});

/*
 * The columns the task list is asked for in the brief: an id, a type, both people, a priority, a
 * title, a status, and the four dates. Asserted by name because a column quietly dropped in an edit
 * is the kind of thing nobody notices until somebody asks where the due date went.
 */
test("the table carries every column the list is meant to show", () => {
  const keys = taskTableFields.map(([key]) => key);
  for (const expected of [
    // `taskTypeLabel`, not `taskType`: the column shows what an "Other" task actually was, which
    // the bare stored type does not carry.
    "taskCode", "taskTypeLabel", "assignedToName", "assignedByName",
    "priorityLabel", "title", "statusLabel", "createdAt", "dueOn", "completedAt", "updatedAt",
  ]) {
    assert.ok(keys.includes(expected), `the table is missing ${expected}`);
  }
});

test("the date columns are typed as dates, so they sort and export as dates rather than strings", () => {
  for (const [key, , type] of taskTableFields) {
    if (["createdAt", "dueOn", "completedAt", "updatedAt"].includes(key)) {
      assert.equal(type, "date", `${key} is not typed as a date`);
    }
  }
});

test("the status column is the one typed as a status, so it gets its coloured dot", () => {
  const status = taskTableFields.find(([key]) => key === "statusLabel");
  assert.equal(status[2], "status");
});

test("the columns hidden by default are real columns, not names that have drifted", () => {
  const keys = taskTableFields.map(([key]) => key);
  for (const hidden of taskDefaultHiddenColumns) assert.ok(keys.includes(hidden), `${hidden} is hidden but is not a column`);
  // Hiding everything would leave a table of serial numbers.
  assert.ok(taskDefaultHiddenColumns.length < keys.length);
});

test("the info panel accounts for the reassignment and both closing dates", () => {
  const fields = taskInfoSections.flatMap((section) => section.fields.map(([key]) => key));
  // The reason a task changed hands is the whole point of a reassignment, and who it came from is
  // what the person now holding it needs; both must be readable somewhere.
  for (const expected of ["reassignReason", "reassignedFromName", "reassignedAt", "cancelledAt", "completedByName", "description"]) {
    assert.ok(fields.includes(expected), `the info panel never shows ${expected}`);
  }
});

test("a status with no label falls back to something readable rather than to undefined", () => {
  assert.equal(statusLabel("IN_PROGRESS"), "In Progress");
  assert.equal(statusLabel("SOMETHING_NEW"), "SOMETHING_NEW");
  assert.equal(statusLabel(null), "—");
});

test("the reassignment wording says the same thing everywhere", () => {
  // One word for one action. The status, the field labels and the activity line all say reassigned,
  // so a screen never reads as two different things happening to one task.
  const fields = taskInfoSections.flatMap((section) => section.fields.map(([key, label]) => [key, label]));
  assert.equal(fields.find(([key]) => key === "reassignReason")[1], "Reason Reassigned");
  assert.equal(fields.find(([key]) => key === "reassignedAt")[1], "Reassigned");
  assert.equal(fields.find(([key]) => key === "reassignedFromName")[1], "Reassigned From");
  assert.equal(STATUS_LABELS.REASSIGNED, "Reassigned");
  assert.equal(activityLabel("REASSIGNED"), "Task reassigned");
});

test("the rolled-back wording survives for the tasks it already happened to", () => {
  // Reassigning replaced rolling back, and the history of a task that was rolled back still says so
  // in the words it was written in. Rewriting it would be a lie about the record.
  assert.equal(activityLabel("REVERTED"), "Task rolled back");
});

test("every activity the server writes reads as a sentence", () => {
  for (const action of ["CREATED", "ASSIGNED", "STATUS_CHANGED", "COMPLETED", "REASSIGNED", "REVERTED", "CANCELLED"]) {
    assert.ok(activityLabel(action), `${action} has no label`);
    assert.notEqual(activityLabel(action), action, `${action} still reads as its key`);
  }
  // An action added on the server before it is named here shows as itself, not as blank.
  assert.equal(activityLabel("SOMETHING_NEW"), "SOMETHING_NEW");
});

/*
 * "Other" is the one type that does not describe itself, so the form asks what it was. The three
 * assertions below are the three ways that quietly stops working: the box never appears, it appears
 * and is optional, or it keeps a value from a type that has since been changed.
 */
const formFields = taskFormSections.flatMap((section) => section.fields);
const otherField = formFields.find((field) => field.name === "taskTypeOther");
const typeField = formFields.find((field) => field.name === "taskType");

test("Other is on the list, and the form has a box to describe it", () => {
  assert.ok(TASK_TYPES.includes(OTHER_TASK_TYPE), "Other is not one of the task types");
  assert.ok(otherField, "the form has no box for what an Other task was");
  assert.ok(emptyTaskValues().taskTypeOther === "", "a new task must start with the box empty");
});

test("the box is shown for Other alone, and is required once it is", () => {
  assert.ok(taskTypeIsOther({ taskType: OTHER_TASK_TYPE }), "Other must ask for a description");
  for (const type of TASK_TYPES.filter((each) => each !== OTHER_TASK_TYPE)) {
    assert.ok(!taskTypeIsOther({ taskType: type }), `${type} names itself and must not ask`);
  }
  assert.equal(otherField.when, taskTypeIsOther, "the box must be gated on the same test");
  assert.ok(otherField.required, "a bare Other says nothing, so the box is required");
});

test("changing the type empties the box, so no detail is stored under a type that never showed it", () => {
  assert.ok((typeField.clears || []).includes("taskTypeOther"), "taskType does not clear taskTypeOther");
});

/*
 * Department and Branch: where in the studio a task sits.
 *
 * They are the task's own answer rather than the assignee's, so what is worth holding is that the
 * form actually asks for both, that neither can be skipped, and that the three places a task is
 * read - the form, the table and the info panel - all know about them. A field added to only two
 * of the three is the failure this catches: it would be typed in and then never seen again.
 */

const formFieldNames = taskFormSections.flatMap((section) => section.fields.map((field) => field.name));
const tableKeys = taskTableFields.map(([key]) => key);
const infoKeys = taskInfoSections.flatMap((section) => section.fields.map(([key]) => key));

test("a task is asked which department and which branch it is for", () => {
  // The options key is named rather than pluralised from the field, because the two must match the
  // keys the options endpoint actually sends and "branchs" is what guessing produces.
  for (const [name, optionsKey] of [["department", "departments"], ["branch", "branches"]]) {
    const field = taskFormSections.flatMap((section) => section.fields).find((item) => item.name === name);
    assert.ok(field, `the form should ask for ${name}`);
    // Closed lists from the studio's master data, keyed into `context.options` - not free text,
    // which would leave "Erode", "erode" and "Erode Branch" as three branches in the same list.
    assert.equal(field.type, "select");
    assert.equal(field.required, true);
    assert.equal(field.options, optionsKey);
  }
});

test("both are on the form a new task opens with, so their inputs stay controlled", () => {
  const empty = emptyTaskValues();
  assert.equal(empty.department, "");
  assert.equal(empty.branch, "");
  // Every field the form asks for has a key here, or React swaps that input from uncontrolled to
  // controlled on the first keystroke.
  for (const name of formFieldNames) assert.ok(name in empty, `${name} should start empty`);
});

test("what is typed in is read back: both reach the table and the info panel", () => {
  for (const key of ["department", "branch"]) {
    assert.ok(tableKeys.includes(key), `${key} should be a column`);
    assert.ok(infoKeys.includes(key), `${key} should be in the info panel`);
  }
});

test("neither is hidden by default - they are the reason the columns were added", () => {
  for (const key of ["department", "branch"]) {
    assert.ok(!taskDefaultHiddenColumns.includes(key), `${key} should open visible`);
  }
});

/*
 * When a task is over, and what the screen does about it.
 *
 * The detail panel closes on a verb that ends the task, so this list decides whether pressing
 * "Mark Complete" leaves the reader on the list they were working through or staring at a finished
 * record with an empty footer. It mirrors `CLOSED_STATUSES` in the module, which is what the server
 * refuses every further verb with - the two disagreeing would leave a panel open over a task
 * nothing can be done to, which is exactly what a confirmation that "did nothing" looked like.
 */

test("the two states a task is over in are the server's two", () => {
  // Reassigned is deliberately not one of them: the task has landed on somebody new and is waiting
  // to be picked up, so it must stay startable. Were it closed the new holder could do nothing.
  assert.deepEqual(CLOSED_TASK_STATUSES, ["COMPLETED", "CANCELLED"]);
  assert.equal(taskIsClosed({ status: "REASSIGNED" }), false);
  // And every one of them is a status the screen otherwise knows about.
  for (const status of CLOSED_TASK_STATUSES) assert.ok(TASK_STATUSES.includes(status), status);
});

test("a task still being worked is not closed", () => {
  assert.equal(taskIsClosed({ status: "PENDING" }), false);
  assert.equal(taskIsClosed({ status: "IN_PROGRESS" }), false);
  // Starting a task is the one verb that does not finish it, which is why the panel stays open for
  // it - Mark Complete has just appeared in the same footer.
  for (const status of CLOSED_TASK_STATUSES) assert.equal(taskIsClosed({ status }), true, status);
});

test("a task that is not there at all is not treated as finished", () => {
  // `afterChange` reads this off whatever the server handed back; nothing is not a task that ended.
  assert.equal(taskIsClosed(null), false);
  assert.equal(taskIsClosed(undefined), false);
  assert.equal(taskIsClosed({}), false);
});
