const test = require("node:test");
const assert = require("node:assert/strict");

/*
 * A CRM lead's vertical, as the Create Project form reads it.
 *
 * `SalesCrmLead.branch` is the vertical — a different column from `assignedBranch`, which is the
 * physical branch the lead is worked from. Spellings vary across leads imported at different times,
 * so this mirrors the CRM screens' own normaliser; the two must agree or a lead would land on one
 * vertical in CRM and another in Project Management.
 */
function verticalForLeadBranch(branch) {
  const value = String(branch || "").trim().toLowerCase();
  if (value === "dum dum" || value === "dumdum") return { groupType: "Dum Dum", vertical: "WED" };
  if (value === "qua qua" || value === "quaqua") return { groupType: "Qua Qua", vertical: "QQ" };
  if (value === "corp" || value === "corporate" || value === "corporation") return { groupType: "Corp", vertical: "CORP" };
  return { groupType: null, vertical: null };
}

test("each vertical's branch resolves to its Product and vertical code", () => {
  assert.deepEqual(verticalForLeadBranch("Dum Dum"), { groupType: "Dum Dum", vertical: "WED" });
  assert.deepEqual(verticalForLeadBranch("Qua Qua"), { groupType: "Qua Qua", vertical: "QQ" });
  assert.deepEqual(verticalForLeadBranch("Corp"), { groupType: "Corp", vertical: "CORP" });
});

test("the spellings that reach the CRM from imports all resolve", () => {
  for (const [branch, vertical] of [["dumdum", "WED"], ["DUM DUM", "WED"], ["  quaqua  ", "QQ"], ["Corporate", "CORP"], ["corporation", "CORP"]]) {
    assert.equal(verticalForLeadBranch(branch).vertical, vertical, branch);
  }
});

test("an unrecognised or missing branch resolves to nothing rather than guessing", () => {
  // Better a blank Product the form still asks for than a wrong one nobody checks.
  for (const branch of ["", null, undefined, "Erode", "unknown"]) {
    assert.deepEqual(verticalForLeadBranch(branch), { groupType: null, vertical: null }, String(branch));
  }
});

test("the physical branch is never mistaken for the vertical", () => {
  // `assignedBranch` holds these, and none of them is a vertical.
  for (const city of ["Erode", "Coimbatore", "Bangalore", "Hyderabad"]) {
    assert.equal(verticalForLeadBranch(city).vertical, null, city);
  }
});
