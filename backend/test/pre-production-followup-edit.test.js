const test = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");
const router = require("../src/modules/project-management/pre-production/routes");
const { updateProjectFollowup, deleteProjectFollowup } = require("../src/modules/project-management/pre-production/controller");

/*
 * A pending Pre Production follow-up can be edited (its date and remarks) or deleted, under the
 * project in the URL and only while pending; both are logged on the project's Activity.
 */

const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

function stub(entries = [{ id: "f1", projectId: "p1", followupDate: new Date("2026-11-01"), remarks: "Call", doneAt: null }]) {
  const writes = [];
  const restore = [];
  const swap = (model, method, fn) => { restore.push([model, method, prisma[model][method]]); prisma[model][method] = fn; };
  const matches = (where) => entries.filter((entry) => entry.id === where.id && entry.projectId === where.projectId && (where.doneAt !== null || entry.doneAt === null));
  swap("salesProject", "findFirst", async ({ where }) => (where.id === "p1" ? { id: "p1", projectStatus: "In Progress" } : null));
  swap("projectPreProductionFollowupEntry", "updateMany", async ({ where, data }) => { const found = matches(where); found.forEach((entry) => Object.assign(entry, data)); if (found.length) writes.push(["update", data]); return { count: found.length }; });
  swap("projectPreProductionFollowupEntry", "findFirst", async ({ where }) => matches(where)[0] || null);
  swap("projectPreProductionFollowupEntry", "delete", async ({ where }) => { const index = entries.findIndex((entry) => entry.id === where.id); writes.push(["delete", where.id]); return entries.splice(index, 1)[0]; });
  swap("projectPreProductionFollowupEntry", "findMany", async () => entries.map((entry) => ({ ...entry, createdByUser: null, doneByUser: null })));
  swap("projectActivity", "create", async ({ data }) => { writes.push(["activity", data.action, data.detail]); return data; });
  return { entries, writes, restore: () => restore.reverse().forEach(([model, method, fn]) => { prisma[model][method] = fn; }) };
}

const call = async (handler, params, body) => {
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
  await handler({ params, body, user: { id: 7 } }, res);
  return res;
};

test("Edit and Delete are mounted after the Pre Production guard", () => {
  const routes = router.stack.filter((layer) => layer.route).map((layer) => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`);
  assert.ok(routes.includes("PATCH /projects/:projectId/followups/:followupId"));
  assert.ok(routes.includes("DELETE /projects/:projectId/followups/:followupId"));
});

test("a pending follow-up's date and remarks can be changed, and the change is logged", async () => {
  const fake = stub();
  try {
    const res = await call(updateProjectFollowup, { projectId: "p1", followupId: "f1" }, { followupDate: tomorrow, remarks: "Call after 5" });
    assert.equal(res.statusCode, 200);
    assert.equal(fake.entries[0].remarks, "Call after 5");
    assert.equal(fake.entries[0].followupDate.toISOString().slice(0, 10), tomorrow);
    assert.ok(fake.writes.some(([kind, action]) => kind === "activity" && action === "FOLLOWUP_EDITED"));
    // A past date is refused, as on adding one.
    assert.equal((await call(updateProjectFollowup, { projectId: "p1", followupId: "f1" }, { followupDate: "2020-01-01" })).statusCode, 400);
  } finally { fake.restore(); }
});

test("a pending follow-up can be deleted, and the deletion is logged with what it was", async () => {
  const fake = stub();
  try {
    const res = await call(deleteProjectFollowup, { projectId: "p1", followupId: "f1" });
    assert.equal(res.statusCode, 200);
    assert.equal(fake.entries.length, 0);
    const logged = fake.writes.find(([kind, action]) => kind === "activity" && action === "FOLLOWUP_DELETED");
    assert.match(logged[2], /Follow-up for 2026-11-01 removed · Call/);
  } finally { fake.restore(); }
});

test("a follow-up already done, or under another project, is neither edited nor deleted", async () => {
  const fake = stub([{ id: "f1", projectId: "p1", followupDate: new Date("2026-11-01"), remarks: null, doneAt: new Date() }]);
  try {
    assert.equal((await call(updateProjectFollowup, { projectId: "p1", followupId: "f1" }, { followupDate: tomorrow })).statusCode, 404);
    assert.equal((await call(deleteProjectFollowup, { projectId: "p1", followupId: "f1" })).statusCode, 404);
    assert.equal((await call(deleteProjectFollowup, { projectId: "p2", followupId: "f1" })).statusCode, 404);
    assert.equal(fake.entries.length, 1);
    assert.ok(!fake.writes.some(([kind]) => kind === "delete" || kind === "update"));
  } finally { fake.restore(); }
});
