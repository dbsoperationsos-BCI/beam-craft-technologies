/**
 * The one seed that may be run on production, and the only thing it does is make permissions exist.
 *
 * ── Why this file exists at all ───────────────────────────────────────────────────────────────
 *
 * `prisma/seed.js` must never be run on a live database (CLAUDE.md, Hard Constraints). It runs
 * *every* seeder, and most of them **assert** rather than fill gaps: master data is rewritten to
 * whatever the repository currently says, the Super Admin's row is upserted, roles and their grants
 * are re-applied, and - the one that actually removes access - `seedPermissions` **retires every
 * active permission the catalogue does not name**. On a live installation that is not "the new rows
 * appear": it is Settings being reset to the repository's opinion, and it is silent.
 *
 * But there is a real production need behind the temptation, and it is narrow: a permission added to
 * `permission-catalogue.js` does not exist in the database until something writes it, and a guard
 * naming a permission the table does not hold refuses everybody but a Super Admin, saying so to
 * nobody. That is normally carried by a **migration** (`INSERT … WHERE NOT EXISTS`, IAM.md step 10)
 * and a migration is still the right answer for a change shipping with code. This is for the other
 * case: repairing drift, or catching a production database up with a catalogue that has moved ahead
 * of it, without handing it a script whose blast radius is "whatever else is in the seed".
 *
 * ── What it will not do ───────────────────────────────────────────────────────────────────────
 *
 * It cannot retire, deactivate or delete a permission. The sweep in `iam-roles-permissions.js` is
 * deliberately absent: on production, a permission this catalogue happens not to describe is far
 * more likely to be one deployed from a branch that has not merged yet than one the studio wants
 * taken away - and deactivating it takes the screen away from everybody holding it.
 *
 * It does not touch **roles, grants, permission scopes, users, branches or any master data**. In
 * particular it writes no `role_permission` row, so after it runs a new permission is held by
 * nobody but a Super Admin until somebody ticks it in Role Management and re-saves the role. That
 * is the same thing the migrations say, and it is deliberate: who may use a feature is the studio's
 * decision, never a seed's.
 *
 * It never writes `isActive`. The full seeder forces `isActive: true` on every upsert, which would
 * quietly un-retire a permission an administrator had turned off here.
 *
 * ── Running it ────────────────────────────────────────────────────────────────────────────────
 *
 *   npm run seed:permissions -- --dry-run     # report what would change, write nothing
 *   npm run seed:permissions                  # create what is missing, refresh names/descriptions
 *
 * Both are safe to repeat: the second run of an unchanged catalogue reports "nothing to do".
 */

const prisma = require("../../src/config/db");
const { PERMISSIONS } = require("./permission-catalogue");

const name = (permission) => `${permission.module} / ${permission.feature}`;

/**
 * What this run would change, worked out before anything is written.
 *
 * Read first and written second so `--dry-run` and the real run answer from the same comparison -
 * a dry run that took a different path would be a rehearsal of something else.
 */
async function plan() {
  const existing = await prisma.permission.findMany({
    select: { id: true, module: true, feature: true, level: true, displayName: true, description: true, isActive: true },
  });
  const held = new Map(existing.map((row) => [`${row.module}::${row.feature}::${row.level}`, row]));

  const missing = [];
  const changed = [];
  for (const permission of PERMISSIONS) {
    const row = held.get(`${permission.module}::${permission.feature}::${permission.level}`);
    if (!row) {
      missing.push(permission);
      continue;
    }
    // Only the two columns that are the catalogue's to describe. `isActive` is the studio's.
    if (row.displayName !== permission.displayName || row.description !== permission.description) {
      changed.push({ permission, row });
    }
  }

  /*
   * Named but never acted on. A permission the database holds and the catalogue does not describe is
   * reported so somebody can look at it - it is usually a branch deployed ahead of this one - and
   * that is the whole of what happens to it here.
   */
  const catalogued = new Set(PERMISSIONS.map((permission) => `${permission.module}::${permission.feature}::${permission.level}`));
  const unknown = existing.filter((row) => !catalogued.has(`${row.module}::${row.feature}::${row.level}`));

  return { missing, changed, unknown, total: PERMISSIONS.length };
}

async function run({ dryRun }) {
  const { missing, changed, unknown, total } = await plan();

  console.log(`Permission catalogue: ${total} described, ${missing.length} missing, ${changed.length} to refresh.`);
  for (const permission of missing) console.log(`  + ${name(permission)} (${permission.level})`);
  for (const { permission } of changed) console.log(`  ~ ${name(permission)} — name or description`);
  if (unknown.length) {
    console.log(`\n  ${unknown.length} permission(s) in the database that this catalogue does not describe.`);
    console.log("  They are left exactly as they are - this seed never retires anything:");
    for (const row of unknown) console.log(`    · ${name(row)} (${row.level})${row.isActive ? "" : " — already inactive"}`);
  }

  if (dryRun) {
    console.log("\n--dry-run: nothing was written.");
    return;
  }
  if (!missing.length && !changed.length) {
    console.log("\nNothing to do.");
    return;
  }

  for (const permission of missing) {
    // `create`, not `upsert`: the row is known to be absent, and an upsert here would be a second
    // place that could quietly update a row this run had decided only to read.
    await prisma.permission.create({ data: permission });
  }
  for (const { permission, row } of changed) {
    await prisma.permission.update({
      where: { id: row.id },
      data: { displayName: permission.displayName, description: permission.description },
    });
  }

  console.log(`\nWrote ${missing.length} new permission(s) and refreshed ${changed.length}.`);
  if (missing.length) {
    console.log("No grants were made. Each new permission is held by nobody but a Super Admin until");
    console.log("a role is ticked in Admin → Role Management and re-saved.");
  }
}

if (require.main === module) {
  run({ dryRun: process.argv.includes("--dry-run") })
    .catch((error) => {
      console.error("Permission seed failed:", error.message);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}

module.exports = { plan, run };
