/*
 * Takes back everything `npm run test:callyzer -- --test-leads` created.
 *
 * The fixture writes real leads through the real webhook - that is the point of it, and it is also
 * why it needs an undo. Every number it uses begins `99000`, which no Indian mobile does, so the
 * rows it created can be found again with certainty rather than by remembering which ones they
 * were.
 *
 *   node scripts/removeCallyzerTestLeads.js            report only, writes nothing
 *   node scripts/removeCallyzerTestLeads.js --apply    remove them
 *
 * Reporting is the default because this deletes leads, and a script that deletes leads should have
 * to be asked twice. Read the list, then run it again with --apply.
 *
 * The leads are **soft** deleted - `deleted_at`, the same column the CRM's own Delete sets - so a
 * row removed by mistake is recoverable by clearing that column. The call logs beneath them are
 * removed outright: `sales_crm_call_log` has no soft delete, and a call log pointing at a lead
 * nobody can see is what makes the "Enquired N times" count wrong on the next delivery.
 *
 * Refuses to touch anything whose number does not carry the prefix. There is no flag to widen it:
 * this script exists to undo one fixture, and a version of it that could delete a real client's
 * lead would be a worse thing to have in the repository than no script at all.
 */
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const { TEST_NUMBER_PREFIX } = require("./callyzerTestBatch");

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

// The last ten digits, which is how every other part of this module compares two numbers - so a
// row stored as "+91 99000 22001" is found by the same rule the CRM matches leads on.
const LIKE = `${TEST_NUMBER_PREFIX}%`;

async function main() {
  /*
   * Matched on either number the lead carries, because the CRM stores a client under `phone` and a
   * Corp contact under `contact_number`, and `leadsForPhones` in the webhook looks at both.
   */
  const leads = await prisma.$queryRawUnsafe(
    "SELECT `enquiry_id`, `name`, `phone`, `contact_number`, `vertical`, `source`"
    + " FROM `sales_crm_lead`"
    + " WHERE `deleted_at` IS NULL"
    + " AND (RIGHT(REGEXP_REPLACE(COALESCE(`phone`,''), '[^0-9]', ''), 10) LIKE ?"
    + "   OR RIGHT(REGEXP_REPLACE(COALESCE(`contact_number`,''), '[^0-9]', ''), 10) LIKE ?)"
    + " ORDER BY `enquiry_id`",
    LIKE,
    LIKE,
  );

  const calls = await prisma.$queryRawUnsafe(
    "SELECT COUNT(*) AS `total` FROM `sales_crm_call_log`"
    + " WHERE RIGHT(REGEXP_REPLACE(COALESCE(`client_number`,''), '[^0-9]', ''), 10) LIKE ?"
    + "    OR RIGHT(REGEXP_REPLACE(COALESCE(`employee_number`,''), '[^0-9]', ''), 10) LIKE ?",
    LIKE,
    LIKE,
  );
  const callCount = Number(calls?.[0]?.total || 0);

  if (!leads.length && !callCount) {
    console.log(`Nothing to remove - no lead or call log carries a ${TEST_NUMBER_PREFIX} number.`);
    return;
  }

  console.log(`${leads.length} lead${leads.length === 1 ? "" : "s"} and ${callCount} call log row${callCount === 1 ? "" : "s"}:\n`);
  for (const lead of leads) {
    // The board it is on, said the way the CRM says it: a Callyzer lead with no vertical is on
    // Calls, and anything else with a blank vertical reads as Dum Dum.
    const branch = String(lead.branch || "").trim();
    const onCalls = !branch && String(lead.source || "").trim().toLowerCase() === "callyzer";
    console.log(`  ${String(lead.enquiry_id).padEnd(20)} ${String(lead.name || "").padEnd(30)} ${String(lead.phone || lead.contact_number || "").padEnd(14)} ${onCalls ? "Calls" : branch || "Dum Dum"}`);
  }

  if (!apply) {
    console.log(`\nNothing was written. Run it again with --apply to remove these.`);
    return;
  }

  /*
   * The call logs first.
   *
   * A lead is soft deleted, so it can be brought back; its calls are gone for good. Removing them
   * first means an interrupted run leaves leads without calls - recoverable and visible - rather
   * than calls pointing at leads nobody can open, which is the state that makes the repeat counter
   * lie on the next delivery.
   */
  const removedCalls = await prisma.$executeRawUnsafe(
    "DELETE FROM `sales_crm_call_log`"
    + " WHERE RIGHT(REGEXP_REPLACE(COALESCE(`client_number`,''), '[^0-9]', ''), 10) LIKE ?"
    + "    OR RIGHT(REGEXP_REPLACE(COALESCE(`employee_number`,''), '[^0-9]', ''), 10) LIKE ?",
    LIKE,
    LIKE,
  );

  let removedLeads = 0;
  for (const lead of leads) {
    removedLeads += await prisma.$executeRawUnsafe(
      "UPDATE `sales_crm_lead` SET `deleted_at` = NOW(3) WHERE `enquiry_id` = ? AND `deleted_at` IS NULL",
      lead.enquiry_id,
    );
  }

  console.log(`\nRemoved ${removedLeads} lead${removedLeads === 1 ? "" : "s"} (soft) and ${removedCalls} call log row${removedCalls === 1 ? "" : "s"}.`);
  /*
   * The staff directory is read back out of the call log - `knownEmployeeNumbers()` selects the
   * distinct employee numbers - and caches for five minutes. With the rows gone the two fixture
   * employees stop being staff, which matters only if the fixture is about to be sent again.
   */
  console.log(`The two fixture employee numbers are no longer in the staff directory, which is`);
  console.log(`read back out of the call log. Allow five minutes for its cache, or restart the API.`);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
