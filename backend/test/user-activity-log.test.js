const test = require("node:test");
// CI has no .env: the tokens these tests sign, and sign-in itself, need a secret - a test-only one
// where none is set, as the other HTTP tests do.
process.env.JWT_SECRET = process.env.JWT_SECRET || "user-activity-log-test-secret";
const { after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const express = require("express");
const prisma = require("../src/config/db");
const { PERMISSIONS } = require("../prisma/seeds/permission-catalogue");
const { PREFIXES } = require("../scripts/clear-test-fixtures");
const log = require("../src/services/activityLog");
const { parseListQuery } = require("../src/modules/admin/activity-logs/controller");
const service = require("../src/modules/admin/activity-logs/service");

/*
 * Administration → User Activity Logs: how a request becomes a line, what is left out, how the
 * list is filtered, and that the endpoint answers to its own permission. The DB suite at the end
 * owns the `TAL-` prefix (scripts/clear-test-fixtures.js).
 */

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");
const STAMP = Date.now().toString(36);
const tag = (name) => `TAL-${STAMP}-${name}`;

// ─── Utility names ─────────────────────────────────────────────────────────────────────────────

test("the utility name comes from the route", () => {
  assert.equal(log.moduleNameFor("/api/sales/crm-leads/:id"), "Sales · CRM Leads");
  assert.equal(log.moduleNameFor("/api/hrm/attendance"), "HRM · Attendance");
  assert.equal(log.moduleNameFor("/api/admin/users/:id/roles"), "Admin · Users");
  assert.equal(log.moduleNameFor("/api/admin/activity-logs"), "Admin · User Activity Logs");
  assert.equal(log.moduleNameFor("/api/sales/whatsapp-chat/leads/:id/messages"), "Sales · WhatsApp Chat");
  assert.equal(log.moduleNameFor("/api/project-management/feedback"), "Project Management · Feedback");
  assert.equal(log.moduleNameFor("/api/image-selection/projects/:param/gallery"), "Image Selection · Gallery");
  assert.equal(log.moduleNameFor("/api/assets/:id"), "Assets");
  assert.equal(log.moduleNameFor("/api/ai-feature/events/:eventId"), "AI Feature");
  assert.equal(log.moduleNameFor("/api/auth/login"), "Auth");
  assert.equal(log.moduleNameFor("/api/user/profile"), "My Profile");
  // A namespace whose next segment is a value still names the namespace.
  assert.equal(log.moduleNameFor("/api/sales/:param"), "Sales");
  assert.equal(log.moduleNameFor("/api"), "Application");
});

// ─── Pattern and action, through a real Express app ────────────────────────────────────────────

/** Runs one request through an app shaped like server.js and answers the line it would write. */
async function lineFor(url, { method = "POST", user = { id: 7 }, setup }) {
  const app = express();
  let line;
  app.use((req, res, next) => {
    res.on("finish", () => { line = log.entryForRequest(req, res, Date.now()); });
    next();
  });
  app.use((req, _res, next) => { if (user) req.user = user; next(); });
  setup(app);
  app.use((error, _req, res, _next) => res.status(500).json({ message: error.message }));
  const server = app.listen(0);
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address();
    await new Promise((resolve, reject) => {
      const request = http.request({ port, path: url, method, headers: { "user-agent": "node-test" } }, (res) => { res.resume(); res.on("end", resolve); });
      request.on("error", reject);
      request.end();
    });
    // `finish` fires before the client's `end`, but give it the tick it may need.
    await new Promise((resolve) => setImmediate(resolve));
    return line;
  } finally {
    server.close();
  }
}

