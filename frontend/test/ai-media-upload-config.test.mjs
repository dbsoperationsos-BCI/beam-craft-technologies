import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { AI_MEDIA_COMPRESSION_BOUNDS, AI_MEDIA_COMPRESSION_DEFAULTS, AI_MEDIA_UPLOAD_CONFIG, compressionFromSettings, limitsFromSettings } from "../src/lib/aiMediaUpload/config.mjs";
import { findExifSegment, parseExifDateTime, readExifCaptureDate } from "../src/lib/aiMediaUpload/exifDate.mjs";

const require = createRequire(import.meta.url);
// The server's one definition of the media settings. Read directly so the browser's recipe cannot
// drift from the one the server derives with.
const { DEFAULTS } = require("../../backend/src/modules/ai-feature/shared/settingsDefaults.js");

test("the browser's compression defaults are the server's media defaults, key for key", () => {
  for (const [key, value] of Object.entries(AI_MEDIA_COMPRESSION_DEFAULTS)) assert.deepEqual(DEFAULTS.media[key], value, key);
});

test("a recipe is read off an event's media settings as the shared presets; defaults where nothing is stored; a legacy row's numbers read as the nearest presets", () => {
  const defaults = compressionFromSettings(null);
  assert.equal("enabled" in defaults, false, "compression is always on; there is no switch to read");
  assert.equal(defaults.previewPreset, "high");
  assert.equal(defaults.thumbnailPreset, "standard");
  assert.equal(defaults.thumbnailType, "image/webp");
  assert.equal(defaults.preserveMetadata, false);
  // High IS 2048 px q84 and Standard IS 480 px WebP q76: the recipe the AI Feature has always derived.
  assert.deepEqual(defaults.derivatives, { preview: { longEdge: 2048, quality: 0.84, targetBytes: 300 * 1024, byteLadder: false }, thumbnail: { longEdge: 480, quality: 0.76 } });
  assert.deepEqual(compressionFromSettings({}), defaults);
  const tuned = compressionFromSettings({ compressionEnabled: false, previewPreset: "compact", thumbnailPreset: "light", thumbnailFormat: "jpeg", preserveMetadata: true });
  assert.equal("enabled" in tuned, false, "a stored compressionEnabled: false is not read");
  assert.equal(tuned.previewPreset, "compact");
  assert.equal(tuned.derivatives.preview.longEdge, 1200);
  assert.equal(tuned.derivatives.preview.byteLadder, false, "whatever the preset, the AI Feature never steps a face's frame down");
  assert.equal(tuned.derivatives.thumbnail.longEdge, 240);
  assert.equal(tuned.thumbnailType, "image/jpeg");
  assert.equal(tuned.preserveMetadata, true);
  const legacy = compressionFromSettings({ previewMaxDimension: 1600, previewQuality: 70, thumbnailSize: 600 });
  assert.equal(legacy.previewPreset, "standard");
  assert.equal(legacy.thumbnailPreset, "high");
  const wild = compressionFromSettings({ previewPreset: "ultra", thumbnailPreset: 10 });
  assert.equal(wild.previewPreset, "high");
  assert.equal(wild.thumbnailPreset, "standard");
  assert.deepEqual(limitsFromSettings(null), { compressionConcurrency: 3, uploadConcurrency: 4 });
  assert.deepEqual(limitsFromSettings({ compressionConcurrency: 9, uploadConcurrency: 0 }), { compressionConcurrency: 4, uploadConcurrency: 1 });
  assert.deepEqual(limitsFromSettings({ compressionConcurrency: 2, uploadConcurrency: 6 }), { compressionConcurrency: 2, uploadConcurrency: 6 });
  assert.equal(AI_MEDIA_UPLOAD_CONFIG.maxCompressionWorkers, AI_MEDIA_COMPRESSION_BOUNDS.compressionConcurrency[1], "the worker pool never grows past the widest bound");
});

