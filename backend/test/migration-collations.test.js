const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * Every table this schema creates says what collation it is in.
 *
 * MySQL 8 defaults a new database to `utf8mb4_0900_ai_ci`; the studio's is `utf8mb4_unicode_ci`. A
 * CREATE TABLE that ends `);` rather than
 * `) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;` takes whichever the database it
 * happens to be built in defaults to - so the same migration folder produces two different schemas
 * and nobody notices, because a table's collation is invisible until something compares it with
 * another one.
 *
 * Then something does. `20260906160000_data_scope_backfill` joins `hrm_task`.`branch` to
 * `branch`.`name`, and MySQL refuses to compare two columns of different collations: *Illegal mix of
 * collations (utf8mb4_0900_ai_ci,IMPLICIT) and (utf8mb4_unicode_ci,IMPLICIT)*. It ran on every
 * machine the studio owns and failed the first time it met a database created without saying, which
 * was CI - the one place whose whole job is to catch this.
 *
 * So: a new CREATE TABLE states its collation, and this fails if one does not. The six that already
 * shipped without it are named below with the migration that repairs them, rather than being edited
 * where they sit - a migration already in git is never rewritten.
 */

const MIGRATIONS = path.join(__dirname, "..", "prisma", "migrations");
const REQUIRED = "utf8mb4_unicode_ci";

/**
 * The six tables created before this was noticed, in one hand-written migration that predates it.
 * `20260906210000_pin_table_collations` converts them at deploy time on any database where they
 * drifted, which is why they are allowed to stay as they are rather than being rewritten in place.
 */
const REPAIRED_IN_PLACE = new Set([
  "hrm_settings",
  "employee_referral",
  "employee_referral_payout",
  "hrm_task",
  "hrm_task_activity",
  "notification",
]);
const REPAIRED_BY = "20260906210000_pin_table_collations";

/** Every CREATE TABLE in the folder, as `{ migration, table, tail }` - `tail` is what follows `)`. */
function createTableStatements() {
  const found = [];
  for (const migration of fs.readdirSync(MIGRATIONS).sort()) {
    const file = path.join(MIGRATIONS, migration, "migration.sql");
    if (!fs.existsSync(file)) continue;
    const body = fs.readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    const pattern = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?`?(\w+)`?\s*\((.*?)\n\s*\)([^;]*);/gis;
    for (const match of body.matchAll(pattern)) {
      found.push({ migration, table: match[1], tail: match[3].trim() });
    }
  }
  return found;
}

test("every table a migration creates states its collation", () => {
  const statements = createTableStatements();
  assert.ok(statements.length > 100, `expected the whole folder, parsed ${statements.length} CREATE TABLE statements`);

  const silent = statements
    .filter((statement) => !statement.tail.toLowerCase().includes(REQUIRED))
    .filter((statement) => !REPAIRED_IN_PLACE.has(statement.table));

  assert.deepEqual(
    silent.map((statement) => `${statement.table} (${statement.migration})`),
    [],
    `these CREATE TABLE statements inherit the database's default collation instead of stating `
      + `${REQUIRED}. End them "DEFAULT CHARACTER SET utf8mb4 COLLATE ${REQUIRED};" - a table that `
      + `does not say comes out differently on a database built with MySQL's default, and the first `
      + `query joining it to a table that does say fails with "Illegal mix of collations".`,
  );
});

test("the six tables that shipped without one are repaired by a migration that is still there", () => {
  // The allowance above is only honest while the repair exists. If that migration is ever removed,
  // these six stop being "handled elsewhere" and become six tables nothing pins.
  const repair = path.join(MIGRATIONS, REPAIRED_BY, "migration.sql");
  assert.ok(fs.existsSync(repair), `${REPAIRED_BY} is what allows the six exceptions above; it is gone`);
  const sql = fs.readFileSync(repair, "utf8");
  for (const table of REPAIRED_IN_PLACE) {
    assert.match(sql, new RegExp(`ALTER TABLE \`${table}\` CONVERT TO CHARACTER SET utf8mb4 COLLATE ${REQUIRED}`), `${table} is not repaired`);
  }
  // Conditional, so a database where they are already right is not made to rewrite six tables.
  assert.match(sql, /SET @needed :=/, "the conversion must ask before it rewrites a table");
});

test("CI builds its database in the studio's collation before applying anything", () => {
  /*
   * The load-bearing half of the fix. The repair migration cannot save a from-scratch build,
   * because it runs *after* the backfill that fails - so CI has to create the database right in the
   * first place. Pinned here because it is one line in a workflow file, far from the schema it
   * decides, and removing it would put CI back to proving the migrations against a database shaped
   * unlike production's.
   */
  const workflow = fs.readFileSync(path.join(__dirname, "..", "..", ".github", "workflows", "ci.yml"), "utf8");
  assert.match(workflow, new RegExp(`ALTER DATABASE \`dbs_ci\` CHARACTER SET utf8mb4 COLLATE ${REQUIRED}`));
  assert.ok(
    workflow.indexOf("ALTER DATABASE") < workflow.indexOf("npx prisma migrate deploy"),
    "the database has to be built before the migrations that fill it",
  );
});