test("a request is recorded as its route pattern and its handler's name - never its ids or query", async () => {
  const line = await lineFor("/api/sales/crm-leads/ENQ-0042?search=secret&token=abc", {
    method: "PUT",
    setup(app) {
      const router = express.Router();
      router.put("/:id", function updateLead(_req, res) { res.json({}); });
      app.use("/api/sales/crm-leads", router);
    },
  });
  assert.equal(line.path, "/api/sales/crm-leads/:id");
  assert.equal(line.action, "updateLead");
  assert.equal(line.module, "Sales · CRM Leads");
  assert.equal(line.method, "PUT");
  assert.equal(line.statusCode, 200);
  assert.equal(line.userId, 7);
  assert.equal(line.userAgent, "node-test");
  assert.ok(!JSON.stringify(line).includes("secret") && !JSON.stringify(line).includes("0042"));
});

test("a parameter in the mount path is written as a parameter too", async () => {
  const line = await lineFor("/api/image-selection/projects/42/gallery", {
    setup(app) {
      const router = express.Router({ mergeParams: true });
      router.get("/", function listImages(_req, res) { res.json({}); });
      app.use("/api/image-selection/projects/:projectId/gallery", router);
    },
  });
  // POST is not a route here, so nothing matched: only the mount depth is kept.
  assert.equal(line.path, "/api/image-selection/projects");
  assert.equal(line.statusCode, 404);
});

test("an unmatched URL keeps only its mount: nothing past it, whatever it looks like", async () => {
  assert.equal((await lineFor("/api/sales/someone.else@example.com/janedoe", { setup() {} })).path, "/api/sales");
  assert.equal((await lineFor("/api/sales/crm-leads/janedoe/secret-slug", { setup() {} })).path, "/api/sales/crm-leads");
  assert.equal((await lineFor("/api/assets/janedoe", { setup() {} })).path, "/api/assets");
});

test("an address is stored as an address: IPv4-mapped IPv6 unwrapped, anything else not stored", () => {
  assert.equal(log.storedIp({ ip: "::ffff:10.0.0.4", headers: {} }), "10.0.0.4");
  assert.equal(log.storedIp({ ip: "::1", headers: {} }), "::1");
  assert.equal(log.storedIp({ ip: "203.0.113.9", headers: {} }), "203.0.113.9");
  assert.equal(log.storedIp({ ip: "not-an-address<script>", headers: {} }), null);
});

test("the pattern survives a handler that fails through next(error), and an anonymous handler is named by method and path", async () => {
  const line = await lineFor("/api/admin/users/12", {
    method: "DELETE",
    setup(app) {
      const router = express.Router();
      router.delete("/users/:id", (_req, _res, next) => next(new Error("boom")));
      app.use("/api/admin", router);
    },
  });
  assert.equal(line.path, "/api/admin/users/:id");
  assert.equal(line.statusCode, 500);
  assert.equal(line.module, "Admin · Users");
  assert.equal(line.action, "DELETE /api/admin/users/:id");
});

test("nobody signed in, nothing outside /api, no read and no heartbeat is recorded - only what somebody did", async () => {
  const setup = (app) => {
    app.get("/api/hrm/employees", function listEmployees(_req, res) { res.json({}); });
    app.post("/uploads/x", (_req, res) => res.end());
    app.post("/api/usage/heartbeat", function heartbeat(_req, res) { res.json({}); });
    app.post("/api/hrm/employees", function createEmployee(_req, res) { res.json({}); });
  };
  // Opening a screen is reads; moving between two screens used to write a dozen lines.
  for (const method of ["GET", "HEAD", "OPTIONS"]) {
    assert.equal(await lineFor("/api/hrm/employees", { method, setup }), null, method);
  }
  assert.equal(await lineFor("/api/hrm/employees", { user: null, setup }), null);
  assert.equal(await lineFor("/uploads/x", { setup }), null);
  assert.equal(await lineFor("/api/usage/heartbeat", { setup }), null);
  const line = await lineFor("/api/hrm/employees", { setup });
  assert.equal(line.action, "createEmployee");
  assert.deepEqual([...log.RECORDED_METHODS], ["POST", "PUT", "PATCH", "DELETE"]);
});

