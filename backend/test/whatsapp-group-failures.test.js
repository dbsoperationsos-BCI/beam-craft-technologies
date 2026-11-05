const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const { listGroupFailures, saysNoGroup, ACTIVITY_CAP, NO_GROUP_REASON } = require("../src/modules/settings/whatsapp-activity/groupFailures");
const { SCHEDULED_TRIGGERS } = require("../src/services/whatsappActivity");
const ROUTES = read("src/modules/settings/whatsapp-activity/routes.js");
const SOURCE = read("src/modules/settings/whatsapp-activity/groupFailures.js");

/*
 * A WhatsApp group is addressed either by its id or by its name, and the ones addressed by name are
 * looked up at send time - so renaming the group on WhatsApp makes the lookup find nothing and the
 * message silently never goes. Nothing told anybody. This collects those failures for the notice
 * above the Activity Log.
 */

/*
 * Just enough of Prisma's shape for the two queries, and it **records the arguments**: the first
 * version ignored `where`, so every one of these tests would have passed with the narrowing removed
 * from the query - which is exactly the bug that let real failures fall past the cap.
 */
const fakeClient = ({ steps = [], activities = [], settings = {} } = {}) => {
  const asked = {};
  return {
    asked,
    projectProductionMessage: { findMany: async (args) => { asked.steps = args; return steps; } },
    whatsAppActivity: { findMany: async (args) => { asked.activities = args; return activities; } },
    // The switches the notice asks about: a message switched off is not work waiting to be done, and
    // neither is one that failed before it was last switched off (`services/notificationSwitches.js`).
    hrmSettings: { findFirst: async () => ({ attendanceReportEnabled: true, photoSelectionNotifyEnabled: true, attendanceReportOffAt: null, photoSelectionOffAt: null, ...settings }) },
    user: { findUnique: async () => ({ linkedEmployeeId: 77 }) },
  };
};

/*
 * Who is looking. Holding the alerts permission is what gets the bar at all; what it lists then
 * depends on reach - every project for somebody who may see every project, their own for a project
 * manager. `reachFor` asks `iam.service`, so these stub it.
 */
const iam = require("../src/services/iam.service");
const realHasPermission = iam.hasPermission;
const seesEverything = (yes) => { iam.hasPermission = async () => yes; };
const SEES_ALL = { id: 1 };
const A_MANAGER = { id: 2 };
test.before(() => seesEverything(true));
test.after(() => { iam.hasPermission = realHasPermission; });

const stepRow = (over = {}) => ({
  productionId: "prod1",
  step: "SHOOT_COMPLETED",
  reason: NO_GROUP_REASON,
  updatedAt: new Date("2026-11-01T10:00:00Z"),
  production: { shootId: "shoot1", salesProject: { id: "proj1", eventId: "DBS-EVT-0001", whatsappGroupName: "DBS-EVT-0001 Ramya", deletedAt: null } },
  ...over,
});

test("a project's failed step message becomes a job with its own Retry", async () => {
  const { groups, total } = await listGroupFailures({ user: SEES_ALL, client: fakeClient({ steps: [stepRow()] }), includeProductionSteps: true });
  assert.equal(total, 1);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].where, "DBS-EVT-0001");
  assert.equal(groups[0].expectedGroupName, "DBS-EVT-0001 Ramya");
  assert.equal(groups[0].retriable, 1);
  // Ids and a kind, never a URL for the client to post to blindly.
  /*
   * Ids and a kind - no URL, and **no permission**. The permission is a constant the frontend holds;
   * a response that named it could disagree with the guard that actually decides.
   */
  assert.deepEqual(groups[0].messages[0].retry, { kind: "PRODUCTION_MESSAGE", shootId: "shoot1", step: "SHOOT_COMPLETED" });
});

