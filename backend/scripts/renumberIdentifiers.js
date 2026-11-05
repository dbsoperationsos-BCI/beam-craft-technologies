#!/usr/bin/env node
/* eslint-disable no-console */
const prisma = require("../src/config/db");
const {
  SCHEMES,
  contextFromKey,
  formatIdentifier,
  parseIdentifier,
  advanceSequence,
  sequenceKey,
} = require("../src/services/identifiers");
const { ENQUIRY_ID_REFERENCES } = require("../src/modules/sales/crm-leads/crmLeadService");

/*
 * ── Renumbering what is already here ──────────────────────────────────────────────────────────
 *
 * The studio asked for one shape of identifier and for the old ones to go, so this walks every
 * record that carries one, works out what it would be called under the new rules, and rewrites it -
 * along with every column elsewhere that quotes it.
 *
 * ── Why a script and not a migration ──
 *
 * The rule this has to apply is the one in `services/identifiers.js`: which spellings of a branch
 * are the same branch, which vertical a lead is on, how the number is padded. Written again in SQL
 * it would be a second copy of that rule, drifting from the first - which is the exact fault this
 * whole change exists to remove. So it runs the real thing, once, and the migration beside it only
 * adds the two columns that did not exist.
 *
 * ── What it will not do ──
 *
 * In its ordinary mode it does not touch a record whose identifier is already in the new shape, so
 * running it twice is safe and a half-finished run can simply be run again.
 *
 * It cannot reach the Google Sheet. The CRM's sheets carry an Enquiry ID column, and a lead renamed
 * here will not match the sheet's copy of its old id - the sync falls back to matching on phone
 * number, which is what it already does for a row with no id. Say so before running this against
 * live data.
 *
 *   node scripts/renumberIdentifiers.js            # say what would change, write nothing
 *   node scripts/renumberIdentifiers.js --apply    # do it
 *
 * ── --renumber: re-issuing codes that are already correct ─────────────────────────────────────
 *
 * The mode above exists to bring old shapes onto the new one. `--renumber` is for the other case:
 * the *counting rule* changed, and codes that are perfectly well-formed are now numbered under a
 * rule nothing uses any more.
 *
 * Nothing in the application needs it today - identifiers count per vertical, which is what the
 * records in the database were written under. It is here because that rule *has* been changed once
 * and could be again, and the only way back from a half-applied change is to re-issue every code in
 * creation order under whatever the rule now is. A database that has been renumbered under a rule
 * that was then reverted is exactly the case this repairs.
 *
 *   node scripts/renumberIdentifiers.js --renumber            # the whole plan, writing nothing
 *   node scripts/renumberIdentifiers.js --renumber --apply    # do it
 *
 * It re-issues **every** row of every scheme, in the order the records were created, so the numbers
 * run in the order the studio took the work. A row whose code is already what it should be is left
 * alone, which is what makes a second run a no-op.
 *
 * ── Read this before running it ──
 *
 * This changes identifiers that have already been quoted - on a quotation, in a WhatsApp group
 * name, to a client on the phone. Every column inside this application that carries one is swept
 * with it, so nothing here breaks; what cannot be swept is somebody's notebook, an email already
 * sent, or the Google Sheet. It is a one-way change with no undo beyond a database backup, and it
 * should be run once, deliberately, against a backup you have taken.
 */

const APPLY = process.argv.includes("--apply");
const RENUMBER = process.argv.includes("--renumber");
/*
 * `--only=SCHEME[,SCHEME]` narrows the run to the schemes named.
 *
 * What it is for is a scheme that has just been added: its column is new, every row is blank, and
 * the rest of the plan has nothing to do and must not be given the chance to do it anyway. An
 * employee id is on a payslip; a scheme whose rows are still in an older shape is a separate,
 * deliberate decision by the studio, not something to sweep up while filling in a new column.
 */
const ONLY = process.argv
  .filter((arg) => arg.startsWith("--only="))
  .flatMap((arg) => arg.slice("--only=".length).split(","))
  .map((name) => name.trim().toUpperCase())
  .filter(Boolean);

