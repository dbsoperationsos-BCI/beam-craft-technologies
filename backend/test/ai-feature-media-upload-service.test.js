const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const sharp = require("sharp");

/*
 * `media/service.upload` and `media/derivatives.derive` run for real - sharp and all - against
 * stubbed Prisma, storage, queue, activity and face engine, so the folder-first rule, the event's
 * compression recipe, the byte-for-byte passthrough and the metadata allow-list are exercised on
 * bytes rather than read off the source text.
 */
const MODULES = path.join(__dirname, "..", "src", "modules");
function stub(relative, exports) {
  const resolved = require.resolve(path.join(MODULES, relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports, children: [], paths: [] };
  return exports;
}

const calls = { put: [], enqueued: [], created: [], settingsReads: 0 };
let mediaSettings = {};
let existingByHash = new Map();
const prisma = {
  aiEventSetting: { findUnique: async () => { calls.settingsReads += 1; return { media: mediaSettings, ai: { faceRecognition: true } }; } },
  aiEventMediaFolder: { findFirst: async ({ where }) => (where.id === "f1" && where.eventId === "e1" ? { id: "f1" } : null) },
  aiEventMedia: {
    findFirst: async ({ where }) => (where.contentHash && existingByHash.has(where.contentHash) ? { id: existingByHash.get(where.contentHash) } : null),
    findUnique: async ({ where }) => ({ id: where.id, kind: "PHOTO", fileName: "old.jpg", sizeBytes: 1n }),
    create: async ({ data }) => { const row = { id: `m${calls.created.length + 1}`, ...data }; calls.created.push(row); return row; },
    groupBy: async () => [],
  },
};
stub("../config/db.js", prisma);
stub("ai-feature/shared/eventAccess.js", { loadEvent: async (eventId) => (eventId === "e1" ? { id: "e1" } : (() => { const e = new Error("Event not found."); e.status = 404; throw e; })()) });
stub("ai-feature/shared/storage.js", { publicUrl: (key) => (key ? `https://cdn/${key}` : null), putPublic: async (eventId, folder, extension, body, contentType) => { calls.put.push({ folder, extension, contentType, body }); return `${eventId}/${folder}/x.${extension}`; }, putPrivate: async () => "k", getPrivateObject: async () => null, deletePublicKeys: async () => {}, deletePrivateKeys: async () => {}, deleteEventObjects: async () => {}, isConfigured: () => true });
stub("ai-feature/shared/activity.js", { EVENTS: { MEDIA_UPLOADED: "MEDIA_UPLOADED", MEDIA_DELETED: "MEDIA_DELETED", AI_PROCESSING_RETRIED: "AI_PROCESSING_RETRIED" }, staffActor: (user) => user, guestActor: (guest) => guest, systemActor: () => ({}), record: async () => {}, list: async () => [], recent: async () => [] });
stub("ai-feature/processing/queue.js", { enqueueMedia: async (id) => { calls.enqueued.push(id); }, enqueueSelfie: async () => {}, recoverPending: async () => {}, requeueStaleDeferred: async () => {}, getQueue: () => null, QUEUE_NAME: "q", DEFERRED_GRACE_MS: 0 });
stub("ai-feature/face-engine/engine.js", { isReady: async () => false, unavailableReason: () => "off" });

const service = require("../src/modules/ai-feature/media/service");
const derivatives = require("../src/modules/ai-feature/media/derivatives");
const { saneCaptureDate, sourceOf, uploadFieldsSchema } = require("../src/modules/ai-feature/media/uploadIntake");

const reset = () => { calls.put.length = 0; calls.enqueued.length = 0; calls.created.length = 0; calls.settingsReads = 0; mediaSettings = {}; existingByHash = new Map(); };
async function photo({ width = 3000, height = 2000, exif = null, quality = 90 } = {}) {
  let pipeline = sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } }).jpeg({ quality });
  if (exif) pipeline = pipeline.withExif(exif);
  const buffer = await pipeline.toBuffer();
  return { buffer, mimetype: "image/jpeg", originalname: "DSC_0001.JPG", size: buffer.length };
}
const readExif = async (buffer) => { const meta = await sharp(buffer).metadata(); return meta.exif ? require("exif-reader")(meta.exif) : null; };

test("a staff upload naming no folder is refused with the workspace's sentence before settings are read or anything is stored", async () => {
  reset();
  const file = await photo();
  await assert.rejects(() => service.upload("e1", file, { userId: 7 }), (error) => error.status === 400 && error.message === service.FOLDER_REQUIRED);
  await assert.rejects(() => service.upload("e1", file, { userId: 7, folderId: "" }), { status: 400 });
  assert.equal(calls.settingsReads, 0, "refused before the event's settings were read");
  assert.equal(calls.put.length, 0);
  assert.equal(calls.created.length, 0);
});

