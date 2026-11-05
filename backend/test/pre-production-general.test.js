const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { preProductionGeneralSchema } = require("../src/modules/sales/projects/controller");
const router = require("../src/modules/project-management/pre-production/routes");

/*
 * Pre Production's General panel saves under PROJECT / Pre Production: whoever may write that
 * screen may change what it shows, and nothing else of the project.
 */

test("General takes only the items it shows, with the reason for a switch", () => {
  const parsed = preProductionGeneralSchema.safeParse({
    welcomeGift: "Not Applicable",
    welcomeGiftEmployeeId: null,
    shootCompletedGift: "Applicable",
    shootCompletedGiftEmployeeId: 9,
    storageNeeded: "Yes",
    crdDocumentStatus: "Not Applicable",
    applicabilityRemarks: { welcomeGift: "Client declined" },
  });
  assert.equal(parsed.success, true);
});

test("the rest of the project is not reachable through General", () => {
  // `productionManagerEmployeeId` among them: that seat moved to Edit Project, with the other four.
  for (const field of ["initialConvertedValue", "projectManagerEmployeeId", "preProductionCoordinatorEmployeeId", "productionManagerEmployeeId", "productionServices"]) {
    assert.equal(preProductionGeneralSchema.safeParse({ [field]: 1 }).success, false, `${field} is refused`);
  }
});

test("every General route sits behind the Pre Production guard", () => {
  const layers = router.stack;
  const guard = layers.findIndex((layer) => !layer.route && layer.handle.name !== "protect" && layers.indexOf(layer) > 0);
  const routes = layers.filter((layer) => layer.route).map((layer) => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`);
  for (const route of [
    "PATCH /projects/:projectId/general",
    "PATCH /projects/:projectId/gifts/:gift/status",
    "GET /projects/:projectId/storage/:storageId",
  ]) assert.ok(routes.includes(route), `${route} is mounted`);
  /*
   * And the disk is only read here. The status route, and the vocabulary its buttons were drawn
   * from, used to let anybody with Pre Production write walk a disk through the whole Client
   * Storage flow. This board sets one status and sets it from the shoot: Hard Disk: Handed Over
   * moves a record from "Yet to Receive" to "Yet to Start" and nothing else.
   */
  for (const route of [
    "GET /storage/options",
    "PATCH /projects/:projectId/storage/:storageId/status",
  ]) assert.ok(!routes.includes(route), `${route} is not this board's`);
  assert.ok(guard > -1 && guard < layers.findIndex((layer) => layer.route), "the guard runs before any route");
  const source = fs.readFileSync(path.join(__dirname, "../src/modules/project-management/pre-production/routes.js"), "utf8");
  assert.match(source, /router\.use\(requireModule\("PROJECT", "Pre Production"\)\);/);
});

test("the save and the storage routes are scoped by the screen's own permission and project", () => {
  const controller = fs.readFileSync(path.join(__dirname, "../src/modules/project-management/pre-production/controller.js"), "utf8");
  assert.match(controller, /saveStartProjectWork\(transaction, project\.id, parsed\.data, \{ start: false, userId: req\.user\.id, permissions: req\.permission \}\)/);
  assert.match(controller, /OR: \[\{ projectId: req\.params\.projectId \}, \{ shoot: \{ projectId: req\.params\.projectId \} \}\]/);
  const projects = fs.readFileSync(path.join(__dirname, "../src/modules/sales/projects/controller.js"), "utf8");
  assert.match(projects, /projectAccessWhere\(\{ userId, forWrite: true, permissions \}\)/);
});
