import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * The Request screen's Decide column says where this login stands on each request - an answer, not
 * buttons. Approve and Reject are in the row's ⋮.
 */

const PAGE = fs.readFileSync(path.join(process.cwd(), "src", "components", "hrm", "AttendanceRequestsPage.js"), "utf8");
const column = PAGE.slice(PAGE.indexOf("const decideColumn = {"), PAGE.indexOf("// Ahead of the ⋮"));

test("the Decide column holds answers, not Approve and Reject buttons", () => {
  assert.doesNotMatch(column, /<Button\b/);
  assert.match(column, /● Approval pending/);
  assert.doesNotMatch(column, /Your decision/);
  assert.match(column, /`Waiting on you and \$\{others\} more`/);
  assert.match(column, /✓ You approved/);
  assert.match(column, /Waiting on \{remaining\} more/);
});

test("deciding stays in the row's ⋮", () => {
  // The row's actions live in `lib/attendanceRequestStatus.mjs`, where they are tested against the
  // lists the server keeps; this is about where the approver presses them.
  const rules = fs.readFileSync(path.join(process.cwd(), "src", "lib", "attendanceRequestStatus.mjs"), "utf8");
  assert.match(rules, /items\.push\(\{ label: "Approve", onSelect: \(\) => onDecide\("approve"\) \}\);/);
  assert.match(rules, /items\.push\(\{ label: "Reject", tone: "danger", onSelect: \(\) => onDecide\("reject"\) \}\);/);
  assert.match(rules, /items\.push\(\{ label: "Send back", onSelect: onSendBack \}\);/);
  assert.match(PAGE, /onDecide: \(choice\) => setDecision\(\{ decision: choice, request: row \}\)/);
  assert.match(PAGE, /onSendBack: \(\) => setDecision\(\{ decision: "send-back", request: row \}\)/);
});

test("Waiting for me is for every approver - administrator or not - and nobody else", () => {
  // Named as a Leave or Permission Approver on somebody's record (the server's `isApprover`), even
  // with nothing waiting yet; or with something already in their queue, which must stay reachable.
  assert.match(PAGE, /setIsApprover\(Boolean\(team\?\.isApprover\)\);/);
  assert.match(PAGE, /const showsWaiting = isApprover \|\| teamRequests\.some\(inMyQueue\);/);
  assert.match(PAGE, /\.\.\.\(showsWaiting \? \[\{ id: WAITING_TAB, label: WAITING_TAB, count: awaitingCount \}\] : \[\]\)/);
  assert.match(PAGE, /const waiting = status === WAITING_TAB && showsWaiting;/);
  // It lists only what waits on them, even for somebody who sees everybody's requests.
  // Lists what its count counts: only what still needs this person's answer.
  assert.match(PAGE, /const waitingList = teamRequests\.filter\(awaitsMe\);/);
  assert.match(PAGE, /const awaitingCount = waitingList\.length;/);
  // Something waiting opens the page there.
  assert.match(PAGE, /if \(team\.rows\.some\(awaitsMe\)\) setStatus\(WAITING_TAB\);/);
});

test("a request with nothing to do keeps the ⋮'s room, so every row is the same height", () => {
  assert.match(PAGE, /if \(!items\.length\) return <span aria-hidden="true" className="inline-block h-8 w-8" \/>;/);
  // The ⋮ itself is IconButton's sm: 32px square.
  const menu = fs.readFileSync(path.join(process.cwd(), "src", "components", "ui", "OptionsMenu.js"), "utf8");
  assert.match(menu, /const TRIGGER_SIZES = \{ plain: "sm"/);
  const icon = fs.readFileSync(path.join(process.cwd(), "src", "components", "shared", "IconButton.js"), "utf8");
  assert.match(icon, /sm: "h-8 w-8/);
});

test("approving asks for no remarks; rejecting requires the reason", () => {
  const helpers = fs.readFileSync(path.join(process.cwd(), "src", "components", "hrm", "attendanceRequests.js"), "utf8");
  const dialog = helpers.slice(helpers.indexOf("const DECISION_COPY = {"));
  /*
   * Which answers ask for a reason is the one list (`DECISION_COPY`): an approval has no `label`
   * and so no box, a rejection and a send back each have one and are required.
   */
  assert.match(dialog, /approve: \{ title: "Approve request", action: "Approve", tone: "primary" \},/);
  assert.match(dialog, /label: "Reason for rejection"/);
  assert.match(dialog, /const needsReason = Boolean\(copy\.label\);/);
  assert.match(dialog, /\{needsReason && <TextAreaField\s+label=\{copy\.label\}\s+(?:helperText=\{copy\.helper\}\s+)?required/);
  // Checked on the press: a blank reason is marked under its own box rather than greying the button.
  assert.match(dialog, /fields\.check\(\{ remarks: needsReason && !remarks\.trim\(\) \? `Enter \$\{copy\.label\.toLowerCase\(\)\}\.` : "" \}\)/);
  assert.match(dialog, /error=\{fields\.errors\.remarks\}/);
  // The remarks, and - on a comp-off credit being approved - how many days the approver granted.
  assert.match(dialog, /onConfirm\(needsReason \? remarks\.trim\(\) : "", grant \? chosen : undefined\)/);
  // And the server: an approval keeps no remarks, a rejection must have them.
  const controller = fs.readFileSync(path.join(process.cwd(), "..", "backend", "src", "modules", "hrm", "attendance", "controller.js"), "utf8");
  assert.match(controller, /return await decide\(req, res, "APPROVED", null\);/);
  assert.match(controller, /const rejectionSchema = z\.object\(\{ remarks: z\.string\(\)\.trim\(\)\.min\(1, "Say why the request is being rejected"\)/);
});

test("an administrator is offered no Raise Request - not on the screen, not in the account menu", () => {
  assert.match(PAGE, /const mayRaise = !permissionsLoading && !isAdministrator;/);
  assert.match(PAGE, /\{mayRaise && <Button type="button" variant="primary" onClick=\{\(\) => setRaising\([^)]*\)\}>Raise Request<\/Button>\}/);
  assert.doesNotMatch(PAGE, /disabled=\{!mayRaise\}/, "absent, not greyed");
  const topbar = fs.readFileSync(path.join(process.cwd(), "src", "components", "app-shell", "AppTopbar.js"), "utf8");
  assert.match(topbar, /\.\.\.\(!isAdministrator && \(hasPermission\("HRM", "Requests", "READ"\)/);
  assert.match(topbar, /\[\{ label: "Raise Request", onSelect: \(\) => setRaiseOpen\(true\) \}\]/);
});
