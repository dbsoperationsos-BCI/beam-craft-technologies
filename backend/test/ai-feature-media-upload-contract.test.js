const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { uploadFieldsSchema, sourceOf } = require("../src/modules/ai-feature/media/uploadIntake");
const { isPreviewAlready, recipeFrom, PREVIEW_EDGE, THUMBNAIL_EDGE } = require("../src/modules/ai-feature/media/derivatives");
const { DEFAULTS, mergeGroup } = require("../src/modules/ai-feature/shared/settingsDefaults");
const { GROUP_SCHEMAS } = require("../src/modules/ai-feature/default-settings/validation");

/*
 * The optimized-upload contract of POST /api/ai-feature/events/:id/media/upload: a client that
 * made the preview itself may describe the source photo it no longer sends. Every field is
 * optional, so the oldest client - `file` alone - is answered exactly as before.
 */
const src = (relative) => fs.readFileSync(path.join(__dirname, "..", "src", "modules", relative), "utf8");
const FINGERPRINT = "5838f7fe053675b1c7a08b633df49e7af5495cee0493c7dcf6697200b85b5b91";

test("with no source fields the intake answers null: the whole-file contract", () => {
  const fields = uploadFieldsSchema.parse({});
  assert.equal(sourceOf(fields), null);
  assert.equal(sourceOf(uploadFieldsSchema.parse({ folderId: "f1", deferAi: "true" })), null, "folderId and deferAi are not source facts");
  assert.equal(sourceOf(uploadFieldsSchema.parse({ sourceSizeBytes: "" })), null, "an empty size field is not sent, not zero");
});

test("a full source description is normalised: lower-case digest, forward slashes, numeric size, optimized only when it says true", () => {
  const fields = uploadFieldsSchema.parse({ sourceFingerprint: FINGERPRINT.toUpperCase(), sourceSizeBytes: "8912345", sourceFileName: "DSC_1001.JPG", relativePath: "Wedding\\Bride\\DSC_1001.JPG", clientOptimized: " TRUE " });
  assert.deepEqual(sourceOf(fields), { fingerprint: FINGERPRINT, sizeBytes: 8912345, fileName: "DSC_1001.JPG", relativePath: "Wedding/Bride/DSC_1001.JPG", optimized: true, capturedAt: null });
  assert.equal(sourceOf(uploadFieldsSchema.parse({ clientOptimized: "yes" })).optimized, false);
});

test("the capture time an optimizing client read off the original is taken as a date, and only as an ISO datetime", () => {
  const source = sourceOf(uploadFieldsSchema.parse({ sourceCapturedAt: "2026-09-12T10:15:30.000Z" }));
  assert.equal(source.capturedAt.toISOString(), "2026-09-12T10:15:30.000Z");
  assert.equal(sourceOf(uploadFieldsSchema.parse({ sourceCapturedAt: "2026-09-12T15:45:30+05:30" })).capturedAt.toISOString(), "2026-09-12T10:15:30.000Z", "an offset is honoured");
  for (const bad of ["2026:09:12 10:15:30", "yesterday", "2026-09-12"]) assert.equal(uploadFieldsSchema.safeParse({ sourceCapturedAt: bad }).success, false, bad);
  const service = src("ai-feature/media/service.js");
  assert.match(service, /capturedAt: derived\.capturedAt \|\| source\?\.capturedAt \|\| null/, "the file's own EXIF wins; the client's reading stands in when the re-encode lost it");
});

