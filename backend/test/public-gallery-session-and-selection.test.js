const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const publicationService = require("../src/modules/image-selection/publication/service");
const publicationRepository = require("../src/modules/image-selection/publication/repository");
const galleryRepository = require("../src/modules/image-selection/gallery/repository");
const galleryService = require("../src/modules/image-selection/gallery/service");
const deliverableService = require("../src/modules/image-selection/deliverables/service");
const controller = require("../src/modules/image-selection/public-gallery/controller");

process.env.JWT_SECRET = process.env.JWT_SECRET || "public-gallery-session-test-secret";

const fakeRes = () => { const res = { statusCode: 200, body: null }; res.status = (code) => { res.statusCode = code; return res; }; res.json = (body) => { res.body = body; return res; }; return res; };
const publication = (pinHash) => ({ projectId: "proj", pinHash, status: "PUBLISHED", publishedAt: new Date(), expiresAt: new Date(Date.now() + 86400000), project: { projectName: "Arun & Meena", deletedAt: null } });

/** Swaps module exports for the length of one test and puts every one of them back. */
async function withStubs(stubs, run) {
  const saved = stubs.map(([target, key]) => [target, key, target[key]]);
  for (const [target, key, value] of stubs) target[key] = value;
  try { await run(); } finally { for (const [target, key, value] of saved) target[key] = value; }
}

test("a PIN session carries the PIN's marker and is refused once the PIN changes; a marker-less one is not", async () => {
  const firstHash = await bcrypt.hash("1234", 4);
  await withStubs([[publicationRepository, "findByShortCode", async () => publication(firstHash)], [publicationRepository, "markGalleryOpened", async () => {}]], async () => {
    const { sessionToken } = await publicationService.verifyPin("ABCD23", "1234");
    const session = publicationService.verifySession("ABCD23", `Bearer ${sessionToken}`);
    assert.match(session.pv, /^[0-9a-f]{16}$/);
    assert.ok(!sessionToken.includes(firstHash), "the hash itself never travels");
    publicationService.assertSessionCurrent(session, publication(firstHash));
    const secondHash = await bcrypt.hash("9876", 4);
    assert.throws(() => publicationService.assertSessionCurrent(session, publication(secondHash)), (error) => error.status === 401 && /enter the PIN again/.test(error.message));
    // Issued before the marker existed: still let in.
    const legacy = jwt.verify(jwt.sign({ scope: "image-selection-gallery-session", galleryToken: "ABCD23", projectId: "proj" }, process.env.JWT_SECRET), process.env.JWT_SECRET);
    publicationService.assertSessionCurrent(legacy, publication(secondHash));
  });
});

// The controller tests below stub the publication, deliverables and gallery layers.
const request = (params, body = {}, query = {}) => ({ params: { token: "ABCD23", ...params }, body, query, headers: { authorization: "Bearer session" } });
const items = (list) => () => ({ list: async () => list });
const baseStubs = (session, pinHash = "hash", offered = []) => [
  [publicationService, "verifySession", () => session],
  [publicationService, "authorize", async () => publication(pinHash)],
  [publicationService, "recordClientActivity", async () => {}],
  [publicationService, "recordGalleryOpened", async () => {}],
  [deliverableService, "createDeliverableService", items(offered)],
];

test("a pick from a session opened with an old PIN is refused before anything is written", async () => {
  let wrote = false;
  const stale = { scope: "image-selection-gallery-session", projectId: "proj", pv: "0000000000000000" };
  await withStubs([...baseStubs(stale), [galleryService, "setSelection", async () => { wrote = true; }]], async () => {
    const res = fakeRes();
    await controller.updateSelection(request({ imageId: "img" }, { selected: true }), res);
    assert.equal(res.statusCode, 401);
    assert.equal(wrote, false);
  });
});

