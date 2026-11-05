const test = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");
const { listCrmLeadsPage } = require("../src/modules/sales/crm-leads/leadQueryService");

/*
 * A Board column's worth (`values`, asked by its first page): the Estimated Value its leads carry,
 * and for converted leads the value each was **last** converted at - its newest live project.
 */
const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TCW-${STAMP}-${name}`;
const F = { leads: [], projects: [] };

const project = (key, enquiryId, value, extra = {}) => prisma.salesProject.create({ data: {
  enquiryId, eventId: tag(`ev-${key}`), whatsappGroupName: `WED ${STAMP} ${key}`, clientMainNumber: "+91 9000000000",
  sourceBranch: "Erode TN", vertical: "WED", deliverables: "[]", initialConvertedValue: value, crmName: "Test", projectStatus: "Work in Progress",
  ...extra,
} });

test.before(async () => {
  for (const [key, estimatedValue] of [["a", "200000"], ["b", "1,50,000"], ["c", "TBD"], ["d", null]]) {
    F.leads.push(await prisma.salesCrmLead.create({ data: { enquiryId: tag(key), name: `Worthy ${STAMP} ${key}`, contactNumber: "9000000000", estimatedValue } }));
  }
  // Lead a was booked twice: the newer booking is what counts. A newer one already deleted does not.
  F.projects.push(await project("a1", tag("a"), 100000, { createdAt: new Date("2026-01-01T00:00:00Z") }));
  F.projects.push(await project("a2", tag("a"), 300000, { createdAt: new Date("2026-06-01T00:00:00Z") }));
  F.projects.push(await project("a3", tag("a"), 999999, { createdAt: new Date("2026-09-01T00:00:00Z"), deletedAt: new Date() }));
  F.projects.push(await project("b1", tag("b"), 50000));
});

test.after(async () => {
  await prisma.salesProject.deleteMany({ where: { id: { in: F.projects.map((row) => row.id) } } });
  await prisma.salesCrmLead.deleteMany({ where: { enquiryId: { in: F.leads.map((lead) => lead.enquiryId) } } });
  await prisma.$disconnect();
});

const page = (withValues) => listCrmLeadsPage({ board: "Dum Dum", filters: { _search: `worthy ${STAMP}` }, limit: 1, today: "2026-11-02", withValues });

test("the estimated values that read as numbers are summed; anything else adds nothing", async () => {
  const { total, values } = await page(true);
  assert.equal(total, 4);
  assert.equal(values.estimated, 350000, "200000 + 1,50,000; TBD and blank add nothing");
});

test("converted is each lead's newest live booking, once per lead", async () => {
  const { values } = await page(true);
  assert.equal(values.converted, 350000, "a at its newer 300000 (not 100000, not the deleted 999999) + b at 50000");
});

test("asked only when wanted: a page without it carries no values", async () => {
  const answer = await page(false);
  assert.equal(answer.values, undefined);
});
