const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { PERMISSIONS } = require("../prisma/seeds/permission-catalogue");

/*
 * Who may select a whole board, and who may import a file onto one.
 *
 * Both were part of `SALES / CRM Leads` Read / Write - the permission that also covers a status, a
 * follow-up date and a remark - so anybody who could work the board could rewrite it wholesale or
 * land a file on it. They are their own rows now, and this file holds the three things that can
 * quietly come apart: the permissions being in the catalogue at all (a guard naming one that is not
 * refuses everybody but a Super Admin, and says so to nobody - CLAUDE.md Rule 4), the routes
 * mounting them, and the board hiding what the guards refuse.
 *
 * Source text rather than a running server, like the other CRM guard tests beside it: no database,
 * no ports, and it fails on the edit that removes a guard rather than on the report weeks later.
 */

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");

const ROUTES = read("src", "modules", "sales", "crm-leads", "routes.js");
const CRM_PAGE = fs.readFileSync(
  path.join(__dirname, "..", "..", "frontend", "src", "components", "sales", "CRMPage.js"),
  "utf8",
);

/** The `router.<method>("<route>", ...)` line for one route, or null. */
function route(method, route) {
  const line = ROUTES.split("\n").find((text) => text.trimStart().startsWith(`router.${method}("${route}"`));
  return line ? line.trim() : null;
}

const has = (module, feature) => PERMISSIONS.some((perm) => perm.module === module && perm.feature === feature);

test("both permissions are in the catalogue, so they can be granted at all", () => {
  assert.ok(has("SALES", "CRM Lead Select All"), "SALES / CRM Lead Select All is not in the catalogue");
  assert.ok(has("SALES", "CRM Lead Import"), "SALES / CRM Lead Import is not in the catalogue");
});

test("a permission is one level, so the seed's upsert cannot make two rows of it", () => {
  const levels = PERMISSIONS.filter((perm) => perm.module === "SALES").map((perm) => perm.level);
  assert.equal(new Set(levels).size, levels.length, `two SALES permissions share a level: ${levels.join(", ")}`);
});

test("everything a selection does is guarded by Select All", () => {
  for (const [method, path] of [["post", "/bulk-status"], ["post", "/bulk-assign"], ["delete", "/bulk"]]) {
    const line = route(method, path);
    assert.ok(line, `${method.toUpperCase()} ${path} is gone`);
    assert.match(line, /canSelectLeads/, `${method.toUpperCase()} ${path} no longer asks for Select All`);
  }
  assert.match(ROUTES, /const canSelectLeads = checkPermission\("SALES", "CRM Lead Select All", "READ_WRITE"\)/);
});

test("a bulk delete asks for deletion as well, and a single delete asks only for that", () => {
  // Both acts at once, so both guards. Losing the deletion guard here would let Select All alone
  // destroy a board; losing it on the single route would put the same act back a row at a time.
  assert.match(route("delete", "/bulk"), /canSelectLeads, canDeleteLeads/);
  const single = ROUTES.split("\n").find((text) => text.trimStart().startsWith('router.delete("/:id"'));
  assert.match(single, /canDeleteLeads/);
  assert.doesNotMatch(single, /canSelectLeads/, "deleting one named lead must not need Select All");
});

test("the CSV is guarded by Import, and Bulk Entry deliberately is not", () => {
  assert.match(route("post", "/import-csv"), /canImportLeads/);
  assert.match(ROUTES.split("\n").find((t) => t.includes('"/import-csv/:batchId/cancel"')), /canImportLeads/);
  assert.match(ROUTES, /const canImportLeads = checkPermission\("SALES", "CRM Lead Import", "READ_WRITE"\)/);
  // Bulk Entry types leads in, which is what the board's own Read / Write is granted for.
  assert.doesNotMatch(route("post", "/bulk"), /canImportLeads|canSelectLeads/);
});

test("the ids route stays on the board's own permission, because Quotations reads it too", () => {
  // The trap in CLAUDE.md Rule 4: one endpoint feeding two screens means those screens share a
  // permission. Narrowing this to Select All would empty the Quotation Generator's Enquire ID
  // picker for everybody who may not select leads.
  assert.doesNotMatch(route("get", "/ids"), /canSelectLeads/);
});

test("the board hides what the guards refuse", () => {
  assert.match(CRM_PAGE, /useModuleAccess\("SALES", "CRM Lead Select All"\)/);
  assert.match(CRM_PAGE, /useModuleAccess\("SALES", "CRM Lead Import"\)/);
  // Absent, not disabled: the whole column of tick boxes - the header's, the filter row's blank
  // and every row's own - is handed to the table only for a role that holds the permission. The
  // board draws through `DataTable`, and a table given no `selection` builds no column at all.
  assert.match(CRM_PAGE, /selection: canSelectLeads \? \{/);
  assert.match(CRM_PAGE, /\} : undefined,\n\s*infiniteScroll:/);
  assert.match(CRM_PAGE, /\.\.\.\(canImportLeads \? \[\{ label: "Import"/);
  // Bulk Entry has no condition on it, so the menu is never empty for somebody who may add a lead.
  assert.match(CRM_PAGE, /\{ label: "Bulk Entry", onSelect/);
});

test("both permissions are created by a migration, not by the seed alone", () => {
  /*
   * The seed cannot be run on production, so a permission that exists only in the catalogue never
   * reaches the `permission` table there - and a guard naming a row that is not in it refuses
   * everybody but a Super Admin and says so to nobody (CLAUDE.md Rule 4). For these two that would
   * close the tick boxes and the CSV import to the whole studio the moment the code shipped.
   *
   * So the catalogue is what makes a permission grantable in a seeded environment, and a migration
   * is what makes it exist everywhere else. Both must carry the same `feature` and `level`, because
   * the seed upserts on them and would otherwise create a second row beside the migration's.
   */
  const dir = path.join(__dirname, "..", "prisma", "migrations");
  const sql = fs.readdirSync(dir)
    .filter((name) => fs.existsSync(path.join(dir, name, "migration.sql")))
    .map((name) => fs.readFileSync(path.join(dir, name, "migration.sql"), "utf8"))
    .join("\n");

  for (const feature of ["CRM Lead Select All", "CRM Lead Import"]) {
    const perm = PERMISSIONS.find((entry) => entry.feature === feature);
    assert.ok(sql.includes(`'${feature}'`), `no migration creates SALES / ${feature}, so production will never hold it`);
    assert.ok(sql.includes(`'${perm.level}'`), `the migration writes a different level for ${feature} than the catalogue does`);
  }
  // Written so a re-run inserts nothing, and so a seeded environment matches rather than duplicates.
  assert.match(sql, /WHERE NOT EXISTS \(\s*SELECT 1 FROM `permission` AS `existing`/);
});
