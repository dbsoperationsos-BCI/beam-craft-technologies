const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const prisma = require("../src/config/db");
const { PERMISSIONS } = require("../prisma/seeds/permission-catalogue");
const { PREFIXES } = require("../scripts/clear-test-fixtures");

/*
 * SUPER_ADMIN holds everything, and holds it as rows.
 *
 * The role is described as "full access across every branch" and was granted **nothing** - no
 * permissions, no branches. It went unnoticed because the one person carrying it also had
 * `user.role = 'SUPER_ADMIN'` on their login, and `iamService` short-circuits on that column without
 * reading a grant. Given to somebody whose login says `EMPLOYEE` - which is how the studio adds an
 * administrator - a role named SUPER_ADMIN granted them nothing at all.
 *
 * It cannot be filled from Administration → Roles, which refuses to edit a system role, and the seed
 * cannot be run on the VPS. So it is filled twice over: by the seed for a machine that reseeds, and
 * by a migration for every database that already exists. These hold the two together.
 */

/*
 * This grant was combined with five other migrations from the same session before push, so the file
 * on disk holds more than it. The section heading marks where it starts and the next one marks
 * where it ends, which is what keeps the assertions below about this grant alone rather than about
 * whatever else was folded in beside it.
 */
const COMBINED_MIGRATION = fs.readFileSync(
  path.join(__dirname, "..", "prisma", "migrations", "20260917120000_hrm_tasks_branch_text_and_admin_fixes", "migration.sql"),
  "utf8",
);
const MIGRATION = (() => {
  const start = COMBINED_MIGRATION.indexOf("-- 5. SUPER_ADMIN holds every permission, in every branch");
  assert.notEqual(start, -1, "the SUPER_ADMIN grant section of the combined migration was not found");
  const end = COMBINED_MIGRATION.indexOf("-- 6. Vizag is Visakhapatnam AP again", start);
  assert.notEqual(end, -1, "the section after the SUPER_ADMIN grant was not found");
  return COMBINED_MIGRATION.slice(start, end);
})();
const SEED = fs.readFileSync(path.join(__dirname, "..", "prisma", "seeds", "iam-roles-permissions.js"), "utf8");