test("the skip list holds the writes that are background noise, and nothing a person does", () => {
  for (const [method, pattern] of [
    ["POST", "/api/usage/heartbeat"],
    ["GET", "/api/health"],
    ["POST", "/api/health/email"],
  ]) assert.ok(log.isSkipped(method, pattern), `${method} ${pattern} should be skipped`);

  for (const [method, pattern] of [
    ["POST", "/api/notifications/:id/read"],
    ["POST", "/api/sales/crm-meetings"],
    ["POST", "/api/sales/whatsapp-chat/leads/:id/messages"],
    ["POST", "/api/ai-feature/events/:eventId/processing/retry-failed"],
    ["PUT", "/api/user/profile"],
    ["PUT", "/api/user/preferences/:key"],
    ["POST", "/api/user/change-password"],
    ["DELETE", "/api/admin/users/:id"],
  ]) assert.ok(!log.isSkipped(method, pattern), `${method} ${pattern} should be recorded`);
});

test("the status text is the HTTP reason phrase", () => {
  assert.equal(log.statusTextFor(200), "OK");
  assert.equal(log.statusTextFor(204), "No Content");
  assert.equal(log.statusTextFor(307), "Temporary Redirect");
  assert.equal(log.statusTextFor(404), "Not Found");
  assert.equal(log.statusTextFor(0), "");
});

test("retention defaults to 186 days - six calendar months at their longest - and reads ACTIVITY_LOG_RETENTION_DAYS", () => {
  const saved = process.env.ACTIVITY_LOG_RETENTION_DAYS;
  try {
    delete process.env.ACTIVITY_LOG_RETENTION_DAYS;
    assert.equal(log.retentionDays(), 186);
    process.env.ACTIVITY_LOG_RETENTION_DAYS = "30";
    assert.equal(log.retentionDays(), 30);
    process.env.ACTIVITY_LOG_RETENTION_DAYS = "nonsense";
    assert.equal(log.retentionDays(), 186);
  } finally {
    if (saved === undefined) delete process.env.ACTIVITY_LOG_RETENTION_DAYS;
    else process.env.ACTIVITY_LOG_RETENTION_DAYS = saved;
  }
});

// ─── Filters ───────────────────────────────────────────────────────────────────────────────────

test("the query string is parsed with defaults and limits", () => {
  const plain = parseListQuery({});
  assert.ok(plain.success);
  assert.deepEqual(
    { page: plain.data.page, pageSize: plain.data.pageSize, sortBy: plain.data.sortBy, sortOrder: plain.data.sortOrder },
    { page: 1, pageSize: 50, sortBy: "createdAt", sortOrder: "desc" },
  );
  assert.equal(plain.data.username, undefined, "a blank filter is no filter");

  const full = parseListQuery({ from: "2026-10-01T00:00:00.000Z", to: "2026-10-02T00:00:00.000Z", method: "post", username: "  ravi ", page: "3", pageSize: "200", sortBy: "statusCode", sortOrder: "asc", status: "Not Found" });
  assert.ok(full.success);
  assert.equal(full.data.method, "POST");
  assert.equal(full.data.username, "ravi");
  assert.ok(full.data.from instanceof Date);
  assert.equal(full.data.page, 3);
  assert.equal(full.data.pageSize, 200);

  assert.equal(parseListQuery({ pageSize: "201" }).success, false, "pageSize is capped at 200");
  assert.equal(parseListQuery({ sortBy: "password" }).success, false, "only the listed columns sort");
  assert.equal(parseListQuery({ from: "yesterday-ish" }).success, false);
  assert.equal(parseListQuery({ from: "2026-10-02", to: "2026-10-01" }).success, false, "from after to");
  assert.equal(parseListQuery({ username: "", module: "" }).success, true);
  const { MAX_DEPTH } = require("../src/modules/admin/activity-logs/controller");
  assert.equal(MAX_DEPTH, 10000);
});