for (const name of ONLY) {
  if (!SCHEMES[name]) {
    console.error(`Unknown scheme: ${name}. One of: ${Object.keys(SCHEMES).join(", ")}`);
    process.exit(1);
  }
}

/*
 * Each scheme: where its identifier lives, how a row's vertical and branch are read, and which
 * other columns quote it.
 *
 * `references` is the part that has to be complete. An enquiry id is stored as plain text on twelve
 * other columns - a project, a quotation, a meeting, the activity log - and a missed one leaves a
 * row pointing at an identifier that no longer exists. The list was taken from
 * `information_schema`, not from memory.
 */
const PLAN = [
  {
    scheme: "EMPLOYEE",
    table: "employee",
    column: "employee_id",
    order: "`created_at` ASC, `id` ASC",
    select: "`id`, `employee_id` AS `code`",
    context: () => ({}),
    references: [["employee_onboarding_invite", "employee_id"]],
  },
  {
    scheme: "CRM_LEAD",
    table: "sales_crm_lead",
    column: "enquiry_id",
    // The row's own arrival, so the oldest enquiry in each vertical and branch is 000001.
    order: "COALESCE(`created_day`, DATE(`created_at`)) ASC, `created_at` ASC, `enquiry_id` ASC",
    // The enquiry id *is* the primary key of this table, so it is what a row is addressed by too.
    key: "`enquiry_id`",
    select: "`enquiry_id` AS `code`, `branch`, `assigned_branch`",
    context: (row) => ({ vertical: row.branch, branch: row.assigned_branch }),
    /*
     * The ten other columns that quote an enquiry id, from `crmLeadService.js` rather than listed
     * again here - the live rename on placement sweeps the same set, and two copies of this list is
     * one that gets a table added to it and one that does not.
     */
    references: ENQUIRY_ID_REFERENCES,
  },
  {
    scheme: "SALES_PROJECT",
    table: "sales_project",
    column: "event_id",
    order: "`created_at` ASC, `id` ASC",
    select: "`event_id` AS `code`, `vertical`, `source_branch`",
    // A booking imported from the old sheet keeps the sheet's Event ID; it is not the app's to renumber.
    where: "`sheet_event_id` IS NULL",
    context: (row) => ({ vertical: row.vertical, branch: row.source_branch }),
    references: [],
  },
  {
    /*
     * A shoot takes its vertical and its branch from the project it belongs to, and is ordered by
     * the day it is booked for - so a project's shoots read in the order the studio will work them.
     */
    scheme: "PROJECT_SHOOT",
    table: "project_shoot",
    column: "shoot_id",
    order: "`date_created` ASC, `created_at` ASC, `id` ASC",
    select: "`s`.`shoot_id` AS `code`, `p`.`vertical`, `p`.`source_branch`",
    from: "`project_shoot` `s` LEFT JOIN `sales_project` `p` ON `p`.`id` = `s`.`project_id`",
    orderQualified: "`s`.`date_created` ASC, `s`.`created_at` ASC, `s`.`id` ASC",
    key: "`s`.`id`",
    // As above: an imported shoot keeps the sheet's Shoot ID.
    whereQualified: "`s`.`sheet_shoot_id` IS NULL",
    context: (row) => ({ vertical: row.vertical, branch: row.source_branch }),
    // Every other `shoot_id` column in the database is a foreign key to `project_shoot`.`id`, not
    // this code - checked against information_schema, not remembered.
    references: [],
  },
  {
    scheme: "QUOTATION",
    table: "sales_quotation",
    column: "quotation_number",
    order: "`created_at` ASC, `id` ASC",
    // The vertical is in the saved payload: a quotation's client fields differ per vertical, so it
    // is the one thing every quotation carries.
    select: "`quotation_number` AS `code`, JSON_UNQUOTE(JSON_EXTRACT(`payload`, '$.vertical')) AS `vertical`, `source_branch`",
    context: (row) => ({ vertical: row.vertical, branch: row.source_branch }),
    references: [],
    /*
     * `quotation_number` is the *chain* - the enquiry's number, shared by every version of the same
     * conversation - and `quotation_id` is that chain plus the version: `…-000001-02`. So the second
     * is rebuilt from the first rather than mirrored onto it, or every version of a renamed chain
     * would collapse onto one id and the unique index would refuse the write.
     */
    derive: { column: "quotation_id", sql: "CONCAT(?, '-', LPAD(`version`, 2, '0'))" },
  },
  {
    scheme: "CRD_DOCUMENT",
    table: "sales_project_crd_document",
    column: "document_code",
    order: "`created_at` ASC, `id` ASC",
    /*
     * The document's own vertical first, then the project's.
     *
     * It read the project's alone, which is null for a document raised by hand from Create CRD
     * Document - that button exists precisely for a project answered "Not Applicable", and such a
     * document is never adopted by one. So the rows most likely to be missing a code were also the
     * rows this could not name a vertical for, and it skipped them. The document carries its own
     * `vertical`, chosen in the create dialog; the project's stays as the answer for a row raised
     * before that column was written.
     */
    select: "`d`.`document_code` AS `code`, `d`.`vertical` AS `own_vertical`, `p`.`vertical`",
    from: "`sales_project_crd_document` `d` LEFT JOIN `sales_project` `p` ON `p`.`id` = `d`.`project_id`",
    orderQualified: "`d`.`created_at` ASC, `d`.`id` ASC",
    key: "`d`.`id`",
    context: (row) => ({ vertical: row.own_vertical || row.vertical }),
    references: [],
  },
  {
    scheme: "IMAGE_SELECTION",
    table: "image_selection_project",
    column: "project_code",
    order: "`created_at` ASC, `id` ASC",
    select: "`project_code` AS `code`",
    context: () => ({}),
    references: [],
  },
  {
    scheme: "CASH_RECEIVED",
    table: "cash_entry",
    column: "entry_id",
    where: "`entry_type` = 'Received'",
    order: "`entry_date` ASC, `created_at` ASC, `id` ASC",
    select: "`c`.`entry_id` AS `code`, `c`.`branch`, `p`.`vertical`",
    from: "`cash_entry` `c` LEFT JOIN `sales_project` `p` ON `p`.`id` = `c`.`project_id`",
    orderQualified: "`c`.`entry_date` ASC, `c`.`created_at` ASC, `c`.`id` ASC",
    whereQualified: "`c`.`entry_type` = 'Received'",
    key: "`c`.`id`",
    context: (row) => ({ vertical: row.vertical, branch: row.branch }),
    references: [],
  },
  {
    scheme: "CASH_SPENT",
    table: "cash_entry",
    column: "entry_id",
    where: "`entry_type` = 'Spent'",
    order: "`entry_date` ASC, `created_at` ASC, `id` ASC",
    select: "`c`.`entry_id` AS `code`, `c`.`branch`, `p`.`vertical`",
    from: "`cash_entry` `c` LEFT JOIN `sales_project` `p` ON `p`.`id` = `c`.`project_id`",
    orderQualified: "`c`.`entry_date` ASC, `c`.`created_at` ASC, `c`.`id` ASC",
    whereQualified: "`c`.`entry_type` = 'Spent'",
    key: "`c`.`id`",
    context: (row) => ({ vertical: row.vertical, branch: row.branch }),
    references: [],
  },
  {
    scheme: "ASSET",
    table: "asset",
    column: "asset_code",
    order: "`created_at` ASC, `id` ASC",
    // The one record that carries a real branch id rather than a branch typed as text.
    select: "`a`.`asset_code` AS `code`, `l`.`name` AS `branch`",
    from: "`asset` `a` LEFT JOIN `location` `l` ON `l`.`id` = `a`.`branch_id`",
    orderQualified: "`a`.`created_at` ASC, `a`.`id` ASC",
    key: "`a`.`id`",
    context: (row) => ({ branch: row.branch }),
    references: [],
  },
  {
    /*
     * The referral register. Ordered by the joining date the instalments are counted from, then by
     * arrival, so the codes run in the order the studio took the people on.
     */
    scheme: "EMPLOYEE_REFERRAL",
    table: "employee_referral",
    column: "referral_id",
    order: "`referred_on` ASC, `created_at` ASC, `id` ASC",
    select: "`referral_id` AS `code`",
    context: () => ({}),
    references: [],
  },
  {
    scheme: "VENDOR",
    table: "vendor",
    column: "vendor_id",
    order: "`created_at` ASC, `id` ASC",
    select: "`vendor_id` AS `code`",
    context: () => ({}),
    references: [],
  },
  {
    scheme: "CLIENT_STORAGE",
    table: "client_storage",
    column: "storage_id",
    order: "`created_at` ASC, `id` ASC",
    select: "`storage_id` AS `code`",
    context: () => ({}),
    references: [],
  },
  {
    scheme: "SPEAK_UP",
    table: "speak_up",
    column: "speak_up_id",
    order: "`created_at` ASC, `id` ASC",
    select: "`speak_up_id` AS `code`",
    context: () => ({}),
    references: [],
  },
];