/** A JPEG that is nothing but SOI, one APP1 Exif segment and EOI, with the dates given. */
function jpegWithExif({ dateTime, dateTimeOriginal, littleEndian = true } = {}) {
  const strings = [dateTime, dateTimeOriginal].filter(Boolean);
  const hasExifIfd = Boolean(dateTimeOriginal);
  const ifd0Entries = (dateTime ? 1 : 0) + (hasExifIfd ? 1 : 0);
  const ifd0At = 8;
  const exifIfdAt = ifd0At + 2 + ifd0Entries * 12 + 4;
  const stringsAt = hasExifIfd ? exifIfdAt + 2 + 12 + 4 : exifIfdAt;
  const tiff = new Uint8Array(stringsAt + strings.length * 20);
  const view = new DataView(tiff.buffer);
  const u16 = (at, value) => view.setUint16(at, value, littleEndian);
  const u32 = (at, value) => view.setUint32(at, value, littleEndian);
  tiff.set(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d], 0);
  u16(2, 42);
  u32(4, ifd0At);
  let at = ifd0At;
  u16(at, ifd0Entries); at += 2;
  let stringAt = stringsAt;
  const writeAscii = (text) => { const start = stringAt; for (let i = 0; i < 19; i += 1) tiff[start + i] = text.charCodeAt(i); tiff[start + 19] = 0; stringAt += 20; return start; };
  if (dateTime) { u16(at, 0x0132); u16(at + 2, 2); u32(at + 4, 20); u32(at + 8, writeAscii(dateTime)); at += 12; }
  if (hasExifIfd) { u16(at, 0x8769); u16(at + 2, 4); u32(at + 4, 1); u32(at + 8, exifIfdAt); at += 12; }
  u32(at, 0);
  if (hasExifIfd) {
    u16(exifIfdAt, 1);
    u16(exifIfdAt + 2, 0x9003); u16(exifIfdAt + 4, 2); u32(exifIfdAt + 6, 20); u32(exifIfdAt + 10, writeAscii(dateTimeOriginal));
    u32(exifIfdAt + 14, 0);
  }
  const header = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
  const length = 2 + header.length + tiff.length;
  const out = new Uint8Array(2 + 2 + length + 2);
  out.set([0xff, 0xd8, 0xff, 0xe1, length >> 8, length & 0xff], 0);
  out.set(header, 6);
  out.set(tiff, 12);
  out.set([0xff, 0xd9], out.length - 2);
  return out.buffer;
}

test("the capture time is DateTimeOriginal when the EXIF has it, DateTime otherwise, read in either byte order", () => {
  const both = readExifCaptureDate(jpegWithExif({ dateTime: "2026:09:12 10:15:30", dateTimeOriginal: "2026:09:11 08:00:00" }));
  assert.deepEqual(both, new Date(2026, 8, 11, 8, 0, 0));
  const only = readExifCaptureDate(jpegWithExif({ dateTime: "2026:09:12 10:15:30" }));
  assert.deepEqual(only, new Date(2026, 8, 12, 10, 15, 30));
  const big = readExifCaptureDate(jpegWithExif({ dateTimeOriginal: "2025:01:02 03:04:05", littleEndian: false }));
  assert.deepEqual(big, new Date(2025, 0, 2, 3, 4, 5));
});

test("a photo without a date, a file that is not a JPEG, or a truncated segment answers null, never throws", () => {
  assert.equal(readExifCaptureDate(jpegWithExif({})), null);
  assert.equal(readExifCaptureDate(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer), null, "PNG");
  assert.equal(readExifCaptureDate(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer), null, "JPEG with no headers");
  assert.equal(readExifCaptureDate(new Uint8Array(jpegWithExif({ dateTime: "2026:09:12 10:15:30" }).slice(0, 30)).buffer), null, "cut off inside the segment");
  assert.equal(readExifCaptureDate(new ArrayBuffer(0)), null);
  assert.equal(findExifSegment(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]).buffer), null, "the scan starts before any APP1");
});

test("EXIF's own date text is read strictly; anything else is not a date", () => {
  assert.deepEqual(parseExifDateTime("2026:09:12 10:15:30"), new Date(2026, 8, 12, 10, 15, 30));
  for (const bad of ["", "    :  :     :  :  ", "0000:00:00 00:00:00", "2026-09-12T10:15:30Z", "2026:13:01 00:00:00", null, undefined]) assert.equal(parseExifDateTime(bad), null, String(bad));
});
