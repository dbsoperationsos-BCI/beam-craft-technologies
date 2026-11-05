const test = require("node:test");
const assert = require("node:assert/strict");
const { viewerManages, viewerLeads } = require("../src/modules/project-management/production/read");

/*
 * Who runs a project on the Production board, decided per row by the server: its Production Manager,
 * its Project Manager or this shoot's Production Coordinator - or whoever runs every project (a Super
 * Admin, an administrator, Show All Projects at Read / Write). Everybody else on the board is crew and
 * is shown the project only from Planned on (`lib/productionBoard.boardForViewer`).
 */

const record = { productionCoordinatorEmployeeId: 30, salesProject: { productionManagerEmployeeId: 10, projectManagerEmployeeId: 20 } };
const as = (employeeId, extra = {}) => ({ employeeId, superAdmin: false, allProjects: false, administrator: false, ...extra });

test("the project's Production Manager, Project Manager and the shoot's Coordinator run it", () => {
  assert.equal(viewerManages(record, as(10)), true);
  assert.equal(viewerManages(record, as(20)), true);
  assert.equal(viewerManages(record, as(30)), true);
});

test("a Super Admin, an administrator and Show All Projects run every project", () => {
  assert.equal(viewerManages(record, as(99, { superAdmin: true })), true);
  assert.equal(viewerManages(record, as(99, { administrator: true })), true);
  assert.equal(viewerManages(record, as(null, { allProjects: true })), true);
});

test("a Production Team member or service crew - or a login with no employee - is crew", () => {
  assert.equal(viewerManages(record, as(99)), false);
  assert.equal(viewerManages(record, as(null)), false);
  assert.equal(viewerManages({ productionCoordinatorEmployeeId: null, salesProject: {} }, as(99)), false);
});

test("the leads - Production Manager, Project Manager, the senior roles - offer every status tab; the Coordinator does not", () => {
  assert.equal(viewerLeads(record, as(10)), true);
  assert.equal(viewerLeads(record, as(20)), true);
  assert.equal(viewerLeads(record, as(30)), false, "a Coordinator runs the shoot but is not a lead");
  assert.equal(viewerLeads(record, as(99, { superAdmin: true })), true);
  assert.equal(viewerLeads(record, as(99, { administrator: true })), true);
  assert.equal(viewerLeads(record, as(null, { allProjects: true })), true);
  assert.equal(viewerLeads(record, as(99)), false);
});

test("running the steps takes Production or Production Execution at Read / Write; the plan takes Production", () => {
  const { accessFor } = require("../src/modules/project-management/production/access");
  const shoot = { productionCoordinatorEmployeeId: 30, salesProject: { productionManagerEmployeeId: 10 }, serviceCrew: [{ employeeId: 40 }], teamMembers: [] };
  const crew = (extra) => ({ employeeId: 40, superAdmin: false, allProjects: false, ...extra });
  assert.equal(accessFor(shoot, crew({ runsExecution: true })).canRunSteps, true, "Execution alone, Production only Read");
  assert.equal(accessFor(shoot, crew({ writesProduction: true })).canRunSteps, true, "Production at Read / Write includes the execution");
  assert.equal(accessFor(shoot, crew({})).canRunSteps, false, "named, but neither write");
  assert.equal(accessFor(shoot, { employeeId: 99, runsExecution: true, writesProduction: true }).canRunSteps, false, "not named on the shoot");
  // A ticket - the plan's - asks Production at Read / Write beside `canEditPlan`, its route being beside the steps'.
  assert.match(require("node:fs").readFileSync(require("node:path").join(__dirname, "../src/modules/project-management/production/execution.js"), "utf8"), /kind === "TICKET" \? !\(access\.canEditPlan && \(caller\?\.superAdmin \|\| caller\?\.allProjects \|\| caller\?\.writesProduction\)\)/);
  const routes = require("node:fs").readFileSync(require("node:path").join(__dirname, "../src/modules/project-management/production/routes.js"), "utf8");
  assert.ok(routes.indexOf('router.post("/shoots/:shootId/steps/:step", runsExecution') < routes.indexOf('router.use(requireModule("PROJECT", "Production"));'), "the step routes sit above Production's own guard");
});
