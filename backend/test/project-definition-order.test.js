const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DEFINITION_ORDER, orderedDefinitionIds, definitionOrderSchema } = require("../src/modules/sales/projects/controller");

/*
 * Settings → Project → Services and Deliverables are put in order by dragging a row. The order is
 * the rows' `sortOrder`, which every list of them now reads first.
 */

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");

test("the order sent is written, and a row it left out keeps its place after the rest", () => {
  assert.deepEqual(orderedDefinitionIds(["a", "b", "c"], ["c", "a", "b"]), ["c", "a", "b"]);
  // Added by somebody else after this list was read: not lost, not moved ahead of the order sent.
  assert.deepEqual(orderedDefinitionIds(["a", "b", "c", "d"], ["b", "a"]), ["b", "a", "c", "d"]);
});

test("an id that is not an active row, or one sent twice, cannot add or duplicate a row", () => {
  assert.deepEqual(orderedDefinitionIds(["a", "b"], ["x", "b", "b", "a"]), ["b", "a"]);
  assert.equal(definitionOrderSchema.safeParse({ ids: "a,b" }).success, false);
  assert.equal(definitionOrderSchema.safeParse({ ids: [""] }).success, false);
  assert.equal(definitionOrderSchema.safeParse({ ids: ["a", "b"] }).success, true);
});

test("every list of services and deliverables reads the order first, the name only as a tie-break", () => {
  assert.deepEqual(DEFINITION_ORDER, [{ sortOrder: "asc" }, { name: "asc" }]);
  const controller = read("src", "modules", "sales", "projects", "controller.js");
  for (const name of ["listServiceDefinitions", "listDeliverableDefinitions"]) {
    const body = controller.slice(controller.indexOf(`async function ${name}(`), controller.indexOf("\n}\n", controller.indexOf(`async function ${name}(`)));
    assert.match(body, /orderBy: DEFINITION_ORDER/, name);
  }
  const calculator = read("src", "modules", "sales", "quotation-calculator", "controller.js");
  const catalogue = calculator.slice(calculator.indexOf("async function catalogue("));
  assert.equal((catalogue.slice(0, 2000).match(/orderBy: DEFINITION_ORDER/g) || []).length, 2, "the calculator's catalogue");
  const extras = read("src", "modules", "sales", "extra-quotations", "controller.js");
  assert.match(extras, /projectServiceDefinition\.findMany\(\{ where: \{ isActive: true \}, orderBy: DEFINITION_ORDER,/, "Extra Quotation's services");
  // Nothing else in the code lists them by name alone any more.
  for (const file of [controller, calculator, extras]) {
    assert.doesNotMatch(file, /project(Service|Deliverable)Definition\.findMany\(\{[^)]*orderBy: \[\{ name: "asc" \}\]/);
  }
});

test("a restored row comes back at the end of the list, as a new one is made", () => {
  const controller = read("src", "modules", "sales", "projects", "controller.js");
  assert.equal((controller.match(/data: \{ name, code, isActive: true, sortOrder: \(max\._max\.sortOrder \|\| 0\) \+ 1 \}/g) || []).length, 2);
});

test("the order routes are written behind the same permission as every other edit, before /:definitionId", () => {
  const routes = read("src", "modules", "sales", "projects", "routes.js");
  for (const kind of ["service", "deliverable"]) {
    const order = routes.indexOf(`router.put("/${kind}-definitions/order", projectPlan,`);
    assert.ok(order > 0, kind);
    assert.ok(order < routes.indexOf(`router.patch("/${kind}-definitions/:definitionId"`), `${kind}: before the id route`);
  }
});

test("the migration only numbers the rows by name, so nothing moves until somebody drags it", () => {
  const sql = read("prisma", "migrations", "20261026130000_project_definition_order_from_names", "migration.sql");
  const statements = sql.split("\n").filter((line) => !line.startsWith("--")).join("\n");
  assert.equal((statements.match(/^UPDATE /gm) || []).length, 2);
  assert.match(statements, /ROW_NUMBER\(\) OVER \(ORDER BY `name`, `id`\)/);
  assert.doesNotMatch(statements, /ALTER|DROP|DELETE|INSERT|CREATE/i);
});
