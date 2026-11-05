const test = require("node:test");
const assert = require("node:assert/strict");
const { createSession, findLiveSession, revokeSession, SESSION_DAYS } = require("../src/services/authSessionService");

// A fake authSession table, so these run without MySQL — the same reason every module test
// stubs its repository. Only the calls the service makes are implemented.
function fakeDb() {
  const rows = [];
  let nextId = 1;
  return {
    rows,
    authSession: {
      create: async ({ data }) => { const row = { id: nextId++, lastUsedAt: null, revokedAt: null, createdAt: new Date(), ...data }; rows.push(row); return row; },
      findUnique: async ({ where }) => {
        const row = rows.find((candidate) => candidate.tokenHash === where.tokenHash) || null;
        return row ? { ...row, user: row.user || { id: row.userId, status: "ACTIVE" } } : null;
      },
      update: async ({ where, data }) => { const row = rows.find((candidate) => candidate.id === where.id); Object.assign(row, data); return row; },
      updateMany: async ({ where, data }) => {
        const matched = rows.filter((candidate) => candidate.tokenHash === where.tokenHash && candidate.revokedAt === where.revokedAt);
        matched.forEach((row) => Object.assign(row, data));
        return { count: matched.length };
      },
    },
  };
}

test("a minted session expires exactly the configured days from creation, and only its hash is stored", async () => {
  const db = fakeDb();
  const before = Date.now();
  const { token, expiresAt } = await createSession(7, "desktop", db);
  const after = Date.now();
  assert.ok(token.length >= 48);
  const days = 24 * 60 * 60 * 1000;
  assert.ok(expiresAt.getTime() >= before + SESSION_DAYS * days && expiresAt.getTime() <= after + SESSION_DAYS * days);
  assert.equal(SESSION_DAYS, 30);
  assert.equal(db.rows.length, 1);
  assert.notEqual(db.rows[0].tokenHash, token);
  assert.equal(db.rows[0].tokenHash.length, 64);
});

test("a live token round-trips to its session; garbage and near-miss tokens answer null", async () => {
  const db = fakeDb();
  const { token } = await createSession(7, "desktop", db);
  const session = await findLiveSession(token, db);
  assert.equal(session?.userId, 7);
  assert.equal(await findLiveSession(`${token}x`, db), null);
  assert.equal(await findLiveSession(null, db), null);
  assert.equal(await findLiveSession("", db), null);
});

test("an expired session answers null — fixed lifetime, no extension by use", async () => {
  const db = fakeDb();
  const { token, expiresAt } = await createSession(7, "desktop", db);
  const afterExpiry = new Date(expiresAt.getTime() + 1);
  assert.equal(await findLiveSession(token, db, afterExpiry), null);
  // Right up to the boundary it still lives.
  assert.ok(await findLiveSession(token, db, new Date(expiresAt.getTime() - 1)));
});

test("a revoked session answers null and revoking again is a harmless no-op", async () => {
  const db = fakeDb();
  const { token } = await createSession(7, "desktop", db);
  await revokeSession(token, db);
  assert.equal(await findLiveSession(token, db), null);
  assert.ok(db.rows[0].revokedAt);
  const stamped = db.rows[0].revokedAt;
  await revokeSession(token, db);
  assert.equal(db.rows[0].revokedAt, stamped);
});

test("revoking one session leaves the user's other sessions signed in", async () => {
  const db = fakeDb();
  const laptop = await createSession(7, "desktop", db);
  const tower = await createSession(7, "desktop", db);
  await revokeSession(laptop.token, db);
  assert.equal(await findLiveSession(laptop.token, db), null);
  assert.ok(await findLiveSession(tower.token, db));
});
