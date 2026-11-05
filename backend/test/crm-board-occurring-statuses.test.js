const test = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");
const { listCrmLeadsPage, crmLeadColumnValues } = require("../src/modules/sales/crm-leads/leadQueryService");

/*
 * The Leads board stands one column per status the tab's leads read as, learned from the Status
 * column's `column-values` (`crmBoardColumnStatuses` in frontend/src/lib/crmBoardOrder.mjs). That
 * holds only if the values it answers are exactly the statuses the page's `status IN [...]` filter
 * then finds - including the ones no vertical offers as a pill: stored text passed through
 * (`statusDisplaySql`'s fall-through), Converted & Followup on a vertical other than Qua Qua, and
 * Unassigned. Every fixture lead must come back in exactly one column.
 */
const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TCOS-${STAMP}-${name}`;
const created = [];
const FIXTURES = [
  ["inactive", { status: "Inactive", crm: "Someone" }],
  ["cnf", { status: "Converted & Followup", crm: "Someone" }],
  ["cna", { status: "CNA", crm: "Someone" }],
  ["unowned", { status: "Followup", crm: "" }],
];

test.before(async () => {
  for (const [key, data] of FIXTURES) {
    created.push(await prisma.salesCrmLead.create({ data: { enquiryId: tag(key), name: `Occurring ${STAMP} ${key}`, ...data } }));
  }
});

test.after(async () => {
  await prisma.salesCrmLead.deleteMany({ where: { enquiryId: { in: created.map((lead) => lead.enquiryId).filter(Boolean) } } });
  await prisma.$disconnect();
});

// Narrowed to these fixtures by the board's own search box, which `column-values` honours too.
const filters = { _search: `Occurring ${STAMP}` };
const today = "2026-11-04";

test("the Status column's values name every status these leads read as, the unoffered ones included", async () => {
  const values = await crmLeadColumnValues({ column: "status", board: "Dum Dum", filters, today });
  assert.deepEqual([...values].sort(), ["CNA", "Converted & Followup", "Inactive", "Unassigned"]);
});

test("each of those values, as a column's filter, finds its leads - every lead in exactly one column", async () => {
  const values = await crmLeadColumnValues({ column: "status", board: "Dum Dum", filters, today });
  const placed = [];
  for (const status of values) {
    const page = await listCrmLeadsPage({ board: "Dum Dum", filters: { ...filters, status: [status] }, limit: 50, today });
    placed.push(...page.rows.map((row) => row.enquiryId));
  }
  assert.deepEqual(placed.sort(), FIXTURES.map(([key]) => tag(key)).sort());
});
