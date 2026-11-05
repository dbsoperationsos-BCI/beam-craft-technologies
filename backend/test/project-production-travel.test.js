const test = require("node:test");
const assert = require("node:assert/strict");
const { savePlan } = require("../src/modules/project-management/production/plan");
const { addFiles } = require("../src/modules/project-management/production/execution");
const { planSchema } = require("../src/modules/project-management/production/controller");
const { toDetail } = require("../src/modules/project-management/production/read");
const T = require("../src/modules/project-management/production/travel");
const { createProductionFake, productionRow, manager } = require("./production-fake-client");

/*
 * Travel on the Production Manager's plan: the modes, the detail each one asks for, and tickets
 * belonging only to Bus / Train / Flight.
 */
const statuses = async () => ["Active"];
const deps = (client) => ({ client, statuses, now: () => new Date("2026-09-30T06:00:00Z") });
const PDF = "data:application/pdf;base64,JVBERi0xLjQ=";
const store = async (kind, files) => files.map((file, index) => ({ url: `https://cdn.example/${kind}-${index}`, key: `k-${index}`, fileName: file.name || "File", mimeType: "application/pdf" }));

const draft = (overrides = {}, assets = [{ id: 21, category: "Cars" }, { id: 22, category: "Vans", status: "UNDER_REPAIR" }, { id: 3, category: "Cameras" }, { id: 23, category: "Cars", status: "DISPOSED" }]) => createProductionFake({
  productions: [productionRow({ planSubmittedAt: null, productionCoordinatorEmployeeId: null, travelMode: null, ...overrides })],
  employees: [{ id: 9 }],
  assets,
});

test("Car is a travel mode, and the plan body takes each mode's detail", () => {
  assert.deepEqual(T.TRAVEL_MODES, ["Bus", "Train", "Flight", "Own", "Car", "Office Vehicle", "Other"]);
  assert.ok(planSchema.safeParse({ travelMode: "Car", vehicleNumberPlate: "tn 33 ab 1234" }).success);
  assert.ok(planSchema.safeParse({ travelMode: "Office Vehicle", travelVehicleAssetId: 21 }).success);
  assert.ok(planSchema.safeParse({ travelMode: "Other", travelModeOther: "Client's tempo" }).success);
  assert.equal(planSchema.safeParse({ vehicleNumberPlate: "X".repeat(21) }).success, false);
  assert.equal(planSchema.safeParse({ travelModeOther: "X".repeat(192) }).success, false);
  // Trimmed before the cap: a plate typed with spaces round it is still 20.
  assert.ok(planSchema.safeParse({ vehicleNumberPlate: `  ${"X".repeat(20)}  ` }).success);
});

test("a draft saves with any travel detail empty", async () => {
  for (const travelMode of ["Own", "Car", "Office Vehicle", "Other", "Bus"]) {
    const client = draft();
    await savePlan("shoot-1", { travelMode }, manager, deps(client));
    assert.equal(client.state.productions[0].travelMode, travelMode);
  }
});

test("a mode's detail is never asked for at submit - only the mode itself", async () => {
  /*
   * The plate, the office vehicle and the line saying how on Other are part of the plan and none is
   * required: the crew often knows how they are going before they know whose car. A plan was being
   * refused over a blank box, and a submitted one could not then be saved at all.
   */
  const submit = (body) => ({ submit: true, productionCoordinatorEmployeeId: 9, ...body });
  for (const travelMode of ["Own", "Car", "Office Vehicle", "Other", "Bus", "Train", "Flight"]) {
    const client = draft();
    await savePlan("shoot-1", submit({ travelMode }), manager, deps(client));
    assert.ok(client.state.productions[0].planSubmittedAt, `${travelMode} submits on its own`);
  }
  // The mode itself is mandatory on an outdoor shoot, beside the coordinator and each service's person.
  await assert.rejects(savePlan("shoot-1", submit({ travelMode: null }), manager, deps(draft())), (error) => error.status === 400 && /Travel Mode/.test(error.message));
  // And a submitted plan is still saved after its detail is cleared.
  const client = draft({ travelMode: "Car", vehicleNumberPlate: "TN33AB1234" });
  await savePlan("shoot-1", { submit: true, productionCoordinatorEmployeeId: 9 }, manager, deps(client));
  await savePlan("shoot-1", { vehicleNumberPlate: null }, manager, deps(client));
  assert.equal(client.state.productions[0].vehicleNumberPlate, null);
});

