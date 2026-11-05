const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { importColumns, rowSchema } = require("../src/modules/project-management/production/importColumns");
const { progressOf, productionFor } = require("../src/modules/project-management/production/import.service");
const { importTableRows } = require("../src/services/tableImport");

/*
 * The browser writes the template from `constants/importColumns.js` and this module reads the file
 * back, so the two lists have to be one list. The frontend's is an ES module in another package, so
 * it is evaluated as text and compared.
 */
function frontendColumns() {
  const source = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", "constants", "importColumns.js"), "utf8");
  // eslint-disable-next-line no-new-func
  return new Function(`${source.replace(/^export /gm, "")}; return PRODUCTION_IMPORT_COLUMNS;`)();
}

test("the production template matches the frontend's, heading for heading", () => {
  const server = importColumns().map(({ field, label, required }) => ({ field, label, required: Boolean(required) }));
  assert.deepEqual(frontendColumns(), server);
});

test("Completed is the only status that says where a shoot stands; the rest are its history", () => {
  assert.deepEqual(progressOf({ shootStatus: "COMPLETED" }), { step: "DONE", status: "COMPLETED" });
  // A step past Happy clients is Completed whether the sheet says so or not.
  assert.deepEqual(progressOf({ currentStep: "PHOTO_COPY" }), { step: "PHOTO_COPY", status: "COMPLETED" });
  assert.deepEqual(progressOf({ currentStep: "PINEAPPLE_MEETING" }), { step: "PINEAPPLE_MEETING", status: undefined });
  // An old sheet's Hold or Started pins no step: nothing sets either any more.
  assert.deepEqual(progressOf({ shootStatus: "HOLD" }), { step: undefined, status: "HOLD" });
  assert.deepEqual(progressOf({ shootStatus: "STARTED", currentStep: "HAPPENING_NOW" }), { step: "HAPPENING_NOW", status: "STARTED" });
  // A shoot stored on a step nobody works is taken as the sheet writes it; the board reads it forward.
  assert.deepEqual(progressOf({ currentStep: "REACHED_STUDIO" }), { step: "REACHED_STUDIO", status: "COMPLETED" });
  // A photo copy is the last step.
  assert.deepEqual(progressOf({ footageUrl: "https://drive.example/x" }), { step: "DONE", status: "COMPLETED" });
});

test("a step and a status that cannot go together are refused, saying which", () => {
  assert.throws(() => progressOf({ shootStatus: "COMPLETED", currentStep: "PINEAPPLE_MEETING" }), /Completed shoot is past Happy clients/);
  assert.throws(() => progressOf({ shootStatus: "HOLD", currentStep: "DONE" }), /past Happy clients is Completed/);
  assert.throws(() => progressOf({ footageUrl: "https://drive.example/x", currentStep: "REACHED_STUDIO" }), /photo copy is the last step/);
});

const HEADERS = importColumns().map((column) => column.label);
async function run(values) {
  const created = [];
  const result = await importTableRows({ headers: HEADERS, rows: [HEADERS.map((label) => values[label] ?? "")], columns: importColumns(), schema: rowSchema, create: async (row) => { created.push(row); } });
  return { result, created };
}

test("the Footage Location column still reads a sheet headed Footage URL, as it was before the rename", async () => {
  const headers = HEADERS.map((label) => (label === "Footage Location" ? "Footage URL" : label));
  const values = {
    "Shoot ID": "DBS-SID-2519", "Footage URL": "Seagate 3, Reception shelf",
    "Footage Backup By Employee Code": "E1", "File Count": "3", Size: "1 GB", "First File Name": "a.jpg", "Last File Name": "c.jpg",
  };
  const created = [];
  const result = await importTableRows({ headers, rows: [headers.map((label) => values[label] ?? "")], columns: importColumns(), schema: rowSchema, create: async (row) => { created.push(row); } });
  assert.equal(result.imported, 1, JSON.stringify(result.errors));
  // Last month's spreadsheet is not asked to be re-headed, and the cell is read as plain text.
  assert.equal(created[0].footageUrl, "Seagate 3, Reception shelf");
});

test("cells are read the way a sheet writes them", async () => {
  const { result, created } = await run({ "Shoot ID": "DBS-SID-2519", "Production Step": "reached shoot place", "Shoot Status": "", "Travel Mode": "train", "Plan Submitted": "yes", "Production Team Employee Codes": "E1, E2" });
  assert.equal(result.imported, 1, JSON.stringify(result.errors));
  assert.equal(created[0].currentStep, "REACHED_SHOOT_PLACE");
  assert.equal(created[0].travelMode, "Train");
  assert.equal(created[0].planSubmitted, true);
  assert.deepEqual(created[0].teamCodes, ["E1", "E2"]);
  const held = await run({ "Shoot ID": "x", "Shoot Status": "on hold" });
  assert.equal(held.created[0].shootStatus, "HOLD");
});

