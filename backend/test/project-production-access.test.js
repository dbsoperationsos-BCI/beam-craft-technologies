const test = require("node:test");
const assert = require("node:assert/strict");
const { accessFor, boardWhere, callerOf, loadForWrite } = require("../src/modules/project-management/production/access");
const { logActivity } = require("../src/modules/project-management/production/activity");

// Nobody here holds PROJECT / Show All Projects unless a test says so.
const iam = { hasPermission: async () => false };

const record = { productionCoordinatorEmployeeId: 9, salesProject: { productionManagerEmployeeId: 5 } };

test("being named decides who edits what", () => {
  // The manager edits the plan and may also complete a step on the coordinator's behalf.
  assert.deepEqual(accessFor(record, { employeeId: 5, superAdmin: false, runsExecution: true }), { canEditPlan: true, canRunSteps: true });
  assert.deepEqual(accessFor(record, { employeeId: 9, superAdmin: false, runsExecution: true }), { canEditPlan: false, canRunSteps: true });
  assert.deepEqual(accessFor(record, { employeeId: 77, superAdmin: false, runsExecution: true }), { canEditPlan: false, canRunSteps: false });
  // A login with no employee is named on nothing - null never matches an unset seat.
  assert.deepEqual(accessFor({ productionCoordinatorEmployeeId: null, salesProject: { productionManagerEmployeeId: null } }, { employeeId: null, superAdmin: false }), { canEditPlan: false, canRunSteps: false });
  assert.deepEqual(accessFor(record, { employeeId: null, superAdmin: true }), { canEditPlan: true, canRunSteps: true });
});

test("named on the shoot without PROJECT / Production Execution reads the steps and runs none", () => {
  assert.deepEqual(accessFor(record, { employeeId: 9, superAdmin: false, runsExecution: false }), { canEditPlan: false, canRunSteps: false });
  // The plan is the manager's either way - the permission is about the steps only.
  assert.deepEqual(accessFor(record, { employeeId: 5, superAdmin: false }), { canEditPlan: true, canRunSteps: false });
  // Crew named on a service, likewise.
  const staffed = { ...record, serviceCrew: [{ employeeId: 41 }] };
  assert.equal(accessFor(staffed, { employeeId: 41, runsExecution: false }).canRunSteps, false);
  assert.equal(accessFor(staffed, { employeeId: 41, runsExecution: true }).canRunSteps, true);
  // Holding it is not enough on a shoot the person is not named on.
  assert.equal(accessFor(record, { employeeId: 77, runsExecution: true }).canRunSteps, false);
  // Show All Projects and a Super Admin run every shoot, as before.
  assert.equal(accessFor(record, { employeeId: 77, allProjects: true }).canRunSteps, true);
  assert.equal(accessFor(record, { employeeId: null, superAdmin: true }).canRunSteps, true);
});

test("Production Execution is asked at Read / Write", async () => {
  const asked = [];
  const holds = { hasPermission: async (...args) => { asked.push(args); return args[2] === "Production Execution"; } };
  const client = { user: { findUnique: async () => ({ id: 21, name: "Ravi", linkedEmployeeId: 9 }) } };
  const caller = await callerOf(21, { client, scope: { bypassesHierarchy: async () => false }, iam: holds });
  assert.equal(caller.runsExecution, true);
  assert.equal(caller.allProjects, false);
  assert.ok(asked.some((args) => args[1] === "PROJECT" && args[2] === "Production Execution" && args[3] === "READ_WRITE"));
});

test("PROJECT / Show All Projects at Read / Write edits the plan and runs the steps of every shoot", () => {
  assert.deepEqual(accessFor(record, { employeeId: 77, superAdmin: false, allProjects: true }), { canEditPlan: true, canRunSteps: true });
});

