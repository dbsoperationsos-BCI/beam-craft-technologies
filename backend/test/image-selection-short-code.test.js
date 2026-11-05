const test = require("node:test");
const assert = require("node:assert/strict");
const repository = require("../src/modules/image-selection/publication/repository");
const service = require("../src/modules/image-selection/publication/service");

const LONG_TOKEN = "a".repeat(43);
function monthsFromNow(months) { const date = new Date(); date.setMonth(date.getMonth() + months); return date; }
function publication(overrides = {}) { return { projectId: "project-1", status: "PUBLISHED", shortCode: "A7K9C2", publishedAt: monthsFromNow(-1), expiresAt: monthsFromNow(5), project: { deletedAt: null }, ...overrides }; }
function duplicateError() { const error = new Error("Unique constraint failed"); error.code = "P2002"; return error; }

test("generated codes are the documented length, alphabet, and not sequential", () => {
  const codes = Array.from({ length: 20 }, () => service.generateShortCode());
  for (const code of codes) {
    assert.equal(code.length, service.SHORT_CODE_LENGTH);
    for (const char of code) assert.ok(service.SHORT_CODE_ALPHABET.includes(char), `unexpected character ${char}`);
  }
  // Random, not a counter: twenty draws collapsing to one value would only happen by patching Math.
  assert.ok(new Set(codes).size > 1);
});

test("ensureShortCode never rewrites a code a client already has", async () => {
  let writes = 0;
  repository.setShortCode = async () => { writes += 1; };
  const existing = publication();
  assert.equal(await service.ensureShortCode(existing), existing);
  assert.equal(writes, 0);
});

test("ensureShortCode assigns a code and retries past a collision", async () => {
  const attempted = [];
  repository.setShortCode = async (projectId, code) => {
    attempted.push(code);
    if (attempted.length === 1) throw duplicateError();
    return { shortCode: code };
  };
  const result = await service.ensureShortCode(publication({ shortCode: null }));
  assert.equal(attempted.length, 2);
  assert.notEqual(attempted[0], attempted[1]);
  assert.equal(result.shortCode, attempted[1]);
});

test("ensureShortCode gives up after exhausting its attempts", async () => {
  repository.setShortCode = async () => { throw duplicateError(); };
  await assert.rejects(() => service.ensureShortCode(publication({ shortCode: null }), 3), { status: 500 });
});

test("ensureShortCode surfaces database errors that are not collisions", async () => {
  repository.setShortCode = async () => { throw new Error("connection lost"); };
  await assert.rejects(() => service.ensureShortCode(publication({ shortCode: null })), /connection lost/);
});

test("authorize resolves a short code through the short-code lookup, uppercased", async () => {
  const lookups = [];
  repository.findByShortCode = async (code) => { lookups.push(code); return publication(); };
  repository.findByTokenHash = async () => { throw new Error("wrong lookup"); };
  assert.equal((await service.authorize("a7k9c2")).projectId, "project-1");
  assert.deepEqual(lookups, ["A7K9C2"]);
});

test("authorize still resolves a legacy 43-character token by its hash", async () => {
  const hashes = [];
  repository.findByTokenHash = async (hash) => { hashes.push(hash); return publication(); };
  repository.findByShortCode = async () => { throw new Error("wrong lookup"); };
  assert.equal((await service.authorize(LONG_TOKEN)).projectId, "project-1");
  assert.equal(hashes.length, 1);
});

test("authorize refuses identifiers that are neither token nor code without touching the database", async () => {
  repository.findByTokenHash = async () => { throw new Error("queried"); };
  repository.findByShortCode = async () => { throw new Error("queried"); };
  for (const bad of ["abc", "has space", "way-too-long-for-a-code", "A7K9!X", "a".repeat(44)]) {
    await assert.rejects(() => service.authorize(bad), { status: 404 });
  }
});

test("an unknown or unpublished short code is refused as not found", async () => {
  // findByShortCode filters on status PUBLISHED, so a revoked or never-published gallery
  // resolves to nothing — exactly the long token's behavior.
  repository.findByShortCode = async () => null;
  await assert.rejects(() => service.authorize("ZZZZZZ"), { status: 404 });
});

test("an expired gallery reached by short code is revoked and refused like the long link", async () => {
  const revoked = [];
  repository.findByShortCode = async () => publication({ publishedAt: monthsFromNow(-7), expiresAt: monthsFromNow(-1) });
  repository.revoke = async (projectId) => { revoked.push(projectId); };
  await assert.rejects(() => service.authorize("A7K9C2"), (error) => error.status === 410 && /expired/i.test(error.message));
  assert.deepEqual(revoked, ["project-1"]);
});

test("the gallery base URL prefers GALLERY_PUBLIC_URL and falls back to the frontend /g route", () => {
  const saved = { gallery: process.env.GALLERY_PUBLIC_URL, frontend: process.env.FRONTEND_URL };
  try {
    process.env.GALLERY_PUBLIC_URL = "https://gallery.dontblinkstudioz.com/";
    assert.equal(service.galleryBaseUrl(), "https://gallery.dontblinkstudioz.com");
    delete process.env.GALLERY_PUBLIC_URL;
    process.env.FRONTEND_URL = "http://localhost:3000";
    assert.equal(service.galleryBaseUrl(), "http://localhost:3000/g");
    delete process.env.FRONTEND_URL;
    assert.equal(service.galleryBaseUrl(), "http://localhost:3000/g");
  } finally {
    if (saved.gallery !== undefined) process.env.GALLERY_PUBLIC_URL = saved.gallery;
    if (saved.frontend !== undefined) process.env.FRONTEND_URL = saved.frontend;
  }
});

test("status() serializes the short client URL and backfills a publication that predates codes", async () => {
  const saved = process.env.GALLERY_PUBLIC_URL;
  try {
    process.env.GALLERY_PUBLIC_URL = "https://gallery.dontblinkstudioz.com";
    repository.findProject = async () => ({ id: "project-1", projectName: "Wedding", selectionValidUntil: null });
    repository.countReadyImages = async () => 3;
    repository.countSelectedImages = async () => 1;
    // An existing gallery published before the column existed: no code stored yet.
    repository.findByProject = async () => publication({ shortCode: null, tokenCipher: "not-decryptable", pinHash: null });
    const writes = [];
    repository.setShortCode = async (projectId, code) => { writes.push(code); return { shortCode: code }; };
    const result = await service.status("project-1");
    assert.equal(writes.length, 1);
    assert.equal(result.shortCode, writes[0]);
    assert.equal(result.clientUrl, `https://gallery.dontblinkstudioz.com/${writes[0]}`);
    // A second look at a gallery that now has its code changes nothing.
    repository.findByProject = async () => publication({ tokenCipher: "not-decryptable", pinHash: null });
    const again = await service.status("project-1");
    assert.equal(writes.length, 1);
    assert.equal(again.clientUrl, "https://gallery.dontblinkstudioz.com/A7K9C2");
  } finally {
    if (saved !== undefined) process.env.GALLERY_PUBLIC_URL = saved; else delete process.env.GALLERY_PUBLIC_URL;
  }
});

test("an unpublished project reports no short code or client URL", async () => {
  repository.findProject = async () => ({ id: "project-1", projectName: "Wedding", selectionValidUntil: null });
  repository.findByProject = async () => null;
  repository.countReadyImages = async () => 0;
  repository.countSelectedImages = async () => 0;
  const result = await service.status("project-1");
  assert.equal(result.status, "UNPUBLISHED");
  assert.equal(result.shortCode, null);
  assert.equal(result.clientUrl, null);
});
