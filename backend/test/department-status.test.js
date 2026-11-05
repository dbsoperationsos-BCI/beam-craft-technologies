const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const dataScope = require("../src/services/dataScope.service");
const iamService = require("../src/services/iam.service");
const { schemaFor, setDepartmentStatus } = require("../src/modules/project-management/departmentStatus");

/*
 * A project's overall Pre Production / Production status set by hand, for one project or several -
 * the project's column alone, never a shoot.
 */
test("each department offers its own statuses; Hold and Rejected need remarks; null goes back to automatic", () => {
  const pre = schemaFor("preProduction");
  const prod = schemaFor("production");
  // Each board's own: both reach Planned and Yet to Start by hand, and Production also Completed -
  // Pre Production is done at Planned and has no Completed of its own. Only Hold and Rejected are
  // exceptions, so the rest are saved without remarks.
  assert.equal(pre.safeParse({ projectIds: ["p"], status: "PLANNED" }).success, true);
  assert.equal(prod.safeParse({ projectIds: ["p"], status: "PLANNED" }).success, true);
  assert.equal(pre.safeParse({ projectIds: ["p"], status: "YET_TO_START" }).success, true);
  assert.equal(prod.safeParse({ projectIds: ["p"], status: "YET_TO_START" }).success, true);
  assert.equal(prod.safeParse({ projectIds: ["p"], status: "COMPLETED" }).success, true);
  assert.equal(pre.safeParse({ projectIds: ["p"], status: "COMPLETED" }).success, false, "Pre Production is done at Planned");
  assert.equal(prod.safeParse({ projectIds: ["p"], status: "HOLD" }).success, false, "remarks are asked");
  assert.equal(prod.safeParse({ projectIds: ["p"], status: "REJECTED", remarks: "Client cancelled" }).success, true);
  assert.equal(pre.safeParse({ projectIds: ["p"], status: null }).success, true);
  assert.equal(pre.safeParse({ projectIds: [], status: null }).success, false);
  assert.equal(pre.safeParse({ projectIds: ["p"], status: null, shootStatus: "HOLD" }).success, false, "nothing else is written");
});

test("only the projects the caller runs are changed - their own coordinator's or manager's - the rest counted", async () => {
  const originals = [dataScope.bypassesHierarchy, iamService.hasPermission];
  dataScope.bypassesHierarchy = async () => false;
  iamService.hasPermission = async () => false;
  const writes = [];
  const client = {
    user: { findUnique: async () => ({ linkedEmployeeId: 7 }) },
    salesProject: {
      findMany: async () => [{ id: "mine", productionManagerEmployeeId: 7 }, { id: "theirs", productionManagerEmployeeId: 8 }],
      updateMany: async (args) => { writes.push(args); },
    },
    // Each change is also a line in the project's Activity.
    projectActivity: { create: async () => ({}) },
  };
  try {
    const result = await setDepartmentStatus("production", { projectIds: ["mine", "theirs", "gone"], status: "HOLD", remarks: " Rain " }, 3, { client });
    assert.deepEqual(result, { updated: 1, refused: 1, missing: 1 });
    assert.deepEqual(writes[0].where.id.in, ["mine"]);
    assert.equal(writes[0].data.productionStatus, "HOLD");
    assert.equal(writes[0].data.productionStatusRemarks, "Rain");
    assert.equal(writes[0].data.productionStatusByUserId, 3);
    // Back to automatic clears the remarks with it.
    iamService.hasPermission = async () => true;
    await setDepartmentStatus("production", { projectIds: ["theirs"], status: null, remarks: "x" }, 3, { client });
    assert.deepEqual(writes[1].where.id.in, ["mine", "theirs"], "Show All Projects reaches every project");
    assert.equal(writes[1].data.productionStatus, null);
    assert.equal(writes[1].data.productionStatusRemarks, null);
  } finally {
    [dataScope.bypassesHierarchy, iamService.hasPermission] = originals;
  }
});

