const test = require("node:test");
const assert = require("node:assert/strict");
const { savePlan, saveSeat, copyTeam } = require("../src/modules/project-management/production/plan");
const { createProductionFake, productionRow, manager, coordinator } = require("./production-fake-client");

const statuses = async () => ["Active"];
// The shoot's booked services: a candid one (person + two assistants) and one that is not.
const SERVICES = [
  { shootId: "shoot-1", serviceDefinitionId: "def-candid", serviceName: "Candid Photo" },
  { shootId: "shoot-1", serviceDefinitionId: "def-booth", serviceName: "360 Video Booth" },
  { shootId: "shoot-2", serviceDefinitionId: "def-drone", serviceName: "Drone" },
];
// A seat may carry several cameras, so the helper takes however many the test gives it.
const lead = (serviceDefinitionId, employeeId, ...cameraAssetIds) => ({ serviceDefinitionId, role: "LEAD", employeeId, cameraAssetIds });
/** The camera ids on each saved seat, in order. */
const camerasOf = (row) => (row.cameras || []).map((camera) => camera.cameraAssetId);
const seed = (overrides = {}) => createProductionFake({
  productions: [productionRow({ planSubmittedAt: null, productionCoordinatorEmployeeId: null, ...overrides })],
  employees: [{ id: 9 }, { id: 12 }, { id: 13 }, { id: 40, active: false }],
  assets: [{ id: 3, category: "Cameras" }, { id: 5, category: "Cameras" }, { id: 4, category: "Lenses" }],
  services: SERVICES,
  vendors: [{ id: 7, status: "ACTIVE", canBeProductionTeamMember: true }, { id: 8, status: "INACTIVE" }, { id: 9, status: "ACTIVE", canBeProductionTeamMember: false }],
});
const deps = (client) => ({ client, statuses, now: () => new Date("2026-09-30T06:00:00Z") });

test("only the project's Production Manager edits the plan", async () => {
  const client = seed();
  await assert.rejects(savePlan("shoot-1", { remarks: "x" }, coordinator, deps(client)), (error) => error.status === 403);
});

test("a draft saves without a coordinator, and is logged", async () => {
  const client = seed();
  await savePlan("shoot-1", { travelMode: "Train", remarks: "Carry rain covers" }, manager, deps(client));
  assert.equal(client.state.productions[0].travelMode, "Train");
  assert.equal(client.state.productions[0].planSubmittedAt, null);
  assert.equal(client.state.activities.at(-1).action, "PLAN_SAVED");
});

test("the plan keeps when the crew leaves the studio, and a cleared one is cleared", async () => {
  const client = seed();
  await savePlan("shoot-1", { studioStartDate: "2026-11-01", studioStartTime: "07:00" }, manager, deps(client));
  assert.equal(client.state.productions[0].studioStartDate.toISOString(), "2026-11-01T00:00:00.000Z");
  assert.equal(client.state.productions[0].studioStartTime, "07:00");
  assert.match(client.state.activities.at(-1).detail, /studio start/);
  await savePlan("shoot-1", { studioStartDate: null, studioStartTime: null }, manager, deps(client));
  assert.equal(client.state.productions[0].studioStartDate, null);
  assert.equal(client.state.productions[0].studioStartTime, null);
});

test("submitting an outdoor plan needs its Studio Start Date and Time, which an indoor shoot is never asked", async () => {
  const outdoor = seed({ productionCoordinatorEmployeeId: 9, studioStartDate: null, studioStartTime: null });
  await assert.rejects(savePlan("shoot-1", { submit: true }, manager, deps(outdoor)), (error) => error.status === 400 && /Studio Start Date and Time/.test(error.message));
  // One half is not enough.
  await assert.rejects(savePlan("shoot-1", { submit: true, studioStartDate: "2026-10-02" }, manager, deps(seed({ productionCoordinatorEmployeeId: 9, studioStartDate: null, studioStartTime: null }))), /Studio Start Date and Time/);
  // Given with the submit itself, it is no longer what stops it (the services' people are asked next).
  const filled = seed({ productionCoordinatorEmployeeId: 9, studioStartDate: null, studioStartTime: null });
  await assert.rejects(savePlan("shoot-1", { submit: true, studioStartDate: "2026-10-02", studioStartTime: "07:00" }, manager, deps(filled)), (error) => !/Studio Start/.test(error.message));
  // An indoor shoot has no studio start to give.
  const indoor = seed({ productionCoordinatorEmployeeId: 9, travelMode: null, studioStartDate: null, studioStartTime: null, shoot: { shoot: "Reception", shootType: "Studio / In-House", dateCreated: new Date("2026-10-02T00:00:00Z"), shootPlace: "Erode", district: "Erode", preProduction: null } });
  await assert.rejects(savePlan("shoot-1", { submit: true }, manager, deps(indoor)), (error) => !/Studio Start/.test(error.message));
});