test("PROJECT / Show All Projects shows every shoot on the board, asked at Read; Read / Write marks the caller", async () => {
  const asked = [];
  const showAll = { hasPermission: async (...args) => { asked.push(args); return true; } };
  const scope = { resolve: async () => { throw new Error("not reached"); }, bypassesHierarchy: async () => false };
  assert.deepEqual(await boardWhere(22, { scope, iam: showAll }), {});
  assert.deepEqual(asked[0], [22, "PROJECT", "Show All Projects", "READ"]);
  const client = { user: { findUnique: async () => ({ id: 22, name: "Priya", linkedEmployeeId: 77 }) } };
  assert.equal((await callerOf(22, { client, scope, iam: showAll })).allProjects, true);
  assert.deepEqual(asked[1], [22, "PROJECT", "Show All Projects", "READ_WRITE"]);
});

test("the manager who is also the coordinator does both", () => {
  assert.deepEqual(accessFor({ productionCoordinatorEmployeeId: 5, salesProject: { productionManagerEmployeeId: 5 } }, { employeeId: 5, superAdmin: false, runsExecution: true }), { canEditPlan: true, canRunSteps: true });
});

test("an unlimited scope reads every row", async () => {
  const scope = { resolve: async () => ({ unlimited: true, where: {}, employeeIds: [] }) };
  assert.deepEqual(await boardWhere(1, { scope, iam }), {});
});

test("a scoped viewer also gets the rows their own name is on as manager, team member or crew", async () => {
  const calls = [];
  const scope = { resolve: async (args) => { calls.push(args); return { unlimited: false, where: { productionCoordinatorEmployeeId: { in: [9, 12] } }, employeeIds: [9, 12] }; } };
  assert.deepEqual(await boardWhere(21, { scope, iam }), {
    OR: [
      { productionCoordinatorEmployeeId: { in: [9, 12] } },
      { salesProject: { productionManagerEmployeeId: { in: [9, 12] } } },
      { teamMembers: { some: { employeeId: { in: [9, 12] } } } },
      { serviceCrew: { some: { employeeId: { in: [9, 12] } } } },
    ],
  });
  assert.equal(calls[0].module, "PROJECT");
  assert.equal(calls[0].feature, "Production");
  assert.deepEqual(calls[0].columns, { branch: "branchId", employee: ["productionCoordinatorEmployeeId"] });
});

test("a viewer named on nothing gets only what the scope already says", async () => {
  const scope = { resolve: async () => ({ unlimited: false, where: { id: { in: [] } }, employeeIds: [] }) };
  assert.deepEqual(await boardWhere(21, { scope, iam }), { OR: [{ id: { in: [] } }] });
});

test("the caller is the employee behind the login, and a Super Admin is asked of dataScope", async () => {
  const client = { user: { findUnique: async () => ({ id: 21, name: "Ravi", linkedEmployeeId: 9 }) } };
  const scope = { bypassesHierarchy: async (id) => id === 1 };
  assert.deepEqual(await callerOf(21, { client, scope, iam }), { userId: 21, name: "Ravi", employeeId: 9, superAdmin: false, allProjects: false, runsExecution: false, writesProduction: false });
  const admin = await callerOf(1, { client: { user: { findUnique: async () => ({ id: 1, name: "Owner", linkedEmployeeId: null }) } }, scope, iam });
  assert.equal(admin.superAdmin, true);
});

test("a shoot with no live production record is not found", async () => {
  const client = { projectProduction: { findFirst: async () => null } };
  await assert.rejects(loadForWrite(client, "shoot-x"), (error) => error.status === 404);
});

test("an activity line records who did it at the time", async () => {
  const created = [];
  const client = { projectProductionActivity: { create: async ({ data }) => { created.push(data); return data; } } };
  await logActivity(client, "prod-1", "PLAN_SAVED", null, { userId: 20, name: "Meena" });
  assert.deepEqual(created, [{ productionId: "prod-1", action: "PLAN_SAVED", detail: null, userId: 20, userName: "Meena" }]);
});