/** Every row of one scheme, oldest first, with whatever its context is read from. */
async function readRows(step) {
  const key = step.key || "`id`";
  const from = step.from || `\`${step.table}\``;
  const where = step.whereQualified || step.where;
  const order = step.orderQualified || step.order;
  return prisma.$queryRawUnsafe(
    `SELECT ${key} AS \`rowKey\`, ${step.select} FROM ${from}${where ? ` WHERE ${where}` : ""} ORDER BY ${order}`,
  );
}

/**
 * What each row of this scheme should be called, and where its counter should end up.
 *
 * A row already carrying an identifier of this scheme keeps it - and still counts, so the numbers
 * that follow carry on from it rather than reusing one. That is what makes a repeat run a no-op.
 */
function planScheme(step, rows) {
  const counters = new Map();
  const changes = [];

  for (const row of rows) {
    const context = step.context(row);
    const key = sequenceKey(step.scheme, context);
    const existing = parseIdentifier(step.scheme, row.code);
    /*
     * A well-formed code keeps its number - unless the rule that produced the number has itself
     * changed, which is what `--renumber` is for. There, every row takes the next number in the run
     * whatever it is called now, so the sequence comes out in the order the records were created.
     */
    if (existing && !RENUMBER) {
      counters.set(key, Math.max(counters.get(key) || 0, existing.value));
      continue;
    }
    const value = (counters.get(key) || 0) + 1;
    counters.set(key, value);
    const to = formatIdentifier(step.scheme, context, value);
    // A row that is already called what it should be is not a change, so a second `--renumber` run
    // has nothing to do and says so.
    if (to === row.code) continue;
    changes.push({ rowKey: row.rowKey, from: row.code || "", to, context });
  }

  return { changes, counters };
}

