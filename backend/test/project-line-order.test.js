const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const prisma = require("../src/config/db");
const { reorderServiceAllocations } = require("../src/modules/sales/projects/controller");

/*
 * A project's service and deliverable lines are put in order, shoot by shoot, by dragging a row on
 * Create Project, Edit Sale Details and Start / Edit Project - the grip the Quotation Generator has.
 * The order is the line's `sortOrder`; a line nobody has dragged is NULL and keeps the order it was
 * added in, after the ones that were.
 */

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");
const controller = read("src", "modules", "sales", "projects", "controller.js");
const bodyOf = (name) => {
  const start = controller.indexOf(`async function ${name}(`);
  return controller.slice(start, controller.indexOf("\n}\n", start));
};

test("every list of a project's lines reads the dragged order first, then the order they were added in", () => {
  // The shoot's day first - a shoot with no date after the dated ones (`SHOOT_DATE_ASC`).
  assert.match(controller, /const PROJECT_LINE_ORDER = \[\{ shoot: \{ dateCreated: SHOOT_DATE_ASC \} \}, \{ sortOrder: \{ sort: "asc", nulls: "last" \} \}, \{ createdAt: "asc" \}\];/);
  for (const name of ["listServiceAllocations", "listDeliverableAllocations", "listProductionDeliverables"]) {
    assert.match(bodyOf(name), /orderBy: PROJECT_LINE_ORDER/, name);
  }
  assert.doesNotMatch(controller, /orderBy: \[\{ shoot: \{ dateCreated: "asc" \} \}, \{ createdAt: "asc" \}\]/);
});

test("a project created from the form keeps its lines in the order they were sent", () => {
  assert.match(controller, /for \(const \[serviceIndex, service\] of services\.entries\(\)\)/);
  assert.match(controller, /sortOrder: serviceIndex,/);
  assert.match(controller, /for \(const \[deliverableIndex, deliverable\] of deliverables\.entries\(\)\)/);
  assert.match(controller, /sortOrder: deliverableIndex,/);
});

test("the order is written only for the shoot named, by the rule the Settings lists reorder by", () => {
  const helper = controller.slice(controller.indexOf("function lineReorder("), controller.indexOf("const reorderServiceAllocations"));
  assert.match(helper, /definitionOrderSchema\.safeParse/);
  assert.match(helper, /findProjectShoot\(prisma, req\.params\.id, req\.params\.shootId\)/);
  assert.match(helper, /where: \{ projectId: shoot\.projectId, shootId: shoot\.id, deletedAt: null \}/);
  assert.match(helper, /orderedDefinitionIds\(/);
  assert.match(helper, /data: \{ sortOrder: index \}/);
});

test("the order routes sit behind the same guards as editing a line", () => {
  const routes = read("src", "modules", "sales", "projects", "routes.js");
  for (const kind of ["service", "deliverable"]) {
    const name = `reorder${kind[0].toUpperCase()}${kind.slice(1)}Allocations`;
    assert.ok(routes.includes(`router.put("/projects/:id/shoots/:shootId/${kind}-allocations/order", plansAProject, editsAStartedProject, ${name});`), kind);
  }
});

test("the migration only adds two nullable columns, so no saved line moves", () => {
  const sql = read("prisma", "migrations", "20261029090000_project_line_sort_order", "migration.sql");
  const statements = sql.split("\n").filter((line) => !line.startsWith("--") && line.trim()).join("\n");
  assert.equal(statements, "ALTER TABLE `project_post_production_allocation` ADD COLUMN `sort_order` INT NULL;\nALTER TABLE `project_shoot_deliverable` ADD COLUMN `sort_order` INT NULL;");
});

/*
 * The handler itself, over a stubbed client: the shoot is looked up on the project in the URL, and
 * only that shoot's live lines are ever written - whatever ids the body carries.
 */
function stubbed(t, { shoot = { id: "s1", projectId: "p1" }, lines = ["a", "b", "c"] } = {}) {
  const writes = [];
  const seen = {};
  // Assigned rather than `t.mock.method`: the client's model methods are proxies it cannot see.
  const stub = (target, name, fn) => {
    const original = target[name];
    target[name] = fn;
    t.after(() => { target[name] = original; });
  };
  stub(prisma.projectShoot, "findFirst", async ({ where }) => { seen.shootWhere = where; return shoot; });
  stub(prisma.projectPostProductionAllocation, "findMany", async ({ where }) => { seen.lineWhere = where; return lines.map((id) => ({ id })); });
  stub(prisma.projectPostProductionAllocation, "update", (args) => { writes.push(args); return args; });
  stub(prisma, "$transaction", async (operations) => operations);
  stub(prisma.projectActivity, "create", async () => null);
  return { writes, seen };
}

function call(handler, { params = { id: "p1", shootId: "s1" }, body } = {}) {
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
  return handler({ params, body, user: { id: 1 } }, res).then(() => res);
}

test("a shoot that is not on the project in the URL is refused, and nothing is written", async (t) => {
  const { writes, seen } = stubbed(t, { shoot: null });
  const res = await call(reorderServiceAllocations, { params: { id: "p1", shootId: "other" }, body: { ids: ["a"] } });
  assert.equal(res.statusCode, 404);
  assert.deepEqual(seen.shootWhere, { id: "other", projectId: "p1", deletedAt: null });
  assert.equal(writes.length, 0);
});

test("a body without an ids array is refused, and nothing is written", async (t) => {
  const { writes } = stubbed(t);
  for (const body of [undefined, {}, { ids: "a,b" }]) {
    const res = await call(reorderServiceAllocations, { body });
    assert.equal(res.statusCode, 400);
  }
  assert.equal(writes.length, 0);
});

test("only this shoot's live lines are written - a foreign or repeated id is dropped, a line left out keeps its place after", async (t) => {
  const { writes, seen } = stubbed(t);
  const res = await call(reorderServiceAllocations, { body: { ids: ["c", "x-from-another-shoot", "a", "a"] } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(seen.lineWhere, { projectId: "p1", shootId: "s1", deletedAt: null });
  assert.deepEqual(writes.map((write) => [write.where.id, write.data.sortOrder]), [["c", 0], ["a", 1], ["b", 2]]);
});
