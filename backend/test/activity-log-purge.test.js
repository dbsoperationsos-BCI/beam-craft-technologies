const test = require("node:test");
// CI has no .env: the tokens these tests sign, and sign-in itself, need a secret - a test-only one
// where none is set, as the other HTTP tests do.
process.env.JWT_SECRET = process.env.JWT_SECRET || "activity-log-purge-test-secret";
const { after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const prisma = require("../src/config/db");
const service = require("../src/modules/settings/activity-log-purge/service");
const { monthsFrom, rangeFrom, askedFor } = require("../src/modules/settings/activity-log-purge/controller");

/*
 * Settings → Activity Log Purge. The purge is tested against a "now" in 2001, so the lines it may
 * delete are this suite's own fixtures and never a developer's real log, which is all far newer.
 */

const STAMP = Date.now().toString(36);
const tag = (name) => `TLP-${STAMP}-${name}`;
const PAST_NOW = new Date(2001, 6, 1, 12, 0, 0);

after(async () => {
  await prisma.userActivityLog.deleteMany({ where: { username: { startsWith: `TLP-${STAMP}` } } }).catch(() => {});
  await prisma.userRole.deleteMany({ where: { role: { name: { startsWith: `TLP-${STAMP}` } } } }).catch(() => {});
  await prisma.role.deleteMany({ where: { name: { startsWith: `TLP-${STAMP}` } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { email: { startsWith: `tlp-${STAMP}` } } }).catch(() => {});
  await prisma.$disconnect();
});

test("a purge keeps the last N calendar months: the cutoff is the same day N months back, held to a short month's end", () => {
  const now = new Date(2026, 9, 20, 14, 30, 0);
  for (const [months, month, year] of [[1, 8, 2026], [2, 7, 2026], [3, 6, 2026], [6, 3, 2026]]) {
    assert.equal(service.cutoffFor(months, now).getTime(), new Date(year, month, 20, 14, 30, 0).getTime(), `${months} months`);
  }
  assert.equal(service.cutoffFor(1, new Date(2026, 2, 31, 9, 0, 0)).getTime(), new Date(2026, 1, 28, 9, 0, 0).getTime());
  assert.equal(service.cutoffFor(6, new Date(2026, 0, 15, 8, 0, 0)).getTime(), new Date(2025, 6, 15, 8, 0, 0).getTime());
});

test("only 1, 2, 3 and 6 months are accepted", () => {
  assert.deepEqual(service.MONTH_CHOICES, [1, 2, 3, 6]);
  for (const ok of [1, 2, 3, 6, "3"]) assert.equal(monthsFrom(ok), Number(ok));
  for (const bad of [0, 4, 12, -1, "all", "", null, undefined, 1.5, true, [3], " 3 ", "3.0", {}]) assert.equal(monthsFrom(bad), null, JSON.stringify(bad));
});

test("a purge deletes the lines older than the cutoff and keeps everything newer", async () => {
  // PAST_NOW less one month is 1 June 2001: one line just before it, one just after, one long after.
  const line = (name, createdAt) => ({ username: tag(name), module: "Test", action: name, method: "POST", path: "/api/test", statusCode: 200, createdAt });
  await prisma.userActivityLog.createMany({ data: [
    line("old", new Date(2001, 4, 31, 23, 59, 0)),
    line("kept", new Date(2001, 5, 1, 12, 1, 0)),
    line("recent", new Date(2001, 5, 30, 9, 0, 0)),
  ] });

  const before = await service.preview(1, PAST_NOW);
  assert.equal(before.cutoff.getTime(), new Date(2001, 5, 1, 12, 0, 0).getTime());
  // At least this suite's one old line: another suite's fixture could also predate 2001.
  assert.ok(before.count >= 1, "the preview counts what the purge will delete");

  const result = await service.purge(1, PAST_NOW);
  assert.ok(result.removed >= 1);
  const left = await prisma.userActivityLog.findMany({ where: { username: { startsWith: `TLP-${STAMP}` } }, select: { action: true } });
  assert.deepEqual(left.map((row) => row.action).sort(), ["kept", "recent"]);
});

test("a custom range is two ISO moments, From not after To, and never reaches past now", () => {
  const now = new Date("2026-10-20T10:00:00.000Z");
  const ok = rangeFrom({ from: "2026-10-01T00:00:00.000Z", to: "2026-10-05T23:59:59.999Z" }, now);
  assert.equal(ok.from.toISOString(), "2026-10-01T00:00:00.000Z");
  assert.equal(ok.to.toISOString(), "2026-10-05T23:59:59.999Z");
  // A To ahead of now is held at now; a From ahead of now has nothing to delete.
  assert.equal(rangeFrom({ from: "2026-10-01T00:00:00.000Z", to: "2027-01-01T00:00:00.000Z" }, now).to.getTime(), now.getTime());
  assert.ok(rangeFrom({ from: "2026-11-01T00:00:00.000Z", to: "2026-12-01T00:00:00.000Z" }, now).error);
  for (const bad of [
    {}, { from: "2026-10-01T00:00:00.000Z" }, { to: "2026-10-01T00:00:00.000Z" },
    { from: "2026-10-05T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" },
    { from: 0, to: 1 }, { from: "2026-10-01", to: "2026-10-02" }, { from: "yesterday", to: "today" },
    { from: ["2026-10-01T00:00:00.000Z"], to: "2026-10-02T00:00:00.000Z" },
  ]) assert.ok(rangeFrom(bad, now).error, JSON.stringify(bad));
  // Months or a range - never both, never neither.
  assert.ok(askedFor({}).error);
  assert.ok(askedFor({ months: 3, from: "2026-10-01T00:00:00.000Z", to: "2026-10-02T00:00:00.000Z" }).error);
  assert.equal(askedFor({ months: "3" }).months, 3);
});

test("a custom range purge deletes the lines inside it, both ends included, and nothing either side", async () => {
  const line = (name, createdAt) => ({ username: tag(`range-${name}`), module: "Test", action: name, method: "POST", path: "/api/test", statusCode: 200, createdAt });
  const from = new Date(2001, 2, 10, 9, 0, 0);
  const to = new Date(2001, 2, 12, 18, 0, 0);
  await prisma.userActivityLog.createMany({ data: [
    line("before", new Date(2001, 2, 10, 8, 59, 59)),
    line("at-from", from),
    line("inside", new Date(2001, 2, 11, 12, 0, 0)),
    line("at-to", to),
    line("after", new Date(2001, 2, 12, 18, 0, 1)),
  ] });
  assert.equal((await service.previewRange(from, to)).count >= 3, true);
  assert.ok((await service.purgeRange(from, to)).removed >= 3);
  const left = await prisma.userActivityLog.findMany({ where: { username: { startsWith: tag("range-") } }, select: { action: true } });
  assert.deepEqual(left.map((row) => row.action).sort(), ["after", "before"]);
});

test("over HTTP: Read may see what a purge would delete but not purge, nobody else may do either, and a bad choice is refused", async () => {
  require("dotenv").config({ quiet: true });
  const jwt = require("jsonwebtoken");
  const makeUser = (name, extra = {}) => prisma.user.create({
    data: { name, email: `${tag(name)}@test.local`.toLowerCase(), username: tag(name).toLowerCase(), password: "x", role: "EMPLOYEE", ...extra },
  });
  const nobody = await makeUser("nobody");
  const reader = await makeUser("reader");
  const admin = await makeUser("admin", { role: "SUPER_ADMIN" });
  const permission = await prisma.permission.findFirst({ where: { module: "SETTINGS", feature: "Activity Log Purge" } });
  assert.ok(permission, "SETTINGS / Activity Log Purge is missing locally - run the migration");
  const role = await prisma.role.create({ data: { name: tag("purge-read") } });
  await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id, accessLevel: "READ" } });
  await prisma.userRole.create({ data: { userId: reader.id, roleId: role.id } });

  const token = (user) => jwt.sign({ id: user.id, username: user.username, role: user.role }, process.env.JWT_SECRET, { expiresIn: "5m" });
  const app = express();
  app.use(express.json());
  app.use("/api/settings/activity-log-purge", require("../src/modules/settings/activity-log-purge/routes"));
  const server = app.listen(0);
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const call = (method, url, user, body) => new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : "";
      const request = http.request({ port: server.address().port, path: url, method, headers: { Authorization: `Bearer ${token(user)}`, "content-type": "application/json", "content-length": Buffer.byteLength(payload) } }, (res) => {
        let text = "";
        res.on("data", (chunk) => { text += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(text || "{}") }));
      });
      request.on("error", reject);
      request.end(payload);
    });

    assert.equal((await call("GET", "/api/settings/activity-log-purge?months=3", nobody)).status, 403);
    assert.equal((await call("POST", "/api/settings/activity-log-purge", nobody, { months: 3 })).status, 403);

    const seen = await call("GET", "/api/settings/activity-log-purge?months=3", reader);
    assert.equal(seen.status, 200);
    assert.equal(typeof seen.body.count, "number");
    assert.deepEqual(seen.body.choices, [1, 2, 3, 6]);
    assert.equal((await call("POST", "/api/settings/activity-log-purge", reader, { months: 3 })).status, 403, "Read alone may not delete");

    // A choice that is not offered never reaches the delete - so nothing real is touched here.
    assert.equal((await call("GET", "/api/settings/activity-log-purge?months=4", admin)).status, 400);
    assert.equal((await call("POST", "/api/settings/activity-log-purge", admin, { months: 12 })).status, 400);
    assert.equal((await call("POST", "/api/settings/activity-log-purge", admin, {})).status, 400);
    assert.equal((await call("POST", "/api/settings/activity-log-purge", admin, { from: "2026-10-05T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" })).status, 400);
    assert.equal((await call("POST", "/api/settings/activity-log-purge", reader, { from: "2001-01-01T00:00:00.000Z", to: "2001-01-02T00:00:00.000Z" })).status, 403);
    const ranged = await call("GET", "/api/settings/activity-log-purge?from=2001-01-01T00%3A00%3A00.000Z&to=2001-01-02T00%3A00%3A00.000Z", reader);
    assert.equal(ranged.status, 200);
    assert.equal(typeof ranged.body.count, "number");
  } finally {
    server.close();
  }
});
