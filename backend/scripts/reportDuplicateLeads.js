/**
 * The duplicate report: which clients the CRM holds more than one lead for, and what is on each.
 *
 * Read-only, and safe to run against production: SELECT and nothing else. It writes no row, marks
 * no status and deletes nothing - it exists so that whatever is done about the duplicates is
 * decided from the actual shape of them rather than from an estimate.
 *
 *   node scripts/reportDuplicateLeads.js                  the summary
 *   node scripts/reportDuplicateLeads.js --groups 40      with the worst 40 groups written out
 *   node scripts/reportDuplicateLeads.js --vertical "Qua Qua" --min 3
 *   node scripts/reportDuplicateLeads.js --csv duplicates.csv    every group, as a file to work from
 *
 * ── What counts as the same client ───────────────────────────────────────────────────────────
 *
 * The **last ten digits** of the phone number, which is the CRM's own rule for "the same client"
 * everywhere else (`phoneMatchKey` in crmLeadService.js): the same number is stored as
 * "9876543210", "+91 9876543210" and "98765-43210" depending on which door it came through. Corp
 * leads keep theirs in `contact_number` rather than `phone`, so both columns are read, and a number
 * that does not reach ten digits is not matched on at all rather than matched on a fragment.
 *
 * Grouped **within a vertical**, because that is the line the application itself draws: a second
 * lead for the same number in the same vertical is refused when somebody types it
 * (409 DUPLICATE_PHONE_IN_VERTICAL), while the same client enquiring on another vertical is a
 * different piece of work and is meant to have its own lead. `--across` groups by number alone for
 * a reader who wants to see those too.
 *
 * ── Why they exist at all ────────────────────────────────────────────────────────────────────
 *
 * The typed door refuses them. The **imported** doors - the CSV, the linked Google Sheet, the
 * Callyzer webhook - are deliberately outside that rule, because a file arrives as it arrives and
 * refusing half of it would lose the half nobody looked at. So every duplicate in the table came in
 * through one of those.
 *
 * ── What the report says about each group ────────────────────────────────────────────────────
 *
 * Enough to decide which lead is the one to keep, without opening any of them:
 *
 *   * how many leads the group holds, and the vertical they are on;
 *   * each lead's id, enquiry date, status, CRM and whether it carries remarks;
 *   * whether anything hangs off it - call logs, quotations, projects, meetings - because a lead
 *     with work against it is not one to fold into another;
 *   * which lead the **keep rule** below would keep.
 *
 * ── The keep rule this proposes ──────────────────────────────────────────────────────────────
 *
 * Nothing acts on it; it is printed so that a decision can be made about something concrete.
 *
 *   1. A lead with a **project or a quotation** against it. That is work the studio has done and it
 *      is keyed by enquiry id - folding such a lead into another would orphan it.
 *   2. Otherwise, a lead **nobody has marked "Duplicated"**. The studio has been marking these by
 *      hand, and that decision is better evidence than a date.
 *   3. Otherwise the lead **last worked**: the newest of the group by enquiry date, which is the one
 *      the CRM has been ringing and the one carrying the current status.
 *   4. Ties broken by enquiry id, so two runs of this report agree with each other.
 *
 * The studio's own convention is already visible in the data and is worth knowing before changing
 * anything: 1,339 leads carry the status **"Duplicated"**, some with the surviving enquiry id typed
 * into their remarks. That is this report's question answered by hand, one lead at a time.
 */
const fs = require("node:fs");
// The connection is this script's to close, even though every query it runs goes through the shared
// rule beside it - `$disconnect` is what lets `node` exit instead of hanging on an open pool.
const prisma = require("../src/config/db");
const { duplicateLeads, keeper, group, number } = require("./lib/duplicateLeads");

function readArgs(argv) {
  const args = { groups: 0, min: 2, vertical: "", across: false, csv: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--across") args.across = true;
    if (flag === "--groups") args.groups = Math.max(0, Number(argv[index + 1]) || 0);
    if (flag === "--min") args.min = Math.max(2, Number(argv[index + 1]) || 2);
    if (flag === "--vertical") args.vertical = String(argv[index + 1] || "").trim();
    if (flag === "--csv") args.csv = String(argv[index + 1] || "").trim();
  }
  return args;
}

const csvCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;

function describe(lead, keep) {
  const marks = [
    number(lead.hasProject) ? "project" : "",
    number(lead.hasQuotation) ? "quotation" : "",
    number(lead.hasCalls) ? "calls" : "",
    number(lead.hasRemarks) ? "remarks" : "",
  ].filter(Boolean).join(", ");
  return `     ${lead.enquiryId === keep ? "KEEP " : "     "}${String(lead.enquiryId).padEnd(24)}`
    + ` ${String(lead.enquiryDate || "no date").padEnd(12)}`
    + ` ${String(lead.status || "(no status)").padEnd(18)}`
    + ` ${String(lead.crm || "(no CRM)").padEnd(20)}`
    + ` ${marks || "nothing attached"}`;
}

async function main() {
  const args = readArgs(process.argv.slice(2));
  const rows = await duplicateLeads(args);
  const groups = group(rows, args.across);

  const leads = rows.length;
  const extras = leads - groups.length;
  const withWork = groups.filter((entry) => entry.leads.some((lead) => number(lead.hasProject) || number(lead.hasQuotation))).length;
  const contested = groups.filter((entry) => keeper(entry.leads).contested).length;
  const marked = rows.filter((row) => String(row.status || "").toLowerCase().startsWith("duplicat")).length;

  console.log("");
  console.log(`Duplicate leads — grouped by the last ten digits of the phone number${args.across ? ", across every vertical" : ", within a vertical"}`);
  console.log(`${args.vertical ? `   vertical: ${args.vertical}\n` : ""}   groups of ${args.min} or more: ${groups.length}`);
  console.log(`   leads in them: ${leads}   (${extras} more than one per client)`);
  console.log(`   groups where a lead already carries work (project or quotation): ${withWork}`);
  console.log(`   groups where more than one lead carries work — decide these by hand: ${contested}`);
  console.log(`   leads already marked "Duplicated" by somebody: ${marked}`);
  console.log("");

  const byVertical = new Map();
  for (const entry of groups) byVertical.set(entry.vertical, (byVertical.get(entry.vertical) || 0) + 1);
  for (const [vertical, count] of [...byVertical].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${String(vertical).padEnd(12)} ${count} group(s)`);
  }

  const sizes = new Map();
  for (const entry of groups) sizes.set(entry.leads.length, (sizes.get(entry.leads.length) || 0) + 1);
  console.log("\n   leads per client:");
  for (const [size, count] of [...sizes].sort((a, b) => a[0] - b[0])) {
    console.log(`   ${String(size).padStart(4)} leads  ${count} client(s)`);
  }

  if (args.groups) {
    console.log(`\n   The ${Math.min(args.groups, groups.length)} largest groups, with the lead the keep rule proposes:\n`);
    for (const entry of groups.slice(0, args.groups)) {
      const keep = keeper(entry.leads);
      console.log(`   ...${entry.key}  ${entry.vertical}  ${entry.leads.length} leads  — keep by: ${keep.reason}`);
      for (const lead of entry.leads) console.log(describe(lead, keep.lead.enquiryId));
      console.log("");
    }
  }

  if (args.csv) {
    const lines = ["phoneKey,vertical,enquiryId,name,enquiryDate,status,crm,hasRemarks,hasCalls,hasQuotation,hasProject,proposed"];
    for (const entry of groups) {
      const keep = keeper(entry.leads).lead.enquiryId;
      for (const lead of entry.leads) {
        lines.push([
          entry.key, entry.vertical, lead.enquiryId, lead.name, lead.enquiryDate, lead.status, lead.crm,
          number(lead.hasRemarks), number(lead.hasCalls), number(lead.hasQuotation), number(lead.hasProject),
          lead.enquiryId === keep ? "keep" : "duplicate",
        ].map(csvCell).join(","));
      }
    }
    fs.writeFileSync(args.csv, `${lines.join("\n")}\n`);
    console.log(`\n   Written: ${args.csv} (${lines.length - 1} rows)`);
  }

  console.log("\n   Nothing was changed. This report only reads.\n");
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
