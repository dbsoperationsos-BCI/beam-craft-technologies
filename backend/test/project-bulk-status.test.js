const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { bulkStatusSchema } = require("../src/modules/sales/projects/controller");

/*
 * Projects → Update status over the ticked projects. Only the projects are written - never a shoot.
 */
test("the bulk status takes ids and one of the project statuses, nothing else", () => {
  assert.equal(bulkStatusSchema.safeParse({ ids: ["a", "b"], status: "Completed" }).success, true);
  assert.equal(bulkStatusSchema.safeParse({ ids: ["a"], status: "Delivered" }).success, false, "an old status is never given again");
  assert.equal(bulkStatusSchema.safeParse({ ids: ["a"], status: "On Hold" }).success, true);
  assert.equal(bulkStatusSchema.safeParse({ ids: [], status: "Completed" }).success, false);
  assert.equal(bulkStatusSchema.safeParse({ ids: ["a"], status: "Planned" }).success, false, "not a project status");
  assert.equal(bulkStatusSchema.safeParse({ ids: ["a"], status: "Completed", projectManagerEmployeeId: 3 }).success, false, "nothing else is written");
});

test("the route plans projects and sits above /projects/:id", () => {
  const routes = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "projects", "routes.js"), "utf8");
  assert.match(routes, /router\.post\("\/projects\/bulk-status", plansAProject, bulkUpdateProjectStatus\);/);
  assert.ok(routes.indexOf('"/projects/bulk-status"') < routes.indexOf('router.delete("/projects/:id"'));
  const controller = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "projects", "controller.js"), "utf8");
  const handler = controller.slice(controller.indexOf("async function bulkUpdateProjectStatus("), controller.indexOf("async function deleteProject("));
  // Each project in the caller's own reach, and theirs to change once started.
  assert.match(handler, /projectAccessWhere\(\{ userId, forWrite: true \}\)/);
  assert.match(handler, /await mayEditStartedProject\(project, req\.user\)/);
  // The shoots are left as they are.
  assert.doesNotMatch(handler, /projectProduction|projectPreProduction|finishProduction/);
});
