/**
 * Resolving the duplicate leads: keep one per client, delete the rest.
 *
 * **A dry run unless you pass `--apply`.** Run without it, it prints exactly what it would do and
 * changes nothing - that output is the thing to read before letting it write, and it is worth
 * reading against production at least once even after it has been run somewhere else.
 *
 *   node scripts/resolveDuplicateLeads.js                          what it would do, to everything
 *   node scripts/resolveDuplicateLeads.js --vertical "Qua Qua" --limit 20
 *   node scripts/resolveDuplicateLeads.js --limit 20 --apply       the first 20 groups, for real
 *   node scripts/resolveDuplicateLeads.js --apply                  all of them
 *
 * ── What it does to a group ──────────────────────────────────────────────────────────────────
 *
 * One client, several leads. It keeps the one `scripts/lib/duplicateLeads.js` names - the same one
 * the report proposes, because both read that file - sets its status to **Followup**, and deletes
 * the others.
 *
 * **Deleted means `deleted_at`,** which is what the board's own red Delete does and what every read
 * in the CRM already filters by. The rows stay in the table: a group resolved wrongly is recoverable
 * by clearing that column, where a real `DELETE` would be a restore from backup. The remarks, call
 * logs and activity of a deleted lead stay with it rather than being copied onto the survivor -
 * nothing is rewritten, so nothing can be rewritten wrongly.
 *
 * ── What it refuses to touch ─────────────────────────────────────────────────────────────────
 *
 * A group where a lead being deleted carries a **project or a quotation**. Those are keyed by
 * enquiry id, and deleting the lead would leave them pointing at a lead nothing lists. Same where
 * more than one lead in the group carries work: there is a real decision to make and it is not this
 * script's. Both are counted and named in the output for somebody to work by hand.
 *
 * A survivor whose status already says how the enquiry **ended** - Converted, Converted & Followup,
 * Invalid, Rejected - keeps it. A booked job is not a lead to chase, and a refused one is not
 * either. `--force-status` overrides that, for a studio that means all of them.
 *
 * ── Getting it wrong ─────────────────────────────────────────────────────────────────────────
 *
 * Everything this writes is reversible, and this is how:
 *
 *   -- the leads it deleted, most recent run first
 *   SELECT enquiry_id, deleted_at FROM sales_crm_lead WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC;
 *   -- putting a run back
 *   UPDATE sales_crm_lead SET deleted_at = NULL WHERE deleted_at BETWEEN ? AND ?;
 *
 * The run stamps every lead it deletes with the same timestamp, so one run is one value to undo.
 */
const prisma = require("../src/config/db");
const { duplicateLeads, group, plan, tableExists } = require("./lib/duplicateLeads");

function readArgs(argv) {
  const args = { apply: false, limit: 0, min: 2, vertical: "", across: false, forceStatus: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--apply") args.apply = true;
    if (flag === "--across") args.across = true;
    if (flag === "--force-status") args.forceStatus = true;
    if (flag === "--limit") args.limit = Math.max(0, Number(argv[index + 1]) || 0);
    if (flag === "--min") args.min = Math.max(2, Number(argv[index + 1]) || 2);
    if (flag === "--vertical") args.vertical = String(argv[index + 1] || "").trim();
  }
  return args;
}

/** Ids per statement, well inside MySQL's placeholder limit - the same slice the CRM's own deletes use. */
const SLICE = 500;

async function deleteLeads(ids, at) {
  let deleted = 0;
  for (let offset = 0; offset < ids.length; offset += SLICE) {
    const slice = ids.slice(offset, offset + SLICE);
    deleted += await prisma.$executeRawUnsafe(
      `UPDATE \`sales_crm_lead\` SET \`deleted_at\` = ?, \`updated_at\` = CURRENT_TIMESTAMP(3)
        WHERE \`deleted_at\` IS NULL AND \`enquiry_id\` IN (${slice.map(() => "?").join(", ")})`,
      at, ...slice,
    );
  }
  return deleted;
}

async function setStatus(pairs, at) {
  let updated = 0;
  // Grouped by the status being written, so each is one statement per slice rather than one per
  // lead: a studio with three thousand groups is three thousand survivors.
  const byStatus = new Map();
  for (const [enquiryId, status] of pairs) {
    if (!byStatus.has(status)) byStatus.set(status, []);
    byStatus.get(status).push(enquiryId);
  }
  for (const [status, ids] of byStatus) {
    for (let offset = 0; offset < ids.length; offset += SLICE) {
      const slice = ids.slice(offset, offset + SLICE);
      updated += await prisma.$executeRawUnsafe(
        `UPDATE \`sales_crm_lead\` SET \`status\` = ?, \`updated_at\` = CURRENT_TIMESTAMP(3)
          WHERE \`deleted_at\` IS NULL AND \`enquiry_id\` IN (${slice.map(() => "?").join(", ")})`,
        status, ...slice,
      );
    }
  }
  return updated;
}

/**
 * A line in the activity log of every lead this touches, so the change is answerable from the app.
 *
 * Written by hand rather than through `recordLeadActivity`, which resolves an actor with a query per
 * lead - this is a script with no signed-in user and possibly thousands of rows.
 *
 * **Never allowed to fail the run.** `sales_crm_lead_activity` is created on demand by the CRM, like
 * the call log, so a database where nobody has edited a lead yet does not have it - and this runs
 * *after* the deletes. Left unguarded it threw there once: the leads were already deleted, the
 * statuses already written, and the run ended on a stack trace without printing the line that undoes
 * it. A missing history is worth a warning; it is not worth losing the receipt for what was done.
 */
