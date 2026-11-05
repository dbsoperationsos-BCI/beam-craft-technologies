const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const service = require("../src/modules/client/change-requests/service");

/*
 * Client Requests -> Raised Requests: the rules a decision is held to, the shape a raise is taken in,
 * and the guards on the routes. The full flow - raise, review, decide each type, what reaches the
 * project and its Payments, the once-only decision under concurrency - runs end to end against a
 * database; these pin the parts that decide it.
 */

const source = (...parts) => fs.readFileSync(path.join(__dirname, "..", "src", ...parts), "utf8");
const item = (id, itemType, itemName = `Item ${id}`) => ({ id, itemType, itemName });
const values = (entries) => new Map(entries.map(([id, value]) => [id, { decision: null, approvedAmount: null, approvedQuantity: null, managerRemarks: null, rejectionReason: null, ...value }]));

test("the request's status follows its items' decisions", () => {
  assert.equal(service.finalStatus(["APPROVED", "APPROVED"]), "ACCEPTED");
  assert.equal(service.finalStatus(["REJECTED", "REJECTED"]), "DECLINED");
  assert.equal(service.finalStatus(["APPROVED", "REJECTED"]), "PARTIALLY_ACCEPTED");
});

test("a final decision needs every item decided, priced when approved and reasoned when rejected", () => {
  const request = { items: [item(1, "SERVICE", "Candid"), item(2, "DELIVERABLE", "Album")] };
  assert.match(service.finalProblem(request, values([[1, { decision: "APPROVED", approvedAmount: 100 }], [2, {}]])), /Album" has no decision/);
  assert.match(service.finalProblem(request, values([[1, { decision: "APPROVED" }], [2, { decision: "REJECTED", rejectionReason: "No" }]])), /approved amount for "Candid"/);
  assert.match(service.finalProblem(request, values([[1, { decision: "APPROVED", approvedAmount: 0 }], [2, { decision: "REJECTED" }]])), /reason "Album" is rejected/);
  // ₹0 is a valid approval: complimentary.
  assert.equal(service.finalProblem(request, values([[1, { decision: "APPROVED", approvedAmount: 0 }], [2, { decision: "REJECTED", rejectionReason: "Not this time" }]])), "");
});

test("a rejected shoot cannot keep an approved service or deliverable", () => {
  const request = { items: [item(1, "SHOOT", "Reception"), item(2, "SERVICE")] };
  const problem = service.finalProblem(request, values([[1, { decision: "REJECTED", rejectionReason: "No" }], [2, { decision: "APPROVED", approvedAmount: 10 }]]));
  assert.match(problem, /shoot is rejected/);
  assert.equal(service.finalProblem(request, values([[1, { decision: "REJECTED", rejectionReason: "No" }], [2, { decision: "REJECTED", rejectionReason: "No shoot" }]])), "");
});

test("rejecting an item clears its amount and quantity; approving clears the reason", () => {
  const saved = { decision: "APPROVED", approvedAmount: "500", approvedQuantity: 2, managerRemarks: "ok", rejectionReason: null };
  assert.deepEqual(service.decidedValues(saved, { decision: "REJECTED", rejectionReason: "Too late" }), { decision: "REJECTED", approvedAmount: null, approvedQuantity: null, managerRemarks: "ok", rejectionReason: "Too late" });
  assert.equal(service.decidedValues({ ...saved, decision: "REJECTED", rejectionReason: "x" }, { decision: "APPROVED", approvedAmount: 0 }).rejectionReason, null);
  // Fields the form did not send keep what was saved.
  assert.equal(service.decidedValues(saved, { managerRemarks: "changed" }).approvedAmount, 500);
});

test("a raise carries no price: amounts in the body are not part of what is taken", () => {
  const parsed = service.raiseSchema.parse({ requestType: "SERVICE", projectId: "p1", shootId: "s1", services: [{ serviceDefinitionId: "d1" }], amount: 9999, approvedAmount: 5, price: 1 });
  assert.equal("amount" in parsed || "approvedAmount" in parsed || "price" in parsed, false);
});

test("a correction needs its category and what is to be corrected", async () => {
  await assert.rejects(() => service.itemsFor({ requestType: "OTHER", correctionCategory: "Something", remarks: "x" }, { id: "p1" }), /correction category/);
  await assert.rejects(() => service.itemsFor({ requestType: "OTHER", correctionCategory: "Album correction", remarks: "" }, { id: "p1" }), /Describe the correction/);
  assert.deepEqual(await service.itemsFor({ requestType: "OTHER", correctionCategory: "Album correction", remarks: "Page 4" }, { id: "p1" }), [{ itemType: "CORRECTION", itemName: "Album correction", quantity: 1, config: null }]);
});

test("services for a shoot: each from the studio's list, none twice, none it already has, on the project's own shoot", async () => {
  const client = {
    projectServiceDefinition: { findFirst: async ({ where }) => (where.id === "gone" ? null : { id: where.id, name: `Service ${where.id}` }) },
    projectShoot: { findFirst: async ({ where }) => (where.id === "s1" && where.projectId === "p1" ? { id: "s1" } : null) },
    projectPostProductionAllocation: { findMany: async () => [{ serviceDefinitionId: "held" }] },
    projectShootDeliverable: { findMany: async () => [] },
  };
  const ask = (overrides) => service.itemsFor({ requestType: "SERVICE", shootId: "s1", services: [{ serviceDefinitionId: "a", quantity: 2 }], deliverables: [], ...overrides }, { id: "p1" }, client);
  const items = await ask({});
  assert.deepEqual(items.map((row) => [row.itemType, row.itemName, row.quantity]), [["SERVICE", "Service a", 2]]);
  await assert.rejects(() => ask({ services: [] }), /at least one service/);
  await assert.rejects(() => ask({ services: [{ serviceDefinitionId: "a" }, { serviceDefinitionId: "a" }] }), /listed twice/);
  await assert.rejects(() => ask({ services: [{ serviceDefinitionId: "gone" }] }), /no longer offered/);
  await assert.rejects(() => ask({ shootId: "other" }), /not on this project/);
  // Approving it could add nothing, so it is never asked for - and never charged for.
  await assert.rejects(() => ask({ services: [{ serviceDefinitionId: "held" }] }), /"Service held" is already on this shoot/);
});

test("a decision that could not add an approved item is refused whole, never charged", () => {
  const body = source("modules", "client", "change-requests", "service.js");
  const decide = body.slice(body.indexOf("async function decideRequest"));
  const refusal = decide.indexOf("cannot be added");
  assert.ok(refusal > 0 && refusal < decide.indexOf("recordApprovedExtra"), "the refusal comes before any extra quotation is recorded");
});

test("every route is guarded: reading and raising on Client Requests, deciding on Request Approval", () => {
  const routes = source("modules", "client", "change-requests", "routes.js");
  assert.match(routes, /router\.use\(protect\)/);
  assert.match(routes, /const reads = checkPermission\("CLIENT", "Client Requests", "READ"\)/);
  assert.match(routes, /const raises = checkPermission\("CLIENT", "Client Requests", "READ_WRITE"\)/);
  assert.match(routes, /const decides = checkPermission\("CLIENT", "Request Approval", "READ_WRITE"\)/);
  for (const route of ["patch\\(\"/:id/review\", decides", "post\\(\"/:id/decide\", decides", "post\\(\"/:id/ask\", decides", "post\\(\"/\", raises", "get\\(\"/\", reads", "get\\(\"/:id\", reads"]) {
    assert.match(routes, new RegExp(`router\\.${route}`));
  }
  // No role check decides access inside the module.
  assert.doesNotMatch(source("modules", "client", "change-requests", "service.js") + source("modules", "client", "change-requests", "controller.js"), /role\s*===\s*"SUPER_ADMIN"/);
});

test("a decision locks the request with its first read, so a second one finds it decided", () => {
  const body = source("modules", "client", "change-requests", "service.js");
  const lock = body.slice(body.indexOf("async function lockForWrite"));
  const firstRead = lock.indexOf("await tx.");
  assert.ok(lock.slice(firstRead).startsWith("await tx.$queryRaw`SELECT id, status, version FROM project_change_request WHERE id = ${Number(id) || 0} FOR UPDATE`"));
  assert.match(lock, /FINAL_STATUSES\.includes\(locked\.status\)/);
});

test("the permission ships in a migration as well as the catalogue, granted to SUPER_ADMIN only", () => {
  const catalogue = require("../prisma/seeds/permission-catalogue");
  const list = catalogue.PERMISSIONS || catalogue;
  assert.ok(list.some((row) => row.module === "CLIENT" && row.feature === "Request Approval" && row.level === "CLIENT_REQUEST_APPROVE"));
  const sql = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20261104150000_project_change_requests", "migration.sql"), "utf8");
  assert.match(sql, /'CLIENT', 'Request Approval', 'CLIENT_REQUEST_APPROVE'/);
  assert.match(sql, /WHERE `role`\.`name` = 'SUPER_ADMIN'/);
  assert.equal((sql.match(/`role`\.`name` =/g) || []).length, 1);
});

test("approved rows are Sale Extras baseline, so the extra quotation is the only place they are priced", () => {
  const projects = source("modules", "sales", "projects", "controller.js");
  const apply = projects.slice(projects.indexOf("async function applyRequestedPlan"), projects.indexOf("async function updateDeliverableAllocation"));
  assert.match(apply, /baselineFor\(true, "SERVICE", row\)/);
  assert.match(apply, /baselineFor\(true, "DELIVERABLE", row\)/);
  assert.match(apply, /baselineFor\(true, "SHOOT"\)/);
  assert.match(apply, /Already on the shoot/);
});