test("a status filter matches the code or the reason phrase", () => {
  assert.deepEqual(service.statusCodesFor("404"), { equals: 404 });
  assert.deepEqual(service.statusCodesFor("4"), { gte: 400, lt: 500 });
  assert.deepEqual(service.statusCodesFor("20"), { gte: 200, lt: 210 });
  assert.deepEqual(service.statusCodesFor("OK"), { in: [200] });
  assert.ok(service.statusCodesFor("not found").in.includes(404));
  assert.equal(service.statusCodesFor("teapots and kettles"), null);
  assert.equal(service.statusCodesFor(""), undefined);
  // A status that matches nothing is no lines at all, not every line.
  assert.equal(service.whereFor({}, { status: "teapots and kettles" }), null);
});

test("the where clause stays inside the branch scope and filters by contains", () => {
  const where = service.whereFor({ branchId: { in: [3] } }, { username: "ravi", module: "CRM", method: "GET", clientIp: "10.0" });
  assert.deepEqual(where.AND[0], { branchId: { in: [3] } });
  assert.ok(where.AND.some((part) => part.module?.contains === "CRM"));
  assert.ok(where.AND.some((part) => part.method === "GET"));
  assert.ok(where.AND.some((part) => part.clientIp?.contains === "10.0"));
  assert.ok(where.AND.some((part) => Array.isArray(part.OR) && part.OR[0].username.contains === "ravi"));
});

test("a typed name is matched word by word, in any order (Word Chunk Search)", () => {
  const where = service.whereFor({}, { username: "kumar ravi" });
  const names = where.AND.filter((part) => Array.isArray(part.OR) && part.OR[0].username).map((part) => part.OR[0].username.contains);
  assert.deepEqual(names, ["kumar", "ravi"]);
  assert.equal(where.AND.filter((part) => Array.isArray(part.OR) && part.OR[1].user.is.name.contains === "ravi").length, 1);
});

// ─── Access ────────────────────────────────────────────────────────────────────────────────────

test("the endpoint answers to ADMIN / User Activity Logs, which exists in the catalogue and the migration", () => {
  const routes = read("src", "modules", "admin", "activity-logs", "routes.js");
  assert.match(routes, /router\.use\(protect\)/);
  assert.match(routes, /router\.use\(requireModule\("ADMIN", "User Activity Logs"\)\)/);
  assert.ok(!/req\.user\.role/.test(read("src", "modules", "admin", "activity-logs", "controller.js")), "a role check below the guard");
  assert.deepEqual(service.PERMISSION, { module: "ADMIN", feature: "User Activity Logs" });

  const row = PERMISSIONS.find((permission) => permission.module === "ADMIN" && permission.feature === "User Activity Logs");
  assert.ok(row, "the catalogue has no User Activity Logs row");
  assert.equal(row.level, "USER_ACTIVITY_LOGS");
  const migration = read("prisma", "migrations", "20261020100000_user_activity_log", "migration.sql");
  assert.match(migration, /'ADMIN', 'User Activity Logs', 'USER_ACTIVITY_LOGS'/);
  assert.match(migration, /WHERE NOT EXISTS/);
  assert.match(migration, /`role`\.`name` = 'SUPER_ADMIN'/);
  // SUPER_ADMIN and nobody else.
  assert.equal((migration.match(/INSERT INTO `role_permission`/g) || []).length, 1);
  assert.ok(!/BRANCH_ADMIN|'ADMIN'\s*AND\s*`role`/.test(migration));
});

test("the router is mounted ahead of the admin router, and the recorder ahead of every router", () => {
  const server = read("src", "server.js");
  const mine = server.indexOf('app.use("/api/admin/activity-logs", adminActivityLogRoutes)');
  const admin = server.indexOf('app.use("/api/admin", adminRoutes)');
  assert.ok(mine !== -1 && mine < admin, "/api/admin/activity-logs must be matched before /api/admin");
  const recorder = server.indexOf("app.use(activityLog)");
  assert.ok(recorder !== -1 && recorder < server.indexOf('app.use("/api/auth"'), "the recorder must run before the routers");
  assert.match(server, /startActivityLogRetention\(\)/);
});

