/*
 * Clear what stops a linked Interview sheet re-importing rows it has already brought in.
 *
 * ── Read this before running it ───────────────────────────────────────────────────────────────
 *
 * A sync refuses to write a candidate the register has seen before, and does so twice over:
 *
 *   1. `hrm_interview_google_sheet_row` - the ledger, which remembers every row a link imported,
 *      whether or not the candidate it made still exists.
 *   2. the soft-deleted candidates themselves, matched on phone, email or source row id, which
 *      still recognise somebody after the spreadsheet has shifted their row.
 *
 * Both exist so that deleting a candidate means something: without them a sheet re-imports the
 * person every two minutes, onto a register somebody has just cleared. This script removes both,
 * for one spreadsheet, so a sync can fill the register from the sheet again.
 *
 * ── It is almost certainly not what you want ──────────────────────────────────────────────────
 *
 * The deletes are *soft*: every candidate is still in the table with `deleted_at` set, holding the
 * status, interviewer, remarks, interview date and follow-up dates the studio put on them. None of
 * that is in the spreadsheet, so a re-import cannot bring it back - it restores the sheet's own
 * columns and nothing else, under new candidate codes.
 *
 * `--restore` puts those rows back exactly as they were, which is lossless and needs no re-sync.
 * Try that first. Use `--flush` only where the register genuinely should be rebuilt from the sheet.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────────────────────
 *
 *   node scripts/resetInterviewSheetImport.js                          # what links and rows exist
 *   node scripts/resetInterviewSheetImport.js --link=<id>              # dry run for one link
 *   node scripts/resetInterviewSheetImport.js --link=<id> --restore --apply
 *   node scripts/resetInterviewSheetImport.js --link=<id> --flush --apply
 *
 * `--since=YYYY-MM-DD` narrows either action to candidates deleted on or after that day, which is
 * how a single afternoon's mistake is undone without touching anybody deleted on purpose before it.
 *
 * Nothing is written without `--apply`. Interview only: no other module's tables are read or
 * touched. Safe to run again - both actions are idempotent.
 */

const prisma = require("../src/config/db");

const arg = (name) => {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3).trim() : "";
};
const APPLY = process.argv.includes("--apply");
const RESTORE = process.argv.includes("--restore");
const FLUSH = process.argv.includes("--flush");
const LINK_ID = arg("link");
const SINCE = arg("since");

const n = (value) => Number(value || 0).toLocaleString();

/** Every link, with what each one would be acting on. Printed when no link is named. */
async function listLinks() {
  const links = await prisma.hrmInterviewGoogleSheetLink.findMany({
    where: { deletedAt: null },
    select: { id: true, spreadsheetId: true, spreadsheetName: true, targetedTab: true, status: true, lastSyncedAt: true },
    orderBy: { createdAt: "asc" },
  });
  if (!links.length) {
    console.log("No live Interview sheet links. Nothing here can help.");
    return;
  }
  console.log("Interview sheet links:\n");
  for (const link of links) {
    const ledger = await prisma.hrmInterviewGoogleSheetRow.count({ where: { linkId: link.id } });
    const deleted = await prisma.hrmInterviewCandidate.count({ where: { deletedAt: { not: null }, spreadsheetId: link.spreadsheetId } });
    const live = await prisma.hrmInterviewCandidate.count({ where: { deletedAt: null, spreadsheetId: link.spreadsheetId } });
    console.log(`  ${link.id}`);
    console.log(`    sheet        ${link.spreadsheetName || link.spreadsheetId} — tab "${link.targetedTab}" (${link.status})`);
    console.log(`    last synced  ${link.lastSyncedAt ? new Date(link.lastSyncedAt).toISOString() : "never"}`);
    console.log(`    candidates   ${n(live)} live, ${n(deleted)} deleted`);
    console.log(`    ledger rows  ${n(ledger)}\n`);
  }
  console.log("Name one with --link=<id> to see what would change.");
}

/** The candidates a run would act on: deleted, from this link's spreadsheet, since `--since`. */
function deletedWhere(link) {
  const where = { deletedAt: { not: null }, spreadsheetId: link.spreadsheetId };
  if (SINCE) {
    const from = new Date(`${SINCE}T00:00:00`);
    if (Number.isNaN(from.getTime())) throw new Error(`--since is not a date: ${SINCE}`);
    where.deletedAt = { gte: from };
  }
  return where;
}

async function main() {
  if (!LINK_ID) return listLinks();

  const link = await prisma.hrmInterviewGoogleSheetLink.findFirst({ where: { id: LINK_ID, deletedAt: null } });
  if (!link) throw new Error(`No live Interview sheet link with id ${LINK_ID}.`);
  if (RESTORE && FLUSH) throw new Error("Pick one of --restore or --flush, not both.");

  const where = deletedWhere(link);
  const affected = await prisma.hrmInterviewCandidate.count({ where });
  const ledger = await prisma.hrmInterviewGoogleSheetRow.count({ where: { linkId: link.id } });

  console.log(`Link   ${link.id}`);
  console.log(`Sheet  ${link.spreadsheetName || link.spreadsheetId} — tab "${link.targetedTab}"`);
  console.log(`Scope  deleted candidates from this spreadsheet${SINCE ? `, deleted on or after ${SINCE}` : ""}\n`);
  console.log(`  deleted candidates in scope : ${n(affected)}`);
  console.log(`  ledger rows for this link   : ${n(ledger)}\n`);

  if (!RESTORE && !FLUSH) {
    console.log("Nothing chosen. Add one of:");
    console.log("  --restore   put those candidates back exactly as they were (recommended, lossless)");
    console.log("  --flush     delete them and the ledger, so a sync re-imports from the sheet");
    return;
  }

  if (RESTORE) {
    console.log(`Would restore ${n(affected)} candidate(s) — every field they held comes back, and the ledger is left alone.`);
    if (!APPLY) return console.log("\nDry run. Add --apply to write it.");
    const done = await prisma.hrmInterviewCandidate.updateMany({ where, data: { deletedAt: null } });
    console.log(`\nRestored ${n(done.count)} candidate(s). No sync needed; nothing else was touched.`);
    return;
  }

  console.log(`Would PERMANENTLY delete ${n(affected)} candidate(s) and ${n(ledger)} ledger row(s).`);
  console.log("Their status, interviewer, remarks and dates go with them and cannot be recovered.");
  console.log("Re-imported rows come back with NEW candidate codes, and any screening-form invite");
  console.log("already sent to them will point at a candidate that no longer exists.");
  if (!APPLY) return console.log("\nDry run. Add --apply to write it.");

  const removed = await prisma.hrmInterviewCandidate.deleteMany({ where });
  const clearedLedger = await prisma.hrmInterviewGoogleSheetRow.deleteMany({ where: { linkId: link.id } });
  console.log(`\nDeleted ${n(removed.count)} candidate(s) and ${n(clearedLedger.count)} ledger row(s).`);
  console.log("Run Sync Now on the link in Settings → Integrations → Interview to re-import.");
}

main()
  .catch((error) => { console.error(`\n${error?.message || error}`); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