test("one project's many waiting messages are one job, not many", async () => {
  /*
   * Six shoots of one project is six failed messages and **one** thing to do: link that project's
   * group. Listed flat it read as six problems, the same project six times.
   */
  const steps = ["STARTED_FROM_STUDIO", "REACHED_SHOOT_PLACE", "SHOOT_COMPLETED"].map((step, index) =>
    stepRow({ step, productionId: `prod${index}`, production: { shootId: `shoot${index}`, salesProject: { id: "proj1", eventId: "DBS-EVT-0001", whatsappGroupName: "DBS-EVT-0001 Ramya", deletedAt: null } } }));
  const { groups, total } = await listGroupFailures({ user: SEES_ALL, client: fakeClient({ steps }), includeProductionSteps: true });
  assert.equal(total, 3, "three messages are still waiting");
  assert.equal(groups.length, 1, "but one job clears them");
  assert.equal(groups[0].messages.length, 3);
  assert.equal(groups[0].retriable, 3);
});

test("the same failure is not listed twice from its two records", async () => {
  /*
   * A step message writes both its own row and the activity that logs it. Listed naively, every
   * project failure appeared twice - once with its Retry and once saying "send it from its own
   * screen". The activity's `eventRef` is the step row's key, which is how they are matched.
   */
  const activities = [{
    id: "act1",
    trigger: "PRODUCTION_SHOOT_COMPLETED",
    recipientName: "DBS-EVT-0001 Ramya",
    failureReason: "No WhatsApp group is linked to this project.",
    failureCode: null,
    updatedAt: new Date("2026-11-01T10:00:00Z"),
    eventRef: "production:prod1:SHOOT_COMPLETED",
  }];
  // Left out by `productionId: null` in the query rather than by picking `eventRef` apart.
  const client = fakeClient({ steps: [stepRow()], activities: [] });
  const { groups, total } = await listGroupFailures({ client, user: SEES_ALL, includeProductionSteps: true });
  assert.equal(client.asked.activities.where.productionId, null);
  assert.equal(total, 1);
  assert.equal(groups.length, 1);
  // The step row is the one left, and the one that knows where Retry lives.
  assert.equal(groups[0].messages[0].source, "PRODUCTION");
});

test("a scheduled message is listed but offered no button", async () => {
  // Its scheduler sends it again on its own, so a button here would race it to send twice.
  const activities = [{
    id: "act2",
    trigger: "ATTENDANCE_REPORT",
    recipientName: "DBS Attendance Daily",
    failureReason: 'no group named "DBS Attendance Daily" among their own WhatsApp groups',
    failureCode: null,
    updatedAt: new Date("2026-11-02T06:00:00Z"),
    eventRef: "attendance-report:2026-11-02",
  }];
  const { groups } = await listGroupFailures({ user: SEES_ALL, client: fakeClient({ activities }), includeProductionSteps: true });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].retriable, 0);
  assert.equal(groups[0].messages[0].retry, null);
  assert.match(groups[0].messages[0].note, /scheduler sends this again on its own/);
  assert.ok(SCHEDULED_TRIGGERS.includes("ATTENDANCE_REPORT"));
});

test("the narrowing is in the query, so the cap cannot hide real work", async () => {
  /*
   * This read the newest 200 failed group rows of **any** reason and sifted them in JS, so a run of
   * unrelated failures pushed a real no-group failure past the cap and the notice said nothing was
   * waiting. For a notice nobody can dismiss, that is the worst thing it can do.
   */
  const client = fakeClient({});
  await listGroupFailures({ client, user: SEES_ALL, includeProductionSteps: true });
  const where = client.asked.activities.where;
  assert.equal(where.status, "FAILED");
  assert.equal(where.recipientKind, "GROUP");
  // A project's step message has its own row; its activity is left out by column, not by parsing
  // `production:<id>:<step>` apart.
  assert.equal(where.productionId, null);
  assert.ok(Array.isArray(where.OR) && where.OR.length >= 2, "the phrases narrow the query itself");
  assert.ok(where.OR.some((clause) => clause.failureReason?.contains));
  assert.ok(where.OR.some((clause) => clause.failureCode?.contains));
  // Ordered by what `(status, createdAt)` indexes, not by `updatedAt`.
  assert.deepEqual(client.asked.activities.orderBy, { createdAt: "desc" });
  assert.equal(client.asked.activities.take, ACTIVITY_CAP);
  assert.deepEqual(client.asked.steps.where, { status: "FAILED", reason: NO_GROUP_REASON });
});

