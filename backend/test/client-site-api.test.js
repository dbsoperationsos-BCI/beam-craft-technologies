const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const { NOT_RECOGNISED, derivedSiteKey, derivedKeyMatches, hashSiteKey, makeSiteKey, siteKeyMatches, siteSubscription, getSiteSubscription } = require("../src/modules/subscribe/client-onboarding/siteApi");
const { serializeInvite, passwordColumns, assertCanMakeSiteKey } = require("../src/modules/subscribe/client-onboarding/controller");

const { key: KEY, hash: HASH } = makeSiteKey();

const liveClient = (overrides = {}) => ({
  id: "c1",
  product: "ACCOUNT_MANAGER",
  subdomain: "velavaagencies",
  companyName: "Velava Agencies",
  logoUrl: "https://cdn.example/logo.png",
  faviconUrl: "https://cdn.example/favicon.png",
  usersAllowed: 5,
  adminUsername: "velavaagencies",
  adminPasswordHash: "$2a$10$abcdefghijklmnopqrstuv",
  adminPasswordSetAt: new Date("2026-11-04T15:01:00.000Z"),
  siteKeyHash: HASH,
  validFrom: new Date("2026-11-04T00:00:00Z"),
  validUntil: new Date("2027-05-03T00:00:00Z"),
  modules: ["hrm/employee-repository", "accounts/accounts-manager"],
  liveVersion: 1,
  activatedAt: new Date("2026-11-04T15:01:00.000Z"),
  pendingChanges: { subdomain: "velava-new", usersAllowed: 50 },
  mainContactName: "Contact",
  ...overrides,
});

const fakeDb = (client) => ({ subscriptionClient: { findUnique: async ({ where }) => (client && where.subdomain === client.subdomain ? client : null) } });

function call(headers, client) {
  const lower = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
  const req = { get: (name) => lower[name.toLowerCase()] };
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  return getSiteSubscription(req, res, fakeDb(client)).then(() => res);
}

test("a site key is 32 random bytes in hex, and only its SHA-256 is kept", () => {
  const { key, hash } = makeSiteKey();
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.equal(hash, require("crypto").createHash("sha256").update(key).digest("hex"));
  assert.notEqual(makeSiteKey().key, key);
});

test("the key matches only its own hash; nothing matches a missing one", () => {
  assert.equal(siteKeyMatches(KEY, HASH), true);
  assert.equal(siteKeyMatches(makeSiteKey().key, HASH), false);
  assert.equal(siteKeyMatches(KEY, null), false);
  assert.equal(siteKeyMatches("", HASH), false);
  assert.equal(siteKeyMatches("", hashSiteKey("")), false);
});

test("200: the live fields only, dates as days, never the pending change", async () => {
  const res = await call({ Authorization: `Bearer ${KEY}`, "X-Site": "velavaagencies" }, liveClient());
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data, {
    product: "ACCOUNT_MANAGER",
    subdomain: "velavaagencies",
    companyName: "Velava Agencies",
    logoUrl: "https://cdn.example/logo.png",
    faviconUrl: "https://cdn.example/favicon.png",
    usersAllowed: 5,
    adminUsername: "velavaagencies",
    adminPasswordHash: "$2a$10$abcdefghijklmnopqrstuv",
    passwordSetAt: "2026-11-04T15:01:00.000Z",
    validFrom: "2026-11-04",
    validUntil: "2027-05-03",
    modules: ["hrm/employee-repository", "accounts/accounts-manager"],
    version: 1,
  });
  assert.equal(JSON.stringify(res.body).includes("velava-new"), false);
});

test("401, with one message, for an unknown subdomain, no key stored, a wrong key or no key", async () => {
  const cases = [
    [{ Authorization: `Bearer ${KEY}`, "X-Site": "someoneelse" }, liveClient()],
    [{ Authorization: `Bearer ${KEY}`, "X-Site": "velavaagencies" }, liveClient({ siteKeyHash: null })],
    [{ Authorization: `Bearer ${makeSiteKey().key}`, "X-Site": "velavaagencies" }, liveClient()],
    [{ "X-Site": "velavaagencies" }, liveClient()],
    [{ Authorization: `Bearer ${KEY}` }, liveClient()],
  ];
  for (const [headers, client] of cases) {
    const res = await call(headers, client);
    assert.equal(res.statusCode, 401, JSON.stringify(headers));
    assert.deepEqual(res.body, { message: NOT_RECOGNISED });
  }
});