test("Planned is written for the project with no remarks of its own", async () => {
  const originals = [dataScope.bypassesHierarchy, iamService.hasPermission];
  dataScope.bypassesHierarchy = async () => false;
  iamService.hasPermission = async () => true;
  const writes = [];
  const client = {
    user: { findUnique: async () => ({ linkedEmployeeId: 7 }) },
    salesProject: {
      findMany: async () => [{ id: "p", preProductionCoordinatorEmployeeId: 8 }],
      updateMany: async (args) => { writes.push(args); },
    },
    // Each change is also a line in the project's Activity.
    projectActivity: { create: async () => ({}) },
  };
  try {
    // Remarks are sent anyway - only Hold and Rejected keep them, so Planned stores none.
    const result = await setDepartmentStatus("preProduction", { projectIds: ["p"], status: "PLANNED", remarks: "Shot list ready" }, 3, { client });
    assert.deepEqual(result, { updated: 1, refused: 0, missing: 0 });
    assert.equal(writes[0].data.preProductionStatus, "PLANNED");
    assert.equal(writes[0].data.preProductionStatusRemarks, null, "Planned carries no remarks");
    assert.equal(writes[0].data.preProductionStatusByUserId, 3);
    // Hold still keeps the remarks it asked for.
    await setDepartmentStatus("preProduction", { projectIds: ["p"], status: "HOLD", remarks: " Venue moved " }, 3, { client });
    assert.equal(writes[1].data.preProductionStatusRemarks, "Venue moved");
  } finally {
    [dataScope.bypassesHierarchy, iamService.hasPermission] = originals;
  }
});

test("the routes sit on each board's guarded router, and never touch a shoot", () => {
  const read = (file) => fs.readFileSync(path.join(__dirname, "..", "src", "modules", "project-management", file), "utf8");
  assert.match(read("pre-production/routes.js"), /router\.post\("\/project-status", handlerFor\("preProduction"\)\);/);
  assert.match(read("production/routes.js"), /router\.post\("\/project-status", handlerFor\("production"\)\);/);
  assert.doesNotMatch(read("departmentStatus.js"), /projectShoot|projectPreProduction\.|projectProduction\./);
});

test("a status set by hand decides its own stage in Overall Status", () => {
  const { projectStage } = require("../src/modules/sales/projects/stage");
  const project = (extra) => ({ projectStatus: "In Progress", shoots: [{ id: "s1", shoot: "Reception", production: { planSubmittedAt: null, currentStep: "STARTED_FROM_STUDIO" } }], ...extra });
  const doneOf = (extra) => Object.fromEntries(projectStage(project(extra)).stages.map((stage) => [stage.id, stage.state === "done"]));
  // Nothing set by hand: the shoots decide, and nothing is finished here.
  assert.equal(doneOf({}).PRE_PRODUCTION, false);
  assert.equal(doneOf({}).PRODUCTION, false);
  // Each board's done status finishes its own stage, whatever the shoots have reached.
  assert.equal(doneOf({ preProductionStatus: "PLANNED" }).PRE_PRODUCTION, true);
  assert.equal(doneOf({ productionStatus: "COMPLETED" }).PRODUCTION, true);
  // Yet to Start says plainly it is not, even with every shoot through.
  const through = { shoots: [{ id: "s1", shoot: "Reception", production: { planSubmittedAt: new Date(), currentStep: "DONE" } }] };
  assert.equal(doneOf(through).PRE_PRODUCTION, true);
  assert.equal(doneOf(through).PRODUCTION, true);
  assert.equal(doneOf({ ...through, preProductionStatus: "YET_TO_START" }).PRE_PRODUCTION, false);
  assert.equal(doneOf({ ...through, productionStatus: "YET_TO_START" }).PRODUCTION, false);
  // Neither board's status touches the other's stage.
  assert.equal(doneOf({ ...through, productionStatus: "YET_TO_START" }).PRE_PRODUCTION, true);
});
