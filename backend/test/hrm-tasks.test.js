const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { refusalFor, canRead, statusLabel, nameOf, taskTypeLabel, STATUSES, PRIORITIES, CLOSED_STATUSES, TASK_TYPES, OTHER_TASK_TYPE } = require("../src/modules/hrm/tasks/service");

const serviceSource = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "tasks", "service.js"), "utf8");

/** One function's body, so a rule can be asserted where it is actually written. */
function functionBody(name) {
  const start = serviceSource.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} was not found in the task service`);
  const end = serviceSource.indexOf("\n}\n", start);
  assert.notEqual(end, -1, `the end of ${name} was not found`);
  return serviceSource.slice(start, end);
}

/*
 * Who may do what to a task.
 *
 * This is the whole access model of the module and the place a mistake would be least visible: four
 * verbs, two people and five states, and every answer is a sentence somebody reads when they are
 * refused. It is asserted directly rather than through a request, because the route's permission
 * guard answers a different question - may you be on this screen at all - and cannot catch a task
 * being completed by the person who set it.
 */

const GIVER = 1;
const RECEIVER = 2;
const BYSTANDER = 3;

const task = (overrides = {}) => ({
  id: 10,
  taskCode: "TSK-000010",
  status: "PENDING",
  assignedToUserId: RECEIVER,
  assignedByUserId: GIVER,
  ...overrides,
});

test("the six states a task can be in, and the two it is over in", () => {
  // SUBMITTED is Finish & Send Back: open, waiting for whoever assigned it.
  assert.deepEqual(STATUSES, ["PENDING", "IN_PROGRESS", "SUBMITTED", "COMPLETED", "REASSIGNED", "CANCELLED"]);
  /*
   * REASSIGNED is open, where the REVERTED it replaced was closed, and that is the difference the
   * whole feature turns on: a rolled-back task was finished — it had gone back to whoever set it and
   * stopped — while a reassigned one has landed on somebody new and is waiting to be picked up. Were
   * it closed, the person it was just handed to could do nothing with it at all.
   */
  assert.deepEqual(CLOSED_STATUSES, ["COMPLETED", "CANCELLED"]);
  assert.deepEqual(PRIORITIES, ["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
});

test("the holder may start or reassign a task nobody has picked up yet", () => {
  for (const action of ["start", "reassign"]) {
    assert.equal(refusalFor(task(), action, RECEIVER), null, `the holder should be able to ${action}`);
  }
});

/*
 * A reassigned task is startable, and this is the case that would be quietly wrong.
 *
 * The status check used to read "must be PENDING". A task handed to somebody new arrives as
 * REASSIGNED, and under that rule they could not start it — nor complete it, since completing
 * requires having started. The work would have been unstartable by anybody, with no error that
 * pointed at why.
 */
test("a task just handed to somebody can be started by them", () => {
  const handedOver = task({ status: "REASSIGNED" });
  assert.equal(refusalFor(handedOver, "start", RECEIVER), null);
  // And passed on again, which is what "and so on" means: a chain has no length limit.
  assert.equal(refusalFor(handedOver, "reassign", RECEIVER), null);
});

/*
 * Completing means starting first.
 *
 * A task that jumps from Pending straight to Completed says nobody ever picked it up, which leaves
 * the person who set it with no moment where they could see it being worked on - the one thing
 * Tasks Given exists to show.
 */
test("a task cannot be completed before it has been started", () => {
  assert.match(refusalFor(task({ status: "PENDING" }), "complete", RECEIVER), /start this task/i);
  assert.equal(refusalFor(task({ status: "IN_PROGRESS" }), "complete", RECEIVER), null);
});

test("reassigning needs no start: work you cannot do is handed on straight away", () => {
  assert.equal(refusalFor(task({ status: "PENDING" }), "reassign", RECEIVER), null);
  assert.equal(refusalFor(task({ status: "IN_PROGRESS" }), "reassign", RECEIVER), null);
});

test("the person who gave the task cannot complete it themselves", () => {
  // The one that matters most: a giver marking their own request done would close the loop with
  // nobody having done the work, and no permission level can be set to prevent it.
  //
  // Asserted on an IN_PROGRESS task so the refusal is about ownership rather than about the task
  // not having been started - on a PENDING one both rules apply and this would pass either way.
  const started = task({ status: "IN_PROGRESS" });
  assert.match(refusalFor(started, "complete", GIVER), /assigned to/i);
  // Reassigning is the holder's too. The giver moving work between people without the holder
  // knowing is a different act, and not one this verb is.
  assert.match(refusalFor(started, "reassign", GIVER), /assigned to/i);
  assert.match(refusalFor(task(), "start", GIVER), /assigned to/i);
});

test("a Super Admin may reassign any open task, and nothing else of the holder's", () => {
  // A bystander to the task - neither its giver nor its holder - who is a Super Admin.
  assert.equal(refusalFor(task(), "reassign", BYSTANDER, "SUPER_ADMIN"), null);
  assert.equal(refusalFor(task({ status: "IN_PROGRESS" }), "reassign", BYSTANDER, "SUPER_ADMIN"), null);
  for (const status of CLOSED_STATUSES) {
    assert.match(refusalFor(task({ status }), "reassign", BYSTANDER, "SUPER_ADMIN"), /cannot be changed/i, `a ${status} task stays where it is`);
  }
  // Starting and completing are about doing the work, so they stay the holder's.
  assert.match(refusalFor(task(), "start", BYSTANDER, "SUPER_ADMIN"), /assigned to/i);
  assert.match(refusalFor(task({ status: "IN_PROGRESS" }), "complete", BYSTANDER, "SUPER_ADMIN"), /assigned to/i);
  // And no other role gets it: an administrator who is not Super Admin is still a bystander.
  assert.match(refusalFor(task(), "reassign", BYSTANDER, "ADMIN"), /assigned to/i);
});

test("a reassignment names the holder it came from, and who moved it when that was somebody else", () => {
  const start = serviceSource.indexOf('} else if (action === "reassign") {');
  const branch = serviceSource.slice(start, serviceSource.indexOf('} else if (action === "resolve") {', start));
  assert.match(branch, /reassignedFromUserId: task\.assignedToUserId \|\| actor\.id \|\| null,/);
  assert.match(branch, /reassignedFromName: fromName,/);
  assert.match(branch, /`Reassigned from \$\{fromName\} to \$\{nextName\}\$\{byAnother \? ` by \$\{actorName\}` : ""\}\. Reason: \$\{why\}`/);
  // The person it was taken from is told.
  assert.match(branch, /title: `Task moved off you: \$\{task\.title\}`/);
  // The menu and the write path ask the same question with the same role.
  assert.match(serviceSource, /canReassign: refusalFor\(task, "reassign", viewerId, viewerRole\) === null,/);
  assert.match(serviceSource, /const refusal = refusalFor\(task, action, actor\.id, actor\.role\);/);
});

test("somebody who is neither side of the task may do nothing to it", () => {
  for (const action of ["start", "complete", "reassign", "cancel", "delete"]) {
    assert.notEqual(refusalFor(task(), action, BYSTANDER), null, `a bystander should be refused ${action}`);
    assert.notEqual(refusalFor(task({ status: "IN_PROGRESS" }), action, BYSTANDER), null, `a bystander should be refused ${action} once started`);
  }
});

test("only the giver may cancel, and never the receiver", () => {
  assert.equal(refusalFor(task(), "cancel", GIVER), null);
  assert.match(refusalFor(task(), "cancel", RECEIVER), /gave this task/i);
});

/*
 * ── Deleting ──────────────────────────────────────────────────────────────────────────────────
 *
 * The fifth verb, and the only one a role widens. It is the giver's, as cancelling is, and a Super
 * Admin's as well - which is the one place in this module where who you are counts for more than
 * where you stand on the task. Everything else stays ownership: a Super Admin has no more business
 * marking somebody else's task done than anyone else does.
 */
test("the giver may delete their own task, and a Super Admin may delete anybody's", () => {
  assert.equal(refusalFor(task(), "delete", GIVER), null);
  assert.equal(refusalFor(task(), "delete", BYSTANDER, "SUPER_ADMIN"), null);
  // Trimmed and case-insensitive, because the role arrives from a token rather than from a literal.
  assert.equal(refusalFor(task(), "delete", BYSTANDER, " super_admin "), null);
});

test("the holder cannot delete the task they were given, whatever they have been asked to do", () => {
  assert.match(refusalFor(task(), "delete", RECEIVER), /gave this task|Super Admin/i);
  assert.notEqual(refusalFor(task({ status: "IN_PROGRESS" }), "delete", RECEIVER), null);
  // A bystander with no role named is refused: an absent role must never read as a privileged one.
  assert.notEqual(refusalFor(task(), "delete", BYSTANDER), null);
  assert.notEqual(refusalFor(task(), "delete", BYSTANDER, ""), null);
  assert.notEqual(refusalFor(task(), "delete", BYSTANDER, "ADMIN"), null);
});

/*
 * Deleting is the one verb no status gates, and that is deliberate. A task is deleted because it
 * should not exist - a duplicate, a test row, one typed against the wrong person - which is as true
 * of one somebody has already started as of one nobody has touched. Cancelling remains the way to
 * call off work that was real.
 */
test("a task can be deleted whatever state it is in", () => {
  for (const status of STATUSES) {
    assert.equal(refusalFor(task({ status }), "delete", GIVER), null, `${status} should still be deletable`);
  }
});

test("a task already deleted cannot be deleted again", () => {
  const gone = task({ deletedAt: new Date() });
  assert.match(refusalFor(gone, "delete", GIVER), /already been deleted/i);
  assert.match(refusalFor(gone, "delete", BYSTANDER, "SUPER_ADMIN"), /already been deleted/i);
});

/*
 * The role argument may only ever widen `delete`. Were it read by the other four, a Super Admin
 * would silently gain verbs the module's whole access model says belong to the two people on the
 * task - and that would be a role check overruling ownership, which is what this module avoids.
 */
// Deleting and editing, and reassigning since the studio asked for it (see the Super Admin reassign
// test above). Starting, completing and cancelling stay with the task's own two people.
test("the role widens deleting and reassigning, and nothing else", () => {
  for (const action of ["start", "complete", "cancel"]) {
    assert.notEqual(refusalFor(task(), action, BYSTANDER, "SUPER_ADMIN"), null, `SUPER_ADMIN must not be able to ${action}`);
  }
});

test("a task that is over cannot be acted on again, by either of them", () => {
  for (const status of CLOSED_STATUSES) {
    assert.notEqual(refusalFor(task({ status }), "complete", RECEIVER), null, `${status} should refuse a second completion`);
    assert.notEqual(refusalFor(task({ status }), "reassign", RECEIVER), null, `${status} should refuse a reassignment`);
    assert.notEqual(refusalFor(task({ status }), "cancel", GIVER), null, `${status} should refuse a cancellation`);
  }
});

test("the refusal names the state the task is actually in", () => {
  assert.match(refusalFor(task({ status: "COMPLETED" }), "complete", RECEIVER), /already completed/i);
  assert.match(refusalFor(task({ status: "CANCELLED" }), "reassign", RECEIVER), /already cancelled/i);
  assert.match(refusalFor(task({ status: "CANCELLED" }), "cancel", GIVER), /already cancelled/i);
});

test("a task already under way cannot be started twice, but can still be finished", () => {
  assert.match(refusalFor(task({ status: "IN_PROGRESS" }), "start", RECEIVER), /already been started/i);
  assert.equal(refusalFor(task({ status: "IN_PROGRESS" }), "complete", RECEIVER), null);
  // Completing is exactly what a started task is for; the refusal above is only about starting twice.
  assert.equal(refusalFor(task({ status: "IN_PROGRESS" }), "reassign", RECEIVER), null);
  assert.equal(refusalFor(task({ status: "IN_PROGRESS" }), "cancel", GIVER), null);
});

/*
 * A deleted login leaves its id null on the task while the name stays. Nothing may then be done in
 * that person's place: a null id must never match a null viewer, or a request carrying no user
 * would answer as the missing party.
 */
test("a task whose giver has been deleted cannot be cancelled by nobody", () => {
  const orphan = task({ assignedByUserId: null });
  assert.notEqual(refusalFor(orphan, "cancel", null), null);
  assert.notEqual(refusalFor(orphan, "cancel", undefined), null);
  assert.notEqual(refusalFor(orphan, "cancel", GIVER), null);
});

test("a task whose receiver has been deleted cannot be completed by nobody", () => {
  const orphan = task({ assignedToUserId: null });
  assert.notEqual(refusalFor(orphan, "complete", null), null);
  assert.notEqual(refusalFor(orphan, "complete", undefined), null);
});

/*
 * Reading is wider than acting: both sides of a task always, and anybody holding HRM / All Tasks.
 */
test("both people on a task may read it, and nobody else without All Tasks", () => {
  assert.equal(canRead(task(), RECEIVER), true);
  assert.equal(canRead(task(), GIVER), true);
  assert.equal(canRead(task(), BYSTANDER), false);
  assert.equal(canRead(task(), BYSTANDER, true), true, "All Tasks opens the whole studio's list");
});

test("reading is not acting: All Tasks does not let a supervisor complete somebody's task", () => {
  // `canRead` is the only thing the permission widens; `refusalFor` never takes it.
  assert.notEqual(refusalFor(task(), "complete", BYSTANDER), null);
});

test("an unknown action is refused rather than falling through to the holder's verbs", () => {
  // A verb added to a route and forgotten in `refusalFor` must not be permitted by default.
  assert.notEqual(refusalFor(task(), "delegate", RECEIVER), null);
  assert.notEqual(refusalFor(task(), "", RECEIVER), null);
});

test("a status reads as a person would say it", () => {
  assert.equal(statusLabel("IN_PROGRESS"), "In Progress");
  assert.equal(statusLabel("PENDING"), "Pending");
  // An unmapped value is returned as it is rather than becoming "undefined" on screen.
  assert.equal(statusLabel("SOMETHING_ELSE"), "SOMETHING_ELSE");
});

test("a login is named by its name, then its username, then its email", () => {
  assert.equal(nameOf({ id: 4, name: "Asha", username: "asha", email: "a@b.c" }), "Asha");
  assert.equal(nameOf({ id: 4, username: "asha", email: "a@b.c" }), "asha");
  assert.equal(nameOf({ id: 4, email: "a@b.c" }), "a@b.c");
  // Never blank: an activity row and a task both store the name as NOT NULL.
  assert.equal(nameOf({ id: 4 }), "User 4");
  assert.equal(nameOf(null), "User ?");
});

/*
 * "Other" is the one type that carries no meaning on its own, so a task given that type is asked
 * what it actually was and the label is what the list shows. Asserted here because the failure is
 * a column of tasks all reading "Other", which is the state the field exists to prevent.
 */
test("Other is a type, and the only one that asks what it was", () => {
  assert.ok(TASK_TYPES.includes(OTHER_TASK_TYPE));
  assert.equal(OTHER_TASK_TYPE, "Other");
});

test("the label carries what an Other task was, and leaves every named type alone", () => {
  assert.equal(
    taskTypeLabel({ taskType: "Other", taskTypeOther: "Vendor coordination" }),
    "Other — Vendor coordination",
  );
  // A named type never shows the column anything but itself, even if a detail somehow survived.
  assert.equal(taskTypeLabel({ taskType: "Client", taskTypeOther: "leftover" }), "Client");
  // An Other with nothing typed still reads as something rather than as "Other — undefined".
  assert.equal(taskTypeLabel({ taskType: "Other", taskTypeOther: null }), "Other");
});

/*
 * Department and Branch: where in the studio a task sits.
 *
 * Both are the task's own answer rather than the assignee's, and both are required - a task nobody
 * said a department for is a row every reading by department has to leave out, and it cannot be
 * filled in afterwards because a task is never edited. Asserted against the schema the route parses
 * with, because the form is not the only caller and a field required on screen alone is not
 * required at all.
 */

const { createSchema } = require("../src/modules/hrm/tasks/controller");

const submission = (overrides = {}) => ({
  assignedToUserId: 2,
  title: "Send the Sharma album for review",
  description: "Second edit, colour graded, ready for the client call on Friday.",
  taskType: "Client",
  priority: "HIGH",
  department: "Post Production",
  branch: "Erode",
  // Required, as of the studio's decision that a task with no due date is in nobody's "due this
  // week" and is chased by nothing - it sits in the list being neither done nor overdue.
  dueOn: "2026-09-25",
  ...overrides,
});

test("a task has to say when it is due", async () => {
  const parsed = await createSchema.parseAsync(submission());
  assert.equal(parsed.dueOn, "2026-09-25");
  // The form sends "" for a date nobody filled in, so the emptiness is what has to be refused -
  // not just a missing key.
  for (const value of ["", "   ", undefined]) {
    const result = await createSchema.safeParseAsync(submission({ dueOn: value }));
    assert.equal(result.success, false, JSON.stringify(value));
  }
});

test("a task records the department and branch it was filed under", async () => {
  // `parseAsync` throughout: the task type is checked against the list the studio maintains, and a
  // synchronous parse cannot run a refinement that awaits - it reports every value as invalid.
  const parsed = await createSchema.parseAsync(submission());
  assert.equal(parsed.department, "Post Production");
  assert.equal(parsed.branch, "Erode");
});

test("neither may be left out, and neither may be blank", async () => {
  for (const field of ["department", "branch"]) {
    for (const value of [undefined, "", "   "]) {
      const parsed = await createSchema.safeParseAsync(submission({ [field]: value }));
      assert.equal(parsed.success, false, `${field} of ${JSON.stringify(value)} should be refused`);
    }
  }
});

test("both are trimmed, so a stray space cannot make a second copy of a branch", async () => {
  // "Erode " and "Erode" filed as two branches is exactly what a list grouped by branch cannot
  // recover from, and it is invisible on screen.
  const parsed = await createSchema.parseAsync(submission({ department: "  Post Production  ", branch: " Erode " }));
  assert.equal(parsed.department, "Post Production");
  assert.equal(parsed.branch, "Erode");
});

test("neither can be longer than the column that stores it", async () => {
  for (const field of ["department", "branch"]) {
    assert.equal((await createSchema.safeParseAsync(submission({ [field]: "x".repeat(121) }))).success, false);
  }
});

/*
 * ── The id a task wears, and the delete that hides it ─────────────────────────────────────────
 */

test("a task id reads DBS-TK-00001, like every other business id the studio mints", () => {
  const body = functionBody("nextTaskCode");
  assert.match(serviceSource, /TASK_CODE_PREFIX = "DBS-TK-"/, "the prefix is the studio's own");
  // Five digits, which is what was asked for. Nothing breaks at 100,000 - the number grows a digit,
  // because the code is read and matched as text and never parsed back into one.
  assert.match(body, /padStart\(5, "0"\)/, "the counter is padded to five digits");
  // The old shape may still be *named* in a comment explaining the change; what must not exist is
  // code that mints one.
  assert.ok(!/`TSK-\$\{/.test(serviceSource), "no task should still be minted under the old shape");
});

