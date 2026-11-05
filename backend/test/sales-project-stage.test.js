const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { projectStage, recordStageUpdate } = require("../src/modules/sales/projects/stage");

const shoot = (id, production) => ({ id, shoot: `Shoot ${id}`, dateCreated: null, production });
const states = (result) => result.stages.map((stage) => `${stage.id}:${stage.state}`);

test("a project not yet started is at Project started", () => {
  const result = projectStage({ projectStatus: "Yet to Start", shoots: [shoot(1, null)] });
  assert.deepEqual(states(result), ["STARTED:current", "PRE_PRODUCTION:upcoming", "PRODUCTION:upcoming", "POST_PRODUCTION:upcoming", "DELIVERED:upcoming"]);
  assert.equal(result.flag, null);
});

test("a started project stays in Pre Production until every shoot's production plan is submitted", () => {
  const result = projectStage({ projectStatus: "Work in Progress - Pre & Production", shoots: [shoot(1, { planSubmittedAt: new Date(), currentStep: "STARTED_FROM_STUDIO" }), shoot(2, null)] });
  assert.deepEqual(states(result).slice(0, 3), ["STARTED:done", "PRE_PRODUCTION:current", "PRODUCTION:upcoming"]);
  const pre = result.stages[1];
  assert.equal(pre.done, 1);
  assert.equal(pre.total, 2);
});

test("a Pre Production or Production status set by hand overrides the stage, and leaves the shoots as they are", () => {
  const at = new Date("2026-10-13");
  const result = projectStage({
    projectStatus: "In Progress",
    preProductionStatus: "PLANNED", preProductionStatusAt: at, preProductionStatusByUser: { name: "Admin" },
    productionStatus: "HOLD", productionStatusRemarks: "Client asked to wait", productionStatusAt: at, productionStatusByUser: { name: "Anu" },
    shoots: [shoot(1, null), shoot(2, null)],
  });
  // Planned by hand finishes Pre Production though no plan is submitted.
  assert.deepEqual(states(result).slice(0, 3), ["STARTED:done", "PRE_PRODUCTION:done", "PRODUCTION:current"]);
  assert.deepEqual(result.stages[1].setStatus, { status: "PLANNED", remarks: null, at, by: "Admin" });
  assert.deepEqual(result.stages[2].setStatus, { status: "HOLD", remarks: "Client asked to wait", at, by: "Anu" });
  // The shoots are untouched: still awaiting their plans.
  assert.deepEqual(result.stages[1].shoots.map((item) => item.planned), [false, false]);
  // Production set to Planned is shown, but Production is done only once the shoots are shot.
  const planned = projectStage({ projectStatus: "In Progress", productionStatus: "PLANNED", shoots: [shoot(1, { planSubmittedAt: at, currentStep: "STARTED_FROM_STUDIO" })] });
  assert.equal(planned.stages[2].state, "current");
  assert.equal(planned.stages[2].setStatus.status, "PLANNED");
  // Nothing set by hand, nothing said.
  assert.equal(projectStage({ projectStatus: "In Progress", shoots: [] }).stages[1].setStatus, null);
});

test("the Pre Production stage carries the CRD document only when it applies: submitted or not", () => {
  const base = { projectStatus: "In Progress", vertical: "QQ", shoots: [] };
  assert.equal(projectStage({ ...base, crdDocumentStatus: "Not Applicable" }).stages[1].crd, null);
  assert.equal(projectStage({ ...base, crdDocumentStatus: null }).stages[1].crd, null, "not answered, not shown");
  assert.deepEqual(projectStage({ ...base, crdDocumentStatus: "Applicable" }).stages[1].crd, { documentId: null, submitted: false, submittedAt: null });
  const submittedAt = new Date("2026-10-10");
  assert.deepEqual(projectStage({ ...base, crdDocumentStatus: "Applicable", crdDocument: { id: "doc-1", submittedAt } }).stages[1].crd, { documentId: "doc-1", submitted: true, submittedAt });
});

