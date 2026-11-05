/*
 * The one-time move from "every call is a lead" to "a call is a call".
 *
 * The Callyzer webhook used to create a `sales_crm_lead` for every call it was sent, minted with an
 * enquiry id out of the same run the studio counts its real enquiries in - so wrong numbers, two-
 * second misdials and calls nobody ever answered all hold an `EID`, and the Calls board was a queue
 * of leads nobody asked for. It does not any more: a call is stored in `sales_crm_call_log` under a
 * Call ID of its own, and an `EID` is minted only when somebody reads the caller and adds them.
 *
 * This clears out what the old behaviour left behind. Two jobs, in this order:
 *
 *   1. every call in the log that has no Call ID is given one, oldest first, so the codes run in the
 *      order the calls happened rather than in the order they were noticed;
 *   2. the leads that were never anything but a call are soft-deleted, and their calls unlinked so
 *      they show on the Calls board as what they are.
 *
 *   node scripts/retireCallyzerCallLeads.js            report only, writes nothing
 *   node scripts/retireCallyzerCallLeads.js --apply    do it
 *
 * Reporting is the default because this deletes leads. Read the report, then run it again.
 *
 * ── What it will not touch ──
 *
 * A lead somebody has worked. "Never anything but a call" is exact and deliberately narrow: the
 * source is Callyzer, no vertical was ever chosen for it, and nothing has been done to it since -
 * no status, no follow-up booked, no note beyond the one the webhook wrote from the call itself, no
 * quotation, project, meeting or CRD against it. Any one of those and the lead stays, because
 * somebody has treated it as an enquiry and it is one, whatever it started as.
 *
 * The deletion is **soft** - `deleted_at`, the same column the CRM's own Delete sets - so a row
 * removed in error is recoverable by clearing it. Nothing is lost either way: every one of these
 * leads exists as a call in the call log, which is where the Calls board now reads them from.
 */
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const { nextIdentifier } = require("../src/services/identifiers");
const { ensureCallLogTable } = require("../src/modules/sales/crm-leads/callLogService");

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

/*
 * A lead that is a call and has never been anything else.
 *
 * `vertical` blank and `source` Callyzer is the pair that put it on the old Calls board - the same
 * test `CALLS_SQL` makes, restated here rather than imported so this script is readable on its own
 * and cannot be widened by a change made elsewhere for another reason.
 *
 * Everything after it is the "nobody has touched it" half. The remark is the interesting one: the
 * webhook writes the call into `remarks` itself ("Incoming call · 42s · … "), so a lead with a
 * remark is not evidence of anything - unless the remark list has entries, which only the CRM's own
 * notes box writes.
 */
const UNTOUCHED_CALL_LEAD = `
  \`deleted_at\` IS NULL
  AND TRIM(COALESCE(\`vertical\`, '')) = ''
  AND LOWER(TRIM(COALESCE(\`source\`, ''))) = 'callyzer'
  AND TRIM(COALESCE(\`status\`, '')) = ''
  AND TRIM(COALESCE(\`next_follow_up_date\`, '')) = ''
  AND TRIM(COALESCE(\`last_follow_up_date\`, '')) = ''
  AND TRIM(COALESCE(\`last_converted_date\`, '')) = ''
  AND TRIM(COALESCE(\`estimated_value\`, '')) = ''
  AND COALESCE(\`remark_entries\`, '') IN ('', '[]')
  AND COALESCE(\`attachments\`, '') IN ('', '[]')
  AND COALESCE(\`shoots\`, '') IN ('', '[]')
  AND NOT EXISTS (SELECT 1 FROM \`sales_project\` p WHERE p.\`enquiry_id\` = \`sales_crm_lead\`.\`enquiry_id\`)
  AND NOT EXISTS (SELECT 1 FROM \`sales_quotation\` q WHERE q.\`enquiry_id\` = \`sales_crm_lead\`.\`enquiry_id\`)
  AND NOT EXISTS (SELECT 1 FROM \`sales_crm_meeting\` m WHERE m.\`enquiry_id\` = \`sales_crm_lead\`.\`enquiry_id\`)
  AND NOT EXISTS (SELECT 1 FROM \`sales_project_crd_document\` c WHERE c.\`enquiry_id\` = \`sales_crm_lead\`.\`enquiry_id\`)
`;

