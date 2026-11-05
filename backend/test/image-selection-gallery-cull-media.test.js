const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/**
 * A photo a finalized cull hid is off every client surface — including its media routes, which
 * used to resolve any READY photo by id. The staff media route stays unfiltered on purpose: the
 * Photo Culling workspace shows culled photos through it.
 */
test("public media resolves cull-eligible photos only; the staff route stays unfiltered", async () => {
  const repository = require("../src/modules/image-selection/gallery/repository");
  const service = require("../src/modules/image-selection/gallery/service");
  const original = { findReadyImage: repository.findReadyImage, findPublishedImage: repository.findPublishedImage };
  repository.findReadyImage = async () => ({ id: "i1", thumbnailKey: "k/t.webp", previewKey: "k/p.jpg" });
  // The eligible lookup finds nothing: the photo carries a cull stamp.
  repository.findPublishedImage = async () => null;
  try {
    await assert.rejects(() => service.media("p1", "i1", "thumbnail", { eligibleOnly: true }), { status: 404 });
    const staff = await service.media("p1", "i1", "thumbnail");
    assert.ok(staff.redirectUrl || staff.path, "the staff route still serves the culled photo");
  } finally { Object.assign(repository, original); }
});

test("the client gallery's media routes ask for eligible photos only", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "image-selection", "public-gallery", "controller.js"), "utf8");
  assert.match(source, /galleryService\.media\(publication\.projectId, params\.imageId, type, \{ eligibleOnly: true \}\)/);
});
