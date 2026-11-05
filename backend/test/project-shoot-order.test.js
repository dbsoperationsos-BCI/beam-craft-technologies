const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * A project's Shoot List order (`project_shoot.sort_order`): written only by the reorder route and by
 * Create Project for a list dragged before saving; read only by the Shoot List forms. Every other
 * reader keeps listing shoots by date.
 */
const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");
const controller = read("src", "modules", "sales", "projects", "controller.js");
const routes = read("src", "modules", "sales", "projects", "routes.js");

test("the order is saved under the same guards as adding or editing a shoot", () => {
  assert.match(routes, /router\.put\("\/projects\/:id\/shoots\/order", plansAProject, editsAStartedProject, reorderProjectShoots\);/);
  assert.match(routes, /router\.post\("\/projects\/:id\/shoots", plansAProject, editsAStartedProject, createProjectShoots\);/);
});

test("only the caller's reachable project, only its live shoots, only sortOrder", () => {
  const body = controller.slice(controller.indexOf("async function reorderProjectShoots"), controller.indexOf("async function listServiceAllocations"));
  assert.match(body, /projectAccessWhere\(\{ userId: Number\(req\.user\.id\), forWrite: true \}\)/);
  assert.match(body, /where: \{ projectId: project\.id, deletedAt: null \}/);
  assert.match(body, /orderedDefinitionIds\(rows\.map\(\(row\) => row\.id\), parsed\.data\.ids\)/, "ids not this project's are ignored");
  assert.match(body, /data: \{ sortOrder: index \}/);
  assert.deepEqual(body.match(/data: \{[^}]*\}/g), ["data: { sortOrder: index }"], "the one write is the position - no date or Shoot ID");
});

test("a created project keeps a dragged order, and nothing else does", () => {
  assert.match(controller, /\.\.\.\(Number\.isInteger\(shootData\.sortOrder\) && shootData\.sortOrder >= 0 && shootData\.sortOrder < 1000 \? \{ sortOrder: shootData\.sortOrder \} : \{\}\)/);
  // The shoot list itself is still read by date (undated last, services/shootOrder.SHOOT_DATE_ASC); the forms put a dragged order on top.
  assert.match(controller, /async function listProjectShoots[\s\S]*?orderBy: \[\{ dateCreated: SHOOT_DATE_ASC \}, \{ createdAt: "asc" \}\]/);
});

test("the column is one nullable integer, added by a migration", () => {
  assert.match(read("prisma", "schema.prisma"), /sortOrder\s+Int\?\s+@map\("sort_order"\)/);
  assert.match(read("prisma", "migrations", "20261030100000_project_shoot_sort_order", "migration.sql"), /ALTER TABLE `project_shoot` ADD COLUMN `sort_order` INTEGER NULL;/);
});
