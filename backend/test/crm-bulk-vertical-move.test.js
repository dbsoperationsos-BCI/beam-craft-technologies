const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const prisma = require("../src/config/db");
const { moveCrmLeadsToVertical } = require("../src/modules/sales/crm-leads/crmLeadService");

/*
 * Bulk Update's Vertical: the selected leads move, the old vertical's own fields go with the move,
 * and a lead whose number the target vertical already holds stays where it is.
 */
const STAMP = `TBV-${Date.now().toString(36)}`;
const id = (name) => `${STAMP}-${name}`;
const lead = (name, data) => prisma.salesCrmLead.create({ data: { enquiryId: id(name), name: `Move ${name}`, ...data } });
const read = (name) => prisma.salesCrmLead.findUnique({ where: { enquiryId: id(name) } });

test.after(async () => {
  await prisma.salesCrmLeadOccasion.deleteMany({ where: { enquiryId: { startsWith: STAMP } } });
  await prisma.salesCrmLead.deleteMany({ where: { enquiryId: { startsWith: STAMP } } });
});

test("leads move to the vertical, lose what only the old one asked, and a number the target holds is left behind", async () => {
  // Numbers unlikely to be anybody's: a fixed prefix and the run's own tail.
  const base = `9${String(Date.now()).slice(-8)}`;
  const n = (k) => `${base}${k}`;
  await lead("dd", { verticalName: "Dum Dum", phone: n(1), groomName: "Arun", brideName: "Priya", customFields: JSON.stringify({ x: "1" }), status: "Followup", nextFollowUpDate: "2026-11-01" });
  await lead("qq", { verticalName: "Qua Qua", phone: n(2), babyOrMotherName: "Baby A", status: "Converted & Followup", nextFollowUpDate: "2026-11-02" });
  await prisma.salesCrmLeadOccasion.create({ data: { enquiryId: id("qq"), occasion: "NEWBORN", occasionYear: 2026 } });
  // Already a Corp enquiry on this number: the Dum Dum lead below carrying it must stay put.
  await lead("corp-held", { verticalName: "Corp", phone: n(3), companyName: "Acme" });
  await lead("dd-clash", { verticalName: "Dum Dum", phone: n(3), groomName: "Kept" });
  await lead("already", { verticalName: "Corp", phone: n(4) });

  const result = await moveCrmLeadsToVertical([id("dd"), id("qq"), id("dd-clash"), id("already")], "Corp", { actorName: "Test" });
  assert.equal(result.moved, 2);
  assert.equal(result.unchanged, 1, "a lead already on Corp is left alone");
  assert.deepEqual(result.skipped.map((row) => row.enquiryId), [id("dd-clash")]);

  const dd = await read("dd");
  assert.equal(dd.verticalName, "Corp");
  assert.equal(dd.groomName, null, "Dum Dum's wedding couple is cleared");
  assert.equal(dd.brideName, null);
  assert.equal(dd.customFields, "{}", "the old vertical's custom fields are cleared");
  assert.equal(dd.status, "Followup", "the shared status stays");
  assert.equal(dd.nextFollowUpDate, "2026-11-01", "a lead still followed up keeps its next call");

  const qq = await read("qq");
  assert.equal(qq.verticalName, "Corp");
  assert.equal(qq.babyOrMotherName, null, "Qua Qua's baby / mother is cleared");
  assert.equal(qq.status, "Converted", "Converted & Followup is Qua Qua's; elsewhere it is Converted");
  assert.equal(qq.nextFollowUpDate, null, "and a Converted lead off Qua Qua books no next call");
  assert.equal(await prisma.salesCrmLeadOccasion.count({ where: { enquiryId: id("qq") } }), 0, "its newborn occasion goes");

  const clash = await read("dd-clash");
  assert.equal(clash.verticalName, "Dum Dum");
  assert.equal(clash.groomName, "Kept", "a lead left behind keeps everything");
});

test("Bulk Update takes the vertical on the same guarded route, and refuses Converted & Followup off Qua Qua", () => {
  const controller = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "crm-leads", "controller.js"), "utf8");
  const routes = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "crm-leads", "routes.js"), "utf8");
  assert.match(routes, /router\.post\("\/bulk-status", canSelectLeads, bulkStatus\);/);
  assert.match(controller, /vertical: z\.string\(\)\.trim\(\)\.max\(40\)\.optional\(\),/);
  assert.match(controller, /const move = target && ids\.length \? await moveCrmLeadsToVertical\(ids, target, actorFrom\(req\)\) : null;/);
  assert.match(controller, /is a Qua Qua status; choose another for leads moving to/);
});

test("one lead moves from its popup on the board's own Read / Write, refused on a number the target holds", () => {
  const controller = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "crm-leads", "controller.js"), "utf8");
  const routes = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "crm-leads", "routes.js"), "utf8");
  // Behind the router's CRM Leads guard (a POST needs Read / Write), not Bulk Update's Select All.
  assert.ok(routes.indexOf('router.use(requireModule("SALES", "CRM Leads"));') < routes.indexOf('router.post("/:id/vertical", moveVertical);'));
  const fn = controller.slice(controller.indexOf("async function moveVertical("), controller.indexOf("const bulkAssignSchema"));
  assert.match(fn, /const record = await scopedLead\(req, req\.params\.id\);\n\s*if \(!record\) return res\.status\(404\)/, "only a lead the caller may read");
  assert.match(fn, /findVerticalDuplicate\(\{ phone, vertical: target, excludeId: record\.lead\.id \}\)/);
  assert.match(fn, /return res\.status\(409\)\.json\(\{ message: `\$\{clash\.enquiryId\} in \$\{target\} already holds this number/);
  assert.match(fn, /await moveCrmLeadsToVertical\(\[record\.lead\.id\], target, actorFrom\(req\)\)/, "the same move Bulk Update makes");
});