/*
 * Deleting is a column, not a `DELETE`, so "it is gone" is a promise every read has to keep on its
 * own. A single query that forgets it is not a small bug: it is a deleted task reappearing in one
 * list while it is absent from the others, which reads as the delete having half worked.
 */
test("every way into a task narrows by deleted_at", () => {
  for (const name of ["listTasks", "getTask", "transition", "taskForAttachment", "deleteTask"]) {
    assert.match(functionBody(name), /deletedAt: null/, `${name} must not read a deleted task`);
  }
});

test("deleting writes the stamp, logs who did it, and clears the bell of that task", () => {
  const body = functionBody("deleteTask");
  assert.match(body, /data: \{ deletedAt: new Date\(\) \}/, "the delete is a stamp on the row, not a removal");
  assert.ok(!/hrmTask\.delete\b/.test(body), "the row must survive, with its holders, history and files");
  assert.match(body, /ACTIONS\.DELETED/, "who deleted it is written into the task's own history");
  /*
   * A notice carries a link to the task, and the task now answers 404 to everybody - so a row left
   * in somebody's bell would open onto nothing for as long as the feed showed it.
   */
  assert.match(body, /notification\.deleteMany/, "notices about a deleted task are cleared with it");
  assert.match(body, /prisma\.\$transaction/, "there can be no deleted task with no record of who deleted it");
});

