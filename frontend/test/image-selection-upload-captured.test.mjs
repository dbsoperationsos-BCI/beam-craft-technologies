import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { captureDateOfFile } from "../src/lib/aiMediaUpload/exifDate.mjs";

const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");

// Culling V2, phase 9 finding: Photo Selection's browser uploader re-encodes each photo (a canvas
// keeps no EXIF), so the capture time never reached the server and bursts, similar series and
// story moments could not form. The date is read off the original's EXIF header first and sent
// with the same two derivatives - the original itself still never leaves the machine.
test("the capture date is read from the head of the original, without reading the whole file", async () => {
  // A minimal JPEG with an APP1 Exif segment holding IFD0 DateTime "2026:06:24 09:40:18".
  const tiff = [0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01, 0x01, 0x32, 0x00, 0x02, 0x00, 0x00, 0x00, 0x14, 0x00, 0x00, 0x00, 0x1a, 0x00, 0x00, 0x00, 0x00, ...Buffer.from("2026:06:24 09:40:18\0", "ascii")];
  const app1 = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, ((app1.length + 2) >> 8) & 0xff, (app1.length + 2) & 0xff, ...app1, 0xff, 0xda, 0x00, 0x02, ...new Array(500000).fill(0), 0xff, 0xd9]);
  let sliced = null;
  const file = new Blob([jpeg], { type: "image/jpeg" });
  const spy = { size: file.size, slice: (start, end) => { sliced = [start, end]; return file.slice(start, end); } };
  const iso = await captureDateOfFile(spy);
  assert.equal(new Date(iso).getFullYear(), 2026);
  assert.equal(new Date(iso).getMonth(), 5);
  assert.equal(new Date(iso).getMinutes(), 40);
  assert.ok(sliced && sliced[1] <= 256 * 1024, `read only the head: ${sliced}`);
  assert.equal(await captureDateOfFile(new Blob([new Uint8Array([1, 2, 3])])), null, "no EXIF: no date, no error");
  assert.equal(await captureDateOfFile(null), null);
});

test("the Photo Selection uploader sends the capture date with the derivatives", () => {
  const store = read("lib", "imageSelectionUploadStore.js");
  assert.match(store, /capturedAt: await captureDateOfFile\(runtime\.file\)/);
  const service = read("services", "image-selection", "image-selection.service.js");
  assert.match(service, /if \(capturedAt\) form\.append\("capturedAt", capturedAt\);/);
});
