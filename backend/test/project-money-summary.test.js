const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const prisma = require("../src/config/db");
const { projectMoneySummary } = require("../src/services/projectMoney");
const { projectSchedule } = require("../src/modules/accounts/scheduled-payments/service");
const { projectsPaymentsSummary } = require("../src/modules/sales/projects/payments-summary");

/*
 * The Boards' money (received, spent, still to receive) must be the Payments tab's own figures,
 * worked out for many projects at once. Read-only: it compares against whatever projects the
 * database holds.
 */
after(() => prisma.$disconnect());

test("each project's totals are the Payments tab's: cash Received and Spent, and every part not Cleared", async () => {
  const projects = await prisma.salesProject.findMany({ where: { deletedAt: null }, select: { id: true }, take: 25 });
  const summary = await projectMoneySummary(projects.map((project) => project.id));
  for (const { id } of projects) {
    const entries = await prisma.cashEntry.findMany({ where: { projectId: id, deletedAt: null }, select: { entryType: true, amount: true } });
    const sum = (type) => Math.round(entries.filter((entry) => entry.entryType === type).reduce((total, entry) => total + Number(entry.amount), 0) * 100) / 100;
    const owed = Math.round((await projectSchedule(id)).filter((payment) => payment.status !== "Cleared").reduce((total, payment) => total + payment.pending, 0) * 100) / 100;
    assert.deepEqual(summary[id], { received: sum("Received"), spent: sum("Spent"), toReceive: owed }, id);
  }
  assert.deepEqual(await projectMoneySummary([]), {});
});

test("ids are checked before anything is read", async () => {
  const call = async (ids) => {
    const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
    await projectsPaymentsSummary({ query: ids === undefined ? {} : { ids }, user: { id: 1 } }, res);
    return res;
  };
  for (const ids of [undefined, "", "a;b", "x".repeat(70), Array.from({ length: 201 }, (_, i) => `p${i}`).join(",")]) {
    assert.equal((await call(ids)).statusCode, 400, String(ids).slice(0, 20));
  }
});

test("the route sits behind the Payments tab's own guards, before /projects/:id", () => {
  const routes = fs.readFileSync(path.join(__dirname, "../src/modules/sales/projects/routes.js"), "utf8");
  const summary = routes.indexOf('router.get("/projects/payments-summary", checkPermission("ACCOUNTS", "Cash Management", "READ"), checkAnyPermission([');
  assert.ok(summary > 0, "guarded by Cash Management and a project board");
  assert.ok(summary < routes.indexOf('router.get("/projects/:id", readsTheRegister, getProject);'), "never read as an id");
  const handler = fs.readFileSync(path.join(__dirname, "../src/modules/sales/projects/payments-summary.js"), "utf8");
  assert.match(handler, /AND: \[await projectAccessWhere\(\{ userId: Number\(req\.user\.id\) \}\)\]/, "only projects in the reader's reach");
});

test("an id the reader cannot reach, or that does not exist, is left out - never reported", async () => {
  const project = await prisma.salesProject.findFirst({ where: { deletedAt: null }, select: { id: true } });
  if (!project) return;
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
  const admin = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" }, select: { id: true } });
  await projectsPaymentsSummary({ query: { ids: `${project.id},no-such-project` }, user: { id: admin.id } }, res);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.data[project.id], "a reachable project answers");
  assert.equal(res.body.data["no-such-project"], undefined, "a missing one is simply absent");
});