test("the plate is trimmed and stored upper-case; empty is none", async () => {
  const client = draft({ travelMode: "Own" });
  await savePlan("shoot-1", { vehicleNumberPlate: "  tn 33 ab 1234 " }, manager, deps(client));
  assert.equal(client.state.productions[0].vehicleNumberPlate, "TN 33 AB 1234");
  await savePlan("shoot-1", { vehicleNumberPlate: "  " }, manager, deps(client));
  assert.equal(client.state.productions[0].vehicleNumberPlate, null);
  assert.equal(T.normalisePlate(" ka01 "), "KA01");
});

test("the office vehicle must be a live asset in a vehicle category", async () => {
  // A camera, a disposed car and an asset that does not exist are all refused.
  for (const id of [3, 23, 999]) {
    await assert.rejects(savePlan("shoot-1", { travelMode: "Office Vehicle", travelVehicleAssetId: id }, manager, deps(draft())), (error) => error.status === 400 && /vehicle/.test(error.message));
  }
  const client = draft();
  await savePlan("shoot-1", { travelMode: "Office Vehicle", travelVehicleAssetId: 22 }, manager, deps(client));
  assert.equal(client.state.productions[0].travelVehicleAssetId, 22);
});

test("a vehicle retired after it was planned stays on the plan and does not block a later save", async () => {
  const assets = [{ id: 21, category: "Cars" }, { id: 24, category: "Cars" }];
  const client = draft({}, assets);
  await savePlan("shoot-1", { submit: true, productionCoordinatorEmployeeId: 9, travelMode: "Office Vehicle", travelVehicleAssetId: 21 }, manager, deps(client));
  assets[0].isDeleted = true;
  await savePlan("shoot-1", { travelMode: "Office Vehicle", travelVehicleAssetId: 21, remarks: "Only the remarks changed" }, manager, deps(client));
  assert.equal(client.state.productions[0].travelVehicleAssetId, 21);
  // A newly picked one is still checked.
  assets[1].isDeleted = true;
  await assert.rejects(savePlan("shoot-1", { travelVehicleAssetId: 24 }, manager, deps(client)), (error) => error.status === 400);
});

test("changing the mode clears the detail that no longer applies", async () => {
  const client = draft({ travelMode: "Office Vehicle", travelVehicleAssetId: 21, vehicleNumberPlate: "OLD", travelModeOther: "old" });
  await savePlan("shoot-1", { travelMode: "Car", vehicleNumberPlate: "tn01" }, manager, deps(client));
  let row = client.state.productions[0];
  assert.deepEqual([row.travelMode, row.vehicleNumberPlate, row.travelVehicleAssetId, row.travelModeOther], ["Car", "TN01", null, null]);
  // Detail sent for a mode it does not belong to is not kept either.
  await savePlan("shoot-1", { travelMode: "Train", vehicleNumberPlate: "TN01", travelModeOther: "x", travelVehicleAssetId: 21 }, manager, deps(client));
  row = client.state.productions[0];
  assert.deepEqual([row.travelMode, row.vehicleNumberPlate, row.travelVehicleAssetId, row.travelModeOther], ["Train", null, null, null]);
  // Clearing the mode clears it all.
  await savePlan("shoot-1", { travelMode: "Other", travelModeOther: "Tempo" }, manager, deps(client));
  await savePlan("shoot-1", { travelMode: null }, manager, deps(client));
  assert.equal(client.state.productions[0].travelModeOther, null);
});

