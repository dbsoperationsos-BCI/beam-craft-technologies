/**
 * When a JPEG was taken, read off its EXIF before the frame is re-encoded - a canvas keeps no
 * EXIF, and the server orders a folder by capture time. Only what is needed: the APP1 segment, the
 * TIFF header's byte order, IFD0's `DateTime` (0x0132) and the Exif IFD's `DateTimeOriginal`
 * (0x9003), the latter preferred. Anything that is not a well-formed JPEG with EXIF answers null,
 * quietly - a missing date is not an error, it is a photo without one.
 *
 * Plain functions over an ArrayBuffer so the compression worker (no DOM) and `node --test` read
 * the same code.
 */
const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
const TAG_DATETIME = 0x0132;
const TAG_EXIF_IFD = 0x8769;
const TAG_DATETIME_ORIGINAL = 0x9003;
const ASCII = 2;

/** The bytes of the APP1 Exif segment (after "Exif\0\0"), or null. */
export function findExifSegment(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) return null; // start of scan / end: no more headers
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2) return null;
    if (marker === 0xe1 && EXIF_HEADER.every((byte, index) => bytes[offset + 4 + index] === byte)) {
      const start = offset + 4 + EXIF_HEADER.length;
      const end = Math.min(bytes.length, offset + 2 + length);
      return bytes.subarray(start, end);
    }
    offset += 2 + length;
  }
  return null;
}

/** "2026:09:12 10:15:30" (EXIF's own format) → a Date in local time, or null when it is not a date. */
export function parseExifDateTime(text) {
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(text || "").trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 60) return null;
  const date = new Date(year, month - 1, day, hour, minute, second);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The capture Date read off a JPEG's EXIF, or null. Never throws. */
export function readExifCaptureDate(buffer) {
  try {
    const tiff = findExifSegment(buffer);
    if (!tiff || tiff.length < 8) return null;
    const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
    const littleEndian = view.getUint16(0) === 0x4949;
    if (!littleEndian && view.getUint16(0) !== 0x4d4d) return null;
    const u16 = (at) => view.getUint16(at, littleEndian);
    const u32 = (at) => view.getUint32(at, littleEndian);
    const ifd0 = u32(4);
    if (ifd0 + 2 > tiff.length) return null;

    const readAscii = (entryAt) => {
      const count = u32(entryAt + 4);
      if (u16(entryAt + 2) !== ASCII || count < 1) return "";
      const valueAt = count <= 4 ? entryAt + 8 : u32(entryAt + 8);
      if (valueAt + count > tiff.length) return "";
      let text = "";
      for (let index = 0; index < count; index += 1) { const code = tiff[valueAt + index]; if (!code) break; text += String.fromCharCode(code); }
      return text;
    };
    const scan = (ifdAt, tags) => {
      const found = {};
      if (ifdAt + 2 > tiff.length) return found;
      const entries = u16(ifdAt);
      for (let index = 0; index < entries; index += 1) {
        const entryAt = ifdAt + 2 + index * 12;
        if (entryAt + 12 > tiff.length) break;
        const tag = u16(entryAt);
        if (tags.includes(tag)) found[tag] = tag === TAG_EXIF_IFD ? u32(entryAt + 8) : readAscii(entryAt);
      }
      return found;
    };

    const first = scan(ifd0, [TAG_DATETIME, TAG_EXIF_IFD]);
    const exif = first[TAG_EXIF_IFD] ? scan(first[TAG_EXIF_IFD], [TAG_DATETIME_ORIGINAL]) : {};
    return parseExifDateTime(exif[TAG_DATETIME_ORIGINAL]) || parseExifDateTime(first[TAG_DATETIME]);
  } catch {
    return null;
  }
}

// A JPEG's EXIF sits in its first segments (an APP1 is at most 64 KB): this much of the head is
// always enough, and a 40 MB original is never read whole just for its date.
const HEAD_BYTES = 256 * 1024;

/** The capture time of a File/Blob as an ISO string, read off its EXIF header only; null when it has none. Never throws. */
export async function captureDateOfFile(file) {
  try {
    if (!file || typeof file.slice !== "function") return null;
    const head = await file.slice(0, Math.min(Number.isFinite(file.size) ? file.size : HEAD_BYTES, HEAD_BYTES)).arrayBuffer();
    const date = readExifCaptureDate(head);
    return date ? date.toISOString() : null;
  } catch {
    return null;
  }
}