test("an unauthenticated request is refused before the permission is asked", async () => {
  const app = express();
  app.use("/api/admin/activity-logs", require("../src/modules/admin/activity-logs/routes"));
  const server = app.listen(0);
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const status = await new Promise((resolve, reject) => {
      http.get({ port: server.address().port, path: "/api/admin/activity-logs" }, (res) => { res.resume(); resolve(res.statusCode); }).on("error", reject);
    });
    assert.equal(status, 401);
  } finally {
    server.close();
  }
});

// ─── Against the database ──────────────────────────────────────────────────────────────────────

test("the TAL- prefix is registered for the fixture sweep", () => {
  assert.ok(PREFIXES.includes("TAL-"));
});

const F = {};
const PASSWORD = "Tal-Activity-1!";

after(async () => {
  await prisma.userActivityLog.deleteMany({ where: { OR: [{ username: { startsWith: `TAL-${STAMP}` } }, { username: { startsWith: `tal-${STAMP}` } }, { userAgent: `TAL-${STAMP}` }] } }).catch(() => {});
  // The desktop session the sign-out test makes goes with its user (`onDelete: Cascade`).
  await prisma.userRole.deleteMany({ where: { role: { name: { startsWith: `TAL-${STAMP}` } } } }).catch(() => {});
  await prisma.role.deleteMany({ where: { name: { startsWith: `TAL-${STAMP}` } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { email: { startsWith: `tal-${STAMP}` } } }).catch(() => {});
  await prisma.branch.deleteMany({ where: { code: { startsWith: `TAL-${STAMP}` } } }).catch(() => {});
  await prisma.$disconnect();
});

const makeUser = (name, extra = {}) => prisma.user.create({
  data: { name, email: `${tag(name)}@test.local`.toLowerCase(), username: tag(name).toLowerCase(), password: "x", role: "EMPLOYEE", ...extra },
});

/** A role granting one permission at READ in the given branches, held by `user`. */
async function grant(user, { module, feature }, branchIds, name) {
  const permission = await prisma.permission.findFirst({ where: { module, feature } });
  assert.ok(permission, `${module} / ${feature} is missing locally - run the migration`);
  const role = await prisma.role.create({ data: { name: tag(name) } });
  await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id, accessLevel: "READ" } });
  await prisma.roleBranch.createMany({ data: branchIds.map((branchId) => ({ roleId: role.id, branchId })) });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
}

test("a queued line is written with control characters stripped, and a Super Admin reads it back with its current name and status text", async () => {
  F.admin = await makeUser("admin", { name: "Activity Reader", role: "SUPER_ADMIN" });
  F.nobody = await makeUser("nobody");

  log.recordActivity({ userId: F.admin.id, username: `${tag("snapshot")}\n\u001b[31m`, path: "/api/sales/crm-leads/:id", method: "PATCH", action: "updateLead", statusCode: 404, clientIp: "10.0.0.9", userAgent: "node\r\ntest", durationMs: 12 });
  await log.flushActivityLog();

  const page = await service.list(F.admin.id, { username: tag("snapshot"), page: 1, pageSize: 50, sortBy: "createdAt", sortOrder: "desc" });
  assert.equal(page.total, 1);
  const [listed] = page.rows;
  assert.equal(typeof listed.id, "string");
  assert.equal(listed.username, `${tag("snapshot")}[31m`, "the username is the snapshot, without control characters");
  assert.equal(listed.module, "Sales · CRM Leads");
  assert.equal(listed.statusText, "Not Found");
  // The list carries only what the grid draws; the rest is the details panel's, one line at a time.
  // `changes` is drawn: the grid has a What changed column, which is the question this screen is
  // usually opened with ("he says he updated it and it is not reflecting").
  assert.deepEqual(Object.keys(listed).sort(), ["action", "changes", "clientIp", "createdAt", "id", "method", "module", "statusCode", "statusText", "username"]);

  const line = await service.detail(F.admin.id, BigInt(listed.id));
  assert.equal(line.userAgent, "nodetest");
  assert.equal(line.userName, "Activity Reader", "the current name comes through the relation");
  assert.equal(line.path, "/api/sales/crm-leads/:id");
  assert.equal(line.durationMs, 12);
  assert.equal(await service.detail(F.nobody.id, BigInt(listed.id)), null, "outside the reader's reach reads as not there");
  assert.equal(await service.detail(F.admin.id, 999999999999n), null);

  // Past the first page the count is not repeated.
  const second = await service.list(F.admin.id, { username: tag("snapshot"), page: 2, pageSize: 50 });
  assert.equal(second.total, null);

  const options = await service.options(F.admin.id);
  assert.deepEqual(options.methods, ["POST", "PUT", "PATCH", "DELETE"]);
  assert.ok(options.modules.includes("Sales · CRM Leads"));

  // Somebody whose roles reach no branch for the permission sees nothing - not everything.
  const none = await service.list(F.nobody.id, { page: 1, pageSize: 50 });
  assert.deepEqual(none, { rows: [], total: 0, page: 1, pageSize: 50 });
});