test("hitting the cap is admitted, not passed off as the whole list", async () => {
  const activities = Array.from({ length: ACTIVITY_CAP }, (unused, index) => ({
    id: `act${index}`,
    trigger: "CRD_DOCUMENT",
    recipientName: `Group ${index}`,
    failureReason: "no group named something among their own WhatsApp groups",
    failureCode: null,
    updatedAt: new Date(2026, 0, 1 + (index % 28)),
  }));
  const { truncated, total } = await listGroupFailures({ user: SEES_ALL, client: fakeClient({ activities }), includeProductionSteps: true });
  assert.equal(total, ACTIVITY_CAP);
  assert.equal(truncated, true, "so the notice can say there are more");

  const { truncated: fits } = await listGroupFailures({ user: SEES_ALL, client: fakeClient({ activities: activities.slice(0, 3) }), includeProductionSteps: true });
  assert.equal(fits, false);
});

test("a failure with no group name of its own stays its own job", async () => {
  // The key was `projectId || \`name:${...}\` || key` - the template is always truthy, so the third
  // branch was dead and every unnamed failure merged into one group called "name:".
  const activities = [1, 2].map((n) => ({ id: `act${n}`, trigger: "CRD_DOCUMENT", recipientName: "", failureReason: "no group named x", failureCode: null, updatedAt: new Date() }));
  const { groups, total } = await listGroupFailures({ user: SEES_ALL, client: fakeClient({ activities }), includeProductionSteps: true });
  assert.equal(total, 2);
  assert.equal(groups.length, 2, "two nameless failures are two jobs, not one");
});

test("only a failure about the group is collected", async () => {
  /*
   * The notice cannot be dismissed, so it may only hold work somebody can do. A send that failed
   * because WhatsApp was down would sit in it for ever.
   */
  assert.equal(saysNoGroup('no group named "DBS Wishes" among their own WhatsApp groups'), true);
  assert.equal(saysNoGroup("No WhatsApp group is linked to this project."), true);
  assert.equal(saysNoGroup("The provider could not deliver it"), false);
  assert.equal(saysNoGroup("Connection closed"), false);
  assert.equal(saysNoGroup(null), false);

  // `saysNoGroup` is now the query's phrase list rather than a JS sift, so this asserts the phrases
  // it is built from rather than feeding rows the query would never have returned.
  const client = fakeClient({});
  await listGroupFailures({ client, user: SEES_ALL, includeProductionSteps: true });
  const phrases = client.asked.activities.where.OR.map((clause) => clause.failureReason?.contains || clause.failureCode?.contains);
  assert.ok(phrases.includes("no group named"));
  assert.ok(!phrases.some((phrase) => /provider|connection|expired/i.test(phrase || "")));
});

test("a binned project is not work anybody has to fix", async () => {
  const steps = [stepRow({ production: { shootId: "shoot1", salesProject: { id: "proj1", eventId: "DBS-EVT-0001", whatsappGroupName: "x", deletedAt: new Date() } } })];
  const { total } = await listGroupFailures({ user: SEES_ALL, client: fakeClient({ steps }), includeProductionSteps: true });
  assert.equal(total, 0);
});

test("a project manager is shown their own projects and nobody else's", async () => {
  /*
   * The studio asked for this: the employee who runs **that** project, plus its admins and Super
   * Admin. So reach narrows the query - a manager is never sent another manager's rows to filter out
   * - on the two roles that can do something about a waiting message: the project's own manager, and
   * its Production Manager, who is the one the Retry answers to.
   */
  seesEverything(false);
  const client = fakeClient({ steps: [stepRow()] });
  await listGroupFailures({ client, user: A_MANAGER, includeProductionSteps: true });
  assert.deepEqual(client.asked.steps.where.production, { salesProject: { OR: [{ projectManagerEmployeeId: 77 }, { productionManagerEmployeeId: 77 }] } });
  // A name-addressed failure belongs to no project, so no project manager is the one to hear about
  // it: that query is not even made for a narrowed viewer.
  assert.equal(client.asked.activities, undefined, "the activity query is skipped, not filtered");
  seesEverything(true);
});