test("submitting needs a Production Coordinator", async () => {
  const client = seed();
  await assert.rejects(savePlan("shoot-1", { submit: true }, manager, deps(client)), (error) => error.status === 400 && /Coordinator/.test(error.message));
});

test("submitting an outdoor plan needs its Travel Mode, which an indoor shoot is never asked", async () => {
  /*
   * The mode is mandatory beside the coordinator and each service's person - the three parts a plan
   * is counted on (`planCompleteness`). Its detail (plate, vehicle, ticket, the line for Other) is
   * still asked for here, and is not one of the counted parts.
   */
  const outdoor = seed({ travelMode: null });
  await assert.rejects(
    savePlan("shoot-1", { submit: true, productionCoordinatorEmployeeId: 9, crew: [lead("def-candid", 12), lead("def-booth", 13)] }, manager, deps(outdoor)),
    (error) => error.status === 400 && /Travel Mode/.test(error.message),
  );
  // An indoor shoot has no travel at all, so it submits without one.
  const indoor = seed({ travelMode: null, shoot: { shoot: "Reception", shootType: "Studio / In-House", dateCreated: new Date("2026-10-02T00:00:00Z"), shootPlace: "Erode", district: "Erode", preProduction: null } });
  await savePlan("shoot-1", { submit: true, productionCoordinatorEmployeeId: 9, crew: [lead("def-candid", 12), lead("def-booth", 13)] }, manager, deps(indoor));
  assert.ok(indoor.state.productions[0].planSubmittedAt, "the indoor plan is submitted");
});

test("submitting stamps the plan once and logs PLAN_SUBMITTED; later saves log PLAN_SAVED", async () => {
  const client = seed();
  await savePlan("shoot-1", { submit: true, productionCoordinatorEmployeeId: 9, crew: [lead("def-candid", 12), lead("def-booth", 13)] }, manager, deps(client));
  const row = client.state.productions[0];
  assert.equal(row.productionCoordinatorEmployeeId, 9);
  assert.deepEqual(row.planSubmittedAt, new Date("2026-09-30T06:00:00Z"));
  assert.equal(row.planSubmittedByUserId, 20);
  assert.equal(client.state.activities.at(-1).action, "PLAN_SUBMITTED");
  await savePlan("shoot-1", { submit: true, remarks: "Changed" }, manager, deps(client));
  assert.equal(client.state.activities.at(-1).action, "PLAN_SAVED");
});

test("a submitted plan cannot lose its coordinator", async () => {
  const client = seed({ planSubmittedAt: new Date(), productionCoordinatorEmployeeId: 9 });
  await assert.rejects(savePlan("shoot-1", { productionCoordinatorEmployeeId: null }, manager, deps(client)), (error) => error.status === 400);
});

test("a coordinator kept by name (somebody who has left) is not cleared by a save that cannot show them", async () => {
  // The form sends no coordinator for one it cannot list; that is "unchanged", even on a submitted plan.
  const client = seed({ planSubmittedAt: new Date(), productionCoordinatorEmployeeId: null, productionCoordinatorName: "Sudeep" });
  const crew = [lead("def-candid", 12), lead("def-booth", 13)];
  await savePlan("shoot-1", { productionCoordinatorEmployeeId: null, remarks: "Carry rain covers", crew }, manager, deps(client));
  const row = client.state.productions[0];
  assert.equal(row.productionCoordinatorName, "Sudeep");
  assert.equal(row.remarks, "Carry rain covers");
  // Choosing a real coordinator replaces the name that stood in for one.
  await savePlan("shoot-1", { productionCoordinatorEmployeeId: 9, crew }, manager, deps(client));
  assert.equal(row.productionCoordinatorEmployeeId, 9);
  assert.equal(row.productionCoordinatorName, null);
});

test("the plan has no Production Team to save: a save leaves the team the old sheet named as it was", async () => {
  const client = seed();
  client.state.links.team.push({ productionId: "prod-1", employeeId: null, vendorId: null, employeeName: "Ajeesh" });
  await savePlan("shoot-1", { remarks: "Only the remarks" }, manager, deps(client));
  assert.deepEqual(client.state.links.team, [{ productionId: "prod-1", employeeId: null, vendorId: null, employeeName: "Ajeesh" }]);
});