async function logActivity(entries, at) {
  if (!await tableExists("sales_crm_lead_activity")) {
    console.warn("   (no activity table on this database - the change is not written into the leads' history)");
    return;
  }
  for (let offset = 0; offset < entries.length; offset += SLICE) {
    const slice = entries.slice(offset, offset + SLICE);
    /*
     * `id` is supplied, because the column has none of its own: `sales_crm_lead_activity.id` is a
     * `VARCHAR(191)` primary key that the application fills with a cuid, so an INSERT that leaves it
     * out is rejected outright ("Field 'id' doesn't have a default value"). `UUID()` is MySQL's own
     * answer to the same question, and the column only has to be unique.
     */
    await prisma.$executeRawUnsafe(
      `INSERT INTO \`sales_crm_lead_activity\`
         (\`id\`, \`enquiry_id\`, \`action\`, \`field\`, \`field_label\`, \`to_value\`, \`actor_name\`, \`source\`, \`created_at\`)
       VALUES ${slice.map(() => "(UUID(), ?, ?, ?, ?, ?, ?, ?, ?)").join(", ")}`,
      ...slice.flatMap(({ enquiryId, action, toValue }) => [
        enquiryId, action, "duplicate", "Duplicate resolution", toValue, "Duplicate cleanup", "script", at,
      ]),
    );
  }
}

async function main() {
  const args = readArgs(process.argv.slice(2));
  const rows = await duplicateLeads(args);
  const groups = group(rows, args.across).map((entry) => plan(entry, args));

  const workable = groups.filter((entry) => !entry.skip);
  const skipped = groups.filter((entry) => entry.skip);
  const chosen = args.limit ? workable.slice(0, args.limit) : workable;

  const toDelete = chosen.flatMap((entry) => entry.remove.map((lead) => lead.enquiryId));
  const toFollowUp = chosen.filter((entry) => !entry.statusKept);
  const statusKept = chosen.filter((entry) => entry.statusKept);

  console.log("");
  console.log(args.apply ? "Resolving duplicate leads — WRITING" : "Resolving duplicate leads — DRY RUN, nothing will be changed");
  console.log(`   groups found: ${groups.length}${args.vertical ? ` (vertical: ${args.vertical})` : ""}`);
  console.log(`   groups this run will resolve: ${chosen.length}${args.limit && workable.length > args.limit ? ` of ${workable.length} it could` : ""}`);
  console.log(`   leads to delete: ${toDelete.length}`);
  console.log(`   survivors set to Followup: ${toFollowUp.length}`);
  console.log(`   survivors keeping a settled status (Converted, Rejected …): ${statusKept.length}${args.forceStatus ? " — overridden by --force-status" : ""}`);
  console.log(`   groups left for somebody to look at: ${skipped.length}`);
  console.log("");

  for (const entry of skipped.slice(0, 20)) {
    console.log(`   left alone  ...${entry.key}  ${entry.vertical}  ${entry.leads.length} leads — ${entry.skip}`);
  }
  if (skipped.length > 20) console.log(`   ... and ${skipped.length - 20} more`);
  if (skipped.length) console.log("");

  for (const entry of chosen.slice(0, args.apply ? 5 : 20)) {
    console.log(`   ...${entry.key}  ${entry.vertical}  ${entry.leads.length} leads`);
    console.log(`        keep   ${entry.keep.enquiryId}  ${entry.keep.status || "(no status)"} -> ${entry.status}${entry.statusKept ? "  (kept: the enquiry has ended)" : ""}   [${entry.reason}]`);
    for (const lead of entry.remove) console.log(`        delete ${lead.enquiryId}  ${lead.enquiryDate || "no date"}  ${lead.status || "(no status)"}`);
  }
  if (chosen.length > (args.apply ? 5 : 20)) console.log(`   ... and ${chosen.length - (args.apply ? 5 : 20)} more groups`);

  if (!args.apply) {
    console.log("\n   Nothing was changed. Add --apply to write, and --limit to do it a few groups at a time.\n");
    return;
  }

  const at = new Date();
  const deleted = await deleteLeads(toDelete, at);
  const updated = await setStatus(toFollowUp.map((entry) => [entry.keep.enquiryId, entry.status]), at);
  // Caught rather than thrown, for the reason in `logActivity`: the rows are already written by the
  // time this runs, and the undo line below is the only thing that makes them reversible.
  try {
    await logActivity([
      ...chosen.flatMap((entry) => entry.remove.map((lead) => ({
        enquiryId: lead.enquiryId, action: "DELETED", toValue: `Duplicate of ${entry.keep.enquiryId}`,
      }))),
      ...chosen.map((entry) => ({
        enquiryId: entry.keep.enquiryId,
        action: "UPDATED",
        toValue: `Kept; ${entry.remove.length} duplicate lead(s) deleted: ${entry.remove.map((lead) => lead.enquiryId).join(", ")}`,
      })),
    ], at);
  } catch (error) {
    console.warn(`   (the leads' history could not be written: ${error?.message || error})`);
  }

  console.log("");
  console.log(`   deleted ${deleted} lead(s), set ${updated} survivor(s) to Followup.`);
  console.log(`   Stamped ${at.toISOString()} — to put this run back:`);
  console.log(`   UPDATE sales_crm_lead SET deleted_at = NULL WHERE deleted_at = '${at.toISOString().slice(0, 19).replace("T", " ")}';`);
  console.log("");
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