test("a folder that is not the event's is refused as not found; nothing is stored", async () => {
  reset();
  const file = await photo();
  await assert.rejects(() => service.upload("e1", file, { userId: 7, folderId: "f-of-another-event" }), { status: 404, message: "Folder not found." });
  assert.equal(calls.put.length, 0);
});

test("a guest's upload names no folder and is accepted into the event, unfiled, and queued for faces", async () => {
  reset();
  const result = await service.upload("e1", await photo(), { guestId: "g1" });
  assert.equal(result.duplicate, false);
  assert.equal(calls.created[0].folderId, null);
  assert.equal(calls.created[0].aiStatus, "QUEUED");
  assert.deepEqual(calls.put.map((put) => [put.folder, put.extension, put.contentType]), [["previews", "jpg", "image/jpeg"], ["thumbnails", "webp", "image/webp"]]);
  assert.deepEqual(calls.enqueued, ["m1"]);
});

test("a staff upload into the event's folder is derived by the default recipe: 2048 px JPEG preview, 480 px WebP thumbnail, EXIF gone", async () => {
  reset();
  const file = await photo({ exif: { IFD0: { Make: "Canon", Model: "EOS R5" }, IFD3: { GPSLatitudeRef: "N", GPSLongitudeRef: "E" } } });
  const result = await service.upload("e1", file, { userId: 7, folderId: "f1" });
  assert.equal(result.media.folderId, "f1");
  const preview = await sharp(calls.put[0].body).metadata();
  assert.equal(Math.max(preview.width, preview.height), 2048);
  assert.equal(preview.exif, undefined, "the default strips every byte of metadata");
  const thumbnail = await sharp(calls.put[1].body).metadata();
  assert.equal(thumbnail.format, "webp");
  assert.equal(Math.max(thumbnail.width, thumbnail.height), 480);
});

test("the event's own presets are followed: a Compact preview, a Light JPEG thumbnail", async () => {
  reset();
  mediaSettings = { previewPreset: "compact", thumbnailPreset: "light", thumbnailFormat: "jpeg" };
  await service.upload("e1", await photo(), { userId: 7, folderId: "f1" });
  const preview = await sharp(calls.put[0].body).metadata();
  assert.equal(Math.max(preview.width, preview.height), 1200);
  assert.deepEqual([calls.put[1].extension, calls.put[1].contentType], ["jpg", "image/jpeg"]);
  const thumbnail = await sharp(calls.put[1].body).metadata();
  assert.equal(thumbnail.format, "jpeg");
  assert.equal(Math.max(thumbnail.width, thumbnail.height), 240);
});

test("a row that still names its recipe in numbers is read as the nearest presets", async () => {
  reset();
  mediaSettings = { previewMaxDimension: 1200, previewQuality: 70, thumbnailSize: 240, thumbnailFormat: "jpeg" };
  await service.upload("e1", await photo(), { userId: 7, folderId: "f1" });
  const preview = await sharp(calls.put[0].body).metadata();
  assert.equal(Math.max(preview.width, preview.height), 1200, "1200 is Compact");
  const thumbnail = await sharp(calls.put[1].body).metadata();
  assert.equal(Math.max(thumbnail.width, thumbnail.height), 240, "240 is Light");
});

test("a thumbnail the client cut from the original is kept beside a kept preview; one that does not fit is derived here instead", async () => {
  reset();
  const optimized = await sharp({ create: { width: 2048, height: 1365, channels: 3, background: { r: 1, g: 2, b: 3 } } }).jpeg({ quality: 84, mozjpeg: true }).toBuffer();
  const thumbnail = await sharp({ create: { width: 480, height: 320, channels: 3, background: { r: 9, g: 9, b: 9 } } }).webp({ quality: 76 }).toBuffer();
  const source = sourceOf(uploadFieldsSchema.parse({ sourceFingerprint: "d".repeat(64), clientOptimized: "true" }));
  await service.upload("e1", { buffer: optimized, mimetype: "image/jpeg", originalname: "x.jpg", size: optimized.length }, { userId: 7, folderId: "f1", source, thumbnail: { buffer: thumbnail } });
  assert.ok(calls.put[1].body.equals(thumbnail), "the client's thumbnail is stored byte for byte");

  reset();
  const tooWide = await sharp({ create: { width: 900, height: 600, channels: 3, background: "#123456" } }).webp().toBuffer();
  await service.upload("e1", { buffer: optimized, mimetype: "image/jpeg", originalname: "x.jpg", size: optimized.length }, { userId: 7, folderId: "f1", source, thumbnail: { buffer: tooWide } });
  assert.equal(calls.put[1].body.equals(tooWide), false, "wider than the event's thumbnail edge: derived here");
  assert.equal(Math.max((await sharp(calls.put[1].body).metadata()).width, (await sharp(calls.put[1].body).metadata()).height), 480);

  reset();
  const jpegNamedWebp = await sharp({ create: { width: 480, height: 320, channels: 3, background: "#123456" } }).jpeg().toBuffer();
  await service.upload("e1", { buffer: optimized, mimetype: "image/jpeg", originalname: "x.jpg", size: optimized.length }, { userId: 7, folderId: "f1", source, thumbnail: { buffer: jpegNamedWebp } });
  assert.equal((await sharp(calls.put[1].body).metadata()).format, "webp", "the bytes decide the format, not the field name");

  reset();
  const whole = await photo();
  await service.upload("e1", whole, { userId: 7, folderId: "f1", thumbnail: { buffer: thumbnail } });
  assert.equal(calls.put[1].body.equals(thumbnail), false, "beside a whole original the thumbnail is cut from that original, never taken on trust");
});

