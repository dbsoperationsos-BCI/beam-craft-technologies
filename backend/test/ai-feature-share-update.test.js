const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-share-update";
const MODULES = path.join(__dirname, "..", "src", "modules");
function stub(relative, exports) {
  const resolved = require.resolve(path.join(MODULES, relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports, children: [], paths: [] };
}

let rows = [];
let collideOnce = false;
const activityLines = [];
stub("../config/db.js", {
  aiEventShare: {
    findUnique: async ({ where }) => rows.find((row) => (where.eventId ? row.eventId === where.eventId : row.shortCode === where.shortCode)) || null,
    update: async ({ where, data }) => {
      if (collideOnce && data.shortCode) { collideOnce = false; const e = new Error("unique"); e.code = "P2002"; throw e; }
      const row = rows.find((r) => r.id === where.id); Object.assign(row, data); return { ...row };
    },
  },
});
stub("ai-feature/shared/eventAccess.js", { loadEvent: async (id) => ({ id }) });
stub("ai-feature/shared/activity.js", { EVENTS: { EVENT_SHARED: "EVENT_SHARED", SHARE_REVOKED: "SHARE_REVOKED" }, staffActor: (user) => user, record: async (...args) => { activityLines.push(args.join(" ")); } });

const security = require("../src/modules/ai-feature/share/security");
const service = require("../src/modules/ai-feature/share/service");

async function reset({ pin = "3955", status = "ACTIVE" } = {}) {
  activityLines.length = 0;
  rows = [
    { id: "s1", eventId: "e1", shortCode: "5G5TVW", status, tokenHash: "t1", tokenCipher: security.encryptValue("tok"), pinHash: pin ? await security.hashPin(pin) : null, pinCipher: pin ? security.encryptValue(pin) : null, expiresAt: null, accessCount: 3 },
    { id: "s2", eventId: "e2", shortCode: "TAKEN1", status: "ACTIVE", tokenHash: "t2", tokenCipher: security.encryptValue("tok2"), pinHash: null, pinCipher: null, expiresAt: null, accessCount: 0 },
  ];
}
const share = () => rows[0];

test("turning the PIN off clears it: the guest join stops asking (no hash), and nothing shows or sends a PIN", async () => {
  await reset();
  const result = await service.update("e1", { requirePin: false }, { id: 1 });
  assert.equal(share().pinHash, null); assert.equal(share().pinCipher, null);
  assert.equal(result.pin, null); assert.equal(result.hasPin, false);
  assert.ok(result.url.endsWith("/5G5TVW"), "the link itself is unchanged");
  assert.equal(share().accessCount, 3, "counts are kept");
});

test("turning it on makes a PIN on the server; keeping it on keeps the same PIN", async () => {
  await reset({ pin: null });
  const on = await service.update("e1", { requirePin: true }, { id: 1 });
  assert.match(on.pin, /^\d{4}$/); assert.equal(await security.comparePin(on.pin, share().pinHash), true);
  const again = await service.update("e1", { requirePin: true }, { id: 1 });
  assert.equal(again.pin, on.pin, "nothing rotates without being asked");
});

test("an empty request changes nothing: opening the dialog never rotates the code or the PIN", async () => {
  await reset();
  const before = { ...share() };
  const result = await service.update("e1", {}, { id: 1 });
  assert.equal(result.pin, "3955"); assert.equal(share().shortCode, before.shortCode); assert.equal(share().pinHash, before.pinHash);
  assert.equal(activityLines.length, 0);
});

test("Reset PIN draws a different PIN: the old one stops opening, the link is untouched, the PIN is never logged", async () => {
  await reset();
  const fresh = await service.update("e1", { newPin: true }, { id: 1 });
  assert.match(fresh.pin, /^\d{4}$/); assert.notEqual(fresh.pin, "3955");
  assert.equal(await security.comparePin(fresh.pin, share().pinHash), true);
  assert.equal(await security.comparePin("3955", share().pinHash), false);
  assert.equal(share().shortCode, "5G5TVW");
  assert.ok(activityLines.every((line) => !line.includes(fresh.pin)));
  await reset({ pin: null });
  assert.equal((await service.update("e1", { newPin: true }, { id: 1 })).hasPin, true, "turns the PIN on when it was off");
  await assert.rejects(() => service.update("e1", { newPin: true, requirePin: false }, { id: 1 }), { status: 400 });
});

test("New link code draws a fresh unique code: the URL follows it, the PIN and counts are kept", async () => {
  await reset();
  const result = await service.update("e1", { newCode: true }, { id: 1 });
  assert.notEqual(share().shortCode, "5G5TVW");
  assert.match(share().shortCode, /^[A-Z0-9]{6}$/);
  assert.notEqual(share().shortCode, "TAKEN1");
  assert.ok(result.url.endsWith(`/e/${share().shortCode}`));
  assert.equal(result.pin, "3955"); assert.equal(share().accessCount, 3);
});

test("a code taken by another link in the instant before the write is drawn again, not an error", async () => {
  await reset();
  collideOnce = true;
  const result = await service.update("e1", { newCode: true }, { id: 1 });
  assert.equal(collideOnce, false);
  assert.ok(result.url.endsWith(`/e/${share().shortCode}`));
});

test("a revoked or never-made link cannot be edited", async () => {
  await reset({ status: "REVOKED" });
  await assert.rejects(() => service.update("e1", { requirePin: false }, { id: 1 }), { status: 409 });
  await assert.rejects(() => service.update("e9", { newCode: true }, { id: 1 }), { status: 409 });
});

test("the route is a PATCH behind the router's guard, and a typed code or PIN is refused by the body", () => {
  const source = require("node:fs").readFileSync(path.join(MODULES, "ai-feature", "routes.js"), "utf8");
  assert.ok(source.indexOf('router.patch("/events/:eventId/share", share.updateShare);') > source.indexOf("router.use(requireModule(MODULE, FEATURE));"));
  const controller = require("node:fs").readFileSync(path.join(MODULES, "ai-feature", "share", "controller.js"), "utf8");
  const schema = controller.match(/const updateBody = z\.object\(\{[\s\S]*?\}\)\.strict\(\);/)[0];
  assert.doesNotMatch(schema, /shortCode|\bpin:/);
  assert.match(schema, /newCode: z\.boolean\(\)/); assert.match(schema, /newPin: z\.boolean\(\)/); assert.match(schema, /requirePin: z\.boolean\(\)/);
});