/*
 * ── Correcting a task, and copying one ───────────────────────────────────────────────────────
 *
 * A task is written down in a hurry and is regularly written down slightly wrong. Until now the
 * only answers were to delete it and raise it again - losing its history, its attachments and its
 * holder chain - or to leave it wrong.
 *
 * Editing is the giver's and a Super Admin's, on the same reasoning delete already follows: the
 * person who wrote a task down is the one who can say it was written down wrong. The receiver is
 * deliberately not among them - they act on a task through start, complete and reassign, and
 * letting them rewrite the title or the due date would let somebody restate the job they were
 * given.
 */
const { refusalFor: taskRefusal } = require("../src/modules/hrm/tasks/service");
const { updateSchema } = require("../src/modules/hrm/tasks/controller");

const editable = (over = {}) => ({ taskCode: "DBS-TK-00042", assignedByUserId: 7, assignedToUserId: 9, deletedAt: null, status: "PENDING", ...over });

test("editing belongs to the giver, and to a Super Admin", () => {
  assert.equal(taskRefusal(editable(), "edit", 7), null, "the giver cannot edit their own task");
  assert.equal(taskRefusal(editable(), "edit", 1, "SUPER_ADMIN"), null, "a Super Admin cannot edit");
  // Trimmed and case-insensitive, the way the delete beside it reads the role.
  assert.equal(taskRefusal(editable(), "edit", 1, "  super_admin  "), null);
});