/** One row's identifier, and every column that quotes it, moved to `to`. */
async function writeOne(step, change, to) {
  const table = step.table;
  const idColumn = step.key ? step.key.split(".").pop() : "`id`";
  /*
   * The identifier itself, plus any column on the same row that is *built from* it - a quotation's
   * `quotation_id` is its chain plus its version, so it has to be recomputed rather than copied.
   */
  const derive = step.derive;
  await prisma.$executeRawUnsafe(
    `UPDATE \`${table}\` SET \`${step.column}\` = ?${derive ? `, \`${derive.column}\` = ${derive.sql}` : ""} WHERE ${idColumn} = ?`,
    to,
    ...(derive ? [to] : []),
    change.rowKey,
  );
  /*
   * The references, matched on the value being replaced rather than on the row - an enquiry id is
   * plain text on twelve other columns and there is no key joining them. Matching on the old value
   * also means a column holding something else entirely, which is what `source_enquiry_id` usually
   * holds, is left alone.
   */
  for (const [refTable, refColumn] of step.references) {
    if (!change.from) continue;
    await prisma.$executeRawUnsafe(
      `UPDATE \`${refTable}\` SET \`${refColumn}\` = ? WHERE \`${refColumn}\` = ?`,
      to,
      change.from,
    );
  }
}

