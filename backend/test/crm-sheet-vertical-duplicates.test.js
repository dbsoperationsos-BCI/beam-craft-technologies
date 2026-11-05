const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { resolveColumnMapping, mapRowToCrmCandidate, createLeadIdAllocator, phoneKey } = require("../src/modules/sales/crm-leads/googleSheetsService");

/*
 * One number, one enquiry - per vertical - on the sheet sync too.
 *
 * The sheet matched an arriving number against every lead in the CRM, so a client already on Dum Dum
 * whose number came in on a Qua Qua sheet was read as "already here" and never imported. A different
 * vertical is different work and a second enquiry on purpose; only the same number in the same
 * vertical is the same client twice - the rule Add Lead already applies.
 */

const SHEET = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "crm-leads", "googleSheetsService.js"), "utf8");
const HEADERS = ["Enquiry Name", "Phone Number"];

const mapAs = (vertical, existing) => {
  const link = { vertical, spreadsheetId: "sheet-1", targetedTab: "Leads" };
  const mapping = { ...resolveColumnMapping(HEADERS, vertical), headers: HEADERS };
  return mapRowToCrmCandidate(["Priya", "9876543210"], mapping, link, 2, createLeadIdAllocator(), new Map(), existing).record.lead;
};
const ddLead = { lead: { id: "DBS-EID-DD-ERD-000001", phone: "9876543210", vertical: "Dum Dum", name: "Priya" }, details: {} };

test("the key is the vertical and the number together", () => {
  assert.equal(phoneKey("Dum Dum", "+91 98765 43210"), phoneKey("dumdum", "9876543210"));
  assert.notEqual(phoneKey("Dum Dum", "9876543210"), phoneKey("Qua Qua", "9876543210"));
  // A blank vertical is Dum Dum, as the board reads it; no number is no key.
  assert.equal(phoneKey("", "9876543210"), phoneKey("Dum Dum", "9876543210"));
  assert.equal(phoneKey("Qua Qua", ""), "");
});

test("the same number in another vertical is a new enquiry, not the existing lead", () => {
  const existing = new Map([[phoneKey("Dum Dum", "9876543210"), ddLead]]);
  const qq = mapAs("Qua Qua", existing);
  assert.notEqual(qq.id, ddLead.lead.id, "a Qua Qua row was folded onto the Dum Dum lead");
  assert.match(qq.id, /^DBS-EID-QQ-/);
});

test("the same number in the same vertical is still the lead already held", () => {
  const existing = new Map([[phoneKey("Dum Dum", "9876543210"), ddLead]]);
  assert.equal(mapAs("Dum Dum", existing).id, ddLead.lead.id);
});

test("every phone match on the sheet path - live, in-sheet, deleted, refresh - is keyed by vertical", () => {
  assert.doesNotMatch(SHEET, /existingByPhone\.(get|set|has)\(normalizePhone/, "a phone map is keyed by the bare number again");
  assert.doesNotMatch(SHEET, /byPhone\.set\(number,/);
  assert.match(SHEET, /const tel = phoneKey\(vertical, phone\);/, "a deleted lead in one vertical holds back another's");
  assert.match(SHEET, /`vertical` FROM `sales_crm_lead` WHERE `deleted_at` IS NOT NULL/);
});
