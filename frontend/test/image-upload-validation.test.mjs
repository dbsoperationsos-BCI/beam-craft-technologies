import assert from "node:assert/strict";
import test from "node:test";
import { resolveImageMimeType, shouldIgnoreFile, splitImageFiles, validateImageFile } from "../src/lib/imageUploadValidation.mjs";

const photo = (webkitRelativePath, type = "image/jpeg") => ({ name: webkitRelativePath.split("/").pop(), webkitRelativePath, type, size: 1024, lastModified: 1 });
const systemFile = (webkitRelativePath) => ({ name: webkitRelativePath.split("/").pop(), webkitRelativePath, type: "", size: 8192, lastModified: 1 });

test("accepts supported photo formats within the upload size limit", () => {
  assert.equal(validateImageFile({ name: "photo.jpg", type: "image/jpeg", size: 1024 }), null);
  assert.equal(validateImageFile({ name: "photo.heic", type: "image/heic", size: 1024 }), null);
});

test("returns rejection reasons for unsupported, empty, and oversized files", () => {
  const result = splitImageFiles([{ name: "notes.pdf", type: "application/pdf", size: 100 }, { name: "empty.jpg", type: "image/jpeg", size: 0 }, { name: "huge.png", type: "image/png", size: 11 * 1024 * 1024 * 1024 }]);
  assert.equal(result.accepted.length, 0); assert.equal(result.rejected.length, 3);
  assert.match(result.rejected[0].reason, /Unsupported/); assert.match(result.rejected[1].reason, /empty/); assert.match(result.rejected[2].reason, /10 GB/);
});

test("silently ignores operating-system metadata files anywhere in the folder tree", () => {
  const files = [...Array.from({ length: 100 }, (unused, index) => photo(`Wedding/IMG_${index}.jpg`)), systemFile("Wedding/Thumbs.db"), systemFile("Wedding/Engagement/Thumbs.db"), systemFile("Wedding/desktop.ini"), systemFile("Wedding/.DS_Store"), systemFile("Wedding/._IMG_0001.jpg")];
  const result = splitImageFiles(files);
  assert.equal(result.accepted.length, 100);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.ignored, 5);
  assert.equal(shouldIgnoreFile({ name: "notes.txt" }), false);
});

test("still reports genuine unsupported files alongside ignored system files", () => {
  const result = splitImageFiles([photo("Wedding/IMG_1.jpg"), { name: "notes.txt", webkitRelativePath: "Wedding/notes.txt", type: "text/plain", size: 12, lastModified: 1 }, systemFile("Wedding/Thumbs.db")]);
  assert.equal(result.accepted.length, 1);
  assert.equal(result.ignored, 1);
  assert.deepEqual(result.rejected.map((item) => item.name), ["notes.txt"]);
  assert.equal(result.rejected[0].type, "unsupported");
});

test("gives same-named files in different folders distinct rejection ids", () => {
  const bad = (path) => ({ name: "notes.txt", webkitRelativePath: path, type: "text/plain", size: 12, lastModified: 1 });
  const { rejected } = splitImageFiles([bad("Wedding/notes.txt"), bad("Engagement/notes.txt")]);
  assert.equal(rejected.length, 2);
  assert.equal(new Set(rejected.map((item) => item.id)).size, 2);
});

test("collapses the identical file listed twice into a single rejection", () => {
  const duplicate = { name: "notes.txt", webkitRelativePath: "Wedding/notes.txt", type: "text/plain", size: 12, lastModified: 1 };
  assert.equal(splitImageFiles([duplicate, duplicate]).rejected.length, 1);
});

test("silently skips footage, camera RAW and sidecars from a mixed event folder", () => {
  const other = (name, type = "") => ({ name, webkitRelativePath: `Wedding/${name}`, type, size: 4096, lastModified: 1 });
  const result = splitImageFiles([
    photo("Wedding/IMG_001.JPG"), photo("Wedding/IMG_002.JPG"),
    other("DJI_0001.MP4", "video/mp4"), other("video.MOV", "video/quicktime"), other("clip.MTS"), other("clip.M2TS"),
    other("DJI_0002.DNG"), other("0Q9A5642.CR3"), other("shot.NEF"), other("shot.ARW"), other("shot.RW2"),
    other("0Q9A5642.DAT"), systemFile("Wedding/Thumbs.db"),
    other("notes.xyz"),
  ]);
  assert.equal(result.accepted.length, 2);
  assert.equal(result.ignored, 11);
  assert.deepEqual(result.rejected.map((item) => item.name), ["notes.xyz"]);
});

test("silently skips audio files without creating unsupported-format errors", () => {
  const audio = (name, type = "") => ({ name, webkitRelativePath: `Wedding/${name}`, type, size: 4096, lastModified: 1 });
  const result = splitImageFiles([
    photo("Wedding/IMG_001.JPG"), photo("Wedding/IMG_002.JPG"),
    audio("song.mp3", "audio/mpeg"), audio("voice.wav", "audio/wav"), audio("mix.aac"), audio("clip.m4a", "audio/mp4"),
    audio("master.flac"), audio("take.ogg", "audio/ogg"), audio("legacy.wma"),
    audio("DJI_0001.MP4", "video/mp4"), audio("DJI_0002.DNG"), systemFile("Wedding/Thumbs.db"),
    audio("notes.xyz"),
  ]);
  assert.equal(result.accepted.length, 2);
  assert.equal(result.ignored, 10);
  assert.deepEqual(result.rejected.map((item) => item.name), ["notes.xyz"]);
  for (const name of ["song.mp3", "voice.wav", "mix.aac", "clip.m4a", "master.flac", "take.ogg", "legacy.wma"]) {
    assert.equal(shouldIgnoreFile({ name }), true, `${name} should be ignored`);
  }
});

test("classifies each file exactly once for a large mixed selection", () => {
  const files = [];
  for (let index = 0; index < 20000; index += 1) {
    files.push(photo(`Wedding/Day/IMG_${index}.jpg`));
    if (index % 10 === 0) files.push({ name: `DJI_${index}.MP4`, webkitRelativePath: `Wedding/Day/DJI_${index}.MP4`, type: "video/mp4", size: 4096, lastModified: 1 });
    if (index % 10 === 0) files.push({ name: `IMG_${index}.DNG`, webkitRelativePath: `Wedding/Day/IMG_${index}.DNG`, type: "", size: 4096, lastModified: 1 });
  }
  const result = splitImageFiles(files);
  assert.equal(result.accepted.length, 20000);
  assert.equal(result.ignored, 4000);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.accepted.length + result.ignored + result.rejected.length, files.length);
});

test("falls back to the extension when the browser reports no MIME type", () => {
  assert.equal(resolveImageMimeType({ name: "IMG_0001.HEIC", type: "" }), "image/heic");
  assert.equal(resolveImageMimeType({ name: "scan.tif", type: "" }), "image/tiff");
  assert.equal(resolveImageMimeType({ name: "Thumbs.db", type: "" }), "");
  assert.equal(validateImageFile({ name: "IMG_0001.heic", type: "", size: 1024 }), null);
});