test("a staff upload names a folder or is refused before anything is stored; a guest's is not asked to", () => {
  const service = src("ai-feature/media/service.js");
  assert.match(service, /const FOLDER_REQUIRED = "Select or create a folder before uploading media\.";/);
  const refusal = service.indexOf("if (!folderId && !guestId) throw httpError(400, FOLDER_REQUIRED);");
  const folderLookup = service.indexOf("const folder = await folderIn(eventId, folderId);");
  const firstWrite = service.indexOf("storage.putPublic(");
  assert.ok(refusal > 0 && refusal < folderLookup && folderLookup < firstWrite, "refused before the folder is looked up, long before any byte is stored");
  // The list without a folder is All Photos: no folder condition at all, so rows in no folder (a
  // guest's, a removed folder's, an older event's) are still listed.
  // All Photos is the folders' photos plus the guests'; a folder asked for by id is that folder alone.
  assert.match(service, /const where = query\.folderId \? \{ eventId, deletedAt: null, folderId: query\.folderId === "root" \? null : query\.folderId \} : \{ eventId, \.\.\.LISTED_MEDIA \};/);
  // Removing a folder never removes its media: the relation sets the folder to null.
  const schema = fs.readFileSync(path.join(__dirname, "..", "prisma", "schema.prisma"), "utf8");
  assert.match(schema, /folder\s+AiEventMediaFolder\? @relation\(fields: \[folderId\], references: \[id\], onDelete: SetNull\)/);
  assert.doesNotMatch(service, /aiEventMedia\.deleteMany\(\{ where: \{ folderId/);
});

test("the compression recipe is the event's preset pair through the shared presets, and its defaults are the recipe every older row was made with", () => {
  const defaults = recipeFrom();
  // `high` / `standard` ARE 2048 px q84 and 480 px WebP q76: the numbers the AI Feature has always derived with.
  assert.deepEqual(defaults, { previewPreset: "high", thumbnailPreset: "standard", previewEdge: 2048, previewQuality: 84, thumbnailEdge: 480, thumbnailQuality: 76, thumbnailFormat: "webp", thumbnailExtension: "webp", thumbnailMime: "image/webp", preserveMetadata: false });
  assert.equal(PREVIEW_EDGE, 2048);
  assert.equal(THUMBNAIL_EDGE, 480);
  assert.deepEqual(recipeFrom(null), defaults);
  const tuned = recipeFrom({ previewPreset: "compact", thumbnailPreset: "light", thumbnailFormat: "JPEG", preserveMetadata: true });
  assert.deepEqual(tuned, { previewPreset: "compact", thumbnailPreset: "light", previewEdge: 1200, previewQuality: 80, thumbnailEdge: 240, thumbnailQuality: 72, thumbnailFormat: "jpeg", thumbnailExtension: "jpg", thumbnailMime: "image/jpeg", preserveMetadata: true });
  // A row written before the presets existed named numbers: read as the nearest preset.
  const legacy = recipeFrom(mergeGroup("media", { previewMaxDimension: 1600, previewQuality: 70, thumbnailSize: 600 }));
  assert.equal(legacy.previewPreset, "standard");
  assert.equal(legacy.thumbnailPreset, "high");
  // A key that is not a preset, or a format that is not one the module stores, falls back rather than breaking.
  const wild = recipeFrom({ previewPreset: "ultra", thumbnailPreset: 480, thumbnailFormat: "gif", preserveMetadata: "yes" });
  assert.deepEqual(wild, defaults);
  // The settings themselves: every compression key has a default and is validated as a preset key.
  const keys = ["previewPreset", "thumbnailPreset", "thumbnailFormat", "uploadConcurrency", "compressionConcurrency", "preserveMetadata"];
  for (const key of keys) assert.ok(key in DEFAULTS.media, key);
  // Compression is always on, the feature takes photos only and keeps no original: none of the
  // three switches is a setting any more, and a stored copy of one is dropped on read.
  for (const gone of ["previewQuality", "previewMaxDimension", "thumbnailSize", "compressionEnabled", "videoUpload", "keepOriginals"]) assert.equal(gone in DEFAULTS.media, false, `${gone} is no longer a stored setting`);
  const legacyRow = mergeGroup("media", { videoUpload: true, keepOriginals: true, compressionEnabled: false, allowedFormats: ["jpg", "MP4", "mov", "png"] });
  for (const gone of ["videoUpload", "keepOriginals", "compressionEnabled"]) assert.equal(gone in legacyRow, false, gone);
  assert.deepEqual(legacyRow.allowedFormats, ["jpg", "png"], "a video container left in an older format list is read without it");
  assert.deepEqual(mergeGroup("media", { allowedFormats: ["mp4", "mov"] }).allowedFormats, DEFAULTS.media.allowedFormats, "a list of only video falls back to the photo defaults, never to an empty list that allows everything");
  assert.equal(DEFAULTS.media.allowedFormats.some((format) => ["mp4", "mov", "webm"].includes(format)), false);
  assert.equal("keepOriginals" in (GROUP_SCHEMAS.media.parse({ keepOriginals: true, videoUpload: true })), false, "an older client sending them has them stripped, never stored");
  assert.equal(GROUP_SCHEMAS.media.safeParse({ previewPreset: "ultra" }).success, false);
  assert.equal(GROUP_SCHEMAS.media.safeParse({ previewMaxDimension: 2560 }).success, true, "an unknown key is ignored by the partial schema, never stored");
  assert.equal(GROUP_SCHEMAS.media.safeParse({ thumbnailFormat: "gif" }).success, false);
  assert.equal(GROUP_SCHEMAS.media.safeParse({ uploadConcurrency: 9 }).success, false);
  assert.equal(GROUP_SCHEMAS.media.safeParse({ previewPreset: "high", thumbnailPreset: "smallest", thumbnailFormat: "webp", uploadConcurrency: 4, compressionConcurrency: 2 }).success, true);
  const service = src("ai-feature/media/service.js");
  assert.match(service, /const recipe = derivatives\.recipeFrom\(settings\);/);
  assert.match(service, /derivatives\.derive\(file\.buffer, \{ preOptimized: Boolean\(source\?\.optimized\), recipe, clientThumbnail: thumbnail\?\.buffer \|\| null \}\)/);
  assert.match(service, /storage\.putPublic\(eventId, "thumbnails", derived\.thumbnailExtension, derived\.thumbnail, derived\.thumbnailMime\)/);
  // Nothing but the two derivatives is ever stored: no `originals/` key, no original row column.
  assert.doesNotMatch(service, /"originals"/);
  assert.match(service, /originalKey: null/);
});

test("a fingerprint that is not a SHA-256 digest is refused, never stored as an identity", () => {
  for (const bad of ["abc", "g".repeat(64), FINGERPRINT.slice(0, 63), `${FINGERPRINT}0`]) {
    assert.equal(uploadFieldsSchema.safeParse({ sourceFingerprint: bad }).success, false, bad);
  }
});

test("a relative path is relative: no drive letters, no leading slash, no . or .. steps", () => {
  for (const bad of ["C:\\Photos\\a.jpg", "/etc/a.jpg", "\\\\server\\share\\a.jpg", "../a.jpg", "Wedding/../a.jpg", "./a.jpg"]) {
    assert.equal(uploadFieldsSchema.safeParse({ relativePath: bad }).success, false, bad);
  }
  assert.equal(uploadFieldsSchema.safeParse({ relativePath: "Wedding/Bride/DSC_1001.JPG" }).success, true);
});

test("only an upright JPEG no larger than the preview edge is kept as the preview byte for byte", () => {
  assert.equal(isPreviewAlready({ format: "jpeg", width: PREVIEW_EDGE, height: 1365 }), true);
  assert.equal(isPreviewAlready({ format: "jpeg", width: 1365, height: PREVIEW_EDGE, orientation: 1 }), true);
  assert.equal(isPreviewAlready({ format: "jpeg", width: PREVIEW_EDGE + 1, height: 1365 }), false, "too large: the full recipe runs");
  assert.equal(isPreviewAlready({ format: "jpeg", width: 2000, height: 1365, orientation: 6 }), false, "an EXIF rotation still to fold in");
  assert.equal(isPreviewAlready({ format: "png", width: 2000, height: 1365 }), false, "not a JPEG");
  assert.equal(isPreviewAlready({ format: "jpeg", width: 2000, height: 1365, exif: Buffer.from("Exif") }), false, "metadata still inside: the re-encode strips it");
  assert.equal(isPreviewAlready({ format: "jpeg", width: 2000, height: 1365, xmp: Buffer.from("x") }), false);
  assert.equal(isPreviewAlready({ format: "jpeg", width: 2000, height: 1365, iptc: Buffer.from("x") }), false);
  assert.equal(isPreviewAlready({ format: "jpeg", width: 0, height: 0 }), false);
  assert.equal(isPreviewAlready(undefined), false);
  // The event's own edge: a 2048 px file is within a 2560 px event and outside a 1600 px one.
  assert.equal(isPreviewAlready({ format: "jpeg", width: 2048, height: 1365 }, 2560), true);
  assert.equal(isPreviewAlready({ format: "jpeg", width: 2048, height: 1365 }, 1600), false);
  // Metadata inside is always the full recipe, whatever the event's setting: the passthrough never
  // stores bytes the server has not filtered, and the allow-list is written only by the re-encode.
  assert.equal(isPreviewAlready({ format: "jpeg", width: 2000, height: 1365, exif: Buffer.from("Exif") }, 2048), false);
});

test("the byte-for-byte preview path takes only a whole, bounded JPEG that decodes end to end", () => {
  const { isWholeJpeg, PASSTHROUGH_MAX_BYTES } = require("../src/modules/ai-feature/media/derivatives");
  assert.equal(isWholeJpeg(Buffer.from([0xff, 0xd8, 0x00, 0x11, 0x22, 0xff, 0xd9])), true);
  assert.equal(isWholeJpeg(Buffer.from([0xff, 0xd8, 0x00, 0x11, 0xff, 0xd9, 0x3c, 0x68, 0x74, 0x6d, 0x6c])), false, "bytes after the end of image");
  assert.equal(isWholeJpeg(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xd9])), false, "not a JPEG start");
  assert.equal(PASSTHROUGH_MAX_BYTES, 3 * 1024 * 1024);
  const derivatives = src("ai-feature/media/derivatives.js");
  assert.match(derivatives, /buffer\.length <= PASSTHROUGH_MAX_BYTES && isWholeJpeg\(buffer\) && hasOnlyImageMarkers\(buffer\) && await decodesWhole\(buffer\)/);
});

test("a fingerprint the server can check is checked: an unoptimized upload whose digest is not the file's is refused", () => {
  const service = src("ai-feature/media/service.js");
  assert.match(service, /if \(source\?\.fingerprint && !source\.optimized && source\.fingerprint !== derived\.contentHash\) throw httpError\(422/);
});

test("the service asks for the duplicate by the source fingerprint before decoding, and stores that digest as the row's identity", () => {
  const service = src("ai-feature/media/service.js");
  const fingerprintCheck = service.indexOf("findDuplicate(eventId, source.fingerprint)");
  const derive = service.indexOf("derivatives.derive(file.buffer, { preOptimized: Boolean(source?.optimized), recipe, clientThumbnail: thumbnail?.buffer || null })");
  assert.ok(fingerprintCheck > 0 && derive > fingerprintCheck, "the fingerprint lookup comes first");
  assert.match(service, /const contentHash = source\?\.fingerprint \|\| derived\.contentHash;/);
  assert.match(service, /sourceSizeBytes: source\?\.sizeBytes == null \? null : BigInt\(source\.sizeBytes\)/);
  assert.match(service, /relativePath: source\?\.relativePath/);
  const controller = src("ai-feature/media/controller.js");
  assert.match(controller, /source: sourceOf\(fields\)/);
  assert.match(controller, /fields: 12/);
  // The photo and the client's thumbnail are two named parts; nothing else is taken.
  assert.match(controller, /files: 2, fields: 12 \} \}\)\.fields\(\[\{ name: "file", maxCount: 1 \}, \{ name: "thumbnail", maxCount: 1 \}\]\)/);
  assert.match(controller, /thumbnail: req\.files\?\.thumbnail\?\.\[0\] \|\| null/);
  // The guest route takes the same two parts and the source fields, and never a folder or a deferral.
  const publicController = src("ai-feature/public/controller.js");
  assert.match(publicController, /\.fields\(\[\{ name: "file", maxCount: 1 \}, \{ name: "thumbnail", maxCount: 1 \}\]\)/);
  assert.match(publicController, /service\.guestUpload\(code, req\.headers\.authorization, req\.files\?\.file\?\.\[0\], \{ source, thumbnail: thumbnail && thumbnail\.size <= CLIENT_THUMBNAIL_MAX_BYTES \? thumbnail : null \}\)/);
  const publicService = src("ai-feature/public/service.js");
  const guestUpload = publicService.slice(publicService.indexOf("async function guestUpload"));
  assert.match(guestUpload, /mediaService\.upload\(event\.id, file, \{ guestId: guest\.id, source: guestSource, thumbnail \}\)/);
  assert.doesNotMatch(guestUpload, /folderId|deferAi/);
  // An anonymous guest never names a photo's identity or size: the digest and size of the bytes
  // that arrived are the row's, so a typed fingerprint can neither read another photo's row back
  // nor pre-empt one the photographer has not uploaded yet.
  assert.match(guestUpload, /const guestSource = source \? \{ fingerprint: null, sizeBytes: null, fileName: source\.fileName, relativePath: null, optimized: source\.optimized === true, capturedAt: source\.capturedAt \} : null;/);
  // Its own rate limit, and a thumbnail past the passthrough's size dropped before the service.
  assert.match(src("ai-feature/public/routes.js"), /router\.post\("\/:code\/upload", createRateLimiter\(\{ windowMs: 60 \* 60 \* 1000, max: 300, keys: \(req\) => \[`ai-event-upload:\$\{clientIp\(req\)\}`\]/);
  assert.match(publicController, /thumbnail && thumbnail\.size <= CLIENT_THUMBNAIL_MAX_BYTES \? thumbnail : null/);
  // A guest's upload goes through the same service, so it keeps no original either.
  assert.doesNotMatch(service, /keepOriginals/);
});

test("the two new columns are nullable and additive", () => {
  const schema = fs.readFileSync(path.join(__dirname, "..", "prisma", "schema.prisma"), "utf8");
  assert.match(schema, /sourceSizeBytes\s+BigInt\?\s+@map\("source_size_bytes"\)/);
  assert.match(schema, /relativePath\s+String\?\s+@map\("relative_path"\) @db\.VarChar\(1024\)/);
  const migration = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20260929120000_ai_event_media_source_fields", "migration.sql"), "utf8");
  assert.match(migration, /ADD COLUMN `source_size_bytes` BIGINT NULL/);
  assert.match(migration, /ADD COLUMN `relative_path` VARCHAR\(1024\) NULL/);
  assert.doesNotMatch(migration, /DROP|RENAME|MODIFY/i);
});
