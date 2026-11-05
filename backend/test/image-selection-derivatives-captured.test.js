const test = require("node:test");
const assert = require("node:assert/strict");

/*
 * Culling V2, phase 9 finding: a photo uploaded through Photo Selection's browser uploader lost its
 * capture time - the browser re-encodes the frame (a canvas keeps no EXIF) and the server never
 * heard the date - so bursts, similar series and story moments could not form on a web-uploaded
 * project. The browser now reads the EXIF date before re-encoding and sends `capturedAt` with the
 * same two derivatives; the server believes it only inside a sane window.
 */
const { saneCaptureDate } = require("../src/services/captureDate");

async function receive(body) {
  const sharp = require("sharp");
  const webp = await sharp({ create: { width: 48, height: 32, channels: 3, background: "#336699" } }).webp({ quality: 76 }).toBuffer();
  const jpeg = await sharp({ create: { width: 160, height: 100, channels: 3, background: "#996633" } }).jpeg({ quality: 82 }).toBuffer();
  const controller = require("../src/modules/image-selection/uploads/derivativeController");
  const repository = require("../src/modules/image-selection/uploads/repository");
  const processingRepository = require("../src/modules/image-selection/processing/repository");
  const r2 = require("../src/modules/image-selection/storage/r2");
  const faceHook = require("../src/modules/image-selection/faces/hook");
  const originals = { repository: { ...repository }, processingRepository: { ...processingRepository }, r2: { ...r2 }, faceHook: { ...faceHook } };
  const seen = { ready: null };
  Object.assign(repository, { findProject: async (id) => ({ id, projectName: "Wedding" }), findByOriginalPath: async () => null, createUpload: async (data) => ({ id: "upload-1", ...data }) });
  Object.assign(processingRepository, { markReady: async (id, batchId, data) => { seen.ready = data; return { width: 160, height: 100 }; } });
  Object.assign(r2, { isConfigured: () => true, putObject: async () => {} });
  Object.assign(faceHook, { enqueueAfterReady: () => {}, recordDeferred: () => Promise.resolve(null) });
  const req = { params: { projectId: "project-1" }, user: { id: "user-1" }, body: { fileName: "DSC00001.JPG", relativePath: "DSC00001.JPG", mimeType: "image/jpeg", sizeBytes: "1000", width: "160", height: "100", ...body }, files: { thumbnail: [{ buffer: webp, size: webp.length }], preview: [{ buffer: jpeg, size: jpeg.length }] } };
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
  try { await controller.receiveDerivatives(req, res); } finally {
    Object.assign(repository, originals.repository); Object.assign(processingRepository, originals.processingRepository); Object.assign(r2, originals.r2); Object.assign(faceHook, originals.faceHook);
  }
  return { res, ready: seen.ready };
}

test("the capture time the browser read is stored with the photo", async () => {
  const { res, ready } = await receive({ capturedAt: "2026-06-24T04:10:18.000Z" });
  assert.equal(res.statusCode, 201);
  assert.equal(ready.capturedAt.toISOString(), "2026-06-24T04:10:18.000Z");
});

test("no date, or a date outside the sane window, leaves the photo without one - never a refusal", async () => {
  assert.equal((await receive({})).ready.capturedAt, undefined);
  const silly = await receive({ capturedAt: "0001-01-01T00:00:00.000Z" });
  assert.equal(silly.res.statusCode, 201);
  assert.equal(silly.ready.capturedAt, undefined);
  assert.equal(saneCaptureDate("not a date"), null);
  assert.equal(saneCaptureDate(new Date(Date.now() + 3 * 86400000).toISOString()), null, "nothing after tomorrow");
});

test("the AI Event uploader reads the same helper", () => {
  assert.equal(require("../src/modules/ai-feature/media/uploadIntake").saneCaptureDate, saneCaptureDate);
});
