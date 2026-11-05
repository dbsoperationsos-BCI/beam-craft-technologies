// Puts back the lead fields that a partial update blanked.
//
// `updateCrmLead` used to write whatever record it was handed as the whole row, so a caller sending
// only the field it was changing blanked every other one. The CRM's inline edit did exactly that
// whenever the lead was not in the page of rows the browser happened to be holding: it posted a
// lead with one field on it, and the vertical, the name, the phone and the status were all written
// as empty in the same statement.
//
// Nothing was deleted, which is why nothing shows in the Activity Log as a deletion - the leads are
// still there, blank, and a lead with no vertical is read as a Dum Dum one, so a Corp lead left the
// board it was on. Both faults are fixed; this is for the rows that were already hit.
//
// The old values are recoverable because the Activity Log recorded every one of them: each blanking
// wrote an `UPDATED` row per field with the real value in `from_value` and nothing in `to_value`.
//
//   node scripts/restoreBlankedLeads.js            report only, writes nothing
//   node scripts/restoreBlankedLeads.js --apply    put the values back
//
// Reporting is the default. Read the report first - it names every lead and every field it would
// restore, and the value it would restore it to.
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const { CRM_LEAD_COLUMN_PAIRS } = require("../src/modules/sales/crm-leads/crmLeadColumns");

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

/*
 * How many fields must have gone blank in one write for it to count as the bug.
 *
 * A person clearing a field they no longer want clears one field. The fault blanked most of the
 * row in a single statement, so the number of fields emptied together is what tells them apart.
 * Three is comfortably above anything a person does by hand and far below what the bug did.
 */
const BLANKED_TOGETHER = 3;

const DB_COLUMN = Object.fromEntries(CRM_LEAD_COLUMN_PAIRS);

function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === "";
}

async function main() {
  /*
   * Every field an update emptied, newest first.
   *
   * Grouped into writes by the lead and the second it happened in - `recordLeadActivity` inserts a
   * batch in one call, so the rows of one write land in the same second.
   */
  const rows = await prisma.$queryRawUnsafe(`
    SELECT \`enquiry_id\` AS \`enquiryId\`, \`field\`, \`from_value\` AS \`fromValue\`,
           \`created_at\` AS \`createdAt\`, DATE_FORMAT(\`created_at\`, '%Y-%m-%d %H:%i:%s') AS \`writeKey\`
      FROM \`sales_crm_lead_activity\`
     WHERE \`action\` = 'UPDATED'
       AND COALESCE(\`field\`, '') <> ''
       AND COALESCE(TRIM(\`to_value\`), '') = ''
       AND COALESCE(TRIM(\`from_value\`), '') <> ''
     ORDER BY \`created_at\` DESC
  `);

  // Only the writes that emptied several fields at once.
  const writes = new Map();
  for (const row of rows) {
    const key = `${row.enquiryId}|${row.writeKey}`;
    if (!writes.has(key)) writes.set(key, []);
    writes.get(key).push(row);
  }
  const suspect = [...writes.values()].filter((batch) => batch.length >= BLANKED_TOGETHER);

  if (!suspect.length) {
    console.log("No lead was blanked by a partial update. Nothing to restore.");
    return;
  }

  /*
   * The newest recorded value for each field, per lead.
   *
   * A lead blanked more than once must come back as it was before the first blanking, so the oldest
   * `from_value` is the true one - the later ones are already empty-to-empty or record the blank
   * itself. The rows arrive newest first, so the last one written into the map wins.
   */
  const wanted = new Map();
  for (const batch of suspect) {
    for (const row of batch) {
      if (!wanted.has(row.enquiryId)) wanted.set(row.enquiryId, new Map());
      wanted.get(row.enquiryId).set(row.field, row.fromValue);
    }
  }

  let leadsTouched = 0;
  let fieldsRestored = 0;
  let leadsAlreadyFine = 0;

  for (const [enquiryId, fields] of wanted) {
    const [lead] = await prisma.$queryRawUnsafe(
      "SELECT * FROM `sales_crm_lead` WHERE `enquiry_id` = ? AND `deleted_at` IS NULL LIMIT 1",
      enquiryId,
    );
    if (!lead) continue;

    /*
     * Only fields that are still empty.
     *
     * Somebody may have typed the value back in by hand since, and that is the value to keep -
     * this puts back what was lost, it does not overwrite what was recovered.
     */
    const restore = [];
    for (const [field, value] of fields) {
      const column = DB_COLUMN[field];
      if (!column) continue;
      if (!isBlank(lead[column])) continue;
      restore.push([column, field, value]);
    }
    if (!restore.length) { leadsAlreadyFine += 1; continue; }

    leadsTouched += 1;
    fieldsRestored += restore.length;
    console.log(`\n  ${enquiryId}`);
    for (const [, field, value] of restore) {
      console.log(`    ${field.padEnd(22)} -> ${JSON.stringify(String(value).slice(0, 60))}`);
    }

    if (apply) {
      await prisma.$executeRawUnsafe(
        `UPDATE \`sales_crm_lead\` SET ${restore.map(([column]) => `\`${column}\` = ?`).join(", ")}`
        + " WHERE `enquiry_id` = ? AND `deleted_at` IS NULL",
        ...restore.map(([, , value]) => String(value)),
        enquiryId,
      );
    }
  }

  console.log("");
  console.log(`${suspect.length} write(s) blanked ${BLANKED_TOGETHER} or more fields at once.`);
  console.log(`${leadsTouched} lead(s) still have ${fieldsRestored} blank field(s) that can be put back.`);
  if (leadsAlreadyFine) console.log(`${leadsAlreadyFine} lead(s) were blanked but have since been filled in again - left alone.`);
  console.log("");
  console.log(apply
    ? "Restored. Open the CRM and check a few of the leads named above."
    : "Nothing was written. Run again with --apply to put these values back.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
