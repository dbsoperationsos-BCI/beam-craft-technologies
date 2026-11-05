const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { PERMISSIONS } = require("../prisma/seeds/permission-catalogue");

/*
 * Who may act on a whole stage of the Interview register at once.
 *
 * `HRM / Interview Select All`, carved out of `HRM / Interview` Read / Write the way
 * `SALES / CRM Lead Select All` was carved out of the board beside it: the tick boxes change nothing
 * by themselves, but everything they lead to is a write over a set the reader never has to look at.
 *
 * Four things can quietly come apart, and this file holds all four: the permission being in the
 * catalogue at all (a guard naming one that is not refuses everybody but a Super Admin, and says so
 * to nobody - CLAUDE.md Rule 4), the row existing in a **migration** as well (the seed cannot be run
 * on the VPS, so a catalogue-only permission never reaches production), the two bulk routes mounting
 * the guard, and the single-candidate routes deliberately *not* mounting it.
 *
 * Source text rather than a running server, like the CRM guard test beside it: no database, no
 * ports, and it fails on the edit that removes a guard rather than on the report weeks later.
 */

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");

const ROUTES = read("src", "modules", "hrm", "interview", "routes.js");
const CONTROLLER = read("src", "modules", "hrm", "interview", "controller.js");
const MIGRATION = read("prisma", "migrations", "20260921100000_interview_select_all_permission", "migration.sql");

/** The `router.<method>("<route>", ...)` line for one route, or null. */
function route(method, routePath) {
  const line = ROUTES.split("\n").find((text) => text.trimStart().startsWith(`router.${method}("${routePath}"`));
  return line ? line.trim() : null;
}

test("the permission is in the catalogue, so it can be granted at all", () => {
  const row = PERMISSIONS.find((perm) => perm.module === "HRM" && perm.feature === "Interview Select All");
  assert.ok(row, "HRM / Interview Select All is not in the catalogue");
  assert.equal(row.level, "INTERVIEW_SELECT_ALL");
});

test("a permission is one level, so the seed's upsert cannot make two rows of it", () => {
  const levels = PERMISSIONS.filter((perm) => perm.module === "HRM").map((perm) => perm.level);
  assert.equal(new Set(levels).size, levels.length, `two HRM permissions share a level: ${levels.join(", ")}`);
});

test("the same row is in a migration, or it never exists on production", () => {
  // The seed cannot be run on the VPS. A catalogue-only permission reaches a developer's machine and
  // nowhere else, and the guard naming it then refuses the entire studio but a Super Admin, silently.
  assert.match(MIGRATION, /INSERT INTO `permission`/);
  assert.match(MIGRATION, /'Interview Select All'/);
  assert.match(MIGRATION, /'INTERVIEW_SELECT_ALL'/);
  // Replayable: re-running writes nothing, and a seeded database matches rather than duplicates.
  assert.match(MIGRATION, /WHERE NOT EXISTS/);
  // And granted to SUPER_ADMIN there too - that role holds every permission there is, and one it
  // does not hold cannot be filled from Administration → Roles, which refuses to edit a system role.
  assert.match(MIGRATION, /INSERT INTO `role_permission`/);
  assert.match(MIGRATION, /`role`\.`name` = 'SUPER_ADMIN'/);
});

test("everything a selection does is guarded by Select All", () => {
  assert.match(ROUTES, /const canSelectCandidates = checkPermission\("HRM", "Interview Select All", "READ_WRITE"\)/);
  for (const [method, routePath] of [["post", "/candidates/bulk-status"], ["delete", "/candidates/bulk"]]) {
    const line = route(method, routePath);
    assert.ok(line, `${method.toUpperCase()} ${routePath} is gone`);
    assert.match(line, /canSelectCandidates/, `${method.toUpperCase()} ${routePath} no longer asks for Select All`);
  }
});

test("working the register one candidate at a time still needs only the screen's own permission", () => {
  // This is what a role without Select All keeps: moving and deleting a candidate by name. Putting
  // the guard on these too would make the new permission the price of using the screen at all.
  assert.doesNotMatch(route("patch", "/candidates/:id/status") || "", /canSelectCandidates/);
  assert.doesNotMatch(route("delete", "/candidates/:id") || "", /canSelectCandidates/);
  // Bulk Entry is adding candidates, which is the job `HRM / Interview` is granted for.
  assert.doesNotMatch(route("post", "/candidates/bulk") || "", /canSelectCandidates/);
});

test("the bulk routes sit above the ones that read an id", () => {
  // `bulk-status` read as a candidate id would 404 as a missing record rather than as a route in the
  // wrong order, which is the kind of bug that gets reported as data loss.
  const order = (needle) => ROUTES.indexOf(needle);
  assert.ok(order('router.post("/candidates/bulk-status"') < order('router.get("/candidates/:id"'));
  assert.ok(order('router.delete("/candidates/bulk"') < order('router.delete("/candidates/:id"'));
});

test("a row already gone is counted, not fatal", () => {
  // A selection of thirty where one has been deleted in another tab is twenty-nine moved and one
  // named. Only a selection where nothing at all could be acted on answers 404.
  assert.match(CONTROLLER, /missedIds\.push\(id\)/);
  assert.match(CONTROLLER, /if \(!movedIds\.length\) return res\.status\(404\)/);
  assert.match(CONTROLLER, /if \(!deletedIds\.length\) return res\.status\(404\)/);
});

test("a bulk move writes each candidate's reason against that candidate", () => {
  // Through the same `applyStatus` the row menu's single move uses, so the append rule - a candidate
  // held in March and rejected in May keeps both reasons - cannot differ between the two paths.
  assert.match(CONTROLLER, /async function applyStatus\(id, status, note, actor, \{ nextFollowUpDate \} = \{\}\)/);
  assert.match(CONTROLLER, /values\.statusNotes = \[\.\.\.held, \{\s*\n\s*status,\s*\n\s*note,\s*\n\s*at: new Date\(\)\.toISOString\(\),/);
  assert.match(CONTROLLER, /await applyStatus\(id, status, note, req\.user\)/);
});

test("the ids a selection sends are bounded and deduplicated", () => {
  assert.match(CONTROLLER, /\.min\(1, "Select at least one candidate\."\)\.max\(2000\)/);
  assert.match(CONTROLLER, /const ids = \[\.\.\.new Set\(parsed\.data\.ids\)\]/);
});
