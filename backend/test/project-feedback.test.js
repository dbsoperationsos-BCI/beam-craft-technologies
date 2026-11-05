const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const prisma = require("../src/config/db");
const { Prisma } = require("@prisma/client");
const { invalidate } = require("../src/services/referenceMatchers");
const { shootPeople, FEEDBACK_CODE_PREFIX, productionComplete, overallFeedbackOpen, REVIEWS, STATUSES, STATUS_FOR_REVIEW, ISSUE_OUTCOMES, listFeedback, pendingFeedback, feedbackOptions, feedbackAssignees, createFeedback, createFeedbackMany, resolveIssue } = require("../src/modules/project-management/feedback/service");
const { createSchema, issueStatusSchema, bulkSchema, BULK_MAX_ITEMS } = require("../src/modules/project-management/feedback/controller");

/*
 * Project Management → Customer Issues and Feedback: every project created in Bookings & Converted
 * waits on Yet to be done for its New Project Feedback, one per project, and every shoot Production
 * completes for a Shoot Completion Feedback of its own. The stages asked for before (Production
 * Completion, Project Completed) were removed; the rows they left are written straight to the table
 * below and still read back. The list holds the reader's own feedback, or everybody's
 * with View All Feedback. Real rows, removed at the end.
 */

const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TFB-${STAMP}-${name}`;
// A Feedback ID for a row written straight to the table, as the column requires one.
let fixtureCount = 0;
const fixtureCode = () => `TFB-${STAMP}-${++fixtureCount}`;
const F = {};
const leadFor = (enquiryId) => prisma.salesCrmLead.upsert({ where: { enquiryId }, create: { enquiryId, name: enquiryId }, update: {} });

async function grant(user, module, feature) {
  const permission = await prisma.permission.findFirst({ where: { module, feature }, select: { id: true } });
  assert.ok(permission, `the seed no longer has ${module} / ${feature}`);
  const roleRow = await prisma.role.create({ data: { name: tag(`r-${Math.random().toString(36).slice(2, 7)}`) } });
  await prisma.rolePermission.create({ data: { roleId: roleRow.id, permissionId: permission.id, accessLevel: "READ_WRITE" } });
  await prisma.userRole.create({ data: { userId: user.id, roleId: roleRow.id } });
  await prisma.roleBranch.create({ data: { roleId: roleRow.id, branchId: F.br.id } });
  return async () => {
    await prisma.userRole.deleteMany({ where: { roleId: roleRow.id } });
    await prisma.roleBranch.deleteMany({ where: { roleId: roleRow.id } });
    await prisma.rolePermission.deleteMany({ where: { roleId: roleRow.id } });
    await prisma.role.delete({ where: { id: roleRow.id } });
  };
}

const ours = (rows) => rows.filter((row) => String(row.eventId).startsWith(`TFB-${STAMP}`));
// A row written straight to the table, read back as the list reads it.
const toListed = async (row) => (await listFeedback({ userId: F.login.id })).find((entry) => entry.id === row.id) || row;
// Somebody else's feedback on `project`, written straight to the table - each its own version.
let fixtureVersion = 0;
const othersFeedback = (project, data) => prisma.projectFeedback.create({ data: { feedbackCode: fixtureCode(), feedbackVersion: ++fixtureVersion, projectId: project.id, ...data } });
// The reader's own feedback on `project`, as the removed Give Feedback left it.
const myFeedback = (project, data) => othersFeedback(project, { createdByUserId: F.login.id, ...data });

before(async () => {
  F.br = await prisma.branch.create({ data: { code: tag("BR"), name: `Feedback Branch ${STAMP}` } });
  const person = (name) => prisma.employee.create({ data: { employeeId: tag(name), employeeName: `Feedback ${name} ${STAMP}`, branchId: F.br.id, workBaseLocation: F.br.name } });
  F.me = await person("me");
  F.stranger = await person("str");
  F.login = await prisma.user.create({ data: { name: `Feedback Reviewer ${STAMP}`, email: `${tag("me")}@test.local`.toLowerCase(), username: tag("me").toLowerCase(), password: "x", role: "ADMIN", branchId: F.br.id, linkedEmployeeId: F.me.id } });
  invalidate();

  F.project = async (name, owner = F.me, extra = {}) => { await leadFor(tag(`enq-${name}`)); return prisma.salesProject.create({ data: {
    enquiryId: tag(`enq-${name}`), eventId: tag(name), whatsappGroupName: `WED ${name} ${STAMP}`, clientMainNumber: "+919876543210",
    sourceBranch: F.br.name, branchId: F.br.id, vertical: "WED",
    deliverables: "[]", initialConvertedValue: 0, crmName: "Test", projectManagerEmployeeId: owner.id, ...extra,
  } }); };
  F.mine = await F.project("mine", F.me);
  F.theirs = await F.project("theirs", F.stranger);

});

after(async () => {
  // The tasks the Average and Poor reviews became: read first, gone once their feedback (and so their
  // issue rows, which keep a task from being deleted) has gone.
  const issueTasks = (await prisma.projectFeedbackIssue.findMany({ where: { projectFeedback: { project: { eventId: { startsWith: `TFB-${STAMP}` } } } }, select: { taskId: true } })).map((row) => row.taskId);
  await prisma.projectFeedback.deleteMany({ where: { project: { eventId: { startsWith: `TFB-${STAMP}` } } } });
  if (issueTasks.length) await prisma.hrmTask.deleteMany({ where: { id: { in: issueTasks } } });
  await prisma.salesProject.deleteMany({ where: { eventId: { startsWith: `TFB-${STAMP}` } } });
  await prisma.salesCrmLead.deleteMany({ where: { enquiryId: { startsWith: `TFB-${STAMP}` } } });
  await prisma.userRole.deleteMany({ where: { userId: F.login.id } });
  await prisma.user.delete({ where: { id: F.login.id } });
  await prisma.employee.deleteMany({ where: { employeeId: { startsWith: `TFB-${STAMP}` } } });
  await prisma.branch.deleteMany({ where: { code: { startsWith: `TFB-${STAMP}` } } });
  invalidate();
  await prisma.$disconnect();
});

test("every route answers for PROJECT / Feedback, guarded on the router", () => {
  const routes = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "project-management", "feedback", "routes.js"), "utf8");
  assert.match(routes, /router\.use\(protect\);/);
  assert.match(routes, /router\.use\(requireModule\("PROJECT", "Feedback"\)\);/);
  // The waiting list, the form's reviews, a shoot's people and the assignees, the list, saving one,
  // saving many (Give Feedback over the ticked rows), and moving one on from Issues.
  assert.deepEqual([...routes.matchAll(/router\.(get|post|put|patch|delete)\("([^"]+)"/g)].map((match) => `${match[1]} ${match[2]}`), ["get /options", "get /pending", "get /projects/:projectId/people", "get /assignees", "get /", "post /", "post /bulk", "patch /:id/status", "post /:id/send-whatsapp"]);
  assert.match(routes, /router\.get\("\/assignees", checkPermission\("PROJECT", "Feedback", "READ_WRITE"\), assignees\);/);
  // A shoot's people are for somebody giving feedback, as the assignees are.
  assert.match(routes, /router\.get\("\/projects\/:projectId\/people", checkPermission\("PROJECT", "Feedback", "READ_WRITE"\), people\);/);
  // The employee timeline drops a deleted shoot's mentions, as the feedback list does.
  const employees = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "employees", "controller.js"), "utf8");
  assert.match(employees, /projectFeedbackMentions: \{\s+where: \{ projectFeedback: \{ project: \{ deletedAt: null \}, OR: \[\{ shootId: null \}, \{ shoot: \{ deletedAt: null \} \}\] \} \},/);
  const server = fs.readFileSync(path.join(__dirname, "..", "src", "server.js"), "utf8");
  assert.match(server, /app\.use\("\/api\/project-management\/feedback", projectFeedbackRoutes\)/);
});

test("a review is one of the four ratings, and the feedback is required and trimmed", () => {
  assert.deepEqual(REVIEWS, ["Excellent", "Good", "Average", "Poor"]);
  assert.deepEqual(feedbackOptions(), { reviews: REVIEWS });
  assert.deepEqual(STATUSES, ["Yet to be done", "Issues", "Issues sorted", "Completed", "Rejected"]);
  assert.deepEqual(STATUS_FOR_REVIEW, { Excellent: "Completed", Good: "Completed", Average: "Issues", Poor: "Issues" });
  const ok = createSchema.safeParse({ projectId: " p1 ", review: "Good", feedback: "  Lovely day.  ", areas: {} });
  assert.equal(ok.success, true);
  assert.deepEqual(ok.data, { projectId: "p1", review: "Good", feedback: "Lovely day.", stage: "NEW_PROJECT" }, "unknown keys are dropped; the stage is New Project when none is sent");
  // Only the stages asked for now; a shoot's names its shoot, and only it does.
  assert.equal(createSchema.safeParse({ projectId: "p1", stage: "PRODUCTION_COMPLETION", review: "Good", feedback: "x" }).success, false);
  assert.equal(createSchema.safeParse({ projectId: "p1", stage: "SHOOT_COMPLETION", shootId: " s1 ", review: "Good", feedback: "x" }).data?.shootId, "s1");
  assert.equal(createSchema.safeParse({ projectId: "p1", stage: "SHOOT_COMPLETION", review: "Good", feedback: "x" }).error?.issues[0]?.message, "Choose the shoot.");
  assert.equal(createSchema.safeParse({ projectId: "p1", stage: "OVERALL", shootId: "s1", review: "Good", feedback: "x" }).success, false);
  assert.equal(createSchema.safeParse({ projectId: "p1", stage: "OVERALL", review: "Good", feedback: "x" }).data?.stage, "OVERALL");
  // The people named: each once, never one in both lists.
  assert.deepEqual(createSchema.safeParse({ projectId: "p1", stage: "SHOOT_COMPLETION", shootId: "s1", review: "Good", feedback: "x", appreciatedEmployeeIds: ["4", 4, 7] }).data?.appreciatedEmployeeIds, [4, 7]);
  assert.equal(createSchema.safeParse({ projectId: "p1", stage: "SHOOT_COMPLETION", shootId: "s1", review: "Good", feedback: "x", appreciatedEmployeeIds: [4], notSatisfiedEmployeeIds: [4] }).error?.issues[0]?.message, "Somebody cannot be both appreciated and not satisfied with.");
  assert.equal(createSchema.safeParse({ projectId: "p1", review: "Fine", feedback: "x" }).success, false);
  assert.equal(createSchema.safeParse({ projectId: "p1", review: "Good", feedback: "   " }).error?.issues[0]?.message, "Write the feedback.");
  assert.equal(createSchema.safeParse({ review: "Good", feedback: "x" }).success, false);
});

test("Yet to be done lists every live project with no New Project Feedback yet, and leaves it once given", async () => {
  const undo = await grant(F.login, "PROJECT", "Feedback");
  try {
    const waiting = await F.project("waits");
    const gone = await F.project("waits-deleted");
    await prisma.salesProject.update({ where: { id: gone.id }, data: { deletedAt: new Date() } });
    const rows = ours(await pendingFeedback());
    const row = rows.find((entry) => entry.projectKey === waiting.id);
    assert.ok(row, "a new project waits");
    assert.equal(row.pending, true);
    assert.equal(row.id, `project:${waiting.id}:NEW_PROJECT`);
    assert.equal(row.stageLabel, "New Project Feedback");
    assert.equal(row.status, "Yet to be done");
    assert.equal(row.branch, F.br.name);
    assert.ok(!rows.some((entry) => entry.projectKey === gone.id), "a deleted project does not wait");
    // Not narrowed to the reader's own projects.
    assert.ok(rows.some((entry) => entry.projectKey === F.theirs.id));

    const saved = await createFeedback({ input: { projectId: waiting.id, review: "Excellent", feedback: "Great energy." }, userId: F.login.id });
    // The project's Feedback ID, and its New Project Feedback as version 01 of it.
    assert.match(saved.feedbackCode, new RegExp(`^${FEEDBACK_CODE_PREFIX}\\d{5,}-01$`));
    assert.equal((await prisma.salesProject.findUnique({ where: { id: waiting.id }, select: { feedbackCode: true } })).feedbackCode, saved.feedbackCode.slice(0, -3));
    assert.equal(saved.stage, "NEW_PROJECT");
    assert.equal(saved.status, "Completed", "filed by its review");
    assert.equal(saved.givenBy, `Feedback Reviewer ${STAMP}`);
    // With its branch's links, for the client's thank-you.
    assert.deepEqual(saved.socialLinks, { googleReviewUrl: null, customSocialLinks: [] });
    assert.ok(!ours(await pendingFeedback()).some((entry) => entry.projectKey === waiting.id), "given, so no longer waiting");

    // One per project: a second is refused, naming the first - also when two arrive at once.
    await assert.rejects(
      createFeedback({ input: { projectId: waiting.id, review: "Good", feedback: "Again." }, userId: F.login.id }),
      (error) => error.status === 409 && error.message.includes(saved.feedbackCode),
    );
    const racing = await F.project("np-race");
    const outcomes = await Promise.allSettled([1, 2].map((n) => createFeedback({ input: { projectId: racing.id, review: "Good", feedback: `Race ${n}.` }, userId: F.login.id })));
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    assert.equal(outcomes.find((outcome) => outcome.status === "rejected")?.reason?.status, 409);
    // A deleted or unknown project cannot be reviewed.
    await assert.rejects(createFeedback({ input: { projectId: gone.id, review: "Good", feedback: "x" }, userId: F.login.id }), (error) => error.status === 404);
    // Taken back out, so the lists read below hold only what they set out to.
    await prisma.projectFeedback.deleteMany({ where: { projectId: { in: [waiting.id, racing.id] } } });
  } finally { await undo(); }
});

test("every shoot Production completes waits for a Shoot Completion Feedback of its own, once", async () => {
  const undo = await grant(F.login, "PROJECT", "Feedback");
  const project = await F.project("shoots");
  const shoot = (name, production) => prisma.projectShoot.create({ data: {
    projectId: project.id, shootId: tag(`sh-${name}`), shoot: `Shoot ${name}`, shootPlace: "Studio", district: "Erode", state: "Tamil Nadu",
    ...(production ? { production: { create: { salesProjectId: project.id, ...production } } } : {}),
  } });
  const done = { planSubmittedAt: new Date(), currentStep: "DONE", shootStatus: "COMPLETED" };
  try {
    const first = await shoot("one", done);
    const second = await shoot("two", done);
    const running = await shoot("run", { planSubmittedAt: new Date(), currentStep: "SHOOT_STATUS" });
    const unplanned = await shoot("plan", { currentStep: "DONE" });
    const gone = await shoot("gone", done);
    await prisma.projectShoot.update({ where: { id: gone.id }, data: { deletedAt: new Date() } });

    const waitingShoots = async () => ours(await pendingFeedback()).filter((row) => row.projectKey === project.id && row.stage === "SHOOT_COMPLETION");
    let rows = await waitingShoots();
    // Only the two Production has completed: not one still running, one whose plan was never
    // submitted, or one deleted.
    assert.deepEqual(rows.map((row) => row.shootCode).sort(), [tag("sh-one"), tag("sh-two")].sort());
    const row = rows.find((entry) => entry.shootKey === first.id);
    assert.equal(row.id, `shoot:${first.id}:SHOOT_COMPLETION`);
    assert.equal(row.stageLabel, "Shoot Completion Feedback");
    assert.equal(row.status, "Yet to be done");
    assert.equal(row.shootName, "Shoot one");
    assert.equal(row.eventId, tag("shoots"));
    // The project's own New Project Feedback still waits beside its shoots.
    assert.ok(ours(await pendingFeedback()).some((entry) => entry.projectKey === project.id && entry.stage === "NEW_PROJECT"));

    // Who worked on the shoot, by area - here the project's Project Manager, under Pre Production.
    const people = await shootPeople(project.id, first.id);
    assert.deepEqual(people.map((area) => area.label), ["Sales", "Pre Production", "Production"]);
    assert.deepEqual(people.find((area) => area.area === "PRE_PRODUCTION").people.map((person) => person.id), [F.me.id]);
    assert.equal(await shootPeople(F.mine.id, first.id), null, "a shoot of another project");
    // Only those people may be named, and never one in both lists.
    await assert.rejects(
      createFeedback({ input: { projectId: project.id, stage: "SHOOT_COMPLETION", shootId: first.id, review: "Good", feedback: "x", appreciatedEmployeeIds: [F.stranger.id] }, userId: F.login.id }),
      (error) => error.status === 400 && /worked on this shoot/.test(error.message),
    );
    await assert.rejects(
      createFeedback({ input: { projectId: project.id, stage: "SHOOT_COMPLETION", shootId: first.id, review: "Good", feedback: "x", appreciatedEmployeeIds: [F.me.id], notSatisfiedEmployeeIds: [F.me.id] }, userId: F.login.id }),
      (error) => error.status === 400,
    );
    // Not on any other feedback.
    await assert.rejects(
      createFeedback({ input: { projectId: project.id, review: "Good", feedback: "x", appreciatedEmployeeIds: [F.me.id] }, userId: F.login.id }),
      (error) => error.status === 400,
    );
    const saved = await createFeedback({ input: { projectId: project.id, stage: "SHOOT_COMPLETION", shootId: first.id, review: "Good", feedback: "Lovely reception.", appreciatedEmployeeIds: [F.me.id] }, userId: F.login.id });
    assert.equal(saved.stage, "SHOOT_COMPLETION");
    assert.equal(saved.appreciated, `Feedback me ${STAMP}`);
    assert.deepEqual(saved.appreciatedEmployees, [{ id: F.me.id, name: `Feedback me ${STAMP}` }]);
    assert.equal(saved.notSatisfied, "");
    assert.equal(saved.shootCode, tag("sh-one"));
    assert.equal(saved.status, "Completed");
    rows = await waitingShoots();
    assert.deepEqual(rows.map((entry) => entry.shootCode), [tag("sh-two")], "given, so that shoot no longer waits; the other still does");
    // Its project's New Project Feedback is a separate one, still open.
    assert.ok(ours(await pendingFeedback()).some((entry) => entry.projectKey === project.id && entry.stage === "NEW_PROJECT"));
    assert.ok(ours(await listFeedback({ userId: F.login.id })).some((entry) => entry.id === saved.id && entry.shootCode === tag("sh-one")));

    // Once per shoot - also when two arrive at once.
    await assert.rejects(
      createFeedback({ input: { projectId: project.id, stage: "SHOOT_COMPLETION", shootId: first.id, review: "Good", feedback: "Again." }, userId: F.login.id }),
      (error) => error.status === 409 && error.message.includes(saved.feedbackCode),
    );
    const outcomes = await Promise.allSettled([1, 2].map((n) => createFeedback({ input: { projectId: project.id, stage: "SHOOT_COMPLETION", shootId: second.id, review: "Good", feedback: `Race ${n}.` }, userId: F.login.id })));
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    assert.equal(outcomes.find((outcome) => outcome.status === "rejected")?.reason?.status, 409);
    assert.equal(await prisma.projectFeedback.count({ where: { shootId: second.id } }), 1);
    // A shoot not completed, deleted, or of another project is refused.
    await assert.rejects(createFeedback({ input: { projectId: project.id, stage: "SHOOT_COMPLETION", shootId: running.id, review: "Good", feedback: "x" }, userId: F.login.id }), (error) => error.status === 409);
    await assert.rejects(createFeedback({ input: { projectId: project.id, stage: "SHOOT_COMPLETION", shootId: unplanned.id, review: "Good", feedback: "x" }, userId: F.login.id }), (error) => error.status === 409);
    await assert.rejects(createFeedback({ input: { projectId: project.id, stage: "SHOOT_COMPLETION", shootId: gone.id, review: "Good", feedback: "x" }, userId: F.login.id }), (error) => error.status === 404);
    await assert.rejects(createFeedback({ input: { projectId: F.mine.id, stage: "SHOOT_COMPLETION", shootId: first.id, review: "Good", feedback: "x" }, userId: F.login.id }), (error) => error.status === 404);
    // A shoot's Average or Poor review is a task naming the shoot, and the task's card says which.
    const undoTasks = await grant(F.login, "HRM", "Task Management");
    try {
      const third = await shoot("three", done);
      const poor = await createFeedback({ input: { projectId: project.id, stage: "SHOOT_COMPLETION", shootId: third.id, review: "Poor", feedback: "Album late.", assignees: { REVIEW: F.login.id } }, userId: F.login.id });
      const issue = await prisma.projectFeedbackIssue.findFirst({ where: { feedbackId: poor.id }, include: { task: true } });
      assert.match(issue.task.title, new RegExp(`rated Poor - ${tag("sh-three")}$`));
      assert.equal(issue.task.department, "Production", "a shoot's issue is Production's");
      assert.match(issue.task.description, new RegExp(`Shoot Completion Feedback DBS-FB-\\d+-\\d{2} on WED shoots ${STAMP} \\(${tag("shoots")}\\), shoot ${tag("sh-three")} \\(Shoot three\\)\\.`));
      const tasks = require("../src/modules/hrm/tasks/service");
      assert.equal((await tasks.getTask(issue.taskId, F.login.id)).feedbackIssue.shootCode, tag("sh-three"));
      await prisma.projectFeedback.deleteMany({ where: { id: poor.id } });
      await prisma.hrmTask.deleteMany({ where: { id: issue.taskId } });
    } finally { await undoTasks(); }
    // A deleted shoot takes its feedback off the list.
    await prisma.projectShoot.update({ where: { id: first.id }, data: { deletedAt: new Date() } });
    assert.equal(ours(await listFeedback({ userId: F.login.id })).some((entry) => entry.id === saved.id), false);
    await prisma.projectFeedback.deleteMany({ where: { projectId: project.id } });
  } finally { await undo(); }
});

test("once Production has completed all of a project's shoots, the project waits for its Overall Feedback", async () => {
  const undo = await grant(F.login, "PROJECT", "Feedback");
  const project = await F.project("overall");
  const shoot = (name, production) => prisma.projectShoot.create({ data: {
    projectId: project.id, shootId: tag(`ov-${name}`), shoot: `Shoot ${name}`, shootPlace: "Studio", district: "Erode", state: "Tamil Nadu",
    ...(production ? { production: { create: { salesProjectId: project.id, ...production } } } : {}),
  } });
  const done = { planSubmittedAt: new Date(), currentStep: "DONE", shootStatus: "COMPLETED" };
  const overallWaiting = async () => ours(await pendingFeedback()).some((row) => row.projectKey === project.id && row.stage === "OVERALL");
  try {
    // The rule: every live shoot completed, a rejected one set aside, at least one completed.
    assert.equal(productionComplete([]), false, "no shoots, nothing completed");
    assert.equal(productionComplete([{ production: done }, { production: null }]), false, "a shoot not on the board yet");
    assert.equal(productionComplete([{ production: done }, { production: { currentStep: "SHOOT_STATUS", shootStatus: "REJECT" } }]), true);
    assert.equal(productionComplete([{ production: { currentStep: "DONE" } }]), false, "a plan never submitted");
    // The Overall Feedback also waits for every shoot's own feedback - a rejected shoot set aside - and
    // for the project to be Delivered, under Projects → Completed.
    const rejected = { production: { currentStep: "SHOOT_STATUS", shootStatus: "REJECT" }, feedback: [] };
    const delivered = (shoots) => ({ projectStatus: "Delivered", shoots });
    assert.equal(overallFeedbackOpen(delivered([{ production: done, feedback: [{ id: "f" }] }, rejected])), true);
    assert.equal(overallFeedbackOpen(delivered([{ production: done, feedback: [{ id: "f" }] }, { production: done, feedback: [] }])), false, "a shoot's feedback still to give");
    assert.equal(overallFeedbackOpen(delivered([{ production: done }])), false, "no feedback read is none given");
    assert.equal(overallFeedbackOpen({ projectStatus: "Work in Progress - Post Production", shoots: [{ production: done, feedback: [{ id: "f" }] }] }), false, "not Delivered yet");

    await shoot("one", done);
    const running = await shoot("two", { planSubmittedAt: new Date(), currentStep: "SHOOT_STATUS" });
    // One shoot still running: not yet, and it cannot be given.
    assert.equal(await overallWaiting(), false);
    await assert.rejects(createFeedback({ input: { projectId: project.id, stage: "OVERALL", review: "Good", feedback: "x" }, userId: F.login.id }), (error) => error.status === 409);
    // A shoot's feedback with no shoot is refused, never matched to one of the project's; a shoot
    // on any other stage, or a stage not asked for, is refused too.
    await assert.rejects(createFeedback({ input: { projectId: project.id, stage: "SHOOT_COMPLETION", review: "Good", feedback: "x" }, userId: F.login.id }), (error) => error.status === 400);
    await assert.rejects(createFeedback({ input: { projectId: project.id, stage: "OVERALL", shootId: running.id, review: "Good", feedback: "x" }, userId: F.login.id }), (error) => error.status === 400);
    await assert.rejects(createFeedback({ input: { projectId: project.id, stage: "PROJECT_COMPLETED", review: "Good", feedback: "x" }, userId: F.login.id }), (error) => error.status === 400);

    // The last one completes - a rejected one beside it set aside. Not yet: the Overall Feedback is the
    // project's last, so it waits for every shoot's feedback too.
    await prisma.projectProduction.update({ where: { shootId: running.id }, data: { currentStep: "DONE", shootStatus: "COMPLETED" } });
    await shoot("rejected", { planSubmittedAt: new Date(), currentStep: "SHOOT_STATUS", shootStatus: "REJECT" });
    assert.equal(await overallWaiting(), false);
    await assert.rejects(
      createFeedback({ input: { projectId: project.id, stage: "OVERALL", review: "Good", feedback: "x" }, userId: F.login.id }),
      (error) => error.status === 409 && /every shoot's Shoot Completion Feedback/.test(error.message),
    );
    // Each shoot's feedback in the order given: -02 and -03, with 01 kept for the New Project Feedback.
    const first = await prisma.projectShoot.findFirst({ where: { projectId: project.id, shootId: tag("ov-one") }, select: { id: true } });
    const second = await createFeedback({ input: { projectId: project.id, stage: "SHOOT_COMPLETION", shootId: running.id, review: "Good", feedback: "Second shoot first." }, userId: F.login.id });
    assert.match(second.feedbackCode, /-02$/);
    assert.equal(await overallWaiting(), false, "one shoot's feedback still to give");
    const third = await createFeedback({ input: { projectId: project.id, stage: "SHOOT_COMPLETION", shootId: first.id, review: "Good", feedback: "Then the first." }, userId: F.login.id });
    assert.equal(third.feedbackCode, `${second.feedbackCode.slice(0, -3)}-03`, "one Feedback ID for the project");
    // Every shoot's feedback given, and still not until the project is Delivered - Projects → Completed.
    assert.equal(await overallWaiting(), false, "not Delivered yet");
    await assert.rejects(
      createFeedback({ input: { projectId: project.id, stage: "OVERALL", review: "Good", feedback: "x" }, userId: F.login.id }),
      (error) => error.status === 409 && /Projects → Completed/.test(error.message),
    );
    await prisma.salesProject.update({ where: { id: project.id }, data: { projectStatus: "Delivered" } });
    assert.equal(await overallWaiting(), true);
    // A deleted or unknown project is not found.
    await assert.rejects(createFeedback({ input: { projectId: "no-such-project", stage: "OVERALL", review: "Good", feedback: "x" }, userId: F.login.id }), (error) => error.status === 404);
    const row = ours(await pendingFeedback()).find((entry) => entry.projectKey === project.id && entry.stage === "OVERALL");
    assert.equal(row.id, `project:${project.id}:OVERALL`);
    assert.equal(row.stageLabel, "Overall Feedback");
    assert.equal(row.shootKey, null);

    // Two at the same moment: one kept, the other refused naming it.
    const outcomes = await Promise.allSettled([1, 2].map((n) => createFeedback({ input: { projectId: project.id, stage: "OVERALL", review: "Excellent", feedback: `A wonderful wedding ${n}.` }, userId: F.login.id })));
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    const saved = outcomes.find((outcome) => outcome.status === "fulfilled").value;
    assert.match(outcomes.find((outcome) => outcome.status === "rejected").reason.message, new RegExp(saved.feedbackCode));
    assert.equal(await prisma.projectFeedback.count({ where: { projectId: project.id, stage: "OVERALL" } }), 1);
    assert.equal(saved.stage, "OVERALL");
    assert.equal(saved.status, "Completed");
    // The last version of the project's Feedback ID; its New Project Feedback, given after it, is still 01.
    assert.equal(saved.feedbackCode, `${second.feedbackCode.slice(0, -3)}-04`);
    // An Overall Feedback's issue is Post Production's: tried on a second project, its shoots completed too.
    const undoTasks = await grant(F.login, "HRM", "Task Management");
    try {
      const other = await F.project("overall-poor");
      const wedding = await prisma.projectShoot.create({ data: { projectId: other.id, shootId: tag("ov-poor"), shoot: "Wedding", shootPlace: "Studio", district: "Erode", state: "Tamil Nadu", production: { create: { salesProjectId: other.id, ...done } } } });
      // Its shoot's feedback given and the project Delivered, as the Overall Feedback waits for both.
      await createFeedback({ input: { projectId: other.id, stage: "SHOOT_COMPLETION", shootId: wedding.id, review: "Good", feedback: "Lovely." }, userId: F.login.id });
      await prisma.salesProject.update({ where: { id: other.id }, data: { projectStatus: "Delivered" } });
      const poor = await createFeedback({ input: { projectId: other.id, stage: "OVERALL", review: "Average", feedback: "Album late.", assignees: { REVIEW: F.login.id } }, userId: F.login.id });
      const issue = await prisma.projectFeedbackIssue.findFirst({ where: { feedbackId: poor.id }, include: { task: true } });
      assert.equal(issue.task.department, "Post Production");
      // All of that project's feedback goes - its shoot's too - so no later test reads it.
      await prisma.projectFeedback.deleteMany({ where: { projectId: other.id } });
      await prisma.hrmTask.deleteMany({ where: { id: issue.taskId } });
    } finally { await undoTasks(); }
    assert.equal(await overallWaiting(), false, "given, so no longer waiting");
    // Once per project, and apart from its New Project Feedback, which still waits.
    await assert.rejects(createFeedback({ input: { projectId: project.id, stage: "OVERALL", review: "Good", feedback: "Again." }, userId: F.login.id }), (error) => error.status === 409 && error.message.includes(saved.feedbackCode));
    assert.ok(ours(await pendingFeedback()).some((entry) => entry.projectKey === project.id && entry.stage === "NEW_PROJECT"));
    // Given after the Overall Feedback, the New Project Feedback still takes version 01.
    const late = await createFeedback({ input: { projectId: project.id, review: "Good", feedback: "Given late." }, userId: F.login.id });
    assert.equal(late.feedbackCode, `${second.feedbackCode.slice(0, -3)}-01`);
    await prisma.projectFeedback.deleteMany({ where: { projectId: project.id } });
  } finally { await undo(); }
});

test("an Average or Poor review is given to somebody as a task, and their answer moves the feedback", async () => {
  const tasks = require("../src/modules/hrm/tasks/service");
  const undo = await grant(F.login, "PROJECT", "Feedback");
  const project = await F.project("tk-new");
  // Nobody assigned to a Poor review: refused, saying so.
  await assert.rejects(
    createFeedback({ input: { projectId: project.id, review: "Poor", feedback: "Late album." }, userId: F.login.id }),
    (error) => error.status === 400 && error.message === "Assign someone to the review - it is Poor.",
  );
  // Somebody who cannot open Tasks cannot be given one: refused, and not offered.
  await assert.rejects(
    createFeedback({ input: { projectId: project.id, review: "Poor", feedback: "x", assignees: { REVIEW: F.login.id } }, userId: F.login.id }),
    (error) => error.status === 400 && /HRM \/ Task Management/.test(error.message),
  );
  assert.equal((await feedbackAssignees()).some((user) => user.id === F.login.id), false);
  const undoTasks = await grant(F.login, "HRM", "Task Management");
  const actor = { id: F.login.id, name: F.login.name, role: F.login.role };
  try {
    assert.equal((await feedbackAssignees()).some((user) => user.id === F.login.id), true);
    const given = await createFeedback({ input: { projectId: project.id, review: "Poor", feedback: "Late album.", assignees: { REVIEW: F.login.id } }, userId: F.login.id });
    assert.equal(given.status, "Issues");
    assert.deepEqual(given.issues.map((issue) => [issue.reviewLabel, issue.review, issue.assignedTo, issue.taskStatus, issue.status]), [["Review", "Poor", F.login.name, "Pending", "Open"]]);
    const issue = await prisma.projectFeedbackIssue.findFirst({ where: { feedbackId: given.id }, include: { task: true } });
    assert.equal(issue.task.priority, "HIGH");
    assert.equal(issue.task.taskType, "Feedback");
    // A New Project Feedback's issue is the sale's to sort out, whoever it is given to.
    assert.equal(issue.task.department, "Sales");
    // The project's Feedback ID with its version - the New Project Feedback is always -01.
    assert.match(issue.task.description, /New Project Feedback DBS-FB-\d+-01 on WED tk-new/);
    assert.doesNotMatch(issue.task.description, /shoot/);
    await tasks.transition(issue.taskId, "resolve", actor, { outcome: "Issues sorted", remarks: "Album delivered." });
    assert.equal((await prisma.projectFeedback.findUnique({ where: { id: given.id }, select: { status: true } })).status, "Issues sorted");
    await prisma.projectFeedback.deleteMany({ where: { id: given.id } });
    await prisma.hrmTask.deleteMany({ where: { id: issue.taskId } });
  } finally { await undoTasks(); await undo(); }
});

test("a reader sees only the feedback they gave, read with its stage and project", async () => {
  const undo = await grant(F.login, "PROJECT", "Feedback");
  try {
    const mine = await myFeedback(F.mine, { review: "Excellent", feedback: "Great energy.", status: "Completed" });
    await myFeedback(F.theirs, { review: "Good", feedback: "Helped on the day.", status: "Completed" });
    // Somebody else's feedback - even on the reader's own project - is not theirs to see by default.
    await othersFeedback(await F.project("others-1", F.stranger), { review: "Poor", feedback: "Somebody else's." });
    await othersFeedback(await F.project("others-2"), { review: "Average", feedback: "Another reviewer." });

    const listed = ours(await listFeedback({ userId: F.login.id }));
    assert.deepEqual(
      listed.map((row) => [row.eventId, row.review, row.feedback]).sort(),
      [[tag("mine"), "Excellent", "Great energy."], [tag("theirs"), "Good", "Helped on the day."]].sort(),
    );
    const row = listed.find((entry) => entry.id === mine.id);
    assert.equal(row.stageLabel, "New Project Feedback");
    assert.equal(row.givenBy, `Feedback Reviewer ${STAMP}`);
    assert.equal(row.projectKey, F.mine.id);
    assert.equal(row.branch, F.br.name);
    assert.equal(row.clientName, `WED mine ${STAMP}`);
    // The list is the feedback given; the projects waiting are `pendingFeedback`'s.
    assert.ok(listed.every((entry) => entry.feedbackCode && !entry.pending));
  } finally { await undo(); }
});

test("View All Feedback shows everybody's feedback in the branches of the role granting it", async () => {
  const undoFeedback = await grant(F.login, "PROJECT", "Feedback");
  const undoAll = await grant(F.login, "PROJECT", "View All Feedback");
  try {
    // A project in a second branch, which the granting role does not name, with somebody's feedback.
    const far = await prisma.branch.create({ data: { code: tag("BR2"), name: `Feedback Far Branch ${STAMP}` } });
    await leadFor(tag("enq-far"));
    const farProject = await prisma.salesProject.create({ data: {
      enquiryId: tag("enq-far"), eventId: tag("far"), whatsappGroupName: `WED far ${STAMP}`, clientMainNumber: "+919876543210",
      sourceBranch: far.name, branchId: far.id, vertical: "WED", deliverables: "[]", initialConvertedValue: 0, crmName: "Test",
    } });
    await othersFeedback(farProject, { review: "Good", feedback: "In another branch." });

    const listed = ours(await listFeedback({ userId: F.login.id }));
    // Both projects are in the test branch the grant reaches, so every feedback written above shows;
    // a project in a branch the grant does not reach keeps its feedback out.
    assert.deepEqual(
      listed.map((row) => row.feedback).sort(),
      ["Another reviewer.", "Great energy.", "Helped on the day.", "Somebody else's."],
    );
  } finally { await undoAll(); await undoFeedback(); }
});


test("a Production Completion and a Project Completed Feedback already given read back with their parts", async () => {
  const undo = await grant(F.login, "PROJECT", "Feedback");
  try {
    const pc = await myFeedback(await F.project("pc-old"), {
      stage: "PRODUCTION_COMPLETION", review: "Average", feedback: null, status: "Completed", referralName: "Anand", referralMobile: "+91 9876543210",
      areas: { create: [{ area: "SALES", review: "Good", feedback: "Quick." }, { area: "PRODUCTION", review: "Average", feedback: "Late start." }] },
      employees: { create: [{ employeeId: F.me.id, kind: "APPRECIATED" }] },
    });
    const pcf = await myFeedback(await F.project("pcf-old"), {
      stage: "PROJECT_COMPLETED", review: "Good", feedback: null, status: "Completed", overallExperience: "Good", suggestion: "More candids.",
      areas: { create: [{ area: "POST_PRODUCTION", review: "Good", feedback: "On time." }] },
    });
    const listed = ours(await listFeedback({ userId: F.login.id }));
    const readPc = listed.find((row) => row.id === pc.id);
    assert.equal(readPc.stageLabel, "Production Completion Feedback");
    assert.equal(readPc.salesReview, "Good");
    assert.equal(readPc.productionFeedback, "Late start.");
    assert.equal(readPc.appreciated, `Feedback me ${STAMP}`);
    assert.equal(readPc.feedback, "Sales (Good): Quick.\nProduction (Average): Late start.");
    const readPcf = listed.find((row) => row.id === pcf.id);
    assert.equal(readPcf.stageLabel, "Project Completed Feedback");
    assert.equal(readPcf.postProductionFeedback, "On time.");
    assert.equal(readPcf.suggestion, "More candids.");
  } finally { await undo(); }
});

test("a deleted project takes its feedback off the list", async () => {
  const undo = await grant(F.login, "PROJECT", "Feedback");
  const project = await F.project("del-later");
  try {
    const given = await myFeedback(project, { review: "Good", feedback: "Before it was deleted.", status: "Completed" });
    assert.ok(ours(await listFeedback({ userId: F.login.id })).some((row) => row.id === given.id));
    await prisma.salesProject.update({ where: { id: project.id }, data: { deletedAt: new Date() } });
    assert.equal(ours(await listFeedback({ userId: F.login.id })).some((row) => row.id === given.id), false);
  } finally { await undo(); }
});

test("a feedback under Issues moves on to Issues sorted or Rejected - once, and only from Issues", async () => {
  assert.deepEqual(ISSUE_OUTCOMES, ["Issues sorted", "Rejected"]);
  // Only the two outcomes are taken.
  assert.equal(issueStatusSchema.safeParse({ status: "Issues sorted" }).success, true);
  assert.equal(issueStatusSchema.safeParse({ status: "Completed" }).success, false);
  assert.equal(issueStatusSchema.safeParse({}).success, false);
  // A rejection must say why; Issues sorted may leave the remark blank. Both are trimmed.
  assert.equal(issueStatusSchema.safeParse({ status: "Rejected" }).success, false);
  assert.equal(issueStatusSchema.safeParse({ status: "Rejected", remarks: "   " }).error?.issues[0]?.message, "Give the reason for rejecting it.");
  assert.equal(issueStatusSchema.safeParse({ status: "Rejected", remarks: " Client withdrew the complaint. " }).data?.remarks, "Client withdrew the complaint.");
  assert.equal(issueStatusSchema.safeParse({ status: "Issues sorted", remarks: "" }).data?.remarks, "");
  assert.equal(issueStatusSchema.safeParse({ status: "Issues sorted", remarks: "x".repeat(1001) }).success, false);

  const undo = await grant(F.login, "PROJECT", "Feedback");
  try {
    // Feedback given before reviews became tasks - the only kind the Feedback page moves by hand.
    const give = async (name, review, feedback) => toListed(await prisma.projectFeedback.create({ data: {
      // Each on a project of its own, so each is its project's version 01.
      feedbackCode: fixtureCode(), feedbackVersion: 1, projectId: (await F.project(name)).id, review, feedback,
      status: review === "Good" ? "Completed" : "Issues", createdByUserId: F.login.id,
    } }));
    const poor = await give("is-poor", "Poor", "Album was late.");
    const average = await give("is-average", "Average", "Too few candids.");
    const good = await give("is-good", "Good", "Fine.");

    const sorted = await resolveIssue({ feedbackId: poor.id, status: "Issues sorted", remarks: "", userId: F.login.id });
    assert.equal(sorted.status, "Issues sorted");
    assert.equal(sorted.feedback, "Album was late.");
    // No remark is kept as none; who moved it, and when, are kept either way.
    assert.equal(sorted.issueRemarks, "");
    assert.equal(sorted.issueResolvedBy, F.login.name);
    assert.ok(sorted.issueResolvedAt instanceof Date);
    const rejected = await resolveIssue({ feedbackId: average.id, status: "Rejected", remarks: "Candids were within the package.", userId: F.login.id });
    assert.equal(rejected.status, "Rejected");
    assert.equal(rejected.issueRemarks, "Candids were within the package.");
    assert.equal((await prisma.projectFeedback.findUnique({ where: { id: average.id }, select: { issueResolvedByUserId: true } })).issueResolvedByUserId, F.login.id);
    // A rejection without a reason is refused by the service too, and leaves it under Issues.
    const third = await give("is-third", "Poor", "Late delivery.");
    await assert.rejects(resolveIssue({ feedbackId: third.id, status: "Rejected", remarks: "  ", userId: F.login.id }), (error) => error.status === 400);
    assert.equal((await prisma.projectFeedback.findUnique({ where: { id: third.id }, select: { status: true } })).status, "Issues");
    // Already moved, or never under Issues: refused, not repainted - and the first remark stands.
    await assert.rejects(resolveIssue({ feedbackId: average.id, status: "Issues sorted", remarks: "Overwrite?", userId: F.login.id }), (error) => error.status === 409);
    assert.equal((await prisma.projectFeedback.findUnique({ where: { id: average.id }, select: { issueRemarks: true } })).issueRemarks, "Candids were within the package.");
    await assert.rejects(resolveIssue({ feedbackId: poor.id, status: "Rejected", remarks: "Late.", userId: F.login.id }), (error) => error.status === 409);
    await assert.rejects(resolveIssue({ feedbackId: good.id, status: "Issues sorted", userId: F.login.id }), (error) => error.status === 409);
    // Somebody else's feedback is not the caller's to move.
    const theirs = await othersFeedback(await F.project("is-theirs"), { review: "Poor", feedback: "Not the caller's.", status: "Issues" });
    await assert.rejects(resolveIssue({ feedbackId: theirs.id, status: "Issues sorted", userId: F.login.id }), (error) => error.status === 404);
    assert.equal((await prisma.projectFeedback.findUnique({ where: { id: theirs.id }, select: { status: true } })).status, "Issues");
  } finally { await undo(); }
});


test("an issue on a feedback is not moved by hand on the page, only answered from its task", async () => {
  const tasks = require("../src/modules/hrm/tasks/service");
  const undo = await grant(F.login, "PROJECT", "Feedback");
  const undoTasks = await grant(F.login, "HRM", "Task Management");
  const actor = { id: F.login.id, name: F.login.name, role: F.login.role };
  try {
    const given = await myFeedback(await F.project("tk-np"), { review: "Poor", feedback: "Late album.", status: "Issues" });
    const task = await prisma.hrmTask.create({ data: { taskCode: tag("TK1"), title: "Feedback issue", description: "x", taskType: "Feedback", priority: "HIGH", assignedToUserId: F.login.id, assignedToName: F.login.name, assignedByUserId: F.login.id, assignedByName: F.login.name } });
    await prisma.projectFeedbackIssue.create({ data: { feedbackId: given.id, reviewKey: "REVIEW", review: "Poor", taskId: task.id } });

    const listed = await toListed(given);
    assert.equal(listed.hasIssues, true);
    assert.deepEqual(listed.issues.map((issue) => [issue.reviewLabel, issue.review, issue.assignedTo, issue.taskStatus, issue.status]), [["Review", "Poor", F.login.name, "Pending", "Open"]]);
    // Not moved by hand on the page: answered from the task.
    await assert.rejects(resolveIssue({ feedbackId: given.id, status: "Issues sorted", userId: F.login.id }), (error) => error.status === 409);
    await tasks.transition(task.id, "resolve", actor, { outcome: "Issues sorted", remarks: "Album delivered." });
    const after = await prisma.projectFeedback.findUnique({ where: { id: given.id }, select: { status: true, issueRemarks: true } });
    assert.equal(after.status, "Issues sorted");
    assert.equal(after.issueRemarks, "Review - Issues sorted: Album delivered.");
  } finally { await undoTasks(); await undo(); }
});

test("Give Feedback over many rows: one request per 500, every row still checked, a refusal does not stop the rest", async () => {
  // A batch of 60 new projects, one of them already given its New Project Feedback.
  const projects = [];
  for (let index = 0; index < 60; index += 1) projects.push(await F.project(`bulk-${index}`));
  await createFeedback({ input: { projectId: projects[0].id, review: "Good", feedback: "Given first." }, userId: F.login.id });

  const items = projects.map((project) => ({ projectId: project.id, stage: "NEW_PROJECT" }));
  const started = Date.now();
  const { saved, refused } = await createFeedbackMany({ items, common: { review: "Good", feedback: "Bulk Movement" }, userId: F.login.id });
  const took = Date.now() - started;

  assert.equal(saved.length, 59);
  assert.equal(refused.length, 1, "the one already given is refused, the rest go in");
  assert.equal(refused[0].projectId, projects[0].id);
  assert.match(refused[0].message, /already has its New Project Feedback/);
  // Each its own Feedback ID, filed by its review, read with its project.
  assert.equal(new Set(saved.map((row) => row.feedbackCode)).size, 59);
  for (const row of saved) {
    assert.match(row.feedbackCode, new RegExp(`^${FEEDBACK_CODE_PREFIX}\\d{5,}-01$`));
    assert.equal(row.status, "Completed");
    assert.equal(row.feedback, "Bulk Movement");
  }
  assert.equal(await prisma.projectFeedback.count({ where: { projectId: { in: projects.map((project) => project.id) }, stage: "NEW_PROJECT" } }), 60);
  // Saved several at a time rather than one after another: 59 rows well inside the time one-by-one took.
  assert.ok(took < 20000, `59 rows took ${took} ms`);

  // Again: every row is now given, so every row is refused - and nothing is written twice.
  const again = await createFeedbackMany({ items, common: { review: "Good", feedback: "Again" }, userId: F.login.id });
  assert.equal(again.saved.length, 0);
  assert.equal(again.refused.length, 60);
});

test("the bulk request takes at most 500 rows and the shared review and feedback, and checks each row's shoot", () => {
  assert.equal(BULK_MAX_ITEMS, 500);
  const item = { projectId: "p1" };
  assert.equal(bulkSchema.safeParse({ items: [item], review: "Good", feedback: "x" }).success, true);
  assert.equal(bulkSchema.safeParse({ items: [], review: "Good", feedback: "x" }).success, false);
  assert.equal(bulkSchema.safeParse({ items: Array.from({ length: 501 }, () => item), review: "Good", feedback: "x" }).success, false);
  assert.equal(bulkSchema.safeParse({ items: [item], review: "Good", feedback: "  " }).success, false);
  // A Shoot Completion item names its shoot; no other item does.
  assert.equal(bulkSchema.safeParse({ items: [{ projectId: "p1", stage: "SHOOT_COMPLETION" }], review: "Good", feedback: "x" }).success, false);
  assert.equal(bulkSchema.safeParse({ items: [{ projectId: "p1", stage: "NEW_PROJECT", shootId: "s1" }], review: "Good", feedback: "x" }).success, false);
  const routes = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "project-management", "feedback", "routes.js"), "utf8");
  assert.match(routes, /router\.post\("\/bulk", createMany\);/);
});
