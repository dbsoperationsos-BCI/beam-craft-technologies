const { test, before, after } = require("node:test");
// CI has no .env: the token this suite signs and checks needs a key of its own, as every other suite sets.
process.env.JWT_SECRET = process.env.JWT_SECRET || "client-portal-reviews-test-secret";
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");
const { retrying } = require("./helpers/retrying");
const albumSecurity = require("../src/modules/image-selection/album-proofs/security");
const { getClientReviews } = require("../src/modules/client/portal/controller");

/*
 * What the client portal says is waiting for the client: a live Image Selection gallery not yet
 * submitted, and an album in CLIENT_REVIEW with a live publication - each with its link and PIN, and
 * only for the client's own project. Real rows, removed at the end.
 */

const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TCPR-${STAMP}-${name}`;
const code = (name) => `${name}${STAMP}`.slice(0, 8).toUpperCase();
const F = {};
const DAY = 86400000;

const leadFor = (enquiryId) => retrying(() => prisma.salesCrmLead.upsert({ where: { enquiryId }, create: { enquiryId, name: enquiryId }, update: {} }));
const projectData = (name) => ({
  enquiryId: tag(`enq-${name}`), eventId: tag(`ev-${name}`), whatsappGroupName: `WED ${name} ${STAMP}`, clientMainNumber: "+919876543210",
  sourceBranch: "Erode TN", vertical: "WED", deliverables: "[]", initialConvertedValue: 100000, crmName: "Test",
  projectStatus: "Work in Progress - Post Production",
});
const selectionProject = (salesProjectId, albumProofing) => retrying(() => prisma.imageSelectionProject.create({
  data: { projectName: tag(albumProofing ? "albums" : "gallery"), salesProjectId, albumProofing },
}));
const galleryPublication = (projectId, name, data = {}) => prisma.imageSelectionGalleryPublication.create({ data: {
  projectId, tokenHash: `${tag(name)}`.padEnd(64, "0").slice(0, 64), tokenCipher: "x", shortCode: code(name), status: "PUBLISHED", ...data,
} });

before(async () => {
  await leadFor(tag("enq-mine"));
  await leadFor(tag("enq-theirs"));
  F.mine = await retrying(() => prisma.salesProject.create({ data: projectData("mine") }));
  F.theirs = await retrying(() => prisma.salesProject.create({ data: projectData("theirs") }));
  F.client = await prisma.user.create({ data: { name: "Client", email: null, username: tag("client").toLowerCase(), password: "x", role: "CLIENT", status: "ACTIVE", clientProjectId: F.mine.id } });

  // My gallery: published, live, one item still to choose for, one already sent.
  F.gallery = await selectionProject(F.mine.id, false);
  await galleryPublication(F.gallery.id, "g1", { pinCipher: null, expiresAt: new Date(Date.now() + 30 * DAY) });
  await prisma.imageSelectionDeliverableConfig.create({ data: { imageSelectionProjectId: F.gallery.id, name: "Premium Album", manualShootName: "Engagement" } });
  await prisma.imageSelectionDeliverableConfig.create({ data: { imageSelectionProjectId: F.gallery.id, name: "Mini Album", manualShootName: "Wedding", selectionSubmittedAt: new Date() } });

  // Their gallery: also live - must never reach my list.
  F.theirGallery = await selectionProject(F.theirs.id, false);
  await galleryPublication(F.theirGallery.id, "g2", { expiresAt: new Date(Date.now() + 30 * DAY) });

  // My albums: one waiting for me, one still with the studio.
  F.albums = await selectionProject(F.mine.id, true);
  const album = (name, status) => prisma.albumProof.create({ data: { projectId: F.albums.id, name, albumType: "Wedding Album", status, revisionLimit: 3, revisionsUsed: 1 } });
  F.waiting = await album("Wedding Album", "CLIENT_REVIEW");
  F.studio = await album("Reception Album", "QC_REVIEW");
  for (const a of [F.waiting, F.studio]) {
    const version = await prisma.albumProofVersion.create({ data: { albumId: a.id, versionNumber: 2 } });
    await prisma.albumProofClientPublication.create({ data: {
      albumId: a.id, versionId: version.id, revisionNumber: 2, shortCode: code(`p${a.name.length}`),
      tokenHash: tag(`t-${a.id}`).padEnd(64, "0").slice(0, 64), tokenCipher: "x",
      pinHash: "x", pinCipher: albumSecurity.encryptValue("4821"), publishedAt: new Date("2026-10-14T12:40:00.000Z"),
    } });
  }
});

after(async () => {
  // Deleting the selection projects cascades to their publications, items, albums and versions.
  await prisma.imageSelectionProject.deleteMany({ where: { projectName: { startsWith: `TCPR-${STAMP}` } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: `tcpr-${STAMP}` } } });
  await prisma.salesProject.deleteMany({ where: { eventId: { startsWith: `TCPR-${STAMP}` } } });
  await prisma.salesCrmLead.deleteMany({ where: { enquiryId: { startsWith: `TCPR-${STAMP}` } } });
  await prisma.$disconnect();
});

async function answer(req) {
  const out = { code: 200, body: null, headers: {} };
  const res = {
    set: (name, value) => { out.headers[name] = value; return res; },
    status: (status) => { out.code = status; return res; },
    json: (body) => { out.body = body; return res; },
  };
  await getClientReviews(req, res);
  return out;
}
const asClient = (extra = {}) => ({ user: { id: F.client.id, role: "CLIENT" }, params: {}, query: {}, ...extra });

test("a client sees what is waiting for them - their own gallery and album only", async () => {
  // An id in the request is never what is read: the account decides.
  const { code: status, body, headers } = await answer(asClient({ params: { id: F.theirs.id }, query: { id: F.theirs.id } }));
  assert.equal(status, 200);
  assert.equal(headers["Cache-Control"], "no-store");
  const kinds = body.data.reviews.map((review) => review.kind).sort();
  assert.deepEqual(kinds, ["album", "images"], "my gallery and my waiting album - not theirs, not the album still with the studio");

  const images = body.data.reviews.find((review) => review.kind === "images");
  // Every item, with how far the client has got: the one still to choose for, and the one already sent.
  assert.deepEqual(images.items.map(({ name, shoot, chosen, submittedAt }) => ({ name, shoot, chosen, sent: Boolean(submittedAt) })), [
    { name: "Premium Album", shoot: "Engagement", chosen: 0, sent: false },
    { name: "Mini Album", shoot: "Wedding", chosen: 0, sent: true },
  ]);
  assert.equal(images.state, "waiting");
  assert.equal(images.status, "Waiting for your selection");
  assert.ok(images.progress.sharedAt, "when the gallery was shared");
  assert.equal(images.progress.submittedAt, null);
  assert.match(images.url, new RegExp(`/${code("g1")}$`));
  assert.equal(images.pin, null, "a gallery without a PIN says so");

  const album = body.data.reviews.find((review) => review.kind === "album");
  assert.equal(album.title, "Wedding Album");
  assert.equal(album.version, 2);
  assert.deepEqual(album.round, { number: 2, max: 3 });
  assert.equal(album.pin, "4821");
  assert.match(album.url, /\/p\/[A-Z0-9]+$/);
  assert.equal(album.sharedAt, "2026-10-14T12:40:00.000Z");
});

test("a submitted gallery stays, marked submitted; a lapsed or revoked one never sent is gone", async () => {
  const publication = await prisma.imageSelectionGalleryPublication.findUnique({ where: { projectId: F.gallery.id } });
  const kinds = async () => (await answer(asClient())).body.data.reviews.map((review) => review.kind);
  const gallery = async () => (await answer(asClient())).body.data.reviews.find((review) => review.kind === "images");
  try {
    await prisma.imageSelectionGalleryPublication.update({ where: { id: publication.id }, data: { selectionSubmittedAt: new Date() } });
    const sent = await gallery();
    assert.equal(sent.state, "submitted");
    assert.equal(sent.status, "Selection submitted");
    assert.ok(sent.progress.submittedAt);
    // The studio downloading the selection is the last step the client sees.
    await prisma.imageSelectionProject.update({ where: { id: F.gallery.id }, data: { selectedDownloadedAt: new Date() } });
    assert.equal((await gallery()).status, "Received by the studio");
    await prisma.imageSelectionProject.update({ where: { id: F.gallery.id }, data: { selectedDownloadedAt: null } });
    await prisma.imageSelectionGalleryPublication.update({ where: { id: publication.id }, data: { selectionSubmittedAt: null, expiresAt: new Date(Date.now() - DAY) } });
    assert.deepEqual(await kinds(), ["album"]);
    await prisma.imageSelectionGalleryPublication.update({ where: { id: publication.id }, data: { expiresAt: new Date(Date.now() + DAY), status: "REVOKED", revokedAt: new Date() } });
    assert.deepEqual(await kinds(), ["album"]);
  } finally {
    await prisma.imageSelectionGalleryPublication.update({ where: { id: publication.id }, data: { selectionSubmittedAt: null, expiresAt: new Date(Date.now() + 30 * DAY), status: "PUBLISHED", revokedAt: null } });
  }
});

test("a client with no project of its own is told so", async () => {
  const orphan = await prisma.user.create({ data: { name: "Orphan", email: null, username: tag("orphan").toLowerCase(), password: "x", role: "CLIENT", status: "ACTIVE" } });
  assert.equal((await answer({ user: { id: orphan.id, role: "CLIENT" }, params: {}, query: {} })).code, 404);
});