/**
 * Applies one scheme's renaming.
 *
 * In the ordinary mode every new name is a name nothing holds - the old codes are a different shape
 * entirely - so each row is written once and that is the end of it.
 *
 * `--renumber` is the case that cannot be done that way. The codes being written are the same shape
 * as the ones already there, so a lead moving to `…-000003` very often collides with the lead
 * currently *called* `…-000003`, which the primary key refuses - and the order the collisions come
 * in cannot be arranged away, because a renumbering is a permutation and a permutation has cycles.
 *
 * So it goes through a staging name first: every changing row is moved to a value nothing can
 * collide with, and only then to the name it is taking. Two passes, and the middle of it is a state
 * where identifiers read `TMP-…` - which is why this wants a backup and a quiet moment rather than a
 * busy afternoon.
 */
async function applyScheme(step, changes) {
  if (!RENUMBER) {
    for (const change of changes) await writeOne(step, change, change.to);
    return;
  }

  /*
   * A name no identifier can have and no two rows can share.
   *
   * Every real identifier begins `DBS-`, so nothing that begins `TMP-` is one; the index makes it
   * unique within the run. Short enough for the narrowest column that holds an identifier.
   */
  const staged = changes.map((change, index) => ({ ...change, temp: `TMP-${index + 1}` }));
  for (const change of staged) await writeOne(step, change, change.temp);
  // From the staging name now, not from the original - that is what the row and its references hold.
  for (const change of staged) await writeOne(step, { ...change, from: change.temp }, change.to);
}

async function main() {
  if (RENUMBER) {
    console.log("Re-issuing every identifier under the current rules: one run per scheme, across all verticals and branches.");
    console.log("Identifiers already quoted on quotations, WhatsApp group names and to clients will change.\n");
  }
  console.log(APPLY ? "Renumbering identifiers.\n" : "Dry run - nothing will be written. Pass --apply to do it.\n");

  if (ONLY.length) console.log(`Only: ${ONLY.join(", ")}\n`);

  let total = 0;
  for (const step of PLAN) {
    if (ONLY.length && !ONLY.includes(step.scheme)) continue;
    /*
     * `--renumber` only touches the schemes whose counting actually changed.
     *
     * Those are the ones that named a vertical and counted by it. An employee, a vendor, a client
     * storage disc and an asset were already on one run for the studio, so re-issuing them would
     * change codes people quote for no gain at all - and an employee id in particular is on a
     * payslip. The scheme's own `parts` answers this rather than a list written out here, which is
     * one more thing to forget when a scheme changes shape.
     */
    if (RENUMBER && !SCHEMES[step.scheme].parts.includes("vertical")) {
      console.log(`${step.scheme} (${step.table}.${step.column}): counted for the whole studio already - left alone.`);
      continue;
    }
    const rows = await readRows(step);
    const { changes, counters } = planScheme(step, rows);
    total += changes.length;

    const label = `${step.scheme} (${step.table}.${step.column})`;
    if (changes.length) {
      console.log(`${label}: ${changes.length} of ${rows.length} row(s) to rename`);
      for (const change of changes.slice(0, 5)) console.log(`    ${change.from || "(none)"}  ->  ${change.to}`);
      if (changes.length > 5) console.log(`    ... and ${changes.length - 5} more`);
    } else {
      console.log(`${label}: ${rows.length} row(s), nothing to rename.`);
    }

    if (!APPLY) continue;
    if (changes.length) await applyScheme(step, changes);
    /*
     * The counters are advanced whether or not anything was renamed.
     *
     * `planScheme` counts every row, including the ones already in the new shape, so `counters`
     * holds where the data has actually got to. A scheme with nothing left to rename is exactly the
     * case where that matters most - a half-finished earlier run, or a second pass - because the
     * counter may still be sitting behind rows that are already correct, and the next record saved
     * would then be handed a number that is on one of them.
     */
    for (const [key, value] of counters) {
      await advanceSequence(step.scheme, contextFromKey(step.scheme, key), value);
    }
    console.log(changes.length ? "    written, counters advanced." : "    counters advanced.");
  }

  console.log(`\n${total} identifier(s) ${APPLY ? "renamed" : "would be renamed"}.`);
  if (!APPLY && total) console.log(`Run again with ${RENUMBER ? "--renumber --apply" : "--apply"} to write them.`);
}

main()
  .catch((error) => { console.error("\nFailed:", error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
