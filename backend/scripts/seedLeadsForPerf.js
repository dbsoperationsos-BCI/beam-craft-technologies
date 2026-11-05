/*
 * Fills the lead table with synthetic leads, so the board can be measured at the size it is
 * actually used at rather than at the size a developer's laptop happens to hold.
 *
 * The CRM is slow at half a million leads and fine at twenty. Nothing about that is visible on a
 * local database with twenty rows in it, so every judgement about what to index, what to stop
 * recomputing and what to paginate differently was being made blind. This makes the slow case
 * reproducible in about a minute.
 *
 *   node scripts/seedLeadsForPerf.js                 # 500,000 leads
 *   node scripts/seedLeadsForPerf.js --rows 100000
 *   node scripts/seedLeadsForPerf.js --remove        # delete every row it created
 *
 * The rows are spread across the three verticals, the statuses, and a two-year span of dates, so
 * the tab counts and the date-driven tabs have real work to do rather than matching nothing.
 *
 * ── This is test data, and it is deleted by id range ──────────────────────────────────────────
 *
 * Every row it writes has an enquiry id of `PERF-EID-<8 digits>`, which the application cannot
 * produce: `nextLeadId()` only ever issues `DBS-DD-EID-<n>`. That matters more than it looks. The
 * first version of this used `DBS-DD-EID-9…` on the reasoning that the real ids are five digits and
 * would not reach it - and `LIKE 'DBS-DD-EID-9%'` promptly matched three real leads numbered in the
 * nine thousands, which `--remove` would have deleted. A prefix that cannot collide is worth more
 * than a range that probably will not.
 *
 * `--remove` deletes exactly that prefix with a hard DELETE, not the soft delete the CRM uses:
 * these rows are not records anybody made, and leaving 500,000 of them behind with `deleted_at`
 * set would go on costing every query that reads the table.
 *
 * Never run this against production.
 */
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const valueOf = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index === -1 ? fallback : Number(args[index + 1]) || fallback;
};
const remove = args.includes("--remove");
const rows = valueOf("--rows", 500000);

// Written in one statement per batch. Larger batches are faster up to a point and then start
// hitting max_allowed_packet; 2,000 rows of this width sits comfortably under it.
const BATCH = 2000;

const ID_PREFIX = "PERF-EID-";
const leadId = (index) => `${ID_PREFIX}${String(index).padStart(8, "0")}`;

const BRANCHES = ["Dum Dum", "Qua Qua", "Corp", ""];
const STATUSES = ["Interested", "Followup", "Converted", "Rejected", "CNA", "Invalid", ""];
const CRMS = ["Priya", "Meera", "Anil", "Ravi", "Divya"];
const SOURCES = ["Manual", "Google Sheet", "CSV Import", "Callyzer"];

/** A day `offset` days before today, as `YYYY-MM-DD`. */
function dayBefore(offset) {
  const date = new Date();
  date.setDate(date.getDate() - offset);
  return date.toISOString().slice(0, 10);
}

async function main() {
  if (remove) {
    console.log(`Deleting every lead in the ${ID_PREFIX}… range.`);
    let total = 0;
    // In chunks: one DELETE of half a million rows is a single enormous transaction, and a lock
    // held that long on the table the API is reading is its own kind of outage.
    for (;;) {
      const deleted = await prisma.$executeRawUnsafe(
        "DELETE FROM `sales_crm_lead` WHERE `enquiry_id` LIKE ? LIMIT 20000",
        `${ID_PREFIX}%`,
      );
      total += deleted;
      if (!deleted) break;
      process.stdout.write(`\r  ${total.toLocaleString()} deleted`);
    }
    console.log(`\r  ${total.toLocaleString()} deleted.`);
    return;
  }

  const existing = await prisma.$queryRawUnsafe(
    "SELECT COUNT(*) AS total FROM `sales_crm_lead` WHERE `enquiry_id` LIKE ?",
    `${ID_PREFIX}%`,
  );
  if (Number(existing[0]?.total || 0)) {
    console.log(`${Number(existing[0].total).toLocaleString()} synthetic leads are already here. Run --remove first.`);
    return;
  }

  console.log(`Writing ${rows.toLocaleString()} leads in batches of ${BATCH}…`);
  const startedAt = Date.now();

  for (let start = 0; start < rows; start += BATCH) {
    const size = Math.min(BATCH, rows - start);
    const values = [];
    const params = [];
    for (let offset = 0; offset < size; offset += 1) {
      const index = start + offset;
      // Deterministic rather than random, so two runs produce the same table and a measurement
      // can be repeated. The moduli are coprime-ish with each other so the fields vary
      // independently rather than moving in lockstep.
      const branch = BRANCHES[index % BRANCHES.length];
      const status = STATUSES[index % STATUSES.length];
      const createdDate = dayBefore(index % 730);
      // Roughly a third carry a follow-up date, a slice of which is today or yesterday - which is
      // what the Today / Yesterday / Overall Pending tabs count.
      const followUp = index % 3 === 0 ? dayBefore((index % 5) - 1) : "";
      const dob = index % 7 === 0 ? dayBefore((index % 900) - 60) : "";
      values.push("(?,?,?,?,?,?,?,?,?,?,?,?,NOW(3),NOW(3))");
      params.push(
        leadId(index),
        `Perf Lead ${index}`,
        // A real-looking ten-digit number, unique per row.
        `9${String(700000000 + index).slice(-9)}`,
        branch,
        status,
        CRMS[index % CRMS.length],
        createdDate,
        followUp,
        dob,
        SOURCES[index % SOURCES.length],
        `${index % 97}`,
        "Seeded for a performance measurement.",
      );
    }
    await prisma.$executeRawUnsafe(
      "INSERT INTO `sales_crm_lead`"
      + " (`enquiry_id`,`name`,`phone`,`branch`,`status`,`crm`,`created_date`,`next_follow_up_date`,"
      + "  `date_of_birth_or_edod`,`source`,`estimated_value`,`remarks`,`created_at`,`updated_at`)"
      + ` VALUES ${values.join(",")}`,
      ...params,
    );
    process.stdout.write(`\r  ${Math.min(start + size, rows).toLocaleString()} / ${rows.toLocaleString()}`);
  }

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\r  ${rows.toLocaleString()} leads written in ${seconds}s.`);
  console.log(`\nRemove them again with:  node scripts/seedLeadsForPerf.js --remove`);
}

main()
  .catch((error) => {
    console.error(`\n${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
