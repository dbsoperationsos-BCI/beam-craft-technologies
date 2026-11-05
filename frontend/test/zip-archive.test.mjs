import assert from "node:assert/strict";
import test from "node:test";
import { createZipArchive, crc32, dosDateTime, zipEntryName } from "../src/lib/zipArchive.mjs";

/**
 * A minimal reader for the archives written here, so the tests prove the bytes are a real ZIP rather
 * than that the writer agrees with itself. It reads the central directory — which is what every
 * extractor trusts — and pulls each entry's stored bytes back out at the offset recorded there.
 */
function readArchive(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end -= 1;
  assert.ok(end >= 0, "no end-of-central-directory record");
  const count = view.getUint16(end + 10, true);
  const directoryOffset = view.getUint32(end + 16, true);
  const entries = [];
  let at = directoryOffset;
  for (let index = 0; index < count; index += 1) {
    assert.equal(view.getUint32(at, true), 0x02014b50, "bad central directory signature");
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));

    // Walk the local header to find where this entry's bytes actually start.
    assert.equal(view.getUint32(localOffset, true), 0x04034b50, "bad local header signature");
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataAt = localOffset + 30 + localNameLength + localExtraLength;
    entries.push({ name, method, flags, crc, size, body: bytes.subarray(dataAt, dataAt + size) });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return { count, entries };
}

const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());
const textOf = (entry) => new TextDecoder().decode(entry.body);

test("checksums match the published CRC-32 test vectors", () => {
  assert.equal(crc32(""), 0x00000000);
  assert.equal(crc32("a"), 0xe8b7be43);
  assert.equal(crc32("123456789"), 0xcbf43926);
  assert.equal(crc32("The quick brown fox jumps over the lazy dog"), 0x414fa339);
});

test("builds the folder tree the studio expects inside the archive", async () => {
  const archive = createZipArchive();
  await archive.add({ blob: new Blob(["one"]), segments: ["Priya Wedding", "Retouches", "Reception", "Card 1"], fileName: "DSC_0001.jpg" });
  await archive.add({ blob: new Blob(["two"]), segments: ["Priya Wedding", "Frames", "Engagement"], fileName: "DSC_0002.jpg" });
  const read = readArchive(await bytesOf(archive.finish()));
  assert.equal(read.count, 2);
  assert.deepEqual(read.entries.map((entry) => entry.name), [
    "Priya Wedding/Retouches/Reception/Card 1/DSC_0001.jpg",
    "Priya Wedding/Frames/Engagement/DSC_0002.jpg",
  ]);
});

test("hands each file's bytes back exactly as they went in", async () => {
  const archive = createZipArchive();
  // A byte range that would break anything treating the payload as text.
  const raw = new Uint8Array(512);
  for (let index = 0; index < raw.length; index += 1) raw[index] = index % 256;
  await archive.add({ blob: new Blob([raw]), segments: ["Project"], fileName: "raw.bin" });
  await archive.add({ blob: new Blob(["a photo's bytes"]), segments: ["Project"], fileName: "photo.jpg" });
  const read = readArchive(await bytesOf(archive.finish()));
  assert.deepEqual(read.entries[0].body, raw);
  assert.equal(read.entries[0].crc, crc32(raw));
  assert.equal(textOf(read.entries[1]), "a photo's bytes");
  assert.equal(read.entries[1].crc, crc32("a photo's bytes"));
  // Stored, not deflated — a JPEG gains nothing from being compressed twice.
  read.entries.forEach((entry) => assert.equal(entry.method, 0));
});

test("marks every name as UTF-8 so a shoot named in any script survives", async () => {
  const archive = createZipArchive();
  await archive.add({ blob: new Blob(["x"]), segments: ["திருமணம்"], fileName: "புகைப்படம்.jpg" });
  const read = readArchive(await bytesOf(archive.finish()));
  assert.equal(read.entries[0].name, "திருமணம்/புகைப்படம்.jpg");
  assert.equal(read.entries[0].flags & 0x0800, 0x0800);
});

test("a separator inside one name becomes part of it, never an extra folder", () => {
  assert.equal(zipEntryName(["Project", "Retouches"], "a/b.jpg"), "Project/Retouches/a-b.jpg");
  assert.equal(zipEntryName(["Pro/ject"], "a.jpg"), "Pro-ject/a.jpg");
});

test("drops an empty level rather than leaving a nameless folder", () => {
  assert.equal(zipEntryName(["Project", "", null, "Reception"], "a.jpg"), "Project/Reception/a.jpg");
  assert.equal(zipEntryName([], "a.jpg"), "a.jpg");
});

test("reports what it holds so a caller knows whether there is an archive to save", async () => {
  const archive = createZipArchive();
  assert.equal(archive.count, 0);
  assert.equal(archive.size, 0);
  await archive.add({ blob: new Blob(["12345"]), segments: ["Project"], fileName: "a.jpg" });
  assert.equal(archive.count, 1);
  // Local header (30) + name + the five bytes themselves.
  assert.equal(archive.size, 30 + "Project/a.jpg".length + 5);
  assert.deepEqual(archive.names, ["Project/a.jpg"]);
});

test("refuses a file with no name instead of writing a nameless entry", async () => {
  const archive = createZipArchive();
  await assert.rejects(() => archive.add({ blob: new Blob(["x"]), segments: [], fileName: "" }), /needs a name/);
});

test("clamps a date the ZIP format cannot express rather than wrapping it", () => {
  // 1980 is the earliest year the DOS field can hold; a 1979 date must not come out as the future.
  assert.equal(dosDateTime(new Date("1979-06-15T10:30:00Z")).date >> 9, 0);
  const stamp = dosDateTime(new Date(2026, 7, 17, 14, 30, 30));
  assert.equal(stamp.date >> 9, 46); // 2026 - 1980
  assert.equal((stamp.date >> 5) & 15, 8); // August
  assert.equal(stamp.date & 31, 17);
  assert.equal(stamp.time >> 11, 14);
  assert.equal((stamp.time >> 5) & 63, 30);
  assert.equal(dosDateTime(new Date("nonsense")).date >> 9 >= 46, true); // falls back to now
});