test("no original is ever stored, whatever an older event row still says: only the preview and thumbnail reach R2", async () => {
  reset();
  mediaSettings = { keepOriginals: true, compressionEnabled: false };
  await service.upload("e1", await photo(), { userId: 7, folderId: "f1" });
  assert.deepEqual(calls.put.map((put) => put.folder), ["previews", "thumbnails"]);
  assert.equal(calls.created[0].originalKey, null);
  assert.equal(calls.created[0].kind, "PHOTO");

  reset();
  mediaSettings = { keepOriginals: true };
  const optimized = await sharp({ create: { width: 2048, height: 1365, channels: 3, background: { r: 1, g: 2, b: 3 } } }).jpeg({ quality: 84, mozjpeg: true }).toBuffer();
  const source = sourceOf(uploadFieldsSchema.parse({ sourceFingerprint: "e".repeat(64), clientOptimized: "true" }));
  await service.upload("e1", { buffer: optimized, mimetype: "image/jpeg", originalname: "x.jpg", size: optimized.length }, { userId: 7, folderId: "f1", source });
  assert.deepEqual(calls.put.map((put) => put.folder), ["previews", "thumbnails"]);
  assert.equal(calls.created[0].originalKey, null);
});

test("a video is refused before anything is stored, even on an event saved with video upload on", async () => {
  reset();
  mediaSettings = { videoUpload: true, allowedFormats: ["jpg", "mp4", "mov"] };
  const clip = { buffer: Buffer.from("not really a video"), mimetype: "video/mp4", originalname: "clip.mp4", size: 18 };
  await assert.rejects(() => service.upload("e1", clip, { userId: 7, folderId: "f1" }), (error) => error.status === 415 && error.message === service.PHOTOS_ONLY);
  await assert.rejects(() => service.upload("e1", { ...clip, mimetype: "video/quicktime", originalname: "clip.mov" }, { guestId: 3 }), { status: 415 });
  assert.equal(calls.put.length, 0);
  assert.equal(calls.created.length, 0);
});

test("a file that cannot be decoded fails as a retryable 422 and nothing - least of all the file itself - is stored", async () => {
  reset();
  const corrupt = { buffer: Buffer.from("definitely not a jpeg"), mimetype: "image/jpeg", originalname: "broken.jpg", size: 21 };
  await assert.rejects(() => service.upload("e1", corrupt, { userId: 7, folderId: "f1" }), { status: 422 });
  assert.equal(calls.put.length, 0);
  assert.equal(calls.created.length, 0);
});

test("keeping camera details keeps the allow-list and never the location", async () => {
  reset();
  mediaSettings = { preserveMetadata: true };
  const file = await photo({ exif: { IFD0: { Make: "Canon", Model: "EOS R5", Software: "Firmware 1.8" }, IFD2: { DateTimeOriginal: "2026:09:12 10:15:30", LensModel: "RF 50mm" }, IFD3: { GPSLatitudeRef: "N", GPSLongitudeRef: "E", GPSMapDatum: "WGS-84" } } });
  assert.ok((await readExif(file.buffer))?.GPSInfo, "the fixture really carries a GPS block");
  await service.upload("e1", file, { userId: 7, folderId: "f1" });
  const kept = await readExif(calls.put[0].body);
  assert.equal(kept.Image.Make, "Canon");
  assert.equal(kept.Image.Model, "EOS R5");
  assert.equal(kept.Photo.LensModel, "RF 50mm");
  assert.ok(kept.Photo.DateTimeOriginal, "the capture time is kept");
  assert.equal(kept.GPSInfo, undefined, "the GPS block is never written to a public preview");
  assert.equal(kept.Image.GPSTag, undefined);
});

