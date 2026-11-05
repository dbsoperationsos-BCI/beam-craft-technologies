const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const prisma = require("../src/config/db");
const brandingRepository = require("../src/modules/image-selection/settings/repository");
const controller = require("../src/modules/settings/template-settings/controller");
const { postalLines } = require("../src/services/payslipHeading");

/*
 * Settings → Template Settings → the payslip, behind SETTINGS / Template Settings. Its heading is taken
 * from where the studio keeps it - the logo and name from Organization → Branding Logo, the address
 * from the Head Office branch - and the screen decides only the month the financial year starts in.
 */

const DIR = path.join(__dirname, "..", "src", "modules", "settings", "template-settings");

function call(handler, { body = {}, user = { id: 7 } } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
    };
    handler({ body, user }, res);
  });
}

const HEAD_OFFICE = { name: "Erode TN", addressLine1: " No. 12, Perundurai Road ", addressLine2: "Near the bus stand", city: "Erode", state: "Tamil Nadu", postalCode: "638011" };

/** The HRM row, the branding and the Head Office branch, stubbed for one case. */
function withStudio({ row = null, branding = null, headOffice = null }, run) {
  const original = { findUnique: prisma.hrmSettings.findUnique, upsert: prisma.hrmSettings.upsert, findFirst: prisma.branch.findFirst, find: brandingRepository.find, fields: prisma.payslipField.findMany, columns: prisma.payrollComponent.findMany };
  // Nothing turned off in Edit Payslip unless the row says so.
  prisma.payslipField.findMany = async () => [];
  prisma.payrollComponent.findMany = async () => [];
  const writes = [];
  const asked = [];
  prisma.hrmSettings.findUnique = async () => row;
  prisma.hrmSettings.upsert = async ({ update }) => { writes.push(update); return { ...row, ...update }; };
  prisma.branch.findFirst = async (query) => { asked.push(query); return headOffice; };
  brandingRepository.find = async () => branding;
  return run({ writes, asked }).finally(() => {
    Object.assign(prisma.hrmSettings, { findUnique: original.findUnique, upsert: original.upsert });
    prisma.branch.findFirst = original.findFirst;
    prisma.payslipField.findMany = original.fields;
    prisma.payrollComponent.findMany = original.columns;
    brandingRepository.find = original.find;
  });
}

test("the heading comes from Branding Logo and the Head Office branch", async () => {
  await withStudio({
    row: { payslipFinancialYearStartMonth: 4, payslipCompanyName: "Typed once", payslipAddress: "Typed address", payslipLogoUrl: "https://cdn.example/old.png" },
    branding: { studioName: "Don't Blink Studios", galleryLogoUrl: "https://cdn.example/brand.png", galleryLogoDarkUrl: "https://cdn.example/brand-dark.png" },
    headOffice: HEAD_OFFICE,
  }, async ({ asked }) => {
    const { html, ...data } = (await call(controller.getPayslipTemplate)).body.data;
    // The sample as the PDF prints it, for the A4 preview - with this heading.
    assert.ok(html.startsWith("<!doctype html>") && html.includes("Erode - 638011"));
    assert.deepEqual(data, {
      companyName: "Don't Blink Studios",
      // The light-theme logo: a payslip prints on white.
      logoUrl: "https://cdn.example/brand.png",
      address: "No. 12, Perundurai Road\nErode - 638011\nTamil Nadu",
      headOfficeName: "Erode TN",
      // Both the personal and the PF details until the studio says otherwise.
      details: "PERSONAL_AND_PF",
      // Nothing added in Settings → Payroll rules → Edit Payslip yet: every item of the payslip's own but
      // the four it starts with is left off.
      hiddenItems: ["Emp Code", "Emp Name", "Department", "Designation", "Location", "Date Of Birth", "Date of Joining", "PAN", "Bank A/c No.", "Residential Status", "Cost Centre", "PF No.", "UAN", "EPS No.", "ESI No.", "Incentive", "Other Deductions"],
      addedItems: { PERSONAL: [], PF: [], EARNING: [], DEDUCTION: [] },
      // Nothing renamed in Edit Payslip.
      renamedItems: {},
    });
    // What was typed into the retired columns is not read.
    assert.deepEqual(asked[0].where, { isHeadOffice: true });
  });
});

test("nothing set yet reads as empty, with no Head Office named", async () => {
  await withStudio({}, async () => {
    const data = (await call(controller.getPayslipTemplate)).body.data;
    assert.deepEqual([data.logoUrl, data.address, data.headOfficeName], ["", "", null]);
  });
});

test("a branch's address prints a line to a row: the main address, the city with its PIN code, the state - never Address 2", () => {
  assert.deepEqual(postalLines(HEAD_OFFICE), ["No. 12, Perundurai Road", "Erode - 638011", "Tamil Nadu"]);
  assert.deepEqual(postalLines({ city: "Erode" }), ["Erode"]);
  assert.deepEqual(postalLines(null), []);
});

test("Edit Employee reads it on the record's own permission", async () => {
  await withStudio({ row: { payslipDetails: "PERSONAL" } }, async () => {
    assert.deepEqual((await call(controller.getPayslipDetailsForEmployees)).body, { data: { details: "PERSONAL" } });
  });
  assert.match(fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "master-data", "routes.js"), "utf8"),
    /router\.get\("\/employees\/payslip-details", readsEmployees, getPayslipDetailsForEmployees\);/);
  const sql = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20261012260000_payslip_details_setting", "migration.sql"), "utf8");
  assert.match(sql, /ADD COLUMN `payslip_details` VARCHAR\(20\) NOT NULL DEFAULT 'PERSONAL_AND_PF';/);
});

test("its preview and sample PDF answer to HRM / Payroll Register, under Payroll rules; nothing is saved", () => {
  const ROUTES = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "payroll-register", "routes.js"), "utf8");
  const guard = ROUTES.indexOf('router.use(requireModule("HRM", "Payroll Register"));');
  assert.ok(guard > 0 && ROUTES.indexOf('router.get("/payslip-template", payslipTemplate.getPayslipTemplate);') > guard);
  assert.ok(ROUTES.indexOf('router.get("/payslip-template/sample.pdf", payslipTemplate.downloadSamplePayslip);') > guard);
  assert.ok(ROUTES.indexOf('router.get("/payslip-template"') < ROUTES.indexOf('router.put("/:id"'), "above /:id");
  // Settings → Template Settings is gone: no router of its own, nothing mounted, nothing saved.
  assert.ok(!fs.existsSync(path.join(DIR, "routes.js")));
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, "..", "src", "server.js"), "utf8"), /template-settings/);
  assert.equal(controller.savePayslipTemplate, undefined);
});