test("a project-wide pick is refused where the project offers selection items, and allowed where it offers none", async () => {
  const offered = [{ id: "frames", name: "Frames", enabled: true, inactiveAt: null, selectionLimit: 10 }];
  const calls = [];
  const setSelection = async (projectId, imageId, selected) => { calls.push(imageId); return { imageId, selected }; };
  await withStubs([...baseStubs({ projectId: "proj" }, "hash", offered), [galleryService, "setSelection", setSelection]], async () => {
    const res = fakeRes();
    await controller.updateSelection(request({ imageId: "img" }, { selected: true }), res);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(calls, []);
  });
  // A retired item is not offered, so a gallery left with only retired ones is the legacy path.
  await withStubs([...baseStubs({ projectId: "proj" }, "hash", [{ ...offered[0], inactiveAt: new Date() }]), [galleryService, "setSelection", setSelection]], async () => {
    const res = fakeRes();
    await controller.updateSelection(request({ imageId: "img" }, { selected: true }), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(calls, ["img"]);
  });
});

test("a retired selection item can be neither picked for nor cleared", async () => {
  const retired = [{ id: "frames", name: "Frames", enabled: true, inactiveAt: new Date(), selectionLimit: 10 }];
  let touched = false;
  await withStubs([...baseStubs({ projectId: "proj" }, "hash", retired), [galleryRepository, "selectDeliverableWithinLimit", async () => { touched = true; return { count: 1 }; }], [galleryRepository, "clearDeliverableSelections", async () => { touched = true; return { count: 3 }; }]], async () => {
    const pick = fakeRes(); await controller.updateSelection(request({ imageId: "img" }, { selected: true, deliverableConfigId: "frames" }), pick);
    const clear = fakeRes(); await controller.clearSelection(request({}, { deliverableConfigId: "frames" }), clear);
    assert.equal(pick.statusCode, 404); assert.equal(clear.statusCode, 404); assert.equal(touched, false);
  });
});

test("a pick goes through the locked count-and-write, and a full item answers the limit", async () => {
  const offered = [{ id: "frames", name: "Frames", enabled: true, inactiveAt: null, selectionLimit: 2 }];
  const seen = [];
  await withStubs([...baseStubs({ projectId: "proj" }, "hash", offered), [galleryRepository, "selectDeliverableWithinLimit", async (projectId, imageId, configId, limit) => { seen.push([projectId, imageId, configId, limit]); return seen.length === 1 ? { count: 1 } : { count: 0, limitReached: true }; }]], async () => {
    const first = fakeRes(); await controller.updateSelection(request({ imageId: "a" }, { selected: true, deliverableConfigId: "frames" }), first);
    const second = fakeRes(); await controller.updateSelection(request({ imageId: "b" }, { selected: true, deliverableConfigId: "frames" }), second);
    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 409); assert.match(second.body.message, /up to 2 photos for Frames/);
    assert.deepEqual(seen[0], ["proj", "a", "frames", 2]);
  });
});

test("a gallery with no selection items reports the older selected flag as picked, in the grid and the folder counts", async () => {
  const image = { id: "a", folderId: "card-1", sizeBytes: 1, compressedSizeBytes: null, thumbnailKey: null, previewKey: null, selected: true, photoSelections: [] };
  await withStubs([...baseStubs({ projectId: "proj" }), [galleryRepository, "listPublishedImages", async () => ({ items: [image], total: 1 })]], async () => {
    const res = fakeRes();
    await controller.listFolderImages(request({ folderId: "card-1" }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.items[0].selected, true);
  });
  const folders = [{ id: "card-1", parentId: null, name: "card 1" }];
  assert.equal(galleryRepository.summarizeFolders(folders, [image], { legacySelected: true }).folders[0].selected, 1);
  // Where selection items exist the flag is not a pick for any of them.
  assert.equal(galleryRepository.summarizeFolders(folders, [image]).folders[0].selected, 0);
});

test("listSelected reads the older flag only for a gallery with no selection items", async () => {
  const asked = [];
  const listPublishedImages = async (projectId, page, pageSize, options) => { asked.push(options); return { items: [], total: 0 }; };
  await withStubs([...baseStubs({ projectId: "proj" }), [galleryRepository, "listPublishedImages", listPublishedImages]], async () => {
    await controller.listSelected(request({}, {}, {}), fakeRes());
  });
  await withStubs([...baseStubs({ projectId: "proj" }, "hash", [{ id: "frames", enabled: true, inactiveAt: null }]), [galleryRepository, "listPublishedImages", listPublishedImages]], async () => {
    await controller.listSelected(request({}, {}, {}), fakeRes());
  });
  assert.deepEqual(asked, [{ selected: "selected" }, { anyDeliverableSelection: true }]);
});