test("the receiver cannot rewrite the task they were given", () => {
  const refusal = taskRefusal(editable(), "edit", 9);
  assert.match(refusal, /Only the person who gave this task, or a Super Admin, can edit it\./);
  // Nor can somebody who is on neither side of it.
  assert.match(taskRefusal(editable(), "edit", 99), /Only the person who gave this task/);
});

test("a deleted task is not editable, and a closed one is", () => {
  assert.match(taskRefusal(editable({ deletedAt: new Date() }), "edit", 7), /has been deleted/);
  /*
   * Cancelled and completed stay editable on purpose: correcting the record of something that
   * already happened is exactly when this is wanted, and the four verbs that *do* gate on status
   * are unaffected by it.
   */
  for (const status of ["CANCELLED", "COMPLETED"]) {
    assert.equal(taskRefusal(editable({ status }), "edit", 7), null, status);
  }
});

test("an edit cannot quietly hand the task to somebody else", async () => {
  /*
   * Reassigning is its own verb - it records the hand-over in the holder chain and tells the new
   * holder - so the update schema has no assignee at all. Sent anyway, it is stripped rather than
   * applied, which is what stops an edit being a second, quieter reassign.
   */
  const parsed = await updateSchema.parseAsync({ ...submission(), assignedToUserId: 999 });
  assert.equal(parsed.assignedToUserId, undefined);
  // Everything else a task says about itself is still there to correct.
  for (const field of ["title", "description", "taskType", "priority", "department", "branch", "dueOn"]) {
    assert.ok(parsed[field] !== undefined, `${field} cannot be corrected`);
  }
});