test("a bad cell, or half a photo copy, is refused naming its column", async () => {
  const cases = [
    [{ "Production Step": "Lunch" }, /^Production Step: Use one of/],
    [{ "Travel Mode": "Boat" }, /^Travel Mode: Use one of/],
    [{ "Footage Location": "drive.example/x" }, /^Footage Backup By Employee Code: Fill this in too/],
  ];
  for (const [change, message] of cases) {
    const { result } = await run({ "Shoot ID": "DBS-SID-2519", ...change });
    assert.equal(result.imported, 0, String(message));
    assert.match(result.errors[0].message, message);
  }
});

/*
 * A transaction holding one imported Dum Dum shoot (sheet Event ID DBS-EVT-1) whose project's
 * Production Manager is employee 5 and whose production team has employee 7 on it.
 */
const transaction = {
  projectShoot: {
    findUnique: async ({ where }) => (where.sheetShootId === "DBS-SID-1" ? {
      deletedAt: null,
      project: { vertical: "WED", sheetEventId: "DBS-EVT-1", deletedAt: null },
      production: { id: "prod-1", salesProject: { productionManagerEmployeeId: 5 }, teamMembers: [{ employeeId: 7 }], serviceCrew: [], productionCoordinatorEmployeeId: null },
    } : null),
  },
};
const manager = { userId: 1, employeeId: 5 };
const teamMember = { userId: 2, employeeId: 7 };
const superAdmin = { userId: 3, employeeId: null, superAdmin: true };
const find = (caller, row) => productionFor(transaction, { vertical: "WED", row: { sheetShootId: "DBS-SID-1", ...row }, caller });

test("only somebody who may change the plan on the board may import it", async () => {
  assert.equal((await find(manager)).id, "prod-1");
  assert.equal((await find(superAdmin)).id, "prod-1");
  // On the shoot, and so on the board, but not its Production Manager: the board refuses their plan edits.
  await assert.rejects(find(teamMember), /not a shoot you can update/);
});

test("a shoot outside the caller's reach says nothing about itself", async () => {
  // Neither its vertical nor its Event ID is said back - nor whether it exists at all.
  await assert.rejects(productionFor(transaction, { vertical: "QQ", row: { sheetShootId: "DBS-SID-1" }, caller: teamMember }), /not a shoot you can update/);
  await assert.rejects(productionFor(transaction, { vertical: "WED", row: { sheetShootId: "DBS-SID-404" }, caller: manager }), /not a shoot you can update/);
  // Somebody who reaches every shoot is told why it is missing.
  await assert.rejects(productionFor(transaction, { vertical: "WED", row: { sheetShootId: "DBS-SID-404" }, caller: superAdmin }), /Import Pre Production first/);
});

test("the row's vertical and Event ID are checked against the shoot", async () => {
  await assert.rejects(productionFor(transaction, { vertical: "QQ", row: { sheetShootId: "DBS-SID-1" }, caller: manager }), /not a Qua Qua shoot/);
  await assert.rejects(find(manager, { sheetEventId: "DBS-EVT-9" }), /does not belong to Event ID DBS-EVT-9/);
});

// ---- Placeholders, and people kept by name ----

test("the old sheet's placeholders come in empty, in a cell and in a team list", async () => {
  const { result, created } = await run({
    "Shoot ID": "DBS-SID-2519", "Plan Remarks": "IN OLD SHEET", "Production Step": "N/A", "Shoot Status": "WCR", "Travel Mode": "#REF!",
    "Footage URL": "N/A", "Production Team Employee Codes": "WCR, Ajeesh, N/A",
  });
  assert.equal(result.imported, 1, JSON.stringify(result.errors));
  assert.equal(created[0].remarks, undefined);
  assert.equal(created[0].currentStep, undefined);
  assert.equal(created[0].shootStatus, undefined);
  assert.equal(created[0].travelMode, undefined);
  assert.equal(created[0].footageUrl, undefined);
  assert.deepEqual(created[0].teamCodes, ["Ajeesh"]);
});

/*
 * One shoot's production, driven through `importRow` with a stand-in client: Asha (E001) works here;
 * Sudeep, Ravi and Ajeesh are names in the old sheet and nobody working in the studio.
 */
const { importRow } = require("../src/modules/project-management/production/import.service");
require("../src/services/employeeOptionLists").workingEmployeeStatuses = async () => ["Active"];