test("an optimized upload that fits the recipe is kept byte for byte, filed under the source fingerprint, dated by the client's reading; one carrying metadata is re-derived", async () => {
  reset();
  const optimized = await sharp({ create: { width: 2048, height: 1365, channels: 3, background: { r: 1, g: 2, b: 3 } } }).jpeg({ quality: 84, mozjpeg: true }).toBuffer();
  assert.equal(derivatives.hasOnlyImageMarkers(optimized), true);
  const fingerprint = "a".repeat(64);
  const source = sourceOf(uploadFieldsSchema.parse({ sourceFingerprint: fingerprint, clientOptimized: "true", sourceFileName: "Wedding\\Bride\\DSC_0001.JPG", sourceCapturedAt: "2026-09-12T10:15:30.000Z" }));
  const result = await service.upload("e1", { buffer: optimized, mimetype: "image/jpeg", originalname: "DSC_0001.jpg", size: optimized.length }, { userId: 7, folderId: "f1", source });
  assert.equal(result.duplicate, false);
  assert.ok(calls.put[0].body.equals(optimized), "the preview is the bytes that arrived");
  assert.equal(calls.created[0].contentHash, fingerprint);
  assert.equal(calls.created[0].fileName, "DSC_0001.JPG", "a name, never a path");
  assert.equal(calls.created[0].capturedAt.toISOString(), "2026-09-12T10:15:30.000Z");

  reset();
  mediaSettings = { preserveMetadata: true };
  const withExif = await sharp(optimized).withExif({ IFD0: { Make: "Canon" }, IFD3: { GPSLatitudeRef: "N" } }).toBuffer();
  await service.upload("e1", { buffer: withExif, mimetype: "image/jpeg", originalname: "x.jpg", size: withExif.length }, { userId: 7, folderId: "f1", source: sourceOf(uploadFieldsSchema.parse({ clientOptimized: "true" })) });
  assert.equal(calls.put[0].body.equals(withExif), false, "metadata inside means the full recipe, whatever the event's setting");
  assert.equal((await readExif(calls.put[0].body))?.GPSInfo, undefined);
});

test("a fingerprint already in the event answers the existing row before any decoding or storage", async () => {
  reset();
  existingByHash.set("b".repeat(64), "m-old");
  const source = sourceOf(uploadFieldsSchema.parse({ sourceFingerprint: "b".repeat(64), clientOptimized: "true" }));
  const result = await service.upload("e1", { buffer: Buffer.from("not even an image"), mimetype: "image/jpeg", originalname: "x.jpg", size: 17 }, { userId: 7, folderId: "f1", source });
  assert.equal(result.duplicate, true);
  assert.equal(result.media.id, "m-old");
  assert.equal(calls.put.length, 0);
});

test("a wrong fingerprint on a whole-file upload is refused", async () => {
  reset();
  const source = sourceOf(uploadFieldsSchema.parse({ sourceFingerprint: "c".repeat(64) }));
  const file = await photo();
  await assert.rejects(() => service.upload("e1", file, { userId: 7, folderId: "f1", source }), { status: 422 });
  assert.equal(calls.put.length, 0);
});

test("the passthrough takes only the segments a plain image needs: a comment or a stray APPn means the full recipe", async () => {
  const plain = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#123456" } }).jpeg().toBuffer();
  assert.equal(derivatives.hasOnlyImageMarkers(plain), true);
  const comment = Buffer.from([0xff, 0xfe, 0x00, 0x07, 0x68, 0x65, 0x6c, 0x6c, 0x6f]);
  assert.equal(derivatives.hasOnlyImageMarkers(Buffer.concat([plain.subarray(0, 2), comment, plain.subarray(2)])), false, "COM");
  const app15 = Buffer.from([0xff, 0xef, 0x00, 0x04, 0x00, 0x00]);
  assert.equal(derivatives.hasOnlyImageMarkers(Buffer.concat([plain.subarray(0, 2), app15, plain.subarray(2)])), false, "APP15");
  assert.equal(derivatives.hasOnlyImageMarkers(Buffer.from([0xff, 0xd8, 0xff, 0xd9])), false, "no scan at all");
});

test("a client's capture time is believed only inside 1990 to tomorrow", () => {
  assert.equal(saneCaptureDate("2026-09-12T10:15:30.000Z").toISOString(), "2026-09-12T10:15:30.000Z");
  assert.equal(saneCaptureDate("0001-01-01T00:00:00.000Z"), null);
  assert.equal(saneCaptureDate("1989-12-31T23:59:59.000Z"), null);
  assert.equal(saneCaptureDate("9999-12-31T00:00:00.000Z"), null);
  assert.equal(saneCaptureDate(new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()), null);
  assert.equal(saneCaptureDate(""), null);
  assert.equal(sourceOf(uploadFieldsSchema.parse({ sourceCapturedAt: "9999-12-31T00:00:00Z" })).capturedAt, null);
});
