const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * Linking your own WhatsApp is not a CRM errand.
 *
 * The session is **per user**: credentials live in a folder per user id, and everything sent goes out
 * from that person's own paired phone. HR already sends from theirs - the screening form, the onboarding
 * invite and a new joiner's login all go through `sendWhatsAppToPerson({ userId, ... })` - but the route
 * that shows the QR sat behind `SALES / CRM Leads`, so an HR user could be told they were not linked and
 * had no way to link. `GET /my-session` was already lifted above that guard for exactly this reason; the
 * pairing pair had not been.
 */

const ROUTES = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "whatsapp-chat", "routes.js"), "utf8");
const CONTROLLER = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "whatsapp-chat", "controller.js"), "utf8");

const guardLine = ROUTES.indexOf('router.use(requireModule("SALES", "CRM Leads"));');

test("pairing and unpairing your own account sit above the CRM Leads guard", () => {
  assert.ok(guardLine > 0, "the CRM Leads guard should still be there");
  for (const route of ['router.post("/session/connect"', 'router.post("/session/logout"']) {
    const at = ROUTES.indexOf(route);
    assert.ok(at > 0, `${route} should exist`);
    assert.ok(at < guardLine, `${route} must not be behind the CRM Leads guard`);
  }
  // And the thread itself stays behind it: a lead's conversation is the CRM's.
  assert.ok(ROUTES.indexOf('router.get("/leads/:id/messages"') > guardLine);
});

test("it is not open to everybody signed in either", () => {
  /*
   * Each request is a real registration against a WhatsApp number, WhatsApp refuses codes to an account
   * that registers repeatedly, and it can ban the number outright - so this is not a route to leave on
   * `protect` alone. It answers to whichever of the three jobs actually messages anybody: the CRM, the
   * interview register, and the repository that sends a joiner their login.
   */
  assert.match(ROUTES, /const mayPairByPermission = checkAnyPermission\(\[/);
  for (const pair of ['{ module: "SALES", feature: "CRM Leads"', '{ module: "HRM", feature: "Interview"', '{ module: "HRM", feature: "Employee Management"']) {
    assert.ok(ROUTES.includes(pair), `${pair} should be able to pair`);
  }
  assert.match(ROUTES, /router\.post\("\/session\/connect", mayPair, connect\);/);
  assert.match(ROUTES, /router\.post\("\/session\/logout", mayPair, limits\.logout, disconnect\);/);
});

test("the two switches still decide whether anybody may link at all", () => {
  // Widening who can reach the route does not widen who may link: the studio switch and the per-user
  // switch are checked inside the handler, before a socket is opened.
  const body = /async function connect\(req, res\) \{([\s\S]*?)\n\}/.exec(CONTROLLER)?.[1] || "";
  assert.ok(body, "connect could not be read");
  assert.match(body, /if \(!\(await isChatEnabled\(\)\)\) return res\.status\(403\)/);
  assert.match(body, /if \(!\(await isChatEnabledForUser\(req\.user\.id\)\)\) return res\.status\(403\)/);
  // The caller's own id, never one from the request - pairing somebody else's account is not a thing
  // this route can be asked to do.
  assert.match(body, /startSession\(req\.user\.id/);
});

/*
 * Allow WhatsApp on its own is enough to link. The tick is what puts the link gate in front of
 * somebody, so a ticked account whose roles hold none of the three features must still be able to
 * pair - otherwise the gate demands a link this route refuses, and there is no way past it.
 */
const prisma = require("../src/config/db");
const iamService = require("../src/services/iam.service");
const router = require("../src/modules/sales/whatsapp-chat/routes");
const connectLayer = router.stack.find((layer) => layer.route?.path === "/session/connect" && layer.route.methods.post);
const mayPair = connectLayer.route.stack[0].handle;

async function runGuard(t, { ticked, permitted }) {
  // Reserved fixture prefix, swept by scripts/clear-test-fixtures.js if a run dies before `t.after`.
  const tag = `TWP-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const account = await prisma.user.create({ data: { name: tag, email: `${tag}@test.local`, username: tag, password: "x", role: "USER", whatsappRequired: ticked } });
  t.after(() => prisma.user.delete({ where: { id: account.id } }));
  const asked = [];
  t.mock.method(iamService, "hasPermission", async (...args) => { asked.push(args); return permitted; });
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  let passed = false;
  await mayPair({ user: { id: account.id } }, res, () => { passed = true; });
  return { passed, res, asked };
}

test("Allow WhatsApp alone lets somebody pair, whatever their roles hold", async (t) => {
  const { passed, asked } = await runGuard(t, { ticked: true, permitted: false });
  assert.equal(passed, true);
  assert.equal(asked.length, 0, "the tick is enough - no permission is consulted");
});

test("without the tick, one of the three features is still what lets somebody pair", async (t) => {
  assert.equal((await runGuard(t, { ticked: false, permitted: true })).passed, true);
});

test("unlinking answers to the same guard as linking", () => {
  const logoutLayer = router.stack.find((layer) => layer.route?.path === "/session/logout" && layer.route.methods.post);
  assert.equal(logoutLayer.route.stack[0].handle, mayPair);
});

test("with neither the tick nor a feature, pairing is refused", async (t) => {
  const { passed, res } = await runGuard(t, { ticked: false, permitted: false });
  assert.equal(passed, false);
  assert.equal(res.statusCode, 403);
});
