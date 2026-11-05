const test = require("node:test");
const assert = require("node:assert/strict");
const { shootStage } = require("../src/modules/schedule/calendar/service");

// Which board a calendar shoot opens on: Production once its plan is submitted (or Pre Production is
// set Planned by hand) and it has a production record; Pre Production once started; else Projects.
test("a shoot opens on the board it is worked on now", () => {
  const started = { projectStatus: "In Progress", preProductionStatus: null };
  assert.equal(shootStage({ project: { projectStatus: "Yet to Start" }, preProduction: { id: "x" } }), "projects");
  assert.equal(shootStage({ project: started, preProduction: { id: "x" }, production: { planSubmittedAt: null } }), "pre-production");
  assert.equal(shootStage({ project: started, preProduction: { id: "x" }, production: { planSubmittedAt: new Date() } }), "production");
  assert.equal(shootStage({ project: { ...started, preProductionStatus: "PLANNED" }, preProduction: { id: "x" }, production: { planSubmittedAt: null } }), "production");
  assert.equal(shootStage({ project: { ...started, preProductionStatus: "PLANNED" }, preProduction: { id: "x" }, production: null }), "pre-production", "no production record to open");
  assert.equal(shootStage({ project: started, preProduction: null, production: null }), "projects");
});

test("the calendar leaves out the shoots of a deleted project, as the project boards do", () => {
  const service = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "src", "modules", "schedule", "calendar", "service.js"), "utf8");
  // The viewer narrowing beside it has gone - every employee sees every shoot - but a deleted shoot
  // and a shoot of a deleted project are still left out, exactly as the project boards leave them.
  assert.match(service, /where: \{ deletedAt: null, project: \{ deletedAt: null \}/);
});