function importWorld(production = {}) {
  const writes = { updates: [], members: [], footage: [], cleared: [] };
  const record = {
    id: "prod-1", shootId: "shoot-1", currentStep: "STARTED_FROM_STUDIO", planSubmittedAt: null, shootStatus: null,
    productionCoordinatorEmployeeId: null, productionCoordinatorName: null, travelMode: null, travelModeOther: null, travelVehicleAssetId: null,
    // The footage already held, if any: the import fills a photo copy only where there is no
    // finished one, and a File in saved part way on the board is not one.
    vehicleNumberPlate: null, remarks: null, salesProject: { productionManagerEmployeeId: null }, teamMembers: [], serviceCrew: [], footage: [],
    ...production,
  };
  const staff = { E001: { id: 1, employeeName: "Asha" }, asha: { id: 1, employeeName: "Asha" } };
  const transaction = {
    projectShoot: { findUnique: async () => ({ deletedAt: null, project: { vertical: "WED", sheetEventId: "DBS-EVT-1", deletedAt: null }, production: record }) },
    projectProduction: { updateMany: async (args) => { writes.updates.push(args); return { count: 1 }; } },
    projectProductionTeamMember: { createMany: async (args) => { writes.members.push(args.data); } },
    projectProductionFootage: {
      create: async (args) => { writes.footage.push(args.data); },
      deleteMany: async (args) => { writes.cleared.push(args.where); return { count: 0 }; },
    },
    projectProductionActivity: { create: async () => ({}) },
    employee: { findMany: async ({ where }) => where.id.in.filter((id) => id === 1).map((id) => ({ id, employeeName: "Asha" })) },
  };
  const references = async () => ({ employee: (text) => (staff[text] ? { kind: text === "E001" ? "employee-id" : "exact", target: staff[text] } : { kind: "unmatched" }) });
  return { writes, deps: { client: { $transaction: async (work) => work(transaction) }, references } };
}
const caller = { userId: 1, name: "Owner", superAdmin: true };
const rowOf = (values) => ({ sheetShootId: "DBS-SID-2519", planSubmitted: false, ...values });

test("a coordinator who has left is kept by name; a working one is linked", async () => {
  const left = importWorld();
  await importRow({ vertical: "WED", row: rowOf({ productionCoordinatorCode: "Sudeep" }), caller }, left.deps);
  assert.deepEqual(left.writes.updates[0].data, { productionCoordinatorName: "Sudeep" });

  const working = importWorld();
  await importRow({ vertical: "WED", row: rowOf({ productionCoordinatorCode: "E001" }), caller }, working.deps);
  assert.deepEqual(working.writes.updates[0].data, { productionCoordinatorEmployeeId: 1 });
});

test("a coordinator already on the record, linked or named, is never overwritten", async () => {
  for (const held of [{ productionCoordinatorEmployeeId: 9 }, { productionCoordinatorName: "Ravi" }]) {
    const { writes, deps } = importWorld(held);
    await importRow({ vertical: "WED", row: rowOf({ productionCoordinatorCode: "Sudeep" }), caller }, deps);
    assert.equal(writes.updates.length, 0, JSON.stringify(held));
  }
});

test("the team links who works here, keeps who has left by name, and counts each person once", async () => {
  const { writes, deps } = importWorld();
  await importRow({ vertical: "WED", row: rowOf({ teamCodes: ["E001", "asha", "Ajeesh", "ajeesh"] }), caller }, deps);
  assert.deepEqual(writes.members[0], [
    { productionId: "prod-1", employeeId: 1, employeeName: null },
    { productionId: "prod-1", employeeId: null, employeeName: "Ajeesh" },
  ]);
});

test("a photo copy's backup who has left is kept by name", async () => {
  const { writes, deps } = importWorld({ planSubmittedAt: new Date("2026-09-30T04:00:00Z") });
  const photoCopy = { footageUrl: "https://drive.example/x", footageBackupCode: "Ravi", fileCount: 3, size: "1 GB", firstFileName: "a.jpg", lastFileName: "c.jpg" };
  await importRow({ vertical: "WED", row: rowOf(photoCopy), caller }, deps);
  assert.equal(writes.footage[0].backedUpByEmployeeId, null);
  assert.equal(writes.footage[0].backedUpByName, "Ravi");

  /*
   * A File in saved part way on the board is not an answer: the sheet's one replaces it, and the
   * pending row of the whole shoot is cleared first so the two do not sit side by side (the unique
   * key does not hold NULL services apart in MySQL).
   */
  const pending = importWorld({ planSubmittedAt: new Date("2026-09-30T04:00:00Z"), footage: [{ footageUrl: "https://drive.example/half", backedUpByEmployeeId: 1, fileCount: null, size: null, firstFileName: null, lastFileName: null }] });
  await importRow({ vertical: "WED", row: rowOf(photoCopy), caller }, pending.deps);
  assert.equal(pending.writes.footage.length, 1, "the sheet fills a pending photo copy");
  assert.deepEqual(pending.writes.cleared, [{ productionId: "prod-1", serviceDefinitionId: null }]);

  // A finished one is left alone, as every other answer the app already holds is.
  const filed = importWorld({ planSubmittedAt: new Date("2026-09-30T04:00:00Z"), footage: [{ footageUrl: "https://drive.example/x", backedUpByEmployeeId: 1, fileCount: 3, size: "1 GB", firstFileName: "a.jpg", lastFileName: "c.jpg" }] });
  await importRow({ vertical: "WED", row: rowOf(photoCopy), caller }, filed.deps);
  assert.equal(filed.writes.footage.length, 0, "the app's own answer wins");
});
