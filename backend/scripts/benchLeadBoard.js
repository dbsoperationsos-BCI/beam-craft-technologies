/*
 * Times the queries the Leads & Followups board actually runs.
 *
 * Every number the CRM's speed depends on is in here: the first page of a board, the page somebody
 * reaches by scrolling, the tab counts, and the same three with a column filter typed into them.
 * Run it before and after a change and the difference is the answer - which beats reasoning about
 * what an index "should" do, and is the only way to tell an improvement from a rearrangement.
 *
 *   node scripts/seedLeadsForPerf.js      # 500,000 leads to measure against
 *   node scripts/benchLeadBoard.js
 *
 * Each case runs twice and reports the second time, so the first run's cold buffer pool is not
 * counted as the query's cost.
 */
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const { listCrmLeadsPage, crmLeadTabCounts } = require("../src/modules/sales/crm-leads/leadQueryService");

const prisma = new PrismaClient();
const today = new Date().toISOString().slice(0, 10);

async function time(label, run) {
  await run();
  const startedAt = process.hrtime.bigint();
  const result = await run();
  const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
  const rows = Array.isArray(result?.rows) ? result.rows.length : "";
  console.log(`  ${label.padEnd(46)} ${ms.toFixed(0).padStart(7)} ms   ${rows === "" ? "" : `${rows} rows`}`);
  return ms;
}

async function main() {
  const [{ total }] = await prisma.$queryRawUnsafe("SELECT COUNT(*) AS total FROM `sales_crm_lead` WHERE `deleted_at` IS NULL");
  console.log(`\n${Number(total).toLocaleString()} live leads\n`);

  const base = { branch: "Dum Dum", view: "all", filters: {}, today };
  let sum = 0;

  console.log("Opening the board (what happens on every page load):");
  sum += await time("page 1", () => listCrmLeadsPage({ ...base, offset: 0, limit: 100 }));
  sum += await time("tab counts", () => crmLeadTabCounts(base));

  console.log("\nScrolling (each of these is one more append):");
  sum += await time("page at offset 5,000", () => listCrmLeadsPage({ ...base, offset: 5000, limit: 100 }));
  sum += await time("page at offset 50,000", () => listCrmLeadsPage({ ...base, offset: 50000, limit: 100 }));

  console.log("\nA typed column filter:");
  const filtered = { ...base, filters: { name: "Lead 12345" } };
  sum += await time("page 1, filtered by name", () => listCrmLeadsPage({ ...filtered, offset: 0, limit: 100 }));
  sum += await time("tab counts, filtered by name", () => crmLeadTabCounts(filtered));

  console.log("\nOther tabs and verticals:");
  sum += await time("Today Pending Followups, page 1", () => listCrmLeadsPage({ ...base, view: "pending", offset: 0, limit: 100 }));
  sum += await time("Qua Qua Newborns, page 1", () => listCrmLeadsPage({ ...base, branch: "Qua Qua", view: "newborns", offset: 0, limit: 100 }));
  sum += await time("Calls board, page 1", () => listCrmLeadsPage({ ...base, branch: "Calls", offset: 0, limit: 100 }));
  sum += await time("sorted by Enquiry Name", () => listCrmLeadsPage({ ...base, sortColumn: "name", sortDirection: "asc", offset: 0, limit: 100 }));

  console.log(`\n  ${"TOTAL".padEnd(46)} ${sum.toFixed(0).padStart(7)} ms\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