test("sign-in, failed sign-in and sign-out each leave a line, and what was typed is never stored", async () => {
  const bcrypt = require("bcryptjs");
  const auth = require("../src/controllers/authController");
  const authSessions = require("../src/services/authSessionService");
  const person = await makeUser("signin", { name: "Signs In", password: await bcrypt.hash(PASSWORD, 4), status: "ACTIVE" });

  const call = (handler, body) => new Promise((resolve) => {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { resolve({ status: this.statusCode, payload }); return this; } };
    handler({ body, headers: { "user-agent": `TAL-${STAMP}` }, ip: "::ffff:10.1.2.3" }, res);
  });

  assert.equal((await call(auth.login, { username: person.username, password: PASSWORD })).status, 200);
  assert.equal((await call(auth.login, { username: person.username, password: "wrong" })).status, 401);
  assert.equal((await call(auth.login, { username: "Hunter2-not-an-account", password: "x" })).status, 401);
  const session = await authSessions.createSession(person.id, "desktop");
  assert.equal((await call(auth.logout, { refreshToken: session.token })).status, 200);
  assert.equal(await authSessions.findLiveSession(session.token), null, "the session is revoked");
  await log.flushActivityLog();

  const lines = await prisma.userActivityLog.findMany({ where: { userAgent: `TAL-${STAMP}` }, orderBy: { id: "asc" } });
  assert.deepEqual(lines.map((line) => [line.action, line.statusCode, line.userId, line.username]), [
    ["Login", 200, person.id, person.username],
    ["Login failed", 401, null, person.username],
    ["Login failed", 401, null, log.UNKNOWN_ACCOUNT],
    ["Logout", 200, person.id, person.username],
  ]);
  assert.ok(lines.every((line) => line.module === "Auth" && line.clientIp === "10.1.2.3"));
  assert.ok(!lines.some((line) => /hunter2/i.test(line.username || "")), "a typed identifier was stored");
});

test("a reader granted the permission for one branch sees that branch's people only - not another branch, not branchless lines, not a Super Admin", async () => {
  const branchA = await prisma.branch.create({ data: { code: tag("BA"), name: `Activity A ${STAMP}` } });
  const branchB = await prisma.branch.create({ data: { code: tag("BB"), name: `Activity B ${STAMP}` } });
  const reader = await makeUser("reader");
  await grant(reader, service.PERMISSION, [branchA.id], "logs-a");
  // A wider role on a different permission must not widen this one.
  await grant(reader, { module: "ADMIN", feature: "User Management" }, [branchA.id, branchB.id], "users-ab");

  const worker = await makeUser("worker", { branchId: branchA.id });
  for (const [username, branchId, userId] of [[tag("in-a"), branchA.id, worker.id], [tag("in-b"), branchB.id, null], [tag("nowhere"), null, null], [tag("by-super"), branchA.id, F.admin.id]]) {
    log.recordActivity({ userId, username, branchId, path: "/api/hrm/attendance", method: "GET", action: "listAttendance", statusCode: 200 });
  }
  await log.flushActivityLog();

  const page = await service.list(reader.id, { username: `TAL-${STAMP}`, page: 1, pageSize: 50 });
  assert.deepEqual(page.rows.map((row) => row.username), [tag("in-a")]);
  assert.equal((await service.detail(reader.id, BigInt(page.rows[0].id))).branchName, `Activity A ${STAMP}`);
  // A line from a branch the reader does not reach is not there to them, even by its id.
  const outside = everythingId(await service.list(F.admin.id, { username: tag("in-b"), page: 1, pageSize: 50 }));
  assert.equal(await service.detail(reader.id, outside), null);
  const everything = await service.list(F.admin.id, { username: `TAL-${STAMP}`, page: 1, pageSize: 50 });
  assert.ok(everything.rows.some((row) => row.username === tag("by-super")) && everything.rows.some((row) => row.username === tag("nowhere")));
});

