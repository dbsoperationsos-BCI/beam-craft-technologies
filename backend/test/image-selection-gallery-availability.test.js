const test = require("node:test");
const assert = require("node:assert/strict");

/*
 * A published gallery stays published exactly while the client has a photo to look at, anywhere in
 * the project; with none left it is revoked as EMPTY, and published again - same token, PIN, short
 * URL and expiry - once one is back. The studio's own unpublish (MANUAL), a lapsed link (EXPIRED)
 * and a row revoked before reasons were recorded are never published again by this.
 *
 * The real publication repository and service run here against an in-memory database, so the
 * conditions they ask are the ones checked.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const DAY = 24 * 60 * 60 * 1000;
const db = { publication: null, uploads: [], folders: [] };

// Just enough of a Prisma `where` for the questions this module asks of photos.
function matches(upload, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return value.some((clause) => matches(upload, clause));
    if (key === "photoSelections") return false; // nothing here is picked
    if (key === "folderId" && value && typeof value === "object") return upload.folderId != null && !value.notIn.includes(upload.folderId);
    return (upload[key] ?? null) === value;
  });
}
const publicationMatches = (where) => db.publication && Object.entries(where).every(([key, value]) => (db.publication[key] ?? null) === value);
const withProject = () => (db.publication ? { ...db.publication, project: { id: db.publication.projectId, projectName: "Asha & Ravi", deletedAt: null, salesProject: null } } : null);

const dbPath = require.resolve("../src/config/db");
require(dbPath);
require.cache[dbPath].exports = {
  imageSelectionProject: { findFirst: async () => ({ id: "project", projectName: "Asha & Ravi", selectionValidUntil: null, salesProjectId: null }) },
  imageSelectionFolder: { findMany: async () => db.folders },
  imageSelectionUpload: { count: async ({ where }) => db.uploads.filter((upload) => matches(upload, where)).length },
  imageSelectionGalleryPublication: {
    findUnique: async () => (db.publication ? { ...db.publication } : null),
    findFirst: async ({ where }) => (publicationMatches(where) ? withProject() : null),
    update: async ({ data }) => { Object.assign(db.publication, data); return { ...db.publication }; },
    updateMany: async ({ where, data }) => { if (!publicationMatches(where)) return { count: 0 }; Object.assign(db.publication, data); return { count: 1 }; },
  },
};

const publication = require("../src/modules/image-selection/publication/service");

const published = (overrides = {}) => ({
  id: "pub-1", projectId: "project", status: "PUBLISHED", tokenHash: "hash", tokenCipher: "token-cipher", pinHash: "pin-hash", pinCipher: "pin-cipher",
  shortCode: "MBUM8D", publishedAt: new Date(), expiresAt: new Date(Date.now() + 180 * DAY), revokedAt: null, revokedReason: null, ...overrides,
});
const photo = (id, overrides = {}) => ({ id, projectId: "project", folderId: "card-1", status: "READY", cullRejectedAt: null, cullingHoldAt: null, editingHoldAt: null, selected: false, ...overrides });
const folder = (id, parentId = null, dateCreated = undefined) => ({ id, parentId, projectShoot: dateCreated === undefined ? null : { dateCreated } });
function reset({ pub = published(), uploads = [], folders = [folder("pre-wedding", null, new Date(Date.now() - DAY)), folder("card-1", "pre-wedding"), folder("wedding", null, new Date(Date.now() - DAY))] } = {}) {
  db.publication = pub; db.uploads = uploads; db.folders = folders;
}
const identity = () => ({ tokenCipher: db.publication.tokenCipher, pinCipher: db.publication.pinCipher, pinHash: db.publication.pinHash, shortCode: db.publication.shortCode, expiresAt: db.publication.expiresAt, publishedAt: db.publication.publishedAt });

test("one photo in one subfolder keeps the gallery published", async () => {
  reset({ uploads: [photo("p1", { folderId: "card-1" })] });
  assert.equal((await publication.syncAvailability("project")).status, "PUBLISHED");
});

test("photos left directly in another folder - or unfiled - keep it published after every subfolder is gone", async () => {
  reset({ uploads: [photo("p1", { folderId: "wedding" })], folders: [folder("wedding", null, new Date(Date.now() - DAY))] });
  assert.equal((await publication.syncAvailability("project")).status, "PUBLISHED");
  reset({ uploads: [photo("p1", { folderId: null })], folders: [] });
  assert.equal((await publication.syncAvailability("project")).status, "PUBLISHED");
});

test("with no client-visible photo left anywhere it is revoked as EMPTY, link and PIN kept", async () => {
  reset({ uploads: [] });
  const before = identity();
  const after = await publication.syncAvailability("project");
  assert.equal(after.status, "REVOKED");
  assert.equal(after.revokedReason, "EMPTY");
  assert.deepEqual(identity(), before, "token, PIN, short code, publish date and expiry untouched");
});

test("processing, culled, held and future-shoot photos do not count as something to see", async () => {
  reset({ uploads: [
    photo("processing", { status: "PROCESSING" }),
    photo("failed", { status: "PROCESSING_FAILED" }),
    photo("rejected", { cullRejectedAt: new Date() }),
    photo("in-culling", { cullingHoldAt: new Date() }),
    photo("in-editing", { editingHoldAt: new Date() }),
    photo("reception", { folderId: "reception" }),
  ], folders: [folder("reception", null, new Date(Date.now() + 3 * DAY))] });
  assert.equal((await publication.syncAvailability("project")).revokedReason, "EMPTY");
});

test("a photo back again publishes it again with the very same link and PIN", async () => {
  reset({ pub: published({ status: "REVOKED", revokedAt: new Date(), revokedReason: "EMPTY" }), uploads: [] });
  const before = identity();
  assert.equal((await publication.syncAvailability("project")).status, "REVOKED", "still nothing to see");
  db.uploads.push(photo("p1"));
  const after = await publication.syncAvailability("project");
  assert.equal(after.status, "PUBLISHED");
  assert.equal(after.revokedReason, null);
  assert.equal(after.revokedAt, null);
  assert.deepEqual(identity(), before);
});

test("the studio's own unpublish is never undone, even when photos are there", async () => {
  reset({ uploads: [photo("p1")] });
  await publication.revoke("project");
  assert.equal(db.publication.revokedReason, "MANUAL");
  assert.equal((await publication.syncAvailability("project")).status, "REVOKED");
  // A gallery held only for being empty, which the studio then switches off, stays off too.
  reset({ pub: published({ status: "REVOKED", revokedAt: new Date(), revokedReason: "EMPTY" }), uploads: [] });
  await publication.revoke("project");
  assert.equal(db.publication.revokedReason, "MANUAL");
  db.uploads.push(photo("p1"));
  assert.equal((await publication.syncAvailability("project")).status, "REVOKED");
});

test("a gallery revoked before reasons were recorded, or one that expired, is not published again", async () => {
  reset({ pub: published({ status: "REVOKED", revokedAt: new Date(), revokedReason: null }), uploads: [photo("p1")] });
  assert.equal((await publication.syncAvailability("project")).status, "REVOKED");
  reset({ pub: published({ status: "REVOKED", revokedAt: new Date(), revokedReason: "EXPIRED" }), uploads: [photo("p1")] });
  assert.equal((await publication.syncAvailability("project")).status, "REVOKED");
  // Lapsed while held for being empty: its expiry stands.
  reset({ pub: published({ status: "REVOKED", revokedAt: new Date(Date.now() - 2 * DAY), revokedReason: "EMPTY", expiresAt: new Date(Date.now() - DAY) }), uploads: [photo("p1")] });
  assert.equal((await publication.syncAvailability("project")).status, "REVOKED");
});

test("an expired link is revoked as EXPIRED, not as empty", async () => {
  reset({ pub: published({ expiresAt: new Date(Date.now() - DAY) }), uploads: [] });
  assert.equal((await publication.syncAvailability("project")).status, "PUBLISHED", "expiry is left to its own rule");
  await publication.status("project");
  assert.equal(db.publication.status, "REVOKED");
  assert.equal(db.publication.revokedReason, "EXPIRED");
});

test("the studio panel reads the gallery after the check: empty shows as unpublished, photos back show it published", async () => {
  reset({ uploads: [] });
  assert.equal((await publication.status("project")).status, "REVOKED");
  db.uploads.push(photo("p1"));
  const back = await publication.status("project");
  assert.equal(back.status, "PUBLISHED");
  assert.equal(back.shortCode, "MBUM8D", "the same short URL");
});

test("the client's link: held while empty with a clear message, the same link working again once a photo is in", async () => {
  reset({ pub: published({ status: "REVOKED", revokedAt: new Date(), revokedReason: "EMPTY" }), uploads: [] });
  await assert.rejects(publication.authorize("MBUM8D"), (error) => error.status === 404 && /not available yet/.test(error.message));
  db.uploads.push(photo("p1"));
  const found = await publication.authorize("MBUM8D");
  assert.equal(found.status, "PUBLISHED");
  assert.equal(found.pinHash, "pin-hash", "the PIN the client has still opens it");
  // A link the studio switched off is still the plain not-found it always was.
  reset({ pub: published({ status: "REVOKED", revokedAt: new Date(), revokedReason: "MANUAL" }), uploads: [photo("p1")] });
  await assert.rejects(publication.authorize("MBUM8D"), (error) => error.status === 404 && /Published gallery not found/.test(error.message));
});

test("every write path that changes what the client sees asks again, without waiting on it", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const read = (file) => fs.readFileSync(path.join(__dirname, "..", "src", "modules", "image-selection", file), "utf8");
  for (const file of ["processing/service.js", "uploads/derivativeController.js", "folders/service.js", "ai-editing/service.js"]) {
    assert.match(read(file), /require\("\.\.\/publication\/service"\)\.syncAvailabilitySoon\(/, file);
  }
  assert.equal((read("ai-culling/service.js").match(/syncAvailabilitySoon\(projectId\)/g) || []).length, 2, "culling finalize and reopen");
});
