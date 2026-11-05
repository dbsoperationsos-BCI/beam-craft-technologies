/**
 * A ZIP file, built in the browser, so a download can carry a folder tree.
 *
 * This exists for one reason: a web page cannot create folders in the Downloads folder. The
 * `download` attribute takes a file name and nothing else — every separator in it is stripped — so a
 * download that has to arrive as `Project / Retouches / Reception / Card 1 / photo.jpg` can only do
 * it inside an archive. When the studio has chosen a Target Download Path the folders are made for
 * real and none of this runs; this is the fallback that keeps the same shape.
 *
 * Entries are **stored**, not deflated. A JPEG is already compressed — deflating one spends the
 * studio's CPU to gain a percent or two — and storing means the bytes can be handed to the archive
 * exactly as they came off the card. It also keeps this module small enough to read: no dependency,
 * and nothing to go wrong in a compressor.
 *
 * Memory is the other reason to store. Each file is handed over as a `Blob` and stays one: the bytes
 * are read once, in slices, only to checksum them, and the archive holds the `Blob` itself rather
 * than its contents. The browser keeps blob data in its own store, which spills to disk, so a
 * fifteen-gigabyte selection does not have to fit in the tab.
 *
 * Zip64 is written only when the archive needs it — past four gigabytes, or past 65,535 entries —
 * because a plain archive opens in more places, including the Windows shell's own zip reader.
 */

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL = 0x06054b50;
const ZIP64_END_OF_CENTRAL = 0x06064b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EXTRA_ID = 0x0001;
// Bit 11 promises the name is UTF-8, which is what lets a shoot named in any script survive.
const FLAG_UTF8 = 0x0800;
const METHOD_STORE = 0;
const VERSION_STORE = 20;
const VERSION_ZIP64 = 45;
const MAX_UINT32 = 0xffffffff;
const MAX_UINT16 = 0xffff;
// Read a file in slices rather than whole: the checksum needs every byte, but never all at once.
const CHECKSUM_CHUNK = 4 * 1024 * 1024;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

/** The running CRC-32 of more bytes. Seed with `crc32Start()` and close with `crc32End()`. */
export const crc32Start = () => 0xffffffff;
export function crc32Push(crc, bytes) {
  let value = crc;
  for (let index = 0; index < bytes.length; index += 1) value = (value >>> 8) ^ CRC_TABLE[(value ^ bytes[index]) & 0xff];
  return value >>> 0;
}
export const crc32End = (crc) => (crc ^ 0xffffffff) >>> 0;

/** The CRC-32 of one buffer or string — the whole checksum in one call. */
export function crc32(input) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  return crc32End(crc32Push(crc32Start(), bytes));
}

/**
 * The MS-DOS date and time a ZIP entry carries. Two seconds is the format's whole resolution, and
 * 1980 is the earliest year it can express, so anything older is clamped rather than wrapped into a
 * date that would read as the future.
 */
export function dosDateTime(date) {
  const when = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const year = Math.max(1980, when.getFullYear());
  return {
    time: ((when.getHours() & 31) << 11) | ((when.getMinutes() & 63) << 5) | ((when.getSeconds() >> 1) & 31),
    date: (((year - 1980) & 127) << 9) | (((when.getMonth() + 1) & 15) << 5) | (when.getDate() & 31),
  };
}

/** A little-endian byte writer, which is the only order ZIP uses. */
function writer(length) {
  const bytes = new Uint8Array(length);
  const view = new DataView(bytes.buffer);
  let at = 0;
  return {
    bytes,
    u16(value) { view.setUint16(at, value & MAX_UINT16, true); at += 2; },
    u32(value) { view.setUint32(at, value >>> 0, true); at += 4; },
    // Sizes and offsets can pass 2^32, which no 32-bit write can hold and no bitwise operator can
    // even represent, so the two halves are taken by division rather than by shifting.
    u64(value) {
      const big = Number(value);
      view.setUint32(at, big >>> 0, true);
      view.setUint32(at + 4, Math.floor(big / 4294967296), true);
      at += 8;
    },
    raw(source) { bytes.set(source, at); at += source.length; },
  };
}

/**
 * The entry's path inside the archive. ZIP always spells its own separator `/`, whatever the machine
 * that made it or opens it. Empty segments are dropped so a missing shoot name collapses the level
 * rather than leaving a nameless folder in the tree.
 */
export function zipEntryName(segments, fileName) {
  return [...(Array.isArray(segments) ? segments : [segments]), fileName]
    .filter((part) => part !== null && part !== undefined && String(part).trim() !== "")
    .map((part) => String(part).replace(/[/\\]+/g, "-"))
    .join("/");
}

async function checksumOf(blob) {
  let crc = crc32Start();
  for (let offset = 0; offset < blob.size; offset += CHECKSUM_CHUNK) {
    const slice = blob.slice(offset, Math.min(offset + CHECKSUM_CHUNK, blob.size));
    crc = crc32Push(crc, new Uint8Array(await slice.arrayBuffer()));
  }
  return crc32End(crc);
}