const everythingId = (page) => BigInt(page.rows[0].id);

test("over HTTP: a signed-in user without the permission is refused with 403, a holder is served, and deep paging is refused", async () => {
  require("dotenv").config({ quiet: true });
  const jwt = require("jsonwebtoken");
  const reader = await makeUser("http-reader");
  const branch = await prisma.branch.create({ data: { code: tag("BH"), name: `Activity H ${STAMP}` } });
  await grant(reader, service.PERMISSION, [branch.id], "logs-h");
  const token = (user) => jwt.sign({ id: user.id, username: user.username, role: user.role }, process.env.JWT_SECRET, { expiresIn: "5m" });

  const app = express();
  app.use("/api/admin/activity-logs", require("../src/modules/admin/activity-logs/routes"));
  const server = app.listen(0);
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const get = (url, user) => new Promise((resolve, reject) => {
      http.get({ port: server.address().port, path: url, headers: { Authorization: `Bearer ${token(user)}` } }, (res) => {
        let body = "";
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(body || "{}") }));
      }).on("error", reject);
    });
    assert.equal((await get("/api/admin/activity-logs", F.nobody)).status, 403);
    assert.equal((await get("/api/admin/activity-logs/options", F.nobody)).status, 403);
    const served = await get("/api/admin/activity-logs?pageSize=10", reader);
    assert.equal(served.status, 200);
    assert.ok(Array.isArray(served.body.rows));
    const deep = await get("/api/admin/activity-logs?page=51&pageSize=200", reader);
    assert.equal(deep.status, 400);
    assert.equal(deep.body.message, "Narrow the period or filters to see older lines.");
  } finally {
    server.close();
  }
});

test("retention deletes the lines older than the window and nothing newer", async () => {
  const now = new Date();
  const old = await prisma.userActivityLog.create({ data: { username: tag("old"), module: "Test", action: "old", method: "GET", path: "/api/test", statusCode: 200, createdAt: new Date(now.getTime() - 91 * 24 * 60 * 60 * 1000) } });
  const fresh = await prisma.userActivityLog.create({ data: { username: tag("fresh"), module: "Test", action: "fresh", method: "GET", path: "/api/test", statusCode: 200, createdAt: new Date(now.getTime() - 89 * 24 * 60 * 60 * 1000) } });
  const { removed } = await log.purgeExpiredActivityLogs({ now, days: 90 });
  assert.ok(removed >= 1);
  assert.equal(await prisma.userActivityLog.findUnique({ where: { id: old.id } }), null);
  assert.ok(await prisma.userActivityLog.findUnique({ where: { id: fresh.id } }));
});

// ─── Export ────────────────────────────────────────────────────────────────────────────────────

