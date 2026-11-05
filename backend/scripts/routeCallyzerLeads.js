// One-off repair for the leads the Callyzer webhook has already created.
//
// The webhook now routes a call to the business it is about and refuses to make a lead out of staff
// and personal calls. The leads already in the database predate that: every one of them was written
// with a blank vertical, which the CRM shows on the Dum Dum tab, and the staff and personal calls
// among them are sitting in the sheet as enquiries nobody can act on.
//
// This re-asks both questions of each of those leads, using the call logs already stored against
// them - the same rules the webhook uses, from the same file, so what this reports is exactly what
// the webhook would do with the same call today.
//
//   node scripts/routeCallyzerLeads.js                      report only, writes nothing
//   node scripts/routeCallyzerLeads.js --apply              sets the vertical where one is now known
//   node scripts/routeCallyzerLeads.js --apply --remove-non-leads
//                                                           also hides the staff and personal calls
//
// Reporting is the default because the whole point of the change is that this decision used to be
// made carelessly. Read the report, then run it again with --apply.
//
// Nothing is deleted. --remove-non-leads sets `deleted_at`, which is the same soft delete the CRM's
// own Delete uses: the rows leave the sheet and can be brought back by clearing that column. A lead
// that already carries a vertical is never touched, because somebody put it there.
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const {
  loadRoutingConfig, verticalForCall, callFilterReason, phoneKey,
} = require("../src/modules/sales/crm-leads/callRouting");

const prisma = new PrismaClient();

const apply = process.argv.includes("--apply");
const removeNonLeads = process.argv.includes("--remove-non-leads");

/**
 * The stored call log rows, back in the shape the routing rules read.
 *
 * `raw` is Callyzer's own payload as it arrived, so a call delivered with labels still has them -
 * which the flattened columns do not carry. It falls back to the columns when the raw JSON is
 * missing or unreadable, so a row written before `raw` existed still contributes its note.
 */
function asCallLog(row) {
  let raw = null;
  try { raw = row.raw ? JSON.parse(row.raw) : null; } catch { raw = null; }
  return {
    ...(raw && typeof raw === "object" ? raw : {}),
    client_name: row.clientName || raw?.client_name || "",
    client_number: row.clientNumber || raw?.client_number || "",
    note: row.note || raw?.note || "",
    crm_status: row.crmStatus || raw?.crm_status || "",
  };
}

async function main() {
  const routing = loadRoutingConfig();

  // The staff directory, exactly as the webhook builds it: every number Callyzer has reported as an
  // employee's own, plus anything named in CALLYZER_STAFF_NUMBERS.
  const staffRows = await prisma.$queryRawUnsafe(
    "SELECT DISTINCT `employee_number` AS `number` FROM `sales_crm_call_log` WHERE `employee_number` IS NOT NULL AND `employee_number` <> ''",
  );
  const staffNumbers = new Set(routing.staffNumbers);
  for (const row of staffRows) {
    const key = phoneKey(row.number);
    if (key) staffNumbers.add(key);
  }
  console.log(`${staffNumbers.size} number(s) are known to belong to staff.`);

  /*
   * The leads this is allowed to touch: the ones Callyzer created that still have no vertical.
   *
   * Anything with a vertical already on it is out of scope whatever its source - that is a decision
   * somebody made, and a script is not the thing to overturn it.
   */
  const leads = await prisma.$queryRawUnsafe(
    "SELECT `enquiry_id` AS `enquiryId`, `name`, `vertical` FROM `sales_crm_lead`"
    + " WHERE `deleted_at` IS NULL AND TRIM(COALESCE(`vertical`, '')) = ''"
    + "   AND (`source` = 'Callyzer' OR `referred_from` = 'Callyzer Call Log')",
  );
  if (!leads.length) {
    console.log("No unrouted Callyzer leads found. Nothing to do.");
    return;
  }
  console.log(`${leads.length} Callyzer lead(s) have no vertical.\n`);

  const routed = { "Dum Dum": 0, "Qua Qua": 0, Corp: 0 };
  const notLeads = { staff: 0, personal: 0 };
  let unchanged = 0;

  for (const lead of leads) {
    const rows = await prisma.$queryRawUnsafe(
      "SELECT `client_name` AS `clientName`, `client_number` AS `clientNumber`, `employee_number` AS `employeeNumber`,"
      + " `employee_name` AS `employeeName`, `note`, `crm_status` AS `crmStatus`, `raw`"
      + " FROM `sales_crm_call_log` WHERE `enquiry_id` = ? ORDER BY `called_at` ASC",
      lead.enquiryId,
    );
    if (!rows.length) { unchanged += 1; continue; }

    /*
     * A lead is only a staff or personal contact when every call on it is. One call marked personal
     * on a client who has also rung about a shoot is a mislabelled call, not a reason to hide a real
     * enquiry - and hiding is the one thing here that costs something if it is wrong.
     */
    const reasons = rows.map((row) => callFilterReason(
      asCallLog(row),
      { emp_name: row.employeeName, emp_number: row.employeeNumber },
      { ...routing, staffNumbers },
    ));
    const notLead = reasons.every(Boolean) && reasons.some((reason) => reason === "staff" || reason === "personal");
    if (notLead) {
      const reason = reasons.includes("staff") ? "staff" : "personal";
      notLeads[reason] += 1;
      console.log(`  ${lead.enquiryId}  not a lead (${reason})`);
      if (apply && removeNonLeads) {
        await prisma.$executeRawUnsafe(
          "UPDATE `sales_crm_lead` SET `deleted_at` = NOW(3) WHERE `enquiry_id` = ? AND `deleted_at` IS NULL",
          lead.enquiryId,
        );
      }
      continue;
    }

    // The first call that names a vertical decides it; the calls are read oldest first, so it is
    // the enquiry itself rather than a later follow-up that says what the lead is about.
    let vertical = "";
    for (const row of rows) {
      vertical = verticalForCall(
        asCallLog(row),
        { emp_name: row.employeeName, emp_number: row.employeeNumber },
        routing,
      );
      if (vertical) break;
    }
    if (!vertical) { unchanged += 1; continue; }

    routed[vertical] += 1;
    console.log(`  ${lead.enquiryId}  → ${vertical}`);
    if (apply) {
      await prisma.$executeRawUnsafe(
        "UPDATE `sales_crm_lead` SET `vertical` = ? WHERE `enquiry_id` = ? AND `deleted_at` IS NULL AND TRIM(COALESCE(`vertical`, '')) = ''",
        vertical,
        lead.enquiryId,
      );
    }
  }

  console.log("");
  console.log(`Dum Dum: ${routed["Dum Dum"]}   Qua Qua: ${routed["Qua Qua"]}   Corp: ${routed.Corp}`);
  console.log(`Not leads - staff: ${notLeads.staff}, personal: ${notLeads.personal}`);
  console.log(`Left alone (nothing in their calls says which business): ${unchanged}`);
  console.log("");

  if (!apply) {
    console.log("Nothing was written. Run again with --apply to set the verticals,");
    console.log("and --apply --remove-non-leads to hide the staff and personal calls as well.");
  } else {
    console.log(removeNonLeads
      ? "Verticals written, and the staff and personal calls hidden."
      : "Verticals written. The staff and personal calls were left in place - add --remove-non-leads to hide them.");
    console.log("Leads left with no vertical still appear on the Dum Dum tab, exactly as before.");
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
