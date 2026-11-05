const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { logProjectActivity, listProjectActivity, logAfterSuccess } = require("../src/services/projectActivity");

/*
 * The Activity tab of a project on Projects and Pre Production: every change made from either,
 * written beside the change, read back newest first.
 */
test("a line is written for a known screen, and never fails the change it describes", async () => {
  const written = [];
  const client = { projectActivity: { create: async ({ data }) => { written.push(data); return data; } } };
  await logProjectActivity({ projectId: "p1", shootId: "s1", area: "PRE_PRODUCTION", action: "SHOOT_SAVED", detail: " Shoot details saved ", userId: "4" }, { client });
  assert.deepEqual(written[0], { projectId: "p1", shootId: "s1", area: "PRE_PRODUCTION", action: "SHOOT_SAVED", detail: "Shoot details saved", userId: 4 });
  assert.equal(await logProjectActivity({ projectId: "p1", area: "ACCOUNTS", action: "X" }, { client }), null, "only the two screens");
  const failing = { projectActivity: { create: async () => { throw new Error("db down"); } } };
  assert.equal(await logProjectActivity({ projectId: "p1", area: "PROJECT", action: "X" }, { client: failing }), null, "a log that cannot be written is not the change failing");
});

test("a project's activity is one screen's, newest first, each line with its shoot and who", async () => {
  let asked;
  const client = { projectActivity: { findMany: async (args) => { asked = args; return [{ id: "a1", action: "STATUS_CHANGED", detail: "Status set to WCR", createdAt: new Date(), user: { name: "Priya" }, shoot: { shootId: "DBS-SID-1", shoot: "Wedding" } }]; } } };
  const rows = await listProjectActivity({ projectId: "p1", area: "PRE_PRODUCTION" }, { client });
  assert.deepEqual(asked.where, { projectId: "p1", area: "PRE_PRODUCTION" });
  assert.deepEqual(asked.orderBy, { createdAt: "desc" });
  assert.equal(rows[0].shoot, "DBS-SID-1 - Wedding");
  assert.equal(rows[0].by, "Priya");
});

test("a shared handler is logged by its route only on success", () => {
  const calls = [];
  const res = { statusCode: 200, json: (body) => { calls.push(body); return body; } };
  logAfterSuccess({ area: "PRE_PRODUCTION", action: "X", describe: () => "d" })({ params: { projectId: "p" }, user: { id: 1 } }, res, () => {});
  assert.deepEqual(res.json({ ok: true }), { ok: true }, "the answer is passed through untouched");
});

test("every Projects and Pre Production write logs, and each screen reads its own", () => {
  const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", "src", "modules", ...parts), "utf8");
  const projects = read("sales", "projects", "controller.js");
  for (const action of ["PROJECT_CREATED", "SALE_EDITED", "PROJECT_SAVED", "STATUS_CHANGED", "SHOOTS_ADDED", "SHOOT_EDITED", "SHOOT_REMOVED", "SERVICE_ADDED", "DELIVERABLE_REMOVED", "ADVANCE_RECORDED"]) {
    assert.match(projects, new RegExp(`area: "PROJECT",\\s*action: "${action}"`), action);
  }
  const pre = read("project-management", "pre-production", "controller.js");
  for (const action of ["SHOOT_SAVED", "STATUS_CHANGED", "FOLLOWUP_ADDED", "FOLLOWUP_DONE", "GENERAL_SAVED"]) {
    assert.match(pre, new RegExp(`area: "PRE_PRODUCTION",\\s*action: "${action}"`), action);
  }
  assert.match(read("project-management", "pre-production", "routes.js"), /router\.get\("\/projects\/:projectId\/activity", controller\.listProjectActivity\);/);
  assert.match(read("sales", "projects", "routes.js"), /router\.get\("\/projects\/:id\/activity", readsTheRegister, getProjectActivity\);/);
  // Both answer with the project's whole flow, each stage under its own permission.
  assert.match(read("sales", "projects", "paymentSchedule.js"), /buildProjectFlow\(\{ projectId: project\.id, userId: req\.user\.id \}\)/);
  assert.match(read("project-management", "pre-production", "controller.js"), /buildProjectFlow\(\{ projectId: project\.id, userId \}\)/);
});
