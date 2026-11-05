const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { resolveColumnMapping, mapRowToCrmCandidate, createLeadIdAllocator, phoneKey } = require("../src/modules/sales/crm-leads/googleSheetsService");
const { LEAD_SOURCES } = require("../src/modules/sales/crm-leads/leadSources");

/*
 * A lead's Source says how it came into the CRM: Manual Entry, CSV Import, Google Sheet
 * Integration or Callyzer. A sheet's or a CSV's own "Source" cell (Instagram, a campaign name) is
 * ignored, and a lead that already has a Source keeps it on every re-read.
 */

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");

test("the four labels, named once", () => {
  assert.deepEqual(LEAD_SOURCES, { MANUAL: "Manual Entry", CSV: "CSV Import", SHEET: "Google Sheet Integration", CALLYZER: "Callyzer" });
});

const HEADERS = ["Enquiry Name", "Phone Number", "Source"];
const LINK = { vertical: "Dum Dum", spreadsheetId: "sheet-1", targetedTab: "Leads" };
const mapping = { ...resolveColumnMapping(HEADERS, "Dum Dum"), headers: HEADERS };
const map = (existingByPhone = new Map()) =>
  mapRowToCrmCandidate(["Priya", "9876543210", "Instagram"], mapping, LINK, 2, createLeadIdAllocator(), new Map(), existingByPhone).record.lead;

test("a new lead from the sheet says Google Sheet Integration, whatever the sheet's Source cell says", () => {
  assert.equal(map().source, "Google Sheet Integration");
});

test("a lead that already has a source keeps it on every re-read of the sheet", () => {
  const existing = { lead: { id: "DBS-EID-DD-ERD-000001", phone: "9876543210", vertical: "Dum Dum", source: "Walk-in" }, details: {} };
  assert.equal(map(new Map([[phoneKey("Dum Dum", "9876543210"), existing]])).source, "Walk-in");
});

test("a CSV import says CSV Import and never reads the file's Source column", () => {
  const csv = read("src", "modules", "sales", "crm-leads", "csvImportService.js");
  assert.match(csv, /record\.lead\.source = LEAD_SOURCES\.CSV;/);
  assert.doesNotMatch(csv, /suppliedSource/);
});

test("Add Lead and Bulk Entry say Manual Entry, whatever the body says", () => {
  const controller = read("src", "modules", "sales", "crm-leads", "controller.js");
  assert.match(controller, /record\.lead\.source = LEAD_SOURCES\.MANUAL;\n\s*const created = await createCrmLead\(record\);/);
  assert.match(controller, /lead: \{ \.\.\.record\.lead, id, source: LEAD_SOURCES\.MANUAL \}/);
});

test("the migration puts stored leads on the labels: sheet, then CSV, then the blank ones", () => {
  const sql = read("prisma", "migrations", "20261009130000_crm_lead_source_labels", "migration.sql");
  assert.match(sql, /SET `source` = 'Google Sheet Integration'\nWHERE COALESCE\(`spreadsheet_id`, ''\) <> '';/);
  assert.match(sql, /SET `source` = 'CSV Import'[\s\S]*LIKE 'csv%'/);
  assert.match(sql, /SET `source` = 'Manual Entry'[\s\S]*TRIM\(COALESCE\(`source`, ''\)\) = ''/);
});