test("an export never lets a cell become a spreadsheet formula, and quotes what CSV needs quoted", () => {
  const exporter = require("../src/modules/admin/activity-logs/export");
  for (const evil of ["=HYPERLINK(\"x\")", "+1", "-2+3", "@SUM(A1)", "\tcmd"]) assert.equal(exporter.safeText(evil)[0], "'", evil);
  assert.equal(exporter.safeText("priya.pillai"), "priya.pillai");
  const format = exporter.logTimeFormatter("Asia/Kolkata");
  assert.equal(format("2026-10-20T07:41:58.000Z"), "2026/10/20 01:11:58 PM");
  const csv = exporter.toCsv([{ createdAt: "2026-10-20T07:41:58.000Z", username: "=evil", user: { name: "A, B" }, module: "Auth", action: "Login", method: "POST", path: "/api/auth/login", statusCode: 401, clientIp: "1.2.3.4", userAgent: "say \"hi\"", durationMs: 12 }], format).toString("utf8");
  const [header, line] = csv.replace(/^﻿/, "").split("\r\n");
  assert.equal(header.split(",").length, exporter.COLUMNS.length);
  assert.match(line, /^2026\/10\/20 01:11:58 PM,'=evil,"A, B",/);
  assert.match(line, /,401,Unauthorized,1\.2\.3\.4,"say ""hi""",12$/);
  assert.equal(exporter.safeTimeZone("Not/AZone"), "UTC");
  assert.deepEqual([0, 25, 26, 51, 52].map(exporter.columnLetter), ["A", "Z", "AA", "AZ", "BA"]);
});

test("an Excel export is a real workbook: every part parses, cells are typed, control characters are gone", async () => {
  const exporter = require("../src/modules/admin/activity-logs/export");
  const row = { createdAt: new Date(), username: "bad\u0001name<&>", module: "Auth", action: "Login", method: "POST", path: "/api/auth/login", statusCode: 200, durationMs: 34 };
  const file = await exporter.buildExport([row], "xlsx", "Asia/Kolkata");
  assert.equal(file.type, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.match(file.fileName, /^user-activity-logs-\d{4}-\d{2}-\d{2}\.xlsx$/);
  assert.equal(file.body.subarray(0, 2).toString(), "PK", "a zip, as every .xlsx is");
  const sheet = exporter.sheetXml([row], exporter.logTimeFormatter("UTC"));
  assert.ok(!sheet.includes("\u0001"), "XML may not carry control characters");
  assert.ok(sheet.includes("bad name&lt;&amp;&gt;") || sheet.includes("badname&lt;&amp;&gt;"));
  assert.match(sheet, /<c r="I2"><v>200<\/v><\/c>/, "a status code is a number");
  assert.match(sheet, /<c r="M2"><v>34<\/v><\/c>/, "a duration is a number");
});

test("over HTTP: export needs the log permission, takes the list's filters, and refuses an unknown format", async () => {
  require("dotenv").config({ quiet: true });
  const jwt = require("jsonwebtoken");
  const token = (user) => jwt.sign({ id: user.id, username: user.username, role: user.role }, process.env.JWT_SECRET, { expiresIn: "5m" });
  const app = express();
  app.use("/api/admin/activity-logs", require("../src/modules/admin/activity-logs/routes"));
  const server = app.listen(0);
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const get = (url, user) => new Promise((resolve, reject) => {
      http.get({ port: server.address().port, path: url, headers: { Authorization: `Bearer ${token(user)}` } }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode, type: res.headers["content-type"], body: Buffer.concat(chunks) }));
      }).on("error", reject);
    });
    assert.equal((await get("/api/admin/activity-logs/export?format=csv", F.nobody)).status, 403);
    assert.equal((await get("/api/admin/activity-logs/export?format=pdf", F.admin)).status, 400);
    const csv = await get(`/api/admin/activity-logs/export?format=csv&username=${encodeURIComponent(tag("snapshot"))}`, F.admin);
    assert.equal(csv.status, 200);
    assert.match(csv.type, /text\/csv/);
    assert.equal(csv.body.toString("utf8").replace(/^﻿/, "").split("\r\n").length, 2, "the header and the one line the filter matches");
    const xlsx = await get(`/api/admin/activity-logs/export?format=xlsx&username=${encodeURIComponent(tag("snapshot"))}`, F.admin);
    assert.equal(xlsx.status, 200);
    assert.equal(xlsx.body.subarray(0, 2).toString(), "PK");
  } finally {
    server.close();
  }
});