test("the CRD View reads the project's own document, read-only, behind the register's readers", () => {
  const routes = fs.readFileSync(path.join(__dirname, "../src/modules/sales/projects/routes.js"), "utf8");
  assert.match(routes, /router\.get\("\/projects\/:id\/crd-response", readsTheRegister, getProjectCrdResponse\);/);
  const stage = fs.readFileSync(path.join(__dirname, "../src/modules/sales/projects/stage.js"), "utf8");
  // The project is held to the reader's scope, and so is the document read through it.
  assert.match(stage, /where: \{ id: req\.params\.id, deletedAt: null, AND: \[access\] \},\n      select: \{ crdDocument:/);
  assert.match(stage, /readResponse\(project\.crdDocument\.id, \{ access \}\)/);
  assert.doesNotMatch(stage, /ensureResponseLink/, "nothing here issues a share link");
});

test("Production counts finished shoots and says what each one is waiting on", () => {
  const result = projectStage({
    projectStatus: "Work in Progress - Pre & Production",
    productionManagerEmployee: { employeeName: "Anu" },
    shoots: [
      shoot(1, { planSubmittedAt: new Date(), currentStep: "DONE" }),
      shoot(2, { planSubmittedAt: new Date(), currentStep: "SHOOT_STARTED" }),
    ],
  });
  const production = result.stages[2];
  assert.equal(production.state, "current");
  assert.equal(production.person, "Anu");
  assert.equal(production.done, 1);
  assert.equal(production.shoots[1].pending, "Step 4/7 · Shoot started");
});

test("every shoot done moves the project to Post Production; the project's status never finishes Pre Production or Production", () => {
  const allDone = projectStage({ projectStatus: "Work in Progress - Pre & Production", shoots: [shoot(1, { planSubmittedAt: new Date(), currentStep: "DONE" })] });
  assert.equal(allDone.stages[3].state, "current");
  // An old Post Production status, or Completed, leaves the department stages to their own statuses.
  const post = projectStage({ projectStatus: "Work in Progress - Post Production", shoots: [shoot(1, null)] });
  assert.deepEqual(states(post), ["STARTED:done", "PRE_PRODUCTION:current", "PRODUCTION:upcoming", "POST_PRODUCTION:upcoming", "DELIVERED:upcoming"]);
  const completed = projectStage({ projectStatus: "Completed", shoots: [shoot(1, null)] });
  assert.deepEqual(states(completed), ["STARTED:done", "PRE_PRODUCTION:current", "PRODUCTION:upcoming", "POST_PRODUCTION:done", "DELIVERED:done"]);
  // With every shoot shot, a Completed project is done throughout.
  const finished = projectStage({ projectStatus: "Completed", shoots: [shoot(1, { planSubmittedAt: new Date(), currentStep: "DONE" })] });
  assert.ok(finished.stages.every((stage) => stage.state === "done"));
});

test("a stopped project carries a flag and keeps how far it got", () => {
  const result = projectStage({ projectStatus: "On Hold", shoots: [shoot(1, null)] });
  assert.equal(result.flag, "On Hold");
  assert.equal(result.stages[0].state, "done");
});

test("the stage is read by whoever reads the project register; updating it stays the planner's", () => {
  const routes = fs.readFileSync(path.join(__dirname, "../src/modules/sales/projects/routes.js"), "utf8");
  assert.match(routes, /router\.get\("\/projects\/:id\/stage", readsTheRegister, getProjectStage\);/);
  assert.match(routes, /router\.post\("\/projects\/:id\/stage\/updates", plansAProject, editsAStartedProject, recordStageUpdate\);/);
});

test("each stage carries its own facts - who converted the project, and what the later stages have", () => {
  const result = projectStage({
    projectStatus: "Work in Progress - Pre & Production",
    crmEmployee: { employeeName: "Kavin" },
    createdAt: new Date("2026-09-01T00:00:00Z"),
    initialConvertedValue: "150000.00",
    branch: { name: "Chennai" },
    preProductionCoordinatorEmployee: { employeeName: "Sneha" },
    shoots: [shoot(1, { planSubmittedAt: new Date(), currentStep: "STARTED_FROM_STUDIO" })],
  });
  const started = Object.fromEntries(result.stages[0].facts.map((item) => [item.label, item]));
  assert.equal(started["Converted by"].value, "Kavin");
  assert.equal(started["Converted value"].value, 150000);
  assert.equal(started["Converted value"].kind, "money");
  assert.equal(started.Branch.value, "Chennai");
  assert.equal(result.stages[1].facts[0].value, "Sneha");
  assert.equal(result.stages[1].facts[2].value, "1 of 1");
  assert.deepEqual(result.stages[4].facts, []);
});

test("a stage update's remark is written only behind the started-project editor guards", () => {
  const routes = fs.readFileSync(path.join(__dirname, "../src/modules/sales/projects/routes.js"), "utf8");
  assert.match(routes, /router\.post\("\/projects\/:id\/stage\/updates", plansAProject, editsAStartedProject, recordStageUpdate\);/);
});

test("the remarks left on stage updates come back newest first, named by the stage and the person", () => {
  const at = new Date("2026-10-01T10:00:00Z");
  const result = projectStage({
    projectStatus: "Work in Progress - Pre & Production",
    shoots: [shoot(1, { planSubmittedAt: null, currentStep: "STARTED_FROM_STUDIO" }), shoot(2, null)],
    stageUpdates: [{ id: 3, stage: "PRE_PRODUCTION", remark: "Venue changed", userName: "Old name", createdAt: at, user: { name: "Meena" } }],
  });
  assert.deepEqual(result.updates, [{ id: 3, stage: "PRE_PRODUCTION", stageLabel: "Pre Production", remark: "Venue changed", by: "Meena", at }]);
  // Only a shoot whose production was raised can be opened from the Production stage.
  assert.deepEqual(result.stages[2].shoots.map((item) => item.hasProduction), [true, false]);
});

test("a stage update needs a stage with an editor and a remark", async () => {
  const reply = () => {
    const res = { statusCode: 200, body: null };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    return res;
  };
  for (const body of [{ stage: "DELIVERED", remark: "Done" }, { stage: "PRE_PRODUCTION", remark: "   " }, { stage: "PRODUCTION", remark: "x".repeat(2001) }]) {
    const res = reply();
    await recordStageUpdate({ params: { id: "p1" }, body, user: { id: 1 } }, res);
    assert.equal(res.statusCode, 400);
  }
});

test("the stage says whether this reader may open the project's own form, and defaults to no", () => {
  /*
   * Project Initiation's Update opens the project's details, so the two rules the save answers to
   * decide whether it is offered at all: the permission that opens the form, and - once the project
   * has started - being its Project Manager, a branch administrator or whoever works every project
   * (`maySeeStartedEditor` → `mayEditStartedProject`). The flag travels with the stage because the
   * browser knows neither rule.
   *
   * Defaulted to false, not true: a reader whose permission nobody asked about is offered nothing
   * rather than a button that opens onto a refusal.
   */
  assert.equal(projectStage({ projectStatus: "Yet to Start", shoots: [] }).canUpdateStarted, false);
  assert.equal(projectStage({ projectStatus: "Yet to Start", shoots: [] }, {}, true).canUpdateStarted, true);
  const source = fs.readFileSync(path.join(__dirname, "../src/modules/sales/projects/stage.js"), "utf8");
  // Both halves, in the order the save asks them.
  assert.match(source, /iamService\.hasPermission\(user\.id, "PROJECT", "Projects", "READ_WRITE"\)/);
  assert.match(source, /if \(!plansProjects && !everyProject\) return false;\s+return mayEditStartedProject\(project, user\);/);
  // And what the board needs to hand the project over: its own code.
  assert.match(source, /data: \{ eventId: project\.eventId \|\| null, \.\.\.projectStage\(project, handed, await maySeeStartedEditor\(project, req\.user\)\) \}/);
});
