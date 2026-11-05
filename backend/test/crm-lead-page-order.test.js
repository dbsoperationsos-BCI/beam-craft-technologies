const test = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");
const { listCrmLeadsPage } = require("../src/modules/sales/crm-leads/leadQueryService");

/*
 * The board reads leads a page at a time with LIMIT / OFFSET. Sorted by a column many leads share -
 * a status, a date - the database may put those leads in a different order on every query, so page 2
 * repeated leads from page 1 and never showed others (32 of 224 on the Status sort): the board drew
 * one lead twice, React warned of two rows with the same key, and the skipped leads simply did not
 * exist on screen. The enquiry id breaks every tie, so each page sees one fixed order.
 */
test("every sort of the lead board ends on the enquiry id, so pages neither repeat nor skip leads", async () => {
  const original = prisma.$queryRawUnsafe;
  const sql = [];
  // Counts answer zero; the page itself answers no rows - only the SQL is under test.
  prisma.$queryRawUnsafe = async (query) => { sql.push(query); return /COUNT\(/i.test(query) ? [{ total: 0, count: 0 }] : []; };
  try {
    const scope = { unlimited: true, where: {}, sql: () => ({ clause: "1=1", params: [] }) };
    for (const sortColumn of ["status", "createdDate"]) {
      sql.length = 0;
      await listCrmLeadsPage({ board: "Dum Dum", view: "all", offset: 100, limit: 50, sortColumn, sortDirection: "desc", scope });
      const page = sql.find((query) => /LIMIT \d+ OFFSET \d+/.test(query));
      assert.ok(page, `no page query for ${sortColumn}`);
      assert.match(page, /ORDER BY [\s\S]+, `enquiry_id` DESC LIMIT/, `${sortColumn}: the order has no tiebreak`);
    }
    // Sorted by the enquiry id itself there is nothing to break.
    sql.length = 0;
    await listCrmLeadsPage({ board: "Dum Dum", view: "all", offset: 0, limit: 50, scope });
    assert.match(sql.find((query) => /LIMIT/.test(query)), /ORDER BY `enquiry_id` DESC LIMIT/);
  } finally {
    prisma.$queryRawUnsafe = original;
  }
});