test("an edit asks for a due date, exactly as a create does", async () => {
  assert.equal((await updateSchema.safeParseAsync({ ...submission(), dueOn: "" })).success, false);
});

/*
 * Finish & Send Back, Mark as Completed and Revoke: the holder finishes and sends the task back,
 * and whoever assigned it marks it completed or revokes it - reassigning it to anyone if they like.
 */
test("the holder finishes and sends back; only the assigner marks it completed, and only then", () => {
  assert.equal(refusalFor(task({ status: "IN_PROGRESS" }), "complete", RECEIVER), null);
  assert.equal(refusalFor(task({ status: "SUBMITTED" }), "approve", GIVER), null);
  for (const status of ["PENDING", "IN_PROGRESS"]) {
    assert.match(refusalFor(task({ status, assignedToName: "Receiver" }), "approve", GIVER), /has not finished and sent back/);
  }
  assert.match(refusalFor(task({ status: "SUBMITTED" }), "approve", RECEIVER), /only the person who assigned/i);
  assert.match(refusalFor(task({ status: "SUBMITTED" }), "approve", BYSTANDER), /only the person who assigned/i);
});

test("a task sent back is no longer the holder's to act on", () => {
  for (const action of ["start", "complete", "reassign"]) {
    assert.match(refusalFor(task({ status: "SUBMITTED", assignedByName: "Giver" }), action, RECEIVER), /sent back to Giver/);
  }
});

test("only whoever assigned the task can revoke it, at any point while it is open", () => {
  for (const status of ["PENDING", "IN_PROGRESS", "SUBMITTED"]) {
    assert.equal(refusalFor(task({ status }), "revoke", GIVER), null, `revoke should be open on ${status}`);
  }
  assert.match(refusalFor(task(), "revoke", RECEIVER), /only the person who assigned/i);
  assert.match(refusalFor(task(), "revoke", BYSTANDER), /only the person who assigned/i);
  assert.match(refusalFor(task({ status: "COMPLETED" }), "revoke", GIVER), /already completed/i);
  assert.match(refusalFor(task({ assignedToUserId: GIVER }), "revoke", GIVER), /already with you/i);
});