test("a service's cameras must come from the Cameras category, and its person must be an active employee", async () => {
  await assert.rejects(savePlan("shoot-1", { crew: [lead("def-booth", 12, 4)] }, manager, deps(seed())), (error) => error.status === 400);
  await assert.rejects(savePlan("shoot-1", { crew: [lead("def-booth", 40, 3)] }, manager, deps(seed())), (error) => error.status === 400);
});

test("an item retired after it was planned stays on the plan and does not block a later save", async () => {
  const employees = [{ id: 9 }, { id: 12 }, { id: 13 }];
  const assets = [{ id: 3, category: "Cameras" }, { id: 5, category: "Cameras" }];
  const vendors = [{ id: 7, status: "ACTIVE" }, { id: 6, status: "ACTIVE" }];
  const client = createProductionFake({ productions: [productionRow({ planSubmittedAt: null, productionCoordinatorEmployeeId: null })], employees, assets, vendors, services: [SERVICES[1]] });
  const plan = { productionCoordinatorEmployeeId: 9, crew: [lead("def-booth", 13, 3)] };
  await savePlan("shoot-1", { ...plan, submit: true }, manager, deps(client));

  employees[0].active = false; // the coordinator left
  employees[2].active = false; // the service's person left
  assets[0].isDeleted = true; // the service's camera was retired

  await savePlan("shoot-1", { ...plan, remarks: "Only the remarks changed" }, manager, deps(client));
  assert.equal(client.state.productions[0].productionCoordinatorEmployeeId, 9);
  assert.deepEqual(client.state.crew.map((row) => ({ employeeId: row.employeeId, cameras: camerasOf(row) })), [{ employeeId: 13, cameras: [3] }]);
});

test("a newly added id is still checked while the ones already planned are kept", async () => {
  const employees = [{ id: 9 }, { id: 12 }, { id: 40, active: false }];
  const assets = [{ id: 3, category: "Cameras" }, { id: 4, category: "Lenses" }];
  const vendors = [{ id: 7, status: "ACTIVE" }, { id: 8, status: "INACTIVE" }];
  const client = createProductionFake({ productions: [productionRow({ planSubmittedAt: null, productionCoordinatorEmployeeId: null })], employees, assets, vendors, services: [SERVICES[1]] });
  await savePlan("shoot-1", { productionCoordinatorEmployeeId: 9, crew: [lead("def-booth", 12, 3)] }, manager, deps(client));

  await assert.rejects(savePlan("shoot-1", { productionCoordinatorEmployeeId: 40 }, manager, deps(client)), (error) => error.status === 400);
  await assert.rejects(savePlan("shoot-1", { crew: [lead("def-booth", 12, 4)] }, manager, deps(client)), (error) => error.status === 400);
});

test("each service gets its own person and cameras; assistants are the shoot's Assist, who take none", async () => {
  const client = seed();
  await savePlan("shoot-1", { crew: [lead("def-candid", 12, 3, 5), lead("def-booth", 9)], team: [{ employeeId: 13 }] }, manager, deps(client));
  // The person's seat carries both its cameras; the assistant is on the shoot, not on a service.
  assert.deepEqual(client.state.crew.map((row) => [row.serviceDefinitionId, row.role, row.employeeId, camerasOf(row)]), [
    ["def-candid", "LEAD", 12, [3, 5]],
    ["def-booth", "LEAD", 9, []],
  ]);
  assert.deepEqual(client.state.links.team.map((member) => member.employeeId), [13]);
});

