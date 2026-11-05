const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * Every table named in raw SQL has to be a table that exists.
 *
 * The snake_case migration renamed all of them, and three queries were missed - the Callyzer
 * webhook's phone lookup and both halves of the sheet-delete. Nothing caught it: Prisma's own
 * client is generated from the schema and cannot be wrong, but `$queryRawUnsafe` takes whatever
 * string it is handed, and these strings still said `SalesCrmLead`. The webhook only failed on a
 * delivery carrying real phone numbers, because the sample payload everyone tests with has masked
 * five-digit numbers that never reach the query.
 *
 * Read from the schema rather than from a live database, so this runs anywhere without MySQL.
 */

const SRC = path.join(__dirname, "..", "src");
const SCHEMA = path.join(__dirname, "..", "prisma", "schema.prisma");

/*
 * Tables this codebase creates at runtime with CREATE TABLE IF NOT EXISTS rather than through a
 * migration, plus the legacy mirror.
 *
 * They are real tables that the schema does not describe, so they would read as typos here. Every
 * write to `leads` is already wrapped in its own try/catch - it belongs to the separate legacy
 * WhatsApp automation and is absent on a fresh install by design.
 */
const KNOWN_UNMAPPED = new Set([
  "leads",
  "sales_crm_lead_activity",
  "sales_crm_call_log",
  "sales_crm_excluded_number",
  "sales_google_sheet_sync_run",
  "SalesCrmWhatsAppMessage",
  "SalesCrmWhatsAppSetting",
  "SalesCrmWhatsAppUserSetting",
]);

function schemaTableNames() {
  const schema = fs.readFileSync(SCHEMA, "utf8");
  const names = new Set();
  // The mapped name where a model declares one, and the model's own name where it does not -
  // Prisma falls back to the model name as the table name.
  for (const match of schema.matchAll(/@@map\("([^"]+)"\)/g)) names.add(match[1]);
  for (const match of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    if (!/@@map\(/.test(match[2])) names.add(match[1]);
  }
  // Views the CRM reads through, created by migration rather than declared as models.
  for (const match of schema.matchAll(/^view\s+(\w+)/gm)) names.add(match[1]);
  return names;
}

function jsFiles(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") found.push(...jsFiles(full));
    } else if (entry.name.endsWith(".js")) {
      found.push(full);
    }
  }
  return found;
}

/*
 * Only backtick-quoted names, after a keyword that can be followed by a table.
 *
 * The backtick may be escaped: most of these queries live inside template literals, where a table
 * is written \`like_this\`. Without that the scan walked straight past every query in the CRM's
 * runtime tables - which is how a table missing from the schema got past this guard once already.
 *
 * `UPDATE` is not counted when `KEY` precedes it: the `UPDATE` in `ON DUPLICATE KEY UPDATE` is
 * followed by the columns being assigned, not by a table, and reading those as tables reported
 * `enquiry_id` and `name` as missing.
 */
const TABLE_REFERENCE = /(?:FROM|INTO|JOIN|(?<!KEY\s)UPDATE|TABLE(?:\s+IF\s+(?:NOT\s+)?EXISTS)?)\s+\\?`([A-Za-z0-9_]+)\\?`/gi;

/*
 * Comments are blanked before the scan, because this file's own vocabulary is ordinary English.
 * A comment reading "derived from `transitions`" is a FROM followed by a backticked name and
 * matches perfectly - and a house style that explains itself in prose produces a lot of those.
 *
 * Replaced with blank lines rather than deleted, so the line numbers in a failure still point at
 * the real one.
 */
function withoutComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    // Not a `://`, which is a URL inside a string rather than the start of a comment.
    .replace(/(^|[^:])\/\/[^\n]*/g, (line, before) => before + " ".repeat(line.length - before.length));
}

test("every table named in raw SQL exists in the schema", () => {
  const known = schemaTableNames();
  // The migration views are created by SQL, not declared - read them from the migrations so a new
  // vertical's view does not have to be added here by hand.
  const migrations = path.join(__dirname, "..", "prisma", "migrations");
  if (fs.existsSync(migrations)) {
    for (const dir of fs.readdirSync(migrations)) {
      const file = path.join(migrations, dir, "migration.sql");
      if (!fs.existsSync(file)) continue;
      const sql = fs.readFileSync(file, "utf8");
      for (const match of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+`?(\w+)`?/gi)) known.add(match[1]);
    }
  }

  const unknown = [];
  for (const file of jsFiles(SRC)) {
    const source = withoutComments(fs.readFileSync(file, "utf8"));
    /*
     * A common table expression is a name that exists only inside its own statement.
     *
     * `WITH \`events\` AS (...) SELECT ... FROM \`events\`` reads to the scan below as a query
     * against a table called `events` that no migration creates - which is exactly what this test
     * is for, and exactly wrong here. Collected per file rather than allowed globally, so a real
     * query against a missing table that happens to share a CTE's name somewhere else is still
     * caught.
     */
    const cteNames = new Set([...source.matchAll(/WITH\s+\\?`([A-Za-z0-9_]+)\\?`\s+AS\s*\(/gi)].map((match) => match[1]));
    for (const match of source.matchAll(TABLE_REFERENCE)) {
      const table = match[1];
      if (known.has(table) || KNOWN_UNMAPPED.has(table) || cteNames.has(table)) continue;
      const line = source.slice(0, match.index).split("\n").length;
      unknown.push(`${path.relative(path.join(__dirname, ".."), file)}:${line} -> \`${table}\``);
    }
  }

  assert.deepEqual(
    unknown,
    [],
    `Raw SQL names ${unknown.length} table(s) that no migration creates.\n` +
      `Usually a rename that a hand-written query was left out of:\n  ${unknown.join("\n  ")}`,
  );
});

test("the CRM lead table is never named in its pre-migration spelling", () => {
  // Named on its own because this is the one that broke, and because the sweep above would pass
  // the moment somebody added the old name to the allowlist instead of fixing the query.
  const offenders = [];
  for (const file of jsFiles(SRC)) {
    const source = withoutComments(fs.readFileSync(file, "utf8"));
    for (const match of source.matchAll(/`(SalesCrmLead|SalesCrmLeadWatch)`/g)) {
      const line = source.slice(0, match.index).split("\n").length;
      offenders.push(`${path.relative(path.join(__dirname, ".."), file)}:${line} -> \`${match[1]}\``);
    }
  }
  assert.deepEqual(offenders, [], `Use \`sales_crm_lead\` / \`sales_crm_lead_watch\`:\n  ${offenders.join("\n  ")}`);
});
