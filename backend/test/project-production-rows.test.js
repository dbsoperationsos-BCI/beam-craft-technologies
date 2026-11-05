const test = require("node:test");
const assert = require("node:assert/strict");
const { ensureProjectProduction } = require("../src/modules/project-management/production/service");

/*
 * A stand-in for the Prisma calls row raising makes - one project, its shoots (with the pre
 * production coordinator each may carry), the employees that exist, and whatever production rows
 * exist - so this runs without MySQL, as the pre production row tests do.
 */
function fakeClient({ project, shoots = [], existing = [], employees = [], assets = [] } = {}) {
  const state = { created: [], existing: existing.map((row) => ({ ...row })), branchSyncs: [] };
  return {
    state,
    salesProject: { findFirst: async ({ where }) => (project && project.id === where.id && !project.deletedAt ? project : null) },
    projectShoot: { findMany: async () => shoots.filter((shoot) => !shoot.deletedAt).map((shoot) => ({ id: shoot.id, preProduction: shoot.preProduction ?? null })) },
    employee: { findMany: async ({ where }) => employees.filter((employee) => where.id.in.includes(employee.id) && !employee.archivedAt).map(({ id }) => ({ id })) },
    asset: { findMany: async ({ where }) => assets.filter((asset) => where.id.in.includes(asset.id) && !asset.isDeleted).map(({ id }) => ({ id })) },
    projectProduction: {
      updateMany: async (args) => { state.branchSyncs.push(args); return { count: 0 }; },
      findMany: async ({ where }) => state.existing.filter((row) => where.shootId.in.includes(row.shootId)).map((row) => ({ shootId: row.shootId })),
      createMany: async ({ data }) => { state.created.push(...data); state.existing.push(...data); return { count: data.length }; },
    },
  };
}

const started = (overrides = {}) => ({ id: "project-1", projectStatus: "Work in Progress - Pre & Production", productionManagerEmployeeId: 5, branchId: 3, ...overrides });
const shoots = [{ id: "shoot-1" }, { id: "shoot-2" }];

test("a started project with a Production Manager gets one production row per shoot", async () => {
  const client = fakeClient({ project: started(), shoots });
  assert.equal(await ensureProjectProduction(client, "project-1"), 2);
  assert.deepEqual(client.state.created, [
    { shootId: "shoot-1", salesProjectId: "project-1", branchId: 3, productionCoordinatorEmployeeId: null, travelMode: null, travelModeOther: null, travelVehicleAssetId: null, studioStartDate: null, studioStartTime: null },
    { shootId: "shoot-2", salesProjectId: "project-1", branchId: 3, productionCoordinatorEmployeeId: null, travelMode: null, travelModeOther: null, travelVehicleAssetId: null, studioStartDate: null, studioStartTime: null },
  ]);
});

test("the pre production coordinator is carried over once as the plan's starting coordinator", async () => {
  const client = fakeClient({
    project: started(),
    shoots: [
      { id: "shoot-1", preProduction: { productionCoordinatorEmployeeId: 9 } },
      // Pre production's column never had a foreign key, so it can name somebody who is gone.
      { id: "shoot-2", preProduction: { productionCoordinatorEmployeeId: 40 } },
      { id: "shoot-3", preProduction: { productionCoordinatorEmployeeId: 41 } },
      { id: "shoot-4", preProduction: null },
    ],
    employees: [{ id: 9 }, { id: 41, archivedAt: new Date() }],
  });
  await ensureProjectProduction(client, "project-1");
  assert.deepEqual(client.state.created.map((row) => [row.shootId, row.productionCoordinatorEmployeeId]), [
    ["shoot-1", 9], ["shoot-2", null], ["shoot-3", null], ["shoot-4", null],
  ]);
  // Once: a row that exists is never touched again, so a coordinator the manager changed stays changed.
  assert.equal(await ensureProjectProduction(client, "project-1"), 0);
});

