/**
 * Whether this database holds every permission the code expects, and nothing the code has retired.
 *
 * Read-only, and safe to run against production: it issues `SELECT` and nothing else.
 *
 * It exists because **the seed cannot be run on the VPS**, and a permission that reaches a database
 * only by being seeded therefore never arrives there. That failure is silent in the worst way: a
 * guard naming a `module / feature` the `permission` table does not hold refuses everybody except a
 * Super Admin, no error says so, and the screen simply goes missing for the whole studio. So the
 * catalogue in the code and the rows in the database have to be checked against each other
 * deliberately, and this is that check.
 *
 * Three things are reported, and only the first is an outage:
 *
 *   - **Missing** - the code guards it, the database has no row. Nobody but a Super Admin reaches
 *     whatever it governs. Fix by applying the migration that creates it, not by seeding.
 *   - **Inactive** - the row is there and switched off. `getUserPermissions` and the Roles dialog
 *     both read `is_active`, so it grants nothing and is offered to nobody. That is correct for a
 *     retired permission (`ADMIN / System Settings` after the Settings split) and a bug otherwise.
 *   - **Unknown** - the database holds an active row the catalogue no longer describes. Harmless to
 *     the application, which never asks for it, but it is still offered in Role Management, so
 *     somebody can grant it and be given nothing.
 *
 *   node scripts/auditPermissionCatalogue.js
 */
const prisma = require("../src/config/db");
const { PERMISSIONS } = require("../prisma/seeds/permission-catalogue");

const key = (row) => `${row.module} / ${row.feature}`;

async function main() {
  const rows = await prisma.permission.findMany({ select: { module: true, feature: true, level: true, isActive: true } });
  const byKey = new Map(rows.map((row) => [key(row), row]));

  const missing = [];
  const inactive = [];
  const mismatched = [];
  for (const wanted of PERMISSIONS) {
    const found = byKey.get(key(wanted));
    if (!found) { missing.push(key(wanted)); continue; }
    if (!found.isActive) inactive.push(key(wanted));
    // The seed upserts on module + feature + level, so a level that has drifted means the next seed
    // makes a *second* row rather than updating this one - and two rows for one screen is a grant
    // that lands on whichever the resolver happens to read first.
    if (found.level !== wanted.level) mismatched.push(`${key(wanted)} - database says ${found.level}, code says ${wanted.level}`);
  }
  const known = new Set(PERMISSIONS.map(key));
  const unknown = rows.filter((row) => row.isActive && !known.has(key(row))).map(key);

  const report = (title, list) => {
    console.log(`\n${title}: ${list.length}`);
    if (list.length) console.log(list.map((entry) => `  - ${entry}`).join("\n"));
  };

  console.log(`catalogue: ${PERMISSIONS.length} permissions | database: ${rows.length} rows (${rows.filter((r) => r.isActive).length} active)`);
  report("MISSING - guarded by the code, absent here, so only a Super Admin reaches them", missing);
  report("INACTIVE - present and switched off", inactive);
  report("LEVEL MISMATCH - a reseed would create a second row", mismatched);
  report("UNKNOWN - active here, not in the catalogue", unknown);

  console.log(missing.length || mismatched.length
    ? "\nNot clean. Apply the migrations that create the rows above; do not seed a production database."
    : "\nClean: every permission the code guards exists here.");
}

main()
  .catch((error) => { console.error("Audit failed:", error.message); process.exitCode = 1; })
  .finally(async () => prisma.$disconnect());
