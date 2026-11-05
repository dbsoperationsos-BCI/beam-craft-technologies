const test = require("node:test");
const assert = require("node:assert/strict");
const { sheetFingerprint, unchangedSince, lastCleanPass, FULL_PASS_EVERY_MS } = require("../src/modules/sales/crm-leads/autoSync");

const link = { id: "link-1", vertical: "Dum Dum", targetedTab: "Leads" };
const sheet = { headers: ["Name", "Phone"], rows: [{ Name: "Priya", Phone: "9876543210" }] };

test("an unchanged sheet is skipped only after a clean pass, and only for half an hour", () => {
  lastCleanPass.clear();
  const print = sheetFingerprint(link, sheet);
  // Never imported cleanly yet: the full pass runs.
  assert.equal(unchangedSince(link, print), false);
  lastCleanPass.set(link.id, { fingerprint: print, at: 1_000 });
  assert.equal(unchangedSince(link, print, 1_000 + 60_000), true);
  // Past the full-pass interval the import runs again even though nothing changed.
  assert.equal(unchangedSince(link, print, 1_000 + FULL_PASS_EVERY_MS), false);
  lastCleanPass.clear();
});

test("any change to the rows, the headers, the tab or the vertical is a change", () => {
  const print = sheetFingerprint(link, sheet);
  assert.notEqual(sheetFingerprint(link, { ...sheet, rows: [...sheet.rows, { Name: "Anu", Phone: "9000000000" }] }), print);
  assert.notEqual(sheetFingerprint(link, { ...sheet, rows: [{ Name: "Priya", Phone: "9876543211" }] }), print);
  assert.notEqual(sheetFingerprint(link, { ...sheet, headers: ["Name", "Mobile"] }), print);
  assert.notEqual(sheetFingerprint({ ...link, vertical: "Qua Qua" }, sheet), print);
  assert.notEqual(sheetFingerprint({ ...link, targetedTab: "Other" }, sheet), print);
  assert.equal(sheetFingerprint(link, JSON.parse(JSON.stringify(sheet))), print);
});
