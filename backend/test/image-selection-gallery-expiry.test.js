const test = require("node:test");
const assert = require("node:assert/strict");
const repository = require("../src/modules/image-selection/publication/repository");
const service = require("../src/modules/image-selection/publication/service");

const TOKEN = "a".repeat(43);
function monthsFromNow(months) { const date = new Date(); date.setMonth(date.getMonth() + months); return date; }
function publication(overrides = {}) { return { projectId: "project-1", status: "PUBLISHED", publishedAt: monthsFromNow(-1), expiresAt: monthsFromNow(5), project: { deletedAt: null }, ...overrides }; }

test("a gallery published before the expiry column existed still ends six months in", () => {
  const publishedAt = new Date("2026-01-15T00:00:00.000Z");
  assert.equal(service.GALLERY_VALIDITY_MONTHS, 6);
  assert.deepEqual(service.expiryOf({ publishedAt, expiresAt: null }), new Date("2026-07-15T00:00:00.000Z"));
});

test("a stored expiry date wins over the six month fallback", () => {
  const expiresAt = new Date("2026-03-01T00:00:00.000Z");
  assert.equal(service.expiryOf({ publishedAt: new Date("2026-01-15T00:00:00.000Z"), expiresAt }), expiresAt);
});

test("an expired link is revoked and refused", async () => {
  const revoked = [];
  repository.findByTokenHash = async () => publication({ publishedAt: monthsFromNow(-7), expiresAt: monthsFromNow(-1) });
  repository.revoke = async (projectId) => { revoked.push(projectId); };
  await assert.rejects(() => service.authorize(TOKEN), (error) => error.status === 410 && /expired/i.test(error.message));
  assert.deepEqual(revoked, ["project-1"]);
});

test("a link inside its six month window is left alone", async () => {
  let revokeCalls = 0;
  repository.findByTokenHash = async () => publication();
  repository.revoke = async () => { revokeCalls += 1; };
  assert.equal((await service.authorize(TOKEN)).projectId, "project-1");
  assert.equal(revokeCalls, 0);
});
