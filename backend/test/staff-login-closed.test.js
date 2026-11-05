const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const prisma = require("../src/config/db");
const { protect } = require("../src/middleware/authMiddleware");

/*
 * A staff sign-in ends the moment its account is closed - offboarding (Relieved, Fired, Absconded)
 * or deleting the employee sets the login INACTIVE - not days later when its token runs out.
 * `protect` asks the account's status on every request, as it always did for client logins; the
 * frontend signs the person out on the 401 it gets.
 */

// CI has no .env: the tokens these tests sign need a secret - a test-only one where none is set.
process.env.JWT_SECRET = process.env.JWT_SECRET || "staff-login-closed-test-secret";
const jwt = require("jsonwebtoken");

const STAMP = Date.now().toString(36);
const tag = (name) => `TSL-${STAMP}-${name}`;

after(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: `TSL-${STAMP}` } } }).catch(() => {});
  await prisma.$disconnect();
});

const makeUser = (name, status = "ACTIVE") => prisma.user.create({
  data: { name, email: `${tag(name)}@test.local`, username: tag(name).toLowerCase(), password: "x", role: "EMPLOYEE", status },
});
const tokenFor = (user) => jwt.sign({ id: user.id, username: user.username, role: user.role }, process.env.JWT_SECRET, { expiresIn: "5m" });

async function withApp(run) {
  const app = express();
  app.get("/api/check", protect, (req, res) => res.json({ ok: true, id: req.user.id }));
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const call = (token) => new Promise((resolve, reject) => {
    http.get({ port: server.address().port, path: "/api/check", headers: token ? { Authorization: `Bearer ${token}` } : {} }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(body || "{}") }));
    }).on("error", reject);
  });
  try { await run(call); } finally { server.close(); }
}

test("an active staff login gets through", async () => {
  const user = await makeUser("active");
  await withApp(async (call) => {
    const answer = await call(tokenFor(user));
    assert.equal(answer.status, 200);
    assert.equal(answer.body.id, user.id);
  });
});

test("the same token is refused the moment offboarding closes the account, and works again if it is reopened", async () => {
  const user = await makeUser("offboarded");
  const token = tokenFor(user);
  await withApp(async (call) => {
    assert.equal((await call(token)).status, 200);
    // What offboarding (closeLogin) and deleting an employee do to the account.
    await prisma.user.update({ where: { id: user.id }, data: { status: "INACTIVE" } });
    const refused = await call(token);
    assert.equal(refused.status, 401, "a token still within its 7 days no longer gets in");
    assert.match(refused.body.message, /no longer active/);
    // Taking the departure back (reopenLogin) lets the same sign-in work again.
    await prisma.user.update({ where: { id: user.id }, data: { status: "ACTIVE" } });
    assert.equal((await call(token)).status, 200);
  });
});

test("an account that no longer exists, and a token naming no account, are refused", async () => {
  const user = await makeUser("deleted");
  const token = tokenFor(user);
  await prisma.user.delete({ where: { id: user.id } });
  await withApp(async (call) => {
    assert.equal((await call(token)).status, 401);
    assert.equal((await call(jwt.sign({ username: "nobody" }, process.env.JWT_SECRET, { expiresIn: "5m" }))).status, 401);
    assert.equal((await call(null)).status, 401);
  });
});