function zip64Extra(uncompressed, compressed, offset) {
  const needsOffset = offset !== null;
  const body = writer(4 + 16 + (needsOffset ? 8 : 0));
  body.u16(ZIP64_EXTRA_ID);
  body.u16(16 + (needsOffset ? 8 : 0));
  body.u64(uncompressed);
  body.u64(compressed);
  if (needsOffset) body.u64(offset);
  return body.bytes;
}

/**
 * An archive being built. `add` takes one file and returns once its bytes have been checksummed;
 * `finish` closes the archive and hands back the whole thing as a Blob to save.
 */
export function createZipArchive({ modifiedAt } = {}) {
  const parts = [];
  const entries = [];
  let offset = 0;

  async function add({ blob, segments = [], fileName }) {
    const name = zipEntryName(segments, fileName);
    if (!name) throw new Error("A file needs a name to go into the archive.");
    const nameBytes = new TextEncoder().encode(name);
    const size = blob.size;
    const crc = await checksumOf(blob);
    const stamp = dosDateTime(modifiedAt || (blob.lastModified ? new Date(blob.lastModified) : new Date()));
    // Only a file of four gigabytes or more needs the local header to defer its sizes to an extra
    // field. That is a single photo, not a selection, so it is rare — but a video would reach it.
    const large = size >= MAX_UINT32;
    const extra = large ? zip64Extra(size, size, null) : new Uint8Array(0);

    const header = writer(30 + nameBytes.length + extra.length);
    header.u32(LOCAL_HEADER);
    header.u16(large ? VERSION_ZIP64 : VERSION_STORE);
    header.u16(FLAG_UTF8);
    header.u16(METHOD_STORE);
    header.u16(stamp.time);
    header.u16(stamp.date);
    header.u32(crc);
    header.u32(large ? MAX_UINT32 : size);
    header.u32(large ? MAX_UINT32 : size);
    header.u16(nameBytes.length);
    header.u16(extra.length);
    header.raw(nameBytes);
    header.raw(extra);

    parts.push(header.bytes, blob);
    entries.push({ nameBytes, crc, size, stamp, offset, large });
    offset += header.bytes.length + size;
    return name;
  }

  function centralDirectory() {
    const written = [];
    let size = 0;
    for (const entry of entries) {
      const needsOffset = entry.offset >= MAX_UINT32;
      const extra = entry.large || needsOffset ? zip64Extra(entry.size, entry.size, needsOffset ? entry.offset : null) : new Uint8Array(0);
      const record = writer(46 + entry.nameBytes.length + extra.length);
      record.u32(CENTRAL_HEADER);
      record.u16(extra.length ? VERSION_ZIP64 : VERSION_STORE);
      record.u16(extra.length ? VERSION_ZIP64 : VERSION_STORE);
      record.u16(FLAG_UTF8);
      record.u16(METHOD_STORE);
      record.u16(entry.stamp.time);
      record.u16(entry.stamp.date);
      record.u32(entry.crc);
      record.u32(entry.large ? MAX_UINT32 : entry.size);
      record.u32(entry.large ? MAX_UINT32 : entry.size);
      record.u16(entry.nameBytes.length);
      record.u16(extra.length);
      record.u16(0); // no comment
      record.u16(0); // one disk only
      record.u16(0); // no internal attributes
      record.u32(0); // no external attributes
      record.u32(needsOffset ? MAX_UINT32 : entry.offset);
      record.raw(entry.nameBytes);
      record.raw(extra);
      written.push(record.bytes);
      size += record.bytes.length;
    }
    return { records: written, size };
  }

  function ending(directorySize, directoryOffset) {
    const needsZip64 = entries.length > MAX_UINT16 || directorySize >= MAX_UINT32 || directoryOffset >= MAX_UINT32;
    const tail = writer(needsZip64 ? 56 + 20 + 22 : 22);
    if (needsZip64) {
      tail.u32(ZIP64_END_OF_CENTRAL);
      tail.u64(44); // the size of this record after these eight bytes
      tail.u16(VERSION_ZIP64);
      tail.u16(VERSION_ZIP64);
      tail.u32(0);
      tail.u32(0);
      tail.u64(entries.length);
      tail.u64(entries.length);
      tail.u64(directorySize);
      tail.u64(directoryOffset);
      tail.u32(ZIP64_LOCATOR);
      tail.u32(0);
      tail.u64(directoryOffset + directorySize);
      tail.u32(1);
    }
    tail.u32(END_OF_CENTRAL);
    tail.u16(0);
    tail.u16(0);
    // A Zip64 archive leaves these at their maximum and means "read the Zip64 record above".
    tail.u16(needsZip64 ? MAX_UINT16 : entries.length);
    tail.u16(needsZip64 ? MAX_UINT16 : entries.length);
    tail.u32(needsZip64 ? MAX_UINT32 : directorySize);
    tail.u32(needsZip64 ? MAX_UINT32 : directoryOffset);
    tail.u16(0); // no archive comment
    return tail.bytes;
  }

  return {
    add,
    get count() { return entries.length; },
    /** What the archive holds so far, in bytes, before its directory is written. */
    get size() { return offset; },
    get names() { return entries.map((entry) => new TextDecoder().decode(entry.nameBytes)); },
    finish() {
      const directory = centralDirectory();
      return new Blob([...parts, ...directory.records, ending(directory.size, offset)], { type: "application/zip" });
    },
  };
}
