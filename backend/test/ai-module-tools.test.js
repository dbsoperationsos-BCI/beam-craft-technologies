const test = require("node:test");
const assert = require("node:assert");
const registry = require("../src/services/ai/tools/registry");
const { registerAllTools } = require("../src/services/ai/tools");
const hrmRead = require("../src/modules/hrm/employees/read.service");
const cashRead = require("../src/modules/accounts/cash-entries/read.service");
const assetRead = require("../src/modules/assets/assets.read.service");

/**
 * The tools for HRM, Accounts and Assets.
 *
 * What these mostly check is what is *not* returned. An employee row carries Aadhaar and PAN
 * numbers, bank account and IFSC, salary and home address; a cash entry carries account numbers and
 * transaction ids; an asset carries invoices and inspection photographs. None of it answers the
 * questions these tools exist for, and all of it would end up in a prompt if the select lists
 * slipped.
 *
 * The database these run against has no employees, cash entries or assets, so the counts are zero.
 * The shapes and the exclusions are what is being tested, and those hold whether or not there are
 * rows.
 */

test.before(() => { registry.resetRegistry(); registerAllTools(); });
test.after(() => registry.resetRegistry());

test("every module with tools maps to a real permission", () => {
  const byModule = {};
  for (const tool of registry.allTools()) (byModule[tool.module] ||= []).push(tool.name);

  for (const module of ["SALES", "IMAGE_SELECTION", "HRM", "ACCOUNTS", "ASSET"]) {
    assert.ok(byModule[module]?.length, `${module} should have tools`);
  }
  // Still not invented.
  assert.strictEqual(byModule.TECHNICAL, undefined);
  assert.strictEqual(byModule.GLOBAL, undefined);
  assert.strictEqual(byModule.ADMIN, undefined);
});

test("an employee's private life never reaches a tool", () => {
  /*
   * The select list is the protection, so it is asserted directly rather than through a row - the
   * table is empty here, and an empty result would pass any test about its contents.
   */
  const selected = Object.keys(hrmRead.SAFE_FIELDS);
  for (const field of [
    "aadharCardNumber", "panCardNumber", "aadharCardImageUrl", "panCardImageUrl",
    "accountNumber", "ifscCode", "bankName", "totalSalary", "joiningSalary",
    "currentAddress", "permanentAddress", "dateOfBirth", "emergencyContactNumber",
    "fatherName", "motherName", "spouseName",
  ]) {
    assert.ok(!selected.includes(field), `${field} is selected by the HRM read service`);
  }
  // And the useful ones are there, or the tool answers nothing.
  for (const field of ["employeeId", "employeeName", "designation", "department", "employmentStatus"]) {
    assert.ok(selected.includes(field), `${field} should be selected`);
  }
});

test("a cash entry's banking details never reach a tool", () => {
  const selected = Object.keys(cashRead.SAFE_FIELDS);
  for (const field of ["transactionId", "receivedAccount", "paidFromAccount", "paymentProof", "paymentMode"]) {
    assert.ok(!selected.includes(field), `${field} is selected by the cash read service`);
  }
  for (const field of ["entryId", "entryType", "category", "amount", "entryDate"]) {
    assert.ok(selected.includes(field), `${field} should be selected`);
  }
});

test("an asset's photographs and invoices never reach a tool", () => {
  const selected = Object.keys(assetRead.SAFE_FIELDS);
  for (const field of [
    "photoData", "images", "documents", "invoiceNumber", "purchasePrice", "insuranceDetails",
    "lastInspectionImages", "currentInspectionImages", "serialNumber",
  ]) {
    assert.ok(!selected.includes(field), `${field} is selected by the asset read service`);
  }
});

test("every search is bounded, in every module", async () => {
  // A model asking for everything gets a page.
  for (const [label, run] of [
    ["hrm", (limit) => hrmRead.searchEmployees({ limit })],
    ["accounts", (limit) => cashRead.searchEntries({ limit })],
    ["assets", (limit) => assetRead.searchAssets({ limit })],
  ]) {
    for (const asked of [99999, -1, "all", null]) {
      const result = await run(asked);
      assert.ok(result.limit >= 1 && result.limit <= 50, `${label} allowed ${result.limit}`);
    }
  }
});

test("a total is counted in the database, not by measuring the page", async () => {
  /*
   * The distinction that keeps "how many" honest: `count` is what came back, `total` is what exists.
   * Without both, a page of twenty reads as twenty employees.
   */
  for (const result of [
    await hrmRead.searchEmployees({ limit: 5 }),
    await cashRead.searchEntries({ limit: 5 }),
    await assetRead.searchAssets({ limit: 5 }),
  ]) {
    assert.ok(Object.hasOwn(result, "count"));
    assert.ok(Object.hasOwn(result, "total"));
    assert.ok(Object.hasOwn(result, "truncated"));
  }
});

test("an asset summary does not list a hundred and fifty empty categories", async () => {
  // The taxonomy is fixed and long; a summary should be the shape of the estate, not its filing.
  const summary = await assetRead.getAssetSummary();
  assert.ok(summary.byCategory.length <= 12, `${summary.byCategory.length} categories returned`);
  for (const row of summary.byCategory) assert.ok(row.count > 0, `${row.value} has no assets`);
});

test("each module's summary is marked so it can be gathered without being asked for", () => {
  const summaries = registry.allTools().filter((tool) => tool.summary).map((tool) => tool.module);
  for (const module of ["SALES", "HRM", "ACCOUNTS", "ASSET"]) {
    assert.ok(summaries.includes(module), `${module} has no standing summary to gather`);
  }
});

test("a cross-module briefing renders each module briefly", () => {
  /*
   * Given five full pages the model picked the wrong figure out of them - it reported "17794
   * follow-ups" from a line that was the count of leads with no event type set.
   */
  const sales = registry.findTool("sales.getPipeline");
  assert.ok(typeof sales.renderBrief === "function", "the CRM summary has no brief form");
});