test("a ticket is refused unless the plan's travel mode is Bus, Train or Flight", async () => {
  for (const travelMode of ["Own", "Car", "Office Vehicle", "Other", null]) {
    const client = createProductionFake({ productions: [productionRow({ travelMode })] });
    await assert.rejects(addFiles("shoot-1", { kind: "TICKET", files: [{ data: PDF }] }, manager, { client, store }), (error) => error.status === 400 && /Bus, Train or Flight/.test(error.message));
    assert.equal(client.state.files.length, 0);
  }
  for (const travelMode of ["Bus", "Train", "Flight"]) {
    const client = createProductionFake({ productions: [productionRow({ travelMode })] });
    await addFiles("shoot-1", { kind: "TICKET", files: [{ data: PDF }] }, manager, { client, store });
    assert.equal(client.state.files.length, 1);
  }
});

test("the ticket's mode is asked again inside the transaction", async () => {
  const client = createProductionFake({ productions: [productionRow({ travelMode: "Train" })] });
  const discarded = [];
  // The plan is resaved as Own while this request's slow upload runs.
  const racing = async (kind, files) => { client.state.productions[0].travelMode = "Own"; return store(kind, files); };
  await assert.rejects(
    addFiles("shoot-1", { kind: "TICKET", files: [{ data: PDF }] }, manager, { client, store: racing, discard: async (stored) => discarded.push(...stored) }),
    (error) => error.status === 400,
  );
  assert.equal(discarded.length, 1);
  assert.equal(client.state.files.length, 0);
});

test("tickets already on the plan are kept when the mode changes, and can still be removed", async () => {
  const { removeFile } = require("../src/modules/project-management/production/execution");
  const client = createProductionFake({ productions: [productionRow({ travelMode: "Train", planSubmittedAt: null })], files: [{ id: "t-1", productionId: "prod-1", kind: "TICKET", url: "u", fileName: "train.pdf" }], employees: [{ id: 9 }] });
  await savePlan("shoot-1", { travelMode: "Own" }, manager, deps(client));
  assert.equal(client.state.files.length, 1);
  await removeFile("shoot-1", "t-1", manager, { client, removeObject: async () => {} });
  assert.equal(client.state.files.length, 0);
});

test("the detail reads the travel back, the vehicle through its link", () => {
  const record = {
    id: "prod-1", shootId: "shoot-1", travelMode: "Office Vehicle", travelModeOther: null, vehicleNumberPlate: null, travelVehicleAssetId: 21,
    travelVehicleAsset: { assetName: "Innova", assetCode: "AST-21" },
    shoot: { id: "shoot-1", preProduction: null }, salesProject: { id: "p", productionManagerEmployeeId: 5 },
  };
  const detail = toDetail(record, new Map(), { employeeId: 5 });
  assert.deepEqual(detail.plan.travelVehicle, { id: 21, name: "Innova (AST-21)" });
  assert.equal(detail.plan.vehicleNumberPlate, null);
  assert.equal(detail.plan.travelModeOther, null);
  assert.equal(toDetail({ ...record, travelVehicleAssetId: null, travelVehicleAsset: null }, new Map(), null).plan.travelVehicle, null);
});

test("the studio start is a real day and an HH:MM time, or nothing", () => {
  assert.ok(planSchema.safeParse({ studioStartDate: "2026-11-01", studioStartTime: "07:00" }).success);
  assert.ok(planSchema.safeParse({ studioStartDate: null, studioStartTime: null }).success);
  for (const studioStartDate of ["2026-02-31", "2026-13-01", "01/11/2026"]) assert.equal(planSchema.safeParse({ studioStartDate }).success, false, studioStartDate);
  for (const studioStartTime of ["25:00", "7am"]) assert.equal(planSchema.safeParse({ studioStartTime }).success, false, studioStartTime);
});