test("the seed grants the role every permission, every scope and every branch", () => {
  const body = SEED.slice(SEED.indexOf("async function grantSuperAdminEverything("), SEED.indexOf("async function main("));
  assert.ok(body, "the seed no longer grants SUPER_ADMIN anything");
  assert.match(body, /where: \{ name: "SUPER_ADMIN" \}/);
  // READ_WRITE, which is what "full access" means: ranked above READ, so it satisfies every guard.
  assert.match(body, /accessLevel: "READ_WRITE"/);
  assert.match(body, /prisma\.rolePermissionScope\.upsert/, "a permission's sub-actions are not granted");
  assert.match(body, /prisma\.roleBranch\.upsert/, "the role is granted no branches, so it reaches nowhere");
  // Every branch, not only the active ones: a closed branch is one whose records are still read.
  assert.ok(!/branch\.findMany\(\{ where: \{ isActive/.test(body), "the role is denied the branches the studio has closed");
  // Called after the three seeds it grants from, or it grants what does not exist yet.
  const main = SEED.slice(SEED.indexOf("async function main("));
  assert.ok(
    main.indexOf("grantSuperAdminEverything()") > main.indexOf("seedScopes()"),
    "the grant runs before the permissions and scopes it is meant to grant",
  );
});

test("the migration writes the same three things, and writes them only where they are missing", () => {
  for (const table of ["`role_permission`", "`role_permission_scope`", "`role_branch`"]) {
    assert.ok(MIGRATION.includes(`INSERT INTO ${table}`), `the migration does not fill ${table}`);
  }
  assert.match(MIGRATION, /'READ_WRITE'/);
  assert.match(MIGRATION, /WHERE `role`\.`name` = 'SUPER_ADMIN'/);
  /*
   * Idempotent, which is not optional: a migration that inserts blindly fails on its second run
   * against the unique key, and the studio's next deploy stops on it. Each statement adds only what
   * is absent - and that is also what makes it safe on a database where somebody has already granted
   * part of this by hand.
   */
  const inserts = MIGRATION.split("INSERT INTO").slice(1);
  assert.equal(inserts.length, 3);
  for (const statement of inserts) {
    assert.match(statement, /LEFT JOIN/, "a statement inserts without checking what is there");
    assert.match(statement, /IS NULL;/, "a statement inserts without checking what is there");
  }
  // The ids these tables need. Prisma mints a cuid in the application, and there is no application
  // here - the columns are `VARCHAR(191)` with no default, so the statement has to supply one.
  assert.match(MIGRATION, /UUID\(\)/);
});

/*
 * ── The invariant itself, against whatever this database holds ────────────────────────────────
 *
 * Fails on a database where the migration has not been applied, which is the point: the role's whole
 * purpose is that it holds everything, and a hole in it is invisible until somebody carrying it is
 * refused something.
 */
test("the role holds every active permission, and holds it at READ_WRITE", async () => {
  const role = await prisma.role.findUnique({ where: { name: "SUPER_ADMIN" }, select: { id: true } });
  assert.ok(role, "there is no SUPER_ADMIN role at all");

  const permissions = await prisma.permission.findMany({ where: { isActive: true }, select: { id: true, module: true, feature: true } });
  const grants = new Map(
    (await prisma.rolePermission.findMany({ where: { roleId: role.id }, select: { permissionId: true, accessLevel: true } }))
      .map((grant) => [grant.permissionId, grant.accessLevel]),
  );

  const missing = permissions.filter((permission) => !grants.has(permission.id)).map((p) => `${p.module} / ${p.feature}`);
  assert.deepEqual(missing, [], "SUPER_ADMIN does not hold these - add them in the migration that adds the permission");

  const weak = permissions
    .filter((permission) => grants.get(permission.id) !== "READ_WRITE")
    .map((p) => `${p.module} / ${p.feature} (${grants.get(p.id)})`);
  assert.deepEqual(weak, [], "SUPER_ADMIN holds these at less than READ_WRITE");
});

test("the role reaches every branch the studio has", async () => {
  const role = await prisma.role.findUnique({ where: { name: "SUPER_ADMIN" }, select: { id: true } });
  const branches = await prisma.branch.findMany({ select: { id: true, code: true, name: true } });
  const reached = new Set((await prisma.roleBranch.findMany({ where: { roleId: role.id }, select: { branchId: true } })).map((row) => row.branchId));
  /*
   * A branch another suite is holding is not one the studio has.
   *
   * `node --test` runs the files in parallel, and several suites create a branch of their own for
   * the length of a test - `data-scope-crm`, `data-scope-employees`, `hrm-employee-branch-scope`.
   * Nothing grants those to SUPER_ADMIN, because nothing should: they are gone by the end of the
   * run, and re-seeding the role for a fixture would be the test arranging its own answer. Read
   * without this, the assertion was a race - it passed or failed on whether a neighbouring suite
   * happened to be between its `before` and its `after`, which is how it failed on branches named
   * "Lead Scope Branch". The prefixes are the sweep's own list, so a suite that registers its
   * fixtures there is skipped here too, and a real branch can never be spelt one of those.
   */
  const fixture = (branch) => PREFIXES.some((prefix) => String(branch.code || "").startsWith(prefix));
  const missing = branches.filter((branch) => !fixture(branch) && !reached.has(branch.id)).map((branch) => branch.name);
  // A role with no branches reaches nowhere, so a missing one is a branch this role cannot work in.
  assert.deepEqual(missing, [], "SUPER_ADMIN does not reach these branches");
});

test("every permission the catalogue describes is one the database has, and the role holds", async () => {
  /*
   * The two halves of a permission's life meeting: the catalogue says what should exist, the table
   * says what does, and the grant says the one role meant to hold everything does. A permission
   * added to the catalogue and to no migration fails here rather than on the day somebody is
   * refused a screen they were told they could open.
   */
  const rows = await prisma.permission.findMany({ where: { isActive: true }, select: { module: true, feature: true } });
  const held = new Set(rows.map((row) => `${row.module}::${row.feature}`));
  const missing = PERMISSIONS
    .map((permission) => `${permission.module}::${permission.feature}`)
    .filter((key) => !held.has(key));
  assert.deepEqual(missing, [], "these are in the catalogue but not in the database - the migration for them is missing");
});