test("404 only once the key matched and the account is not set up", async () => {
  const res = await call({ Authorization: `Bearer ${KEY}`, "X-Site": "velavaagencies" }, liveClient({ activatedAt: null }));
  assert.equal(res.statusCode, 404);
  assert.ok(res.body.message);
});

test("a new password is stored as its bcrypt hash with the moment it was made", async () => {
  const now = new Date("2026-11-04T15:01:00.000Z");
  const columns = await passwordColumns("Secret123abc", now);
  assert.deepEqual(Object.keys(columns).sort(), ["adminPasswordHash", "adminPasswordSetAt"]);
  assert.equal(columns.adminPasswordSetAt, now);
  assert.equal(await bcrypt.compare("Secret123abc", columns.adminPasswordHash), true);
});

test("the team's list says whether a site key exists, never either hash", () => {
  const row = serializeInvite({ id: "i1", product: "ACCOUNT_MANAGER", submittedAt: new Date(), client: liveClient() });
  assert.equal(row.client.hasSiteKey, true);
  assert.equal("siteKeyHash" in row.client, false);
  assert.equal("adminPasswordHash" in row.client, false);
  assert.equal(serializeInvite({ id: "i2", submittedAt: new Date(), client: liveClient({ siteKeyHash: null }) }).client.hasSiteKey, false);
});

test("a site key is made only for a set-up account", () => {
  assert.throws(() => assertCanMakeSiteKey(null), (error) => error.status === 404);
  assert.throws(() => assertCanMakeSiteKey({ client: { activatedAt: null } }), (error) => error.status === 400);
  assert.doesNotThrow(() => assertCanMakeSiteKey({ client: liveClient() }));
});

test("the public answer reads off the live columns alone", () => {
  assert.equal(siteSubscription(liveClient({ adminPasswordSetAt: null })).passwordSetAt, null);
  assert.deepEqual(siteSubscription(liveClient({ modules: null })).modules, []);
});

test("a site works out its own key from the shared secret: no copying, a different key per subdomain", async () => {
  const secret = "s".repeat(48);
  const before = process.env.BEAMCRAFT_SITE_SECRET;
  process.env.BEAMCRAFT_SITE_SECRET = secret;
  try {
    const own = derivedSiteKey("velavaagencies", secret);
    assert.match(own, /^[a-f0-9]{64}$/);
    assert.notEqual(derivedSiteKey("kamal", secret), own);
    assert.equal(derivedKeyMatches(own, "velavaagencies", secret), true);
    // Another client's key, a short secret or no secret never match.
    assert.equal(derivedKeyMatches(derivedSiteKey("kamal", secret), "velavaagencies", secret), false);
    assert.equal(derivedSiteKey("velavaagencies", "short"), null);
    assert.equal(derivedSiteKey("velavaagencies", ""), null);
    // The route takes it for a client with no pasted key at all, and refuses it for another subdomain.
    assert.equal((await call({ authorization: `Bearer ${own}`, "x-site": "velavaagencies" }, liveClient({ siteKeyHash: null }))).statusCode, 200);
    assert.equal((await call({ authorization: `Bearer ${derivedSiteKey("kamal", secret)}`, "x-site": "velavaagencies" }, liveClient({ siteKeyHash: null }))).statusCode, 401);
    // The pasted key still works beside it.
    assert.equal((await call({ authorization: `Bearer ${KEY}`, "x-site": "velavaagencies" }, liveClient())).statusCode, 200);
  } finally {
    if (before === undefined) delete process.env.BEAMCRAFT_SITE_SECRET; else process.env.BEAMCRAFT_SITE_SECRET = before;
  }
});
