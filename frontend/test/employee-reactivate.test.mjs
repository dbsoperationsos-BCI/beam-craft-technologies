import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { isOnboarding, isWorking } from "../src/lib/employmentStatus.mjs";

/*
 * The way out of the InActive tab.
 *
 * The tab could be reached and never left. An offboarding put somebody on Relieved, Fired or
 * Absconded, and the only thing in the codebase that put a status back was `deleteSeparation` -
 * an endpoint no screen has ever called. Somebody on `Long Leave` had no separation at all, so
 * even that would not have helped them.
 *
 * Read from the source, the way the other repository tests here do: there is no DOM in this suite.
 */

const HERE = import.meta.dirname;
const read = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");

const TABLE = read("components", "employees", "EmployeeTable.js");
const PAGE = read("components", "employees", "EmployeeVerificationPage.js");
const DIALOG = read("components", "employees", "EmployeeActionDialog.js");
const SERVICE = read("services", "hrm", "employees.service.js");

/*
 * Every status the InActive tab lists, and the rule the menu entry is drawn by. The entry is gated
 * on `!isWorking`, not on a written-out list of departures, so a status the studio adds in Field
 * Settings and does not mark as working is offered the way back too.
 */
test("everyone the InActive tab holds is somebody the rule offers the entry to", () => {
  for (const employmentStatus of ["Relieved", "Absconded", "Fired", "Long Leave"]) {
    const row = { employmentStatus };
    assert.equal(isWorking(row), false, `${employmentStatus} is being counted as working`);
    assert.equal(isOnboarding(row), false);
  }
});

test("nobody already working here is offered it", () => {
  for (const employmentStatus of ["Active", "in Training", "PIP"]) {
    assert.equal(isWorking({ employmentStatus }), true);
  }
});

// Somebody who has not started has nothing to come back from, and the endpoint refuses them too.
test("a candidate still onboarding is not offered it either", () => {
  for (const employmentStatus of ["HR Onboarding Pending", "Employee Submission Pending"]) {
    assert.equal(isOnboarding({ employmentStatus }), true);
  }
});

/*
 * Start Offboarding, on the other hand, is offered on **every** employee row including those two.
 * It was withheld from them for a while, on the reasoning that there is nothing to offboard
 * somebody from before they have been taken on - but a hire falls through at exactly that point,
 * and the row then sat in an onboarding tab waiting for a submission that was never coming.
 */
/*
 * And on an **invite** row, which is what the onboarding tabs actually hold until a candidate
 * submits: those rows have no employee record behind them, so what the entry does there is the
 * invite's own cancellation. It carries the offboarding name because the decision is the same one -
 * a hire that fell through - and nobody should have to learn that a candidate is "cancelled" while
 * an employee is "offboarded".
 */
test("an invite row offers it too, through the same panel an employee is offboarded with", () => {
  const invite = TABLE.slice(TABLE.indexOf('employee.type === "invite"'), TABLE.indexOf("] : canWrite ? ["));
  assert.match(invite, /label: "Start Offboarding", onSelect: \(\) => onSeparate\(employee\)/);
  // Cancel Invite stays beside it: an invite sent by mistake or to the wrong address is not a
  // departure, and leaves nothing worth keeping.
  assert.match(invite, /label: "Cancel Invite", tone: "danger", onSelect: \(\) => onCancelInvite\(employee\)/);
});

/*
 * What the panel sends. An invite row's `id` is the synthetic `invite:<id>` the repository builds,
 * so it can never be sent as an employee id - the endpoint takes the invite's own id and turns it
 * into a record inside the transaction that offboards it.
 */
