const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const prisma = require("../src/config/db");
const { definitions } = require("../src/modules/hrm/master-data/definitions");
const { optionNames, namesWithFlag, nameWithFlag } = require("../src/services/optionLists");
const { FIELD_LISTS } = require("../../frontend/src/constants/moduleFieldLists.js");

/*
 * Ten more dropdowns the studio maintains rather than ten more arrays it could not reach.
 *
 * Every one is plain vocabulary - what state an asset is in, how it travels, what a vendor is
 * engaged for, what kind of work a task is. The workflow states beside them are deliberately NOT
 * here: a task's PENDING → IN_PROGRESS → COMPLETED and a client storage record's transitions are a
 * state machine the code branches on, and renaming COMPLETED would strand every completed task.
 * That line is the thing worth holding, so the last test in this file holds it.
 */

const SEEDED = [
  ["assetCondition", ["Excellent", "Good", "Fair", "Damaged"]],
  ["assetRepairSeverity", ["Low", "Medium", "High", "Critical"]],
  ["assetShipmentType", ["Hand Delivery", "Courier", "Transport", "Internal Transfer"]],
  ["storageCondition", ["Excellent", "Good", "Fair", "Damaged"]],
  ["storageShipmentType", ["Hand Delivery", "Courier", "Transport", "Internal Transfer"]],
  ["bankAccountType", ["Savings", "Current", "Overdraft", "Cash Credit"]],
  ["taskType", ["Client", "Internal", "Administrative", "Follow Up", "Escalation", "Other"]],
  ["paymentSettlement", ["Expense Excess", "Reimbursement needed"]],
];

test("each list was seeded with exactly what its array held", async () => {
  // Nothing already recorded may stop matching: an asset inspected as "Fair" before this has to
  // still name a condition the list offers.
  for (const [model, expected] of SEEDED) {
    const rows = await prisma[model].findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
    assert.deepEqual(rows.map((row) => row.name), expected, `${model} no longer offers what it did`);
  }
  assert.equal((await prisma.vendorType.count({ where: { isActive: true } })), 14);
  assert.equal((await prisma.offerType.count({ where: { isActive: true } })), 21);
});

test("Assets and Client Storage keep a list each, not one between them", async () => {
  /*
   * They read the same today and the studio asked for them to be able to part company: a disc on
   * its way to a client is not judged the way a camera on the shelf is. Two tables, so adding to one
   * cannot alter the other - which is exactly what sharing a list would have done.
   */
  assert.notEqual(definitions["asset-conditions"].model, definitions["storage-conditions"].model);
  assert.notEqual(definitions["asset-shipment-types"].model, definitions["storage-shipment-types"].model);

  const before = await optionNames("storageCondition", []);
  const added = await prisma.assetCondition.create({ data: { code: "ZZ_PROBE", name: "ZZ Probe Condition", sortOrder: 99 } });
  try {
    // Read straight from the table rather than through the cache, which this deliberately does not
    // disturb: what is being checked is that the two tables are separate, not how they are cached.
    const after = (await prisma.storageCondition.findMany({ where: { isActive: true } })).map((row) => row.name);
    assert.deepEqual(after.sort(), [...before].sort(), "adding an asset condition changed the storage list");
  } finally {
    await prisma.assetCondition.delete({ where: { id: added.id } });
  }
});

test("the two meanings are on the row, and exactly where they were", async () => {
  // "Other" was the literal the task form and the tasks service both compared against; "Expense
  // Excess" was the literal that decided which way the money moved.
  assert.deepEqual(await namesWithFlag("taskType", "asksForDetails", []), ["Other"]);
  assert.equal(await nameWithFlag("paymentSettlement", "meansExcess", ""), "Expense Excess");

  const settling = await prisma.paymentSettlement.count({ where: { isActive: true, meansExcess: true } });
  assert.equal(settling, 1, "a request has no single settlement meaning the money comes back");
});

test("a list that cannot be read falls back rather than answering empty", async () => {
  /*
   * A model that does not exist stands in for a table that cannot be read. Answering "no condition
   * is valid" would refuse every asset inspection the studio tried to record, and an empty picker is
   * not a smaller failure than a wrong one.
   */
  const fallback = ["Excellent", "Good"];
  assert.deepEqual(await optionNames("noSuchListAnywhere", fallback), fallback);
  assert.deepEqual(await namesWithFlag("noSuchListAnywhere", "whatever", fallback), fallback);
  assert.equal(await nameWithFlag("noSuchListAnywhere", "whatever", "Expense Excess"), "Expense Excess");
});

