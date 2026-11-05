const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * The Production Manager: the fifth seat on a project, assigned on Edit Project with the other four.
 *
 * A seat is not one field. It is a column, the name copied beside it, the resolver that prefers the
 * linked employee's current name, the schema that lets the value through, and the check that whoever
 * is named is still working here. Miss one and the failure is quiet: the id saves and the name goes
 * stale, or the picker offers somebody who left.
 *
 * Source-level, so it runs without a database - the behaviour these hold together is covered by the
 * DB-backed tests once the migration is applied.
 */

const { startProjectDraftSchema } = require("../src/modules/sales/projects/controller");

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");
const SCHEMA = read("prisma", "schema.prisma");
const CONTROLLER = read("src", "modules", "sales", "projects", "controller.js");
const PRE_PRODUCTION = read("src", "modules", "project-management", "pre-production", "controller.js");
const NAME_COPIES = read("src", "services", "nameCopies.js");
const RESOLVED = read("src", "services", "resolvedNames.js");

test("the link is an id with a key and an index, and the name beside it is only a copy", () => {
  // Rule 5. The text column exists, but it is the copy - never the link.
  assert.match(SCHEMA, /productionManagerEmployeeId\s+Int\?\s+@map\("production_manager_employee_id"\)/);
  assert.match(SCHEMA, /productionManager\s+String\?\s+@map\("production_manager"\)/);
  assert.match(SCHEMA, /productionManagerEmployee\s+Employee\?\s+@relation\("SalesProjectProductionManagerEmployee", fields: \[productionManagerEmployeeId\], references: \[id\], onDelete: SetNull\)/);
  assert.match(SCHEMA, /@@index\(\[productionManagerEmployeeId\]\)/);
  // The other side of the relation, or Prisma will not load.
  assert.match(SCHEMA, /salesProjectProductionManagerEmployee\s+SalesProject\[\]\s+@relation\("SalesProjectProductionManagerEmployee"\)/);
});

test("the migration adds exactly what the schema declares", () => {
  const dir = path.join(__dirname, "..", "prisma", "migrations");
  const folder = fs.readdirSync(dir).find((name) => name.endsWith("_sales_project_production_manager"));
  assert.ok(folder, "the migration is missing - a schema change that never reaches production");
  const sql = fs.readFileSync(path.join(dir, folder, "migration.sql"), "utf8");
  assert.match(sql, /ADD COLUMN `production_manager` VARCHAR\(191\) NULL/);
  assert.match(sql, /ADD COLUMN `production_manager_employee_id` INTEGER NULL/);
  // The names Prisma itself generates, or `migrate diff` reports drift for ever after.
  assert.match(sql, /CREATE INDEX `sales_project_production_manager_employee_id_idx`/);
  assert.match(sql, /ADD CONSTRAINT `sales_project_production_manager_employee_id_fkey`[\s\S]*ON DELETE SET NULL ON UPDATE CASCADE/);
  // Nullable and no default: every project that exists has nobody in this seat, and that is an answer.
  assert.doesNotMatch(sql, /production_manager[^\n]*NOT NULL/);
});

test("a rename rewrites the copy, and a read prefers the employee's name as it stands now", () => {
  assert.match(NAME_COPIES, /exact\("salesProject", "productionManager", "project", \{ idField: "productionManagerEmployeeId" \}\)/);
  assert.match(RESOLVED, /productionManager: \["productionManagerEmployee", "employeeName"\]/);
});

test("the value is let through by name, never spread in from the body", () => {
  assert.match(CONTROLLER, /productionManager: optionalText,/);
  assert.match(CONTROLLER, /productionManagerEmployeeId: optionalPositiveInt,/);
});

test("the form it moved to may send it, and the seat is raised with the project's production rows", () => {
  /*
   * The parse, not the field list: Edit Project autosaves through `startProjectDraftSchema`, and the
   * screen it moved from refuses the same field (`pre-production-general.test.js`), so between the
   * two tests the seat has exactly one way in.
   */
  assert.equal(startProjectDraftSchema.safeParse({ productionManagerEmployeeId: 7 }).success, true);
  assert.equal(startProjectDraftSchema.safeParse({ productionManagerEmployeeId: 0 }).success, false, "not an id");
  /*
   * And the save raises the board: production rows exist once somebody is named, so the call has to
   * come after the write that names them. It used to be reached by way of Pre Production's General
   * save; now it is this form that names the seat, and nothing else would notice if the call went.
   */
  const work = CONTROLLER.slice(CONTROLLER.indexOf("async function saveStartProjectWork"));
  const body = work.slice(0, work.indexOf("\nasync function "));
  assert.match(body, /await ensureProjectProduction\(transaction, project\.id\);/);
  assert.ok(body.indexOf("ensureProjectProduction") > body.indexOf("ensureProjectPreProduction"), "after the project's own update");
});

test("whoever is named has to be an employee who still works here", () => {
  /*
   * `resolveAssignmentEmployees` is what refuses an id that is not an active employee, and what
   * writes the name copy. A seat left out of that list saves any integer the browser sends.
   */
  assert.match(CONTROLLER, /\["productionManagerEmployeeId", "productionManager"\],/);
  const block = CONTROLLER.slice(CONTROLLER.indexOf("async function resolveAssignmentEmployees"));
  const body = block.slice(0, block.indexOf("\n}\n"));
  assert.match(body, /productionManagerEmployeeId/, "the seat is not resolved, so it is never validated");
  assert.match(body, /archivedAt: null/);
});

test("being the Production Manager does not by itself grant editing the project", () => {
  /*
   * `PROJECT_STAFF_FIELDS` is an access rule, not a list of seats: whoever is named in it may edit
   * the project, and the first entry may delete it. This seat was added as an assignment only, so
   * adding it here is a deliberate widening somebody has to choose - not something that happens by
   * tidying the list to match the schema.
   */
  const list = CONTROLLER.slice(CONTROLLER.indexOf("const PROJECT_STAFF_FIELDS = ["));
  assert.doesNotMatch(list.slice(0, list.indexOf("]")), /productionManagerEmployeeId/);
});

test("the board that works to it is still given it to show", () => {
  /*
   * Pre Production reads the seat - it is a column on the board and a line in the record panel -
   * and no longer sets it: `preProductionGeneralSchema` refuses it (`pre-production-general.test.js`).
   * Selected with the linked employee, and mapped with the linked name preferred over the copy.
   */
  assert.match(PRE_PRODUCTION, /productionManagerEmployee: \{ select: \{ employeeName: true \} \},/);
  assert.match(PRE_PRODUCTION, /productionManager: project\.productionManagerEmployee\?\.employeeName \|\| project\.productionManager \|\| null,/);
  assert.match(PRE_PRODUCTION, /productionManagerEmployeeId: project\.productionManagerEmployeeId,/);
});