test("a viewer with no linked employee manages nothing, and is shown nothing", async () => {
  // `?? -1` rather than a missing key: an absent id must match no project, never every project.
  seesEverything(false);
  const client = fakeClient({ steps: [] });
  client.user.findUnique = async () => ({ linkedEmployeeId: null });
  await listGroupFailures({ client, user: A_MANAGER, includeProductionSteps: true });
  assert.deepEqual(client.asked.steps.where.production, { salesProject: { OR: [{ projectManagerEmployeeId: -1 }, { productionManagerEmployeeId: -1 }] } });
  seesEverything(true);
});

test("somebody who may see every project is not narrowed at all", async () => {
  const client = fakeClient({ steps: [stepRow()] });
  await listGroupFailures({ client, user: SEES_ALL, includeProductionSteps: true });
  assert.equal(client.asked.steps.where.production, undefined);
  assert.ok(client.asked.activities, "and the name-addressed failures are read for them");
});

test("a project's step messages are in the bar as it ships, as one job per project", async () => {
  /*
   * They were out for a while, for two reasons that are now answered rather than avoided: a project
   * with several shoots filled the bar with rows whose answer was the one job of linking its group -
   * which the grouping below collapses - and the Retry was offered to readers the endpoint would
   * refuse, which `productionRow` no longer does.
   */
  const { SHOWS_PRODUCTION_STEPS } = require("../src/modules/settings/whatsapp-activity/groupFailures");
  assert.equal(SHOWS_PRODUCTION_STEPS, true);
  const steps = [stepRow(), stepRow({ step: "STARTED_FROM_STUDIO" }), stepRow({ step: "REACHED_SHOOT_PLACE" })];
  const { groups, total } = await listGroupFailures({ user: SEES_ALL, client: fakeClient({ steps }) });
  assert.equal(total, 3);
  assert.equal(groups.length, 1, "three messages of one project are one job: link its group");
  assert.equal(groups[0].messages.length, 3);
  // And a caller can still ask for the notice without them, which is what the argument is for.
  const without = await listGroupFailures({ user: SEES_ALL, client: fakeClient({ steps }), includeProductionSteps: false });
  assert.equal(without.total, 0);
});

test("the Retry is offered only to somebody the endpoint will accept, and says who it belongs to otherwise", async () => {
  /*
   * `retryMessage` allows that project's own Production Manager, or Show All Projects at Read /
   * Write. The bar used to draw its button from `PROJECT / Production` at Read / Write instead, so
   * anybody else pressed it and was told it was not theirs. Now the row says so before they press.
   */
  const steps = [stepRow({ production: { shootId: "shoot1", salesProject: { id: "proj1", eventId: "DBS-EVT-0001", whatsappGroupName: "x", deletedAt: null, productionManagerEmployeeId: 77 } } })];

  // Show All Projects at Read / Write: every project's is theirs to retry.
  const all = await listGroupFailures({ user: SEES_ALL, client: fakeClient({ steps }) });
  assert.ok(all.groups[0].messages[0].retry, "a widened viewer keeps the button");
  assert.equal(all.groups[0].retriable, 1);

  // The project's own Production Manager, who is employee 77 on the row above.
  seesEverything(false);
  const mine = await listGroupFailures({ user: A_MANAGER, client: fakeClient({ steps }) });
  assert.ok(mine.groups[0].messages[0].retry, "its Production Manager keeps the button");

  // Somebody else who can see it but could not send it: no button, and the row says whose it is.
  const theirs = fakeClient({ steps: [stepRow({ production: { shootId: "shoot1", salesProject: { id: "proj1", eventId: "DBS-EVT-0001", whatsappGroupName: "x", deletedAt: null, productionManagerEmployeeId: 1234 } } })] });
  const other = await listGroupFailures({ user: A_MANAGER, client: theirs });
  assert.equal(other.groups[0].messages[0].retry, null);
  assert.equal(other.groups[0].retriable, 0, "nothing for them to press");
  assert.match(other.groups[0].messages[0].note, /group is not linked[\s\S]*Production Manager sends this again/);
  seesEverything(true);
});