/** Gives a Call ID to every call in the log that has not got one, oldest call first. */
async function backfillCallIds() {
  const [{ total }] = await prisma.$queryRawUnsafe(
    "SELECT COUNT(*) AS `total` FROM `sales_crm_call_log` WHERE `call_id` IS NULL OR `call_id` = ''",
  );
  const pending = Number(total || 0);
  if (!pending) {
    console.log("Call IDs: every call already has one.");
    return 0;
  }
  if (!apply) {
    console.log(`Call IDs: ${pending.toLocaleString()} call${pending === 1 ? "" : "s"} would be given one.`);
    return pending;
  }

  let written = 0;
  // In batches, so a log of a hundred thousand calls does not hold one query open for all of them.
  for (;;) {
    const rows = await prisma.$queryRawUnsafe(
      "SELECT `id` FROM `sales_crm_call_log` WHERE `call_id` IS NULL OR `call_id` = ''"
      + " ORDER BY `called_at` ASC, `id` ASC LIMIT 500",
    );
    if (!rows.length) break;
    for (const row of rows) {
      const callId = await nextIdentifier("CALL_LOG");
      await prisma.$executeRawUnsafe(
        "UPDATE `sales_crm_call_log` SET `call_id` = ? WHERE `id` = ? AND (`call_id` IS NULL OR `call_id` = '')",
        callId, row.id,
      );
      written += 1;
    }
    if (written % 5000 === 0) console.log(`  … ${written.toLocaleString()} of ${pending.toLocaleString()}`);
  }
  console.log(`Call IDs: ${written.toLocaleString()} written.`);
  return written;
}

async function main() {
  await ensureCallLogTable();
  await backfillCallIds();

  const leads = await prisma.$queryRawUnsafe(
    "SELECT `enquiry_id`, `name`, `phone`, `created_date`"
    + ` FROM \`sales_crm_lead\` WHERE ${UNTOUCHED_CALL_LEAD} ORDER BY \`enquiry_id\``,
  );

  if (!leads.length) {
    console.log("Leads: no untouched Callyzer call leads are left.");
    await prisma.$disconnect();
    return;
  }

  console.log(`\nLeads: ${leads.length.toLocaleString()} were only ever a call.`);
  for (const lead of leads.slice(0, 20)) {
    console.log(`  ${lead.enquiry_id}  ${lead.name || "(no name)"}  ${lead.phone || ""}  ${lead.created_date || ""}`);
  }
  if (leads.length > 20) console.log(`  … and ${(leads.length - 20).toLocaleString()} more`);

  if (!apply) {
    console.log("\nNothing was written. Run again with --apply to remove them.");
    await prisma.$disconnect();
    return;
  }

  /*
   * Unlinked first, then deleted.
   *
   * The other order leaves a window in which a call points at a lead that is already gone - and if
   * the second statement fails, it leaves it that way for good: the call would be attached to a
   * deleted lead, so it would appear on neither the Calls board nor anybody's Call Logs tab.
   */
  const ids = leads.map((lead) => lead.enquiry_id);
  const placeholders = ids.map(() => "?").join(", ");
  const unlinked = await prisma.$executeRawUnsafe(
    `UPDATE \`sales_crm_call_log\` SET \`enquiry_id\` = '' WHERE \`enquiry_id\` IN (${placeholders})`,
    ...ids,
  );
  const removed = await prisma.$executeRawUnsafe(
    `UPDATE \`sales_crm_lead\` SET \`deleted_at\` = NOW(3) WHERE \`enquiry_id\` IN (${placeholders})`,
    ...ids,
  );

  console.log(`\nRemoved ${removed.toLocaleString()} lead${removed === 1 ? "" : "s"}; ${unlinked.toLocaleString()} call${unlinked === 1 ? "" : "s"} returned to the Calls board.`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
