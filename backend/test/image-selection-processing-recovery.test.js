const test = require("node:test");
const assert = require("node:assert/strict");

/**
 * The processing worker reads bytes from two places only: a legacy chunked upload under the
 * upload root, or an absolute path the server itself registered on the studio's drive or NAS.
 * A browser- or desktop-registered photo carries a RELATIVE trail that only that workstation can
 * resolve — the workstation posts the derivatives itself. Such a row must never be handed to the
 * worker (boot recovery used to), because reading it fails three times and flips the photo to
 * PROCESSING_FAILED while the workstation is still uploading it.
 */
test("the worker can only read bytes it holds or an absolute studio path", () => {
  const { isWorkerReadableSource } = require("../src/modules/image-selection/processing/service");
  assert.equal(isWorkerReadableSource({ originalPath: null }), true, "legacy chunked upload under the upload root");
  assert.equal(isWorkerReadableSource({ originalPath: "D:\\Studio\\Wedding\\IMG_1.jpg" }), true);
  assert.equal(isWorkerReadableSource({ originalPath: "/mnt/nas/wedding/IMG_1.jpg" }), true);
  assert.equal(isWorkerReadableSource({ originalPath: "\\\\nas\\studio\\IMG_1.jpg" }), true, "UNC share");
  assert.equal(isWorkerReadableSource({ originalPath: "Wedding/card 1/IMG_1.jpg" }), false, "a browser or desktop trail");
});

test("a row awaiting its derivatives from a workstation is left PROCESSING, never started or failed", async () => {
  const repository = require("../src/modules/image-selection/processing/repository");
  const service = require("../src/modules/image-selection/processing/service");
  const original = { findUpload: repository.findUpload, markStarted: repository.markStarted };
  let started = false;
  repository.findUpload = async () => ({ id: "u1", status: "PROCESSING", originalPath: "Wedding/IMG_1.jpg", storageRootId: "root1", storageName: "x", batchId: null });
  repository.markStarted = async () => { started = true; };
  try {
    await service.processUpload("u1");
    assert.equal(started, false);
  } finally { Object.assign(repository, original); }
});

test("boot recovery skips rows a workstation registered: their bytes never reach this server", () => {
  const { recoverableWhere } = require("../src/modules/image-selection/processing/queue");
  assert.deepEqual(recoverableWhere(), { status: "PROCESSING", storageRootId: null });
});
