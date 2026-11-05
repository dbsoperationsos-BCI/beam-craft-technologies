#!/usr/bin/env node
/* eslint-disable no-console */
const prisma = require("../src/config/db");
const { buildQuotationName } = require("../src/services/quotationName");

/*
 * ── Naming the quotations that were raised before they had names ──────────────────────────────
 *
 * `quotation_name` is stamped when a version is raised. Every version raised before the column
 * existed has none, so the register would show a gap for them - the serializer builds one on read
 * so nothing looks broken, but a name that is only ever computed is a name that changes when the
 * master data behind it does, which is the thing storing it exists to prevent.
 *
 * So this writes them, once, from what each row already holds: its own payload and columns, through
 * the same `buildQuotationName` the live path uses. Nothing else about the row is touched.
 *
 *   node scripts/backfillQuotationNames.js            # say what would be written, write nothing
 *   node scripts/backfillQuotationNames.js --apply    # do it
 *
 * Only rows with no name are considered, so running it twice is safe and a half-finished run can
 * simply be run again. It never renames a quotation that already has one: what a version was called
 * when it was sent is a fact about that version.
 */

const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(APPLY ? "Naming quotations.\n" : "Dry run - nothing will be written. Pass --apply to do it.\n");

  const rows = await prisma.salesQuotation.findMany({
    where: { quotationName: null },
    select: { id: true, quotationId: true, sourceBranch: true, clientName: true, eventVenue: true, payload: true },
    orderBy: { createdAt: "asc" },
  });

  if (!rows.length) {
    console.log("Every quotation already has a name.");
    return;
  }

  console.log(`${rows.length} quotation(s) without a name:`);
  let written = 0;
  for (const row of rows) {
    const quotationName = buildQuotationName(row);
    if (written < 10) console.log(`    ${row.quotationId}  ->  ${quotationName}`);
    if (APPLY) {
      await prisma.salesQuotation.update({ where: { id: row.id }, data: { quotationName } });
      written += 1;
    } else {
      written += 1;
    }
  }
  if (rows.length > 10) console.log(`    ... and ${rows.length - 10} more`);
  console.log(`\n${rows.length} quotation(s) ${APPLY ? "named" : "would be named"}.`);
  if (!APPLY) console.log("Run again with --apply to write them.");
}

main()
  .catch((error) => { console.error("\nFailed:", error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