test("every one of the ten is offered in Field Settings, under the screen that asks it", () => {
  const byValue = Object.fromEntries(FIELD_LISTS.map((item) => [item.value, item]));
  for (const [value, screens] of [
    ["asset-conditions", ["assets"]],
    ["asset-repair-severities", ["assets"]],
    ["asset-shipment-types", ["assets"]],
    ["storage-conditions", ["client-storage"]],
    ["storage-shipment-types", ["client-storage"]],
    ["vendor-types", ["vendors"]],
    ["bank-account-types", ["accounts-manager"]],
    ["payment-settlements", ["payment-requests"]],
    ["offer-types", ["leads-followups", "quotations"]],
    ["task-types", ["tasks"]],
  ]) {
    assert.ok(byValue[value], `${value} is not offered in Field Settings`);
    assert.deepEqual(byValue[value].screens, screens, `${value} is offered under the wrong screens`);
    assert.ok(definitions[value], `${value} is not a master-data resource`);
  }
});

/* ────────────────────────── the readers, off the source ────────────────────────── */

const read = (...parts) => fs.readFileSync(path.join(process.cwd(), ...parts), "utf8");
const frontend = (...parts) => read("..", "frontend", "src", ...parts);

test("the browser and the server ask the same list", () => {
  /*
   * The failure this is here for: a word the form offered and the server refused. Both sides read
   * the list now, so a condition or a mode added in Settings is accepted by whatever validates it.
   */
  const storage = read("src", "modules", "assets", "client-storage.controller.js");
  assert.match(storage, /optionNames\("storageCondition"/, "the server no longer reads the storage conditions");
  assert.match(storage, /optionNames\("storageShipmentType"/, "the server no longer reads the storage shipment types");
  assert.match(storage, /parseAsync/, "the transit details are parsed synchronously, so the list check cannot run");

  const inspections = read("src", "modules", "assets", "inspections.controller.js");
  assert.match(inspections, /optionNames\("assetCondition"/, "an inspection no longer checks the studio's conditions");
  assert.ok(!/z\.enum\(\["Excellent"/.test(inspections), "the inspection still validates against a compiled-in set");

  const vendors = read("src", "modules", "assets", "vendor-options.js");
  assert.match(vendors, /optionNames\("vendorType"/, "vendor types are still an array on the server");

  const panel = frontend("constants", "formPanelConfig.js");
  for (const key of ["assetConditions", "assetRepairSeverities", "assetShipmentTypes"]) {
    assert.match(panel, new RegExp(`options: "${key}"`), `the ${key} field is back on a compiled-in list`);
  }
});

test("the two meanings are read off the row on both sides, not off the spelling", () => {
  const service = read("src", "modules", "hrm", "tasks", "service.js");
  assert.match(service, /namesWithFlag\("taskType", "asksForDetails"/, "the server decides Other by its name again");

  const config = frontend("constants", "taskConfig.js");
  assert.match(config, /taskTypesAskingForDetails/, "the form decides Other by its name again");

  const requests = read("src", "modules", "hrm", "payment-requests", "controller.js");
  assert.match(requests, /nameWithFlag\("paymentSettlement", "meansExcess"/, "the excess settlement is a literal again");
  const requestConfig = frontend("constants", "paymentRequestConfig.js");
  assert.match(requestConfig, /context\?\.options\?\.excessSettlement/, "the form decides the excess by its name again");
});

test("the workflow states stayed in the code", () => {
  /*
   * The line this whole change is drawn along. These are states the application branches on, not
   * vocabulary: a task moves PENDING → IN_PROGRESS → COMPLETED, an asset may only be assigned in
   * certain states, and client storage has a table of legal transitions. Letting somebody rename
   * COMPLETED in Settings would strand every completed task, and no flag on a row rescues that.
   */
  const offered = new Set(FIELD_LISTS.map((item) => item.value));
  for (const value of ["task-statuses", "task-priorities", "asset-statuses", "client-storage-statuses",
    "payment-request-statuses", "payment-request-types", "cash-entry-types"]) {
    assert.ok(!offered.has(value), `${value} is a workflow state and must not be editable in Settings`);
  }
  assert.match(read("src", "modules", "hrm", "tasks", "service.js"), /const STATUSES = \["PENDING"/,
    "task statuses are no longer a fixed set in the code");
});