test("a message addressed by name is still shown, because renaming the group really is the fix", async () => {
  // Only the production arm went. The attendance report and the wishes have no other home, and the
  // bar is the only place a renamed group announces itself.
  const { groups } = await listGroupFailures({ user: SEES_ALL, client: fakeClient({ activities: [{ id: "act1", trigger: "ATTENDANCE_REPORT", recipientName: "DBS Attendance", failureReason: "no group named DBS Attendance", failureCode: null, updatedAt: new Date() }] }) });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].messages[0].source, "ACTIVITY");
});

test("nothing waiting answers empty, so the notice draws nothing", async () => {
  const { groups, total } = await listGroupFailures({ user: SEES_ALL, client: fakeClient({}) });
  assert.deepEqual(groups, []);
  assert.equal(total, 0);
});

test("the bar is behind authentication and nothing else, and that is deliberate", () => {
  /*
   * It had a permission of its own, and that was the wrong shape for the question. A permission
   * answers *may you open this screen*; this is not a screen anybody opens, it is a strip about the
   * reader's own work, and IAM.md's "Whose records" says whose rows you get has "one answer for
   * everybody - no setting, per role or otherwise". In front of that, a tickable gate could only
   * hide a project manager's own row from them, and it did: a new permission is granted to
   * SUPER_ADMIN alone, as every new permission must be, so the manager of a project whose message
   * never went saw nothing until somebody ticked a box nobody knew existed.
   *
   * Still mounted **above** the router-wide guard, or `requireModule("SETTINGS", "WhatsApp Activity
   * Log")` would demand the log's permission - the thing this was separated from in the first place.
   */
  assert.match(ROUTES, /router\.get\("\/group-failures", controller\.groupFailures\);/);
  const failuresAt = ROUTES.indexOf('router.get("/group-failures"');
  const guardAt = ROUTES.indexOf('router.use(requireModule("SETTINGS", "WhatsApp Activity Log"));');
  assert.ok(failuresAt > -1 && guardAt > -1 && failuresAt < guardAt, "above the log's guard");
  assert.ok(ROUTES.indexOf("router.use(protect);") < failuresAt, "but still behind authentication");
  // No permission of its own anywhere: not on the route, not in the catalogue, not in a migration.
  assert.doesNotMatch(ROUTES, /group-failures", checkPermission/);
  assert.doesNotMatch(read("prisma/seeds/permission-catalogue.js"), /WhatsApp Group Alerts/);
});

test("the access control is the narrowing, so no call can answer with somebody else's row", () => {
  /*
   * This is what carries the route instead of a guard, so it is the thing that has to hold. Narrowed
   * **in the query** - a project manager is never sent another manager's rows to filter out - and
   * the only widener is `PROJECT / Show All Projects`, the project register's own deliberate one.
   */
  const source = read("src/modules/settings/whatsapp-activity/groupFailures.js");
  assert.match(source, /hasPermission\(user\.id, "PROJECT", "Show All Projects", "READ"\)/);
  assert.match(source, /projectManagerEmployeeId: reach\.myEmployeeId \?\? -1/);
  // The Retry answers to the Production Manager, so the rows they could act on are theirs to see too.
  assert.match(source, /productionManagerEmployeeId: reach\.myEmployeeId \?\? -1/);
  // No linked employee is no project to manage, and `?? -1` is what makes that match nothing.
  assert.match(source, /linkedEmployeeId: true/);
  // The ownerless Settings failures belong to no project, so they are not queried for a narrowed
  // viewer at all - asking for rows nobody will be shown is work for nothing.
  assert.match(source, /reach\.all \? client\.whatsAppActivity\.findMany\(/);
});

test("retry is left to the module that owns the message", () => {
  /*
   * Production's retry claims the row with a conditional update, so two presses cannot both send
   * and the loser gets a 409. A second retry written here would sit beside that claim, not share
   * it - which is exactly how the same message gets sent twice.
   */
  // Comments stripped first: the prose above quotes production's own comment about
  // `sendMessageToGroup`, and asserting absence against prose tests the wording, not the code.
  const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /sendMessageToGroup|sessionManager|\blistGroups\b/, "this collects failures, it does not send");
  assert.doesNotMatch(code, /feature: "Production"/, "and it does not echo the permission back either");
  assert.match(read("src/modules/project-management/production/messages.js"), /async function retryMessage\(/);
});

/*
 * A message that is switched off is not waiting on a group.
 *
 * The notice is the list of WhatsApp messages somebody has to find a group for; it cannot be
 * dismissed, which is right for real work and wrong for a message the studio has stopped sending.
 * The activity log keeps the failure either way - that is the record of what happened - but once the
 * attendance report is switched off, nobody has to go looking for its group.
 */
test("a name-addressed failure drops out of the notice once its message is switched off", async () => {
  const activity = (trigger, name) => ({ id: `a-${trigger}`, trigger, recipientName: name, failureReason: `no group named "${name}" among their own WhatsApp groups`, failureCode: null, updatedAt: new Date("2026-11-03T11:06:10.000Z") });
  const activities = [activity("ATTENDANCE_REPORT", "DBS Attendance Daily"), activity("WISH_BIRTHDAY", "DBS Wishes")];
  const triggersIn = ({ groups }) => groups.flatMap((group) => group.messages.map((message) => message.what)).sort();

  // Both on: both are work waiting.
  assert.deepEqual(triggersIn(await listGroupFailures({ user: SEES_ALL, client: fakeClient({ activities }) })), ["ATTENDANCE_REPORT", "WISH_BIRTHDAY"]);

  // The attendance report switched off: its own row goes, and nothing else does.
  const off = fakeClient({ activities, settings: { attendanceReportEnabled: false } });
  assert.deepEqual(triggersIn(await listGroupFailures({ user: SEES_ALL, client: off })), ["WISH_BIRTHDAY"], "the wishes have no switch, so theirs is still to fix");

  // Photo Selection Submitted is the other one with a switch of its own.
  const both = fakeClient({ activities: [activity("PHOTO_SELECTION_SUBMITTED", "DBS Selections")], settings: { photoSelectionNotifyEnabled: false } });
  assert.deepEqual(triggersIn(await listGroupFailures({ user: SEES_ALL, client: both })), []);
});

/*
 * Switching a notification **on** starts it fresh.
 *
 * The failure itself cannot be cleared - the activity log is the record of what happened - so the
 * switch records when it was pressed and everything older has been answered. Without this, switching
 * a message back on put every failure from before it was switched off straight back on the screen,
 * which is what somebody switching it off was getting rid of.
 */
test("switching a notification back on shows only what fails after it, never the failures from before", async () => {
  const at = (iso) => new Date(iso);
  const activity = (id, createdAt) => ({ id, trigger: "ATTENDANCE_REPORT", recipientName: "DBS Attendance Daily", failureReason: 'no group named "DBS Attendance Daily" among their own WhatsApp groups', failureCode: null, createdAt: at(createdAt), updatedAt: at(createdAt) });
  const ids = ({ groups }) => groups.flatMap((group) => group.messages.map((message) => message.activityId)).sort();
  // Switched off on the 4th: the 3rd's failure is answered, whatever happens next.
  const settings = { attendanceReportEnabled: true, attendanceReportOffAt: at("2026-11-04T10:00:00.000Z") };

  const before = fakeClient({ activities: [activity("old", "2026-11-03T11:06:10.000Z")], settings });
  assert.deepEqual(ids(await listGroupFailures({ user: SEES_ALL, client: before })), [], "a failure from before the switch-off never comes back");

  const after = fakeClient({ activities: [activity("old", "2026-11-03T11:06:10.000Z"), activity("new", "2026-11-05T09:00:00.000Z")], settings });
  assert.deepEqual(ids(await listGroupFailures({ user: SEES_ALL, client: after })), ["new"], "and what fails after it is still work to do");

  // A notification never switched off has no moment to answer by, so nothing is hidden.
  const never = fakeClient({ activities: [activity("old", "2026-11-03T11:06:10.000Z")], settings: { attendanceReportEnabled: true, attendanceReportOffAt: null } });
  assert.deepEqual(ids(await listGroupFailures({ user: SEES_ALL, client: never })), ["old"]);
});