test("pre production's travel answer is carried over once as the plan's starting travel", async () => {
  const client = fakeClient({
    project: started(),
    shoots: [
      { id: "shoot-1", preProduction: { travelMode: "Office Vehicle", travelModeOther: null, travelVehicleAssetId: 21 } },
      // A vehicle since deleted is not carried; the mode still is.
      { id: "shoot-2", preProduction: { travelMode: "Office Vehicle", travelModeOther: null, travelVehicleAssetId: 22 } },
      { id: "shoot-3", preProduction: { travelMode: "Other", travelModeOther: "Client's tempo", travelVehicleAssetId: null } },
      { id: "shoot-4", preProduction: null },
    ],
    assets: [{ id: 21 }, { id: 22, isDeleted: true }],
  });
  await ensureProjectProduction(client, "project-1");
  assert.deepEqual(client.state.created.map((row) => [row.shootId, row.travelMode, row.travelModeOther, row.travelVehicleAssetId]), [
    ["shoot-1", "Office Vehicle", null, 21],
    ["shoot-2", "Office Vehicle", null, null],
    ["shoot-3", "Other", "Client's tempo", null],
    ["shoot-4", null, null, null],
  ]);
  // Never over a production row that exists: the plan's own travel stays the plan's.
  const again = fakeClient({ project: started(), shoots: [{ id: "shoot-1", preProduction: { travelMode: "Bus" } }], existing: [{ shootId: "shoot-1", travelMode: "Car" }] });
  assert.equal(await ensureProjectProduction(again, "project-1"), 0);
  assert.equal(again.state.existing[0].travelMode, "Car");
});

test("pre production's studio start is carried over once as the plan's own", async () => {
  const day = new Date("2026-11-01T00:00:00.000Z");
  const client = fakeClient({
    project: started(),
    shoots: [{ id: "shoot-1", preProduction: { studioStartDate: day, studioStartTime: "07:00" } }, { id: "shoot-2", preProduction: null }],
  });
  await ensureProjectProduction(client, "project-1");
  assert.deepEqual(client.state.created.map((row) => [row.shootId, row.studioStartDate, row.studioStartTime]), [
    ["shoot-1", day, "07:00"],
    ["shoot-2", null, null],
  ]);
});

test("rows are created idempotently: only the missing ones, and a second call makes none", async () => {
  const client = fakeClient({ project: started(), shoots, existing: [{ shootId: "shoot-1" }] });
  assert.equal(await ensureProjectProduction(client, "project-1"), 1);
  assert.deepEqual(client.state.created.map((row) => row.shootId), ["shoot-2"]);
  assert.equal(await ensureProjectProduction(client, "project-1"), 0);
});

test("no Production Manager, a Yet to Start project, or a deleted shoot raise nothing", async () => {
  assert.equal(await ensureProjectProduction(fakeClient({ project: started({ productionManagerEmployeeId: null }), shoots }), "project-1"), 0);
  assert.equal(await ensureProjectProduction(fakeClient({ project: started({ projectStatus: "Yet to Start" }), shoots }), "project-1"), 0);
  const client = fakeClient({ project: started(), shoots: [{ id: "shoot-1", deletedAt: new Date() }] });
  assert.equal(await ensureProjectProduction(client, "project-1"), 0);
  assert.equal(await ensureProjectProduction(fakeClient({ project: null }), "project-1"), 0);
});

test("existing rows follow the project's branch, including rows with no branch yet", async () => {
  const client = fakeClient({ project: started({ branchId: 4 }), shoots, existing: [{ shootId: "shoot-1" }, { shootId: "shoot-2" }] });
  await ensureProjectProduction(client, "project-1");
  assert.deepEqual(client.state.branchSyncs[0], {
    where: { salesProjectId: "project-1", OR: [{ branchId: null }, { branchId: { not: 4 } }] },
    data: { branchId: 4 },
  });
  const unbranched = fakeClient({ project: started({ branchId: null }), shoots });
  await ensureProjectProduction(unbranched, "project-1");
  assert.deepEqual(unbranched.state.branchSyncs[0].where, { salesProjectId: "project-1", branchId: { not: null } });
});
