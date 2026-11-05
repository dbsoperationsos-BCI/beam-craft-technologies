/**
 * What stands between the lead's children and their keys - read-only, safe to run on production.
 *
 * Migration 20260924150000 gives projects, quotations, meetings, CRD documents, saved group names and
 * call transcripts a real key to the lead. "" and a deleted lead both become "no lead"; a meeting
 * without a lead is removed. A booking is created with an enquiry, always - the form and the import
 * both require one - so a project left with no lead after the migration is a row somebody has to
 * look at: point it at its enquiry, or remove it if it was a test. This prints every such row and
 * the counts the migration acts on, so the answer is known before `migrate deploy` runs.
 *
 *   npm run report:lead-keys
 */
const prisma = require("../src/config/db");

const CHILDREN = [
  ["sales_project", "projects", "becomes no lead - and needs looking at"],
  ["sales_quotation", "quotations", "becomes no lead"],
  ["sales_crm_meeting", "meetings", "removed"],
  ["sales_project_crd_document", "CRD documents", "becomes no lead"],
  ["sales_whatsapp_group_name", "saved group names", "becomes no lead"],
  ["sales_call_transcript", "call transcripts", "becomes no lead"],
];

async function main() {
  console.log("");
  for (const [table, label, outcome] of CHILDREN) {
    const [row] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) AS total,
              SUM(\`enquiry_id\` = '') AS blank,
              SUM(\`enquiry_id\` IS NOT NULL AND \`enquiry_id\` <> '' AND NOT EXISTS (SELECT 1 FROM \`sales_crm_lead\` AS \`l\` WHERE \`l\`.\`enquiry_id\` = \`t\`.\`enquiry_id\`)) AS dangling
         FROM \`${table}\` AS \`t\``,
    );
    const blank = Number(row.blank || 0);
    const dangling = Number(row.dangling || 0);
    const flag = blank + dangling ? `   <- ${blank + dangling} row(s) ${outcome}` : "";
    console.log(`${label.padEnd(20)} ${String(Number(row.total)).padStart(7)} rows   blank ${String(blank).padStart(5)}   pointing at a deleted lead ${String(dangling).padStart(5)}${flag}`);
  }
  const blocking = await prisma.$queryRawUnsafe(
    "SELECT `event_id`, `enquiry_id`, `whatsapp_group_name`, `client_main_number`, `project_status`, `created_at`"
    + "  FROM `sales_project` AS `p`"
    + " WHERE `enquiry_id` = '' OR NOT EXISTS (SELECT 1 FROM `sales_crm_lead` AS `l` WHERE `l`.`enquiry_id` = `p`.`enquiry_id`)"
    + " ORDER BY `created_at`",
  );
  console.log("");
  if (!blocking.length) {
    console.log("Every project names a lead that exists.");
  } else {
    console.log(`${blocking.length} project(s) name no lead, or a deleted one. Each keeps an empty link after the migration; point it at its enquiry, or remove it if it was a test row:`);
    for (const row of blocking) {
      console.log(`   ${row.event_id}  enquiry "${row.enquiry_id}"  group "${row.whatsapp_group_name}"  ${row.client_main_number}  ${row.project_status}  ${new Date(row.created_at).toISOString().slice(0, 10)}`);
    }
  }
  console.log("");
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect().catch(() => {}));
