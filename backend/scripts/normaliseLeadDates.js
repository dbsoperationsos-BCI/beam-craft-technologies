#!/usr/bin/env node
/* eslint-disable no-console */
const prisma = require("../src/config/db");
const { toIsoDay, LEAD_DATE_COLUMNS } = require("../src/modules/sales/crm-leads/leadDates");

/*
 * ── The lead dates that were written in a shape nothing could read ─────────────────────────────
 *
 * A CRM lead's dates are stored as text, exactly as their source wrote them. Until `leadDates.js`
 * existed the application understood two shapes - `YYYY-MM-DD` and `DD/MM/YYYY` - and a CSV exported
 * from Excel writes neither: its short date is `09-Sep-26`. So a studio importing its own export
 * stored dates that were, as far as every reader was concerned, not dates.
 *
 * The application reads those shapes now, and `flattenLeadColumns` folds every date it writes to
 * `YYYY-MM-DD`, so nothing imported from here on has the problem. This is for the rows that were
 * already written, and they need more than a reader can give them:
 *
 *   `created_day`, `follow_up_day` and `dob_edod_day` are **stored generated columns**. Their
 *   expression lives in the schema, still understands only those two shapes, and cannot be widened
 *   without a migration that rebuilds the table. While they are NULL the lead is in no Today or
 *   Yesterday Pending tab and in neither Newborns nor Birthdays - and no amount of reading fixes
 *   that, because the tabs filter on the stored column.
 *
 * Rewriting the text to ISO makes MySQL recompute all three on the spot. No schema change, no table
 * rebuild, and the columns end up holding what they always should have.
 *
 *   node scripts/normaliseLeadDates.js            # report what would change, write nothing
 *   node scripts/normaliseLeadDates.js --apply    # do it
 *   node scripts/normaliseLeadDates.js --apply --include-deleted   # soft-deleted leads as well
 *
 * Soft-deleted leads are left out by default: they are on no board, so their dates are read by
 * nothing. Include them when a studio expects to restore some - a lead brought back would otherwise
 * come back with the same unreadable date it went away with.
 *
 * Safe to run twice: a value already ISO normalises to itself and is not written. Safe to run on a
 * studio with nothing to fix, which reports zero and touches no row.
 *
 * **It never discards a value it does not understand.** A cell holding a note, a dash or a
 * half-typed date is left exactly as its author left it and counted separately, so the dry run says
 * how many dates the studio has that are not dates at all - which is a data question for a person,
 * not something a script should decide.
 */

const APPLY = process.argv.includes("--apply");
const INCLUDE_DELETED = process.argv.includes("--include-deleted");
const BATCH = 500;

// `updated_at` is deliberately left alone. This corrects how a date was written down; it is not
// somebody editing the lead, and it must not look like one on the record.
const SQL_COLUMN = {
  createdDate: "created_date",
  date: "date",
  eventPlannedDate: "event_planned_date",
  lastFollowUpDate: "last_follow_up_date",
  nextFollowUpDate: "next_follow_up_date",
  lastConvertedDate: "last_converted_date",
  dateOfBirthOrEdod: "date_of_birth_or_edod",
};

async function main() {
  const columns = LEAD_DATE_COLUMNS.map((key) => SQL_COLUMN[key]);
  const missing = LEAD_DATE_COLUMNS.filter((key) => !SQL_COLUMN[key]);
  if (missing.length) throw new Error(`No column name known for: ${missing.join(", ")}`);

  const rows = await prisma.$queryRawUnsafe(
    `SELECT \`enquiry_id\`, ${columns.map((column) => `\`${column}\``).join(", ")}
       FROM \`sales_crm_lead\`${INCLUDE_DELETED ? "" : " WHERE `deleted_at` IS NULL"}`,
  );

  const changes = [];
  const unreadable = new Map();
  for (const row of rows) {
    const updates = {};
    for (const [key, column] of Object.entries(SQL_COLUMN)) {
      const current = row[column];
      const text = String(current ?? "").trim();
      if (!text) continue;
      const iso = toIsoDay(text);
      if (!iso) {
        unreadable.set(text, (unreadable.get(text) || 0) + 1);
        continue;
      }
      if (iso !== current) updates[column] = iso;
    }
    if (Object.keys(updates).length) changes.push({ id: row.enquiry_id, updates });
  }

  console.log(`Leads read:            ${rows.length.toLocaleString()}${INCLUDE_DELETED ? " (soft-deleted included)" : ""}`);
  console.log(`Leads to rewrite:      ${changes.length.toLocaleString()}`);
  console.log(`Values left untouched: ${unreadable.size.toLocaleString()} distinct that are not dates`);

  for (const [value, count] of [...unreadable.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`   left as it is: ${JSON.stringify(value)} x${count}`);
  }
  for (const change of changes.slice(0, 10)) {
    console.log(`   ${change.id}  ${Object.entries(change.updates).map(([column, value]) => `${column}: ${value}`).join(", ")}`);
  }
  if (changes.length > 10) console.log(`   ... and ${(changes.length - 10).toLocaleString()} more`);

  if (!changes.length) {
    console.log("\nNothing to do.");
    return;
  }
  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to write these.");
    return;
  }

  let written = 0;
  for (let offset = 0; offset < changes.length; offset += BATCH) {
    const slice = changes.slice(offset, offset + BATCH);
    // One statement per lead, inside a transaction per batch: the columns that change differ from
    // row to row, so there is no one UPDATE that covers them.
    await prisma.$transaction(slice.map((change) => prisma.$executeRawUnsafe(
      `UPDATE \`sales_crm_lead\` SET ${Object.keys(change.updates).map((column) => `\`${column}\` = ?`).join(", ")}
         WHERE \`enquiry_id\` = ?`,
      ...Object.values(change.updates), change.id,
    )));
    written += slice.length;
    console.log(`   written ${written.toLocaleString()} / ${changes.length.toLocaleString()}`);
  }
  console.log(`\nRewrote ${written.toLocaleString()} lead${written === 1 ? "" : "s"}.`);
}

main()
  .catch((error) => { console.error(error); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