test("the panel offboards an invite against the invite, and an employee against the employee", () => {
  const panel = read("components", "employees", "SeparationFormPanel.js");
  assert.match(panel, /const inviteId = employee\.type === "invite" \? employee\.inviteId : null;/);
  assert.match(panel, /createSeparation\(inviteId \? \{ \.\.\.payload, inviteId \} : \{ \.\.\.payload, employeeId: employee\.id \}\)/);
  // An invite has no offboarding to load, and `invite:<id>` is not an id the endpoint would take.
  assert.match(panel, /const \[loading, setLoading\] = useState\(employee\.type !== "invite"\);/);
});

/*
 * The reason is required because Move to Active *deletes* the offboarding it reverses: without it
 * the only trace of a departure that was taken back would be a status quietly reading Active again.
 */
test("coming back asks why, and will not proceed until it is answered", () => {
  assert.match(DIALOG, /confirmDisabled=\{!reason\.trim\(\)\}/);
  assert.match(DIALOG, /onConfirm=\{\(\) => onConfirm\(reason\.trim\(\)\)\}/);
  assert.match(DIALOG, /<TextAreaField\s+label="Reason"\s+required/);
  // Keyed by the row where it is drawn, so the reason typed for one employee is never carried into
  // the next one's confirmation - the dialog would otherwise stay mounted between openings.
  assert.match(PAGE, /<ReactivateEmployeeDialog key=\{reactivatingEmployee\?\.id \|\| "none"\}/);
  assert.match(SERVICE, /body: JSON\.stringify\(\{ reason \}\)/);
});

test("offboarding is offered on every employee row, the onboarding ones included", () => {
  const entry = TABLE.slice(TABLE.indexOf('label: offboarded ? "Open Offboarding"'));
  assert.ok(entry, "the offboarding entry is gone from the row menu");
  assert.doesNotMatch(
    TABLE.slice(0, TABLE.indexOf('label: offboarded ? "Open Offboarding"')).slice(-400),
    /isOnboarding\(employee\) \? \[\]/,
    "the onboarding statuses are being withheld from Start Offboarding again",
  );
});

test("the row menu draws the entry on that rule, and only where the reader may write", () => {
  const entry = TABLE.slice(TABLE.indexOf("onReactivate && !isWorking(employee)"));
  assert.ok(entry, "the Move to Active entry is gone from the row menu");
  assert.match(entry.slice(0, 200), /label: "Move to Active"/);
  // The whole non-invite branch it sits in is already behind `canWrite`, which is what keeps a
  // read-only viewer from being shown an action they cannot take.
  assert.match(TABLE, /\] : canWrite \? \[/);
});

test("the page confirms before it acts, and reloads the list after", () => {
  assert.match(PAGE, /<ReactivateEmployeeDialog key=\{reactivatingEmployee\?\.id \|\| "none"\} employee=\{reactivatingEmployee\}/);
  const handler = PAGE.slice(PAGE.indexOf("async function reactivateEmployee(reason)"));
  const body = handler.slice(0, handler.indexOf("\n  }"));
  assert.match(body, /reactivateEmployeeRequest\(reactivatingEmployee\.id, reason\)/);
  assert.match(body, /await loadEmployees\(\)/);
  // The info panel is showing the record as it was a moment ago, and the status on it is exactly
  // what just changed.
  assert.match(body, /setInfoEmployee\(null\)/);
});

/*
 * The consequence is not the same for the two kinds of row, so the sentence is not either: a
 * departure is *removed* by this and cannot be recovered, while a Long Leave has no separation
 * behind it and nothing is destroyed.
 */
test("the dialog says which of the two it is about to do", () => {
  assert.match(DIALOG, /removes \$\{name\}'s offboarding record/);
  assert.match(DIALOG, /tone=\{offboarded \? "danger" : "primary"\}/);
  // The half nobody can see from the repository: the login the departure closed is reopened.
  assert.match(DIALOG, /reopens their login/);
});

test("the request is a POST to the employee's own reactivate route, carrying the reason", () => {
  assert.match(SERVICE, /\/api\/hrm\/employees\/\$\{id\}\/reactivate`, \{ method: "POST", body: JSON\.stringify\(\{ reason \}\) \}/);
});