test("a service takes its own person only - assistants go under Assist - and only this shoot's services", async () => {
  const refused = (crew, pattern) => assert.rejects(savePlan("shoot-1", { crew }, manager, deps(seed())), (error) => error.status === 400 && pattern.test(error.message));
  await refused([{ serviceDefinitionId: "def-candid", role: "ASSISTANT_1", employeeId: 12 }], /under Assist/);
  await refused([{ serviceDefinitionId: "def-booth", role: "ASSISTANT_1", employeeId: 12 }], /under Assist/);
  await refused([lead("def-drone", 12)], /this shoot's services/);
  await refused([lead("def-booth", 40)], /active employees/);
});

test("submitting needs a person on every service of the shoot", async () => {
  const client = seed();
  await assert.rejects(savePlan("shoot-1", { productionCoordinatorEmployeeId: 9, crew: [lead("def-candid", 12)], submit: true }, manager, deps(client)), (error) => error.status === 400 && /360 Video Booth/.test(error.message));
  await savePlan("shoot-1", { productionCoordinatorEmployeeId: 9, crew: [lead("def-candid", 12), lead("def-booth", 13)], submit: true }, manager, deps(client));
  assert.ok(client.state.productions[0].planSubmittedAt);
});

test("a service's person can be a vendor; one role takes an employee or a vendor, never both, and only an active vendor", async () => {
  const client = seed();
  await savePlan("shoot-1", { productionCoordinatorEmployeeId: 9, crew: [
    { serviceDefinitionId: "def-candid", role: "LEAD", employeeId: null, vendorId: 7 },
    lead("def-booth", 12),
  ], team: [{ vendorId: 7 }], submit: true }, manager, deps(client));
  // A vendor company may assist on the shoot as well as fill a service's seat.
  assert.deepEqual(client.state.links.team.map((member) => member.vendorId), [7]);
  assert.equal(client.state.crew[0].vendorId, 7);
  assert.equal(client.state.crew[0].employeeId, null);
  assert.ok(client.state.productions[0].planSubmittedAt, "a vendor counts as the service's person");
  const refused = (crew, pattern) => assert.rejects(savePlan("shoot-1", { crew }, manager, deps(seed())), (error) => error.status === 400 && pattern.test(error.message));
  await refused([{ serviceDefinitionId: "def-booth", role: "LEAD", employeeId: 12, vendorId: 7 }], /not both/);
  await refused([{ serviceDefinitionId: "def-booth", role: "LEAD", employeeId: null, vendorId: 8 }], /active vendors/);
});

test("a camera goes to one service of the shoot, not two, and no seat is given the same one twice", async () => {
  await assert.rejects(savePlan("shoot-1", { crew: [lead("def-candid", 12, 3), lead("def-booth", 13, 3)] }, manager, deps(seed())), (error) => error.status === 400 && /only one service/.test(error.message));
  await assert.rejects(savePlan("shoot-1", { crew: [lead("def-candid", 12, 3, 3)] }, manager, deps(seed())), (error) => error.status === 400 && /each camera once/.test(error.message));
  const client = seed();
  await savePlan("shoot-1", { crew: [lead("def-candid", 12, 3), lead("def-booth", 13)] }, manager, deps(client));
  assert.equal(client.state.crew.filter((row) => camerasOf(row).includes(3)).length, 1);
});

test("a service takes any active vendor, and refuses one that is not active", async () => {
  /*
   * Active is the whole test. It also asked for the vendor's "Can be a production team member?" Yes,
   * which kept a vendor the studio had just hired out of the list until somebody went and ticked
   * their record; the tick stays on the vendor as what it says about them.
   */
  const client = seed();
  await savePlan("shoot-1", { crew: [{ serviceDefinitionId: "def-candid", role: "LEAD", employeeId: null, vendorId: 7 }] }, manager, deps(client));
  assert.equal(client.state.crew[0].vendorId, 7, "marked Yes");
  // Vendor 9 is active and marked No: on a service all the same.
  await savePlan("shoot-1", { crew: [{ serviceDefinitionId: "def-candid", role: "LEAD", employeeId: null, vendorId: 9 }] }, manager, deps(client));
  assert.equal(client.state.crew[0].vendorId, 9);
  // Vendor 8 is INACTIVE, and that is still refused.
  await assert.rejects(
    savePlan("shoot-1", { crew: [{ serviceDefinitionId: "def-candid", role: "LEAD", employeeId: null, vendorId: 8 }] }, manager, deps(client)),
    (error) => error.status === 400 && /active vendors/.test(error.message),
  );
});

test("a vendor on a service answers with Waiting or Confirmed, and keeps no cameras", async () => {
  /*
   * A vendor holds the day and says so; the studio's camera belongs to an employee in that seat. So
   * the two never sit together, a newly chosen vendor starts on Waiting, and a seat that goes back to
   * an employee loses the status.
   */
  const client = seed();
  await savePlan("shoot-1", { crew: [{ serviceDefinitionId: "def-candid", role: "LEAD", employeeId: null, vendorId: 7 }] }, manager, deps(client));
  assert.equal(client.state.crew[0].vendorStatus, "WAITING", "a vendor starts waiting to confirm");
  assert.deepEqual(camerasOf(client.state.crew[0]), [], "and carries no cameras");
  // A vendor is never given one, even when the request carries some.
  await assert.rejects(
    savePlan("shoot-1", { crew: [{ serviceDefinitionId: "def-candid", role: "LEAD", employeeId: null, vendorId: 7, cameraAssetIds: [3] }] }, manager, deps(seed())),
    (error) => error.status === 400 && /takes no camera/.test(error.message),
  );

  await savePlan("shoot-1", { crew: [{ serviceDefinitionId: "def-candid", role: "LEAD", employeeId: null, vendorId: 7, vendorStatus: "CONFIRMED" }] }, manager, deps(client));
  assert.equal(client.state.crew[0].vendorStatus, "CONFIRMED");

  // Back to an employee: the cameras are theirs again and no status is kept.
  await savePlan("shoot-1", { crew: [{ serviceDefinitionId: "def-candid", role: "LEAD", employeeId: 12, cameraAssetIds: [3] }] }, manager, deps(client));
  assert.equal(client.state.crew[0].vendorStatus, null);
  assert.deepEqual(camerasOf(client.state.crew[0]), [3]);

  // Nobody else carries one, and only the two answers are taken.
  await assert.rejects(
    savePlan("shoot-1", { crew: [{ serviceDefinitionId: "def-candid", role: "LEAD", employeeId: 12, vendorStatus: "WAITING" }] }, manager, deps(seed())),
    (error) => error.status === 400 && /Only a vendor/.test(error.message),
  );
  await assert.rejects(
    savePlan("shoot-1", { crew: [{ serviceDefinitionId: "def-candid", role: "LEAD", employeeId: null, vendorId: 7, vendorStatus: "MAYBE" }] }, manager, deps(seed())),
    (error) => error.status === 400 && /Waiting or Confirmed/.test(error.message),
  );
});

test("the plan's own Hold / Rejected needs remarks, is the Production Manager's, and is logged", async () => {
  const { setPlanStatus } = require("../src/modules/project-management/production/plan");
  const client = seed();
  await assert.rejects(setPlanStatus("shoot-1", { status: "HOLD", remarks: " " }, manager, { client }), (error) => error.status === 400);
  await assert.rejects(setPlanStatus("shoot-1", { status: "HOLD", remarks: "Client unsure" }, { userId: 77, employeeId: 77, superAdmin: false }, { client }), (error) => error.status === 403);
  await setPlanStatus("shoot-1", { status: "HOLD", remarks: "Client unsure" }, manager, { client });
  assert.equal(client.state.productions[0].planStatus, "HOLD");
  assert.equal(client.state.productions[0].planStatusRemarks, "Client unsure");
  assert.equal(client.state.activities.at(-1).action, "PLAN_STATUS_CHANGED");
  await setPlanStatus("shoot-1", { status: null }, manager, { client });
  assert.equal(client.state.productions[0].planStatus, null);
});

test("WCR on the plan needs its remarks and a next follow-up date that is not past; any other status clears the date", async () => {
  const { setPlanStatus } = require("../src/modules/project-management/production/plan");
  const caller = { userId: 1, employeeId: null, superAdmin: true };
  // Refused before anything is read, so no database is reached.
  await assert.rejects(() => setPlanStatus("s1", { status: "WCR", remarks: " ", followupDate: "2999-01-01" }, caller, { client: {} }), /remarks for WCR/);
  await assert.rejects(() => setPlanStatus("s1", { status: "WCR", remarks: "Call back" }, caller, { client: {} }), /Next Followup Date/);
  await assert.rejects(() => setPlanStatus("s1", { status: "WCR", remarks: "Call back", followupDate: "2020-01-01" }, caller, { client: {} }), /cannot be in the past/);
  await assert.rejects(() => setPlanStatus("s1", { status: "PAUSED", remarks: "x" }, caller, { client: {} }), /Choose WCR, Hold, Rejected/);
  const writes = [];
  const client = { $transaction: async (work) => work({
    projectProduction: { findFirst: async () => ({ id: "p1", salesProject: { productionManagerEmployeeId: 5 } }), update: async (args) => { writes.push(args.data); } },
    projectProductionActivity: { create: async () => {} },
  }) };
  await setPlanStatus("s1", { status: "WCR", remarks: "Venue not confirmed", followupDate: "2999-01-01" }, caller, { client });
  assert.equal(writes[0].planStatus, "WCR");
  assert.equal(writes[0].planFollowupDate.toISOString(), "2999-01-01T00:00:00.000Z");
  await setPlanStatus("s1", { status: "HOLD", remarks: "Postponed", followupDate: "2999-01-01" }, caller, { client });
  assert.equal(writes[1].planFollowupDate, null, "only WCR keeps a follow-up date");
});

test("Assist is the shoot's: each person once, an employee or a vendor, active - and saved whole, never doubled", async () => {
  const refused = (team, pattern) => assert.rejects(savePlan("shoot-1", { team }, manager, deps(seed())), (error) => error.status === 400 && pattern.test(error.message));
  await refused([{ employeeId: 12 }, { employeeId: 12 }], /once/);
  await refused([{ employeeId: 12, vendorId: 7 }], /one employee or one vendor/);
  await refused([{}], /one employee or one vendor/);
  await refused([{ employeeId: 40 }], /active employees/);
  await refused([{ vendorId: 8 }], /active vendors/);
  const client = seed();
  await savePlan("shoot-1", { team: [{ employeeId: 12 }, { employeeId: 13 }] }, manager, deps(client));
  await savePlan("shoot-1", { team: [{ employeeId: 12 }, { employeeId: 13 }] }, manager, deps(client));
  assert.deepEqual(client.state.links.team.map((member) => member.employeeId), [12, 13], "a save repeated writes the same rows");
  await savePlan("shoot-1", { team: [{ employeeId: 13 }] }, manager, deps(client));
  assert.deepEqual(client.state.links.team.map((member) => member.employeeId), [13], "one taken off is off the shoot");
  // Changing the Assist leaves every service's person and cameras alone.
  await savePlan("shoot-1", { crew: [lead("def-candid", 12, 3)] }, manager, deps(client));
  await savePlan("shoot-1", { team: [] }, manager, deps(client));
  assert.deepEqual(client.state.crew.map((row) => [row.role, row.employeeId, camerasOf(row)]), [["LEAD", 12, [3]]]);
});

test("a service's old assistant seat is kept by a save without Assist, and moves to Assist when the form sends it", async () => {
  const client = seed();
  // Written before Assist was the shoot's.
  client.state.crew.push({ productionId: client.state.productions[0].id, serviceDefinitionId: "def-candid", role: "ASSISTANT_1", employeeId: 13, cameras: [] });
  await savePlan("shoot-1", { crew: [lead("def-candid", 12)] }, manager, deps(client));
  assert.ok(client.state.crew.some((row) => row.role === "ASSISTANT_1" && row.employeeId === 13), "an older caller, sending no Assist, loses nobody");
  // The form lists that assistant under Assist, so the save that sends Assist moves them there.
  await savePlan("shoot-1", { crew: [lead("def-candid", 12)], team: [{ employeeId: 13 }] }, manager, deps(client));
  assert.ok(!client.state.crew.some((row) => row.role === "ASSISTANT_1"));
  assert.deepEqual(client.state.links.team.map((member) => member.employeeId), [13]);
});

/*
 * The Production Schedule's grid changes one service's person at a time; every other seat on the
 * shoot - its person, cameras, vendor status - is kept as it was.
 */
const seats = (client) => client.state.crew.map((row) => [row.serviceDefinitionId, row.employeeId, row.vendorId, camerasOf(row), row.vendorStatus]);

test("one seat changes and the others keep their person, cameras and vendor status", async () => {
  const client = seed();
  await savePlan("shoot-1", { crew: [lead("def-candid", 12, 3), { serviceDefinitionId: "def-booth", role: "LEAD", employeeId: null, vendorId: 7, vendorStatus: "CONFIRMED" }] }, manager, deps(client));
  await saveSeat("shoot-1", { serviceDefinitionId: "def-candid", employeeId: 13, vendorId: null }, manager, deps(client));
  assert.deepEqual(seats(client), [
    ["def-booth", null, 7, [], "CONFIRMED"],
    // The employee who takes the seat takes its cameras with it.
    ["def-candid", 13, null, [3], null],
  ]);
});

test("a vendor put on a seat starts on Waiting and takes no camera; neither takes the person off", async () => {
  const client = seed();
  await savePlan("shoot-1", { crew: [lead("def-candid", 12, 3), lead("def-booth", 13)] }, manager, deps(client));
  await saveSeat("shoot-1", { serviceDefinitionId: "def-candid", employeeId: null, vendorId: 7 }, manager, deps(client));
  assert.deepEqual(seats(client).find((row) => row[0] === "def-candid"), ["def-candid", null, 7, [], "WAITING"]);
  await saveSeat("shoot-1", { serviceDefinitionId: "def-booth", employeeId: null, vendorId: null }, manager, deps(client));
  assert.deepEqual(seats(client).map((row) => row[0]), ["def-candid"]);
});

test("a vendor Waiting is confirmed in place; a vendor new to the seat still starts on Waiting", async () => {
  const client = seed();
  await savePlan("shoot-1", { crew: [lead("def-candid", 12, 3), lead("def-booth", 13)] }, manager, deps(client));
  await saveSeat("shoot-1", { serviceDefinitionId: "def-candid", employeeId: null, vendorId: 7 }, manager, deps(client));
  assert.equal(seats(client).find((row) => row[0] === "def-candid")[4], "WAITING");
  // The schedule's Confirm: the same vendor, Confirmed.
  await saveSeat("shoot-1", { serviceDefinitionId: "def-candid", employeeId: null, vendorId: 7, vendorStatus: "CONFIRMED" }, manager, deps(client));
  assert.deepEqual(seats(client).find((row) => row[0] === "def-candid"), ["def-candid", null, 7, [], "CONFIRMED"]);
  assert.deepEqual(seats(client).find((row) => row[0] === "def-booth"), ["def-booth", 13, null, [], null], "the other seat is untouched");
});

test("a vendor new to a seat starts on Waiting, whatever answer is sent with them", async () => {
  const client = seed();
  await savePlan("shoot-1", { crew: [lead("def-candid", 12, 3), lead("def-booth", 13)] }, manager, deps(client));
  // The seat had an employee; the vendor taking it has not been asked yet.
  await saveSeat("shoot-1", { serviceDefinitionId: "def-candid", employeeId: null, vendorId: 7, vendorStatus: "CONFIRMED" }, manager, deps(client));
  assert.deepEqual(seats(client).find((row) => row[0] === "def-candid"), ["def-candid", null, 7, [], "WAITING"]);
});

test("the seat route takes a vendor's answer only with a vendor", () => {
  const { seatSchema } = require("../src/modules/project-management/production/controller");
  assert.equal(seatSchema.safeParse({ serviceDefinitionId: "d", employeeId: null, vendorId: 7, vendorStatus: "CONFIRMED" }).success, true);
  assert.equal(seatSchema.safeParse({ serviceDefinitionId: "d", employeeId: 12, vendorId: null, vendorStatus: "CONFIRMED" }).success, false);
  assert.equal(seatSchema.safeParse({ serviceDefinitionId: "d", employeeId: null, vendorId: 7, vendorStatus: "MAYBE" }).success, false);
});

test("a seat is the Production Manager's, on this shoot's own services, and may be emptied on a submitted plan", async () => {
  await assert.rejects(saveSeat("shoot-1", { serviceDefinitionId: "def-candid", employeeId: 12, vendorId: null }, coordinator, deps(seed())), (error) => error.status === 403);
  await assert.rejects(saveSeat("shoot-1", { serviceDefinitionId: "def-drone", employeeId: 12, vendorId: null }, manager, deps(seed())), (error) => error.status === 400);
  const client = seed();
  await savePlan("shoot-1", { productionCoordinatorEmployeeId: 9, crew: [lead("def-candid", 12), lead("def-booth", 13)], submit: true }, manager, deps(client));
  // Taken off by mistake: saved, the plan still submitted - it reads Work in Progress until filled.
  await saveSeat("shoot-1", { serviceDefinitionId: "def-booth", employeeId: null, vendorId: null }, manager, deps(client));
  assert.deepEqual(client.state.crew.map((row) => row.serviceDefinitionId), ["def-candid"]);
  assert.ok(client.state.productions[0].planSubmittedAt);
  // And one of two empty services filled on it saves, the other still empty.
  await saveSeat("shoot-1", { serviceDefinitionId: "def-candid", employeeId: null, vendorId: null }, manager, deps(client));
  await saveSeat("shoot-1", { serviceDefinitionId: "def-booth", employeeId: 13, vendorId: null }, manager, deps(client));
  assert.deepEqual(client.state.crew.map((row) => [row.serviceDefinitionId, row.employeeId]), [["def-booth", 13]]);
});

test("two seats changed one after the other on one shoot both stay", async () => {
  const client = seed();
  await savePlan("shoot-1", { crew: [lead("def-candid", 12), lead("def-booth", 13)] }, manager, deps(client));
  await saveSeat("shoot-1", { serviceDefinitionId: "def-candid", employeeId: 9, vendorId: null }, manager, deps(client));
  await saveSeat("shoot-1", { serviceDefinitionId: "def-booth", employeeId: null, vendorId: 7 }, manager, deps(client));
  assert.deepEqual(seats(client).map((row) => [row[0], row[1], row[2]]).sort(), [["def-booth", null, 7], ["def-candid", 9, null]]);
});

test("one person works one service of a shoot: a save that puts them on a second is refused, named", async () => {
  await assert.rejects(
    savePlan("shoot-1", { crew: [lead("def-candid", 12), lead("def-booth", 12)] }, manager, deps(seed())),
    (error) => error.status === 400 && /Employee 12 is already on another service of this shoot/.test(error.message),
  );
  const client = seed();
  await savePlan("shoot-1", { crew: [lead("def-candid", 12), lead("def-booth", 13)] }, manager, deps(client));
  await assert.rejects(saveSeat("shoot-1", { serviceDefinitionId: "def-booth", employeeId: 12, vendorId: null }, manager, deps(client)), (error) => error.status === 400 && /already on another service/.test(error.message));
});

test("a vendor may work several services of one shoot", async () => {
  const client = seed();
  await savePlan("shoot-1", { crew: [{ ...lead("def-candid", null), vendorId: 7 }, { ...lead("def-booth", null), vendorId: 7 }] }, manager, deps(client));
  assert.deepEqual(seats(client).map((row) => [row[0], row[1], row[2]]).sort(), [["def-booth", null, 7], ["def-candid", null, 7]]);
});

test("a shoot that already had somebody on two services still saves, as long as no more are added", async () => {
  const client = seed();
  // Saved before the rule: the same person on both services.
  client.state.crew.push({ productionId: "prod-1", serviceDefinitionId: "def-candid", role: "LEAD", employeeId: 12, cameras: [] }, { productionId: "prod-1", serviceDefinitionId: "def-booth", role: "LEAD", employeeId: 12, cameras: [] });
  await savePlan("shoot-1", { remarks: "Carry rain covers", crew: [lead("def-candid", 12), lead("def-booth", 12)] }, manager, deps(client));
  assert.equal(client.state.productions[0].remarks, "Carry rain covers");
});

test("the same team as above: shared services take the other shoot's people, the rest stay as they are", async () => {
  const client = createProductionFake({
    productions: [
      productionRow({ planSubmittedAt: null, salesProjectId: "sp-1" }),
      productionRow({ id: "prod-2", shootId: "shoot-2", planSubmittedAt: null, salesProjectId: "sp-1" }),
      productionRow({ id: "prod-3", shootId: "shoot-3", planSubmittedAt: null, salesProjectId: "sp-other" }),
    ],
    employees: [{ id: 9 }, { id: 12 }, { id: 13 }],
    assets: [{ id: 3, category: "Cameras" }],
    services: [
      ...SERVICES.filter((service) => service.shootId === "shoot-1"),
      { shootId: "shoot-2", serviceDefinitionId: "def-candid", serviceName: "Candid Photo" },
      { shootId: "shoot-2", serviceDefinitionId: "def-drone", serviceName: "Drone" },
      { shootId: "shoot-3", serviceDefinitionId: "def-candid", serviceName: "Candid Photo" },
    ],
    vendors: [{ id: 7, status: "ACTIVE", canBeProductionTeamMember: true }],
  });
  await savePlan("shoot-2", { crew: [lead("def-candid", 12), lead("def-drone", 13)] }, manager, deps(client));
  await savePlan("shoot-1", { crew: [lead("def-candid", 9, 3), lead("def-booth", 13)] }, manager, deps(client));
  await copyTeam("shoot-1", { fromShootId: "shoot-2" }, manager, deps(client));
  const onShoot1 = client.state.crew.filter((row) => row.productionId === "prod-1").map((row) => [row.serviceDefinitionId, row.employeeId, camerasOf(row)]).sort();
  // Candid takes shoot-2's person (no camera - it was the last person's); 360 Booth, not on shoot-2, is kept.
  assert.deepEqual(onShoot1, [["def-booth", 13, []], ["def-candid", 12, []]]);
  // Only a shoot of the same project, and never the shoot itself.
  await assert.rejects(copyTeam("shoot-1", { fromShootId: "shoot-3" }, manager, deps(client)), (error) => error.status === 404);
  await assert.rejects(copyTeam("shoot-1", { fromShootId: "shoot-1" }, manager, deps(client)), (error) => error.status === 400);
  // The plan's rules still hold: not the Production Manager, no change.
  await assert.rejects(copyTeam("shoot-1", { fromShootId: "shoot-2" }, coordinator, deps(client)), (error) => error.status === 403);
});

test("a drone service may be flown by somebody already on another service of the shoot", async () => {
  const client = createProductionFake({
    productions: [productionRow({ planSubmittedAt: null })],
    employees: [{ id: 12 }, { id: 13 }],
    services: [...SERVICES.filter((service) => service.shootId === "shoot-1"), { shootId: "shoot-1", serviceDefinitionId: "def-drone", serviceName: "Complementary Drone" }],
  });
  await savePlan("shoot-1", { crew: [lead("def-candid", 12), lead("def-booth", 13), lead("def-drone", 12)] }, manager, deps(client));
  assert.deepEqual(client.state.crew.map((row) => [row.serviceDefinitionId, row.employeeId]), [["def-candid", 12], ["def-booth", 13], ["def-drone", 12]]);
  // Two services that are not the drone still are one person's only.
  await assert.rejects(savePlan("shoot-1", { crew: [lead("def-candid", 12), lead("def-booth", 12), lead("def-drone", 13)] }, manager, deps(client)), (error) => error.status === 400 && /already on another service/.test(error.message));
});
