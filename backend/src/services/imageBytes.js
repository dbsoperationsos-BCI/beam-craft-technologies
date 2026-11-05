/**
 * What a buffer's bytes say it is. A browser or a desktop tells this server what it is sending;
 * the bytes are what decide, so a route that stores a derivative as it arrived checks them here
 * before it writes anything. Shared by the Image Selection derivative route and the AI Feature's
 * passthrough paths; the Signature Album keeps its own copy inside its module.
 *
 * Two levels: the first bytes (`isJpeg`, `isWebp`, `isPng`), and the whole structure
 * (`isPlainJpeg`, `isPlainWebp`) - every segment or chunk walked to the end of the file, only the
 * ones a plain image needs allowed, nothing before the header and nothing after the last one. A
 * file that passes the second level is stored byte for byte on a public bucket, so it must be
 * unable to carry a payload in a segment a decoder skips.
 */
const isJpeg = (buffer) => Buffer.isBuffer(buffer) && buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
const isWebp = (buffer) => Buffer.isBuffer(buffer) && buffer.length > 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
const isPng = (buffer) => Buffer.isBuffer(buffer) && buffer.length > 8 && buffer[0] === 0x89 && buffer.toString("ascii", 1, 4) === "PNG";

/** "image/jpeg" | "image/webp" | "image/png" | null. */
function sniffImageType(buffer) {
  if (isJpeg(buffer)) return "image/jpeg";
  if (isWebp(buffer)) return "image/webp";
  if (isPng(buffer)) return "image/png";
  return null;
}

/** SOI first, EOI last: nothing rides behind the image (a polyglot or appended payload would). */
function isWholeJpeg(buffer) {
  if (!Buffer.isBuffer(buffer)) return false;
  const n = buffer.length;
  return n > 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[n - 2] === 0xff && buffer[n - 1] === 0xd9;
}

// The segments a plain baseline or progressive JPEG needs: JFIF (APP0), an ICC profile (APP2,
// and only as one), tables, frame headers, restart interval. Nothing else - no COM, no other
// APPn - so a passthrough file can carry no hidden payload in a segment a decoder skips.
const PLAIN_JPEG_MARKERS = new Set([0xe0, 0xe2, 0xdb, 0xc4, 0xc0, 0xc1, 0xc2, 0xdd]);
const ICC_HEADER = "ICC_PROFILE\0";

/**
 * Walks every segment from SOI to EOI - through each scan's entropy-coded data, so a progressive
 * JPEG's later scans are examined too - and answers false on any segment a plain image would not
 * have, an APP2 that is not an ICC profile, a file that ends before EOI, or bytes after it.
 */
function hasOnlyImageMarkers(buffer) {
  if (!isWholeJpeg(buffer)) return false;
  let offset = 2;
  let scans = 0;
  while (offset + 2 <= buffer.length) {
    if (buffer[offset] !== 0xff) return false;
    const marker = buffer[offset + 1];
    if (marker === 0xff) { offset += 1; continue; } // fill byte
    if (marker === 0xd9) return offset + 2 === buffer.length && scans > 0;
    if (offset + 4 > buffer.length) return false;
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return false;
    if (marker === 0xda) {
      // Start of scan: the entropy-coded data runs to the next marker that is not stuffing
      // (FF00), a restart (FFD0-FFD7) or fill (FFFF).
      let cursor = offset + 2 + length;
      while (cursor + 1 < buffer.length) {
        if (buffer[cursor] === 0xff) {
          const next = buffer[cursor + 1];
          if (next !== 0x00 && next !== 0xff && !(next >= 0xd0 && next <= 0xd7)) break;
        }
        cursor += 1;
      }
      offset = cursor;
      scans += 1;
      continue;
    }
    if (!PLAIN_JPEG_MARKERS.has(marker)) return false;
    if (marker === 0xe2 && buffer.toString("ascii", offset + 4, offset + 4 + ICC_HEADER.length) !== ICC_HEADER) return false;
    offset += 2 + length;
  }
  return false;
}

/** A JPEG whole and made only of the segments a plain image needs. */
const isPlainJpeg = (buffer) => hasOnlyImageMarkers(buffer);

// The chunks a plain still or animated WebP is made of. No ICCP, EXIF, XMP or unknown chunk: a
// file kept byte for byte on a public bucket carries nothing a decoder skips.
// The frame, its alpha, animation, and the colour profile: Chrome's canvas writes every WebP as
// VP8X + ICCP + VP8, the sRGB profile being how the picture says what its numbers mean, exactly
// as the JPEG walk admits an APP2 ICC_PROFILE segment. EXIF and XMP stay out - they carry text.
const PLAIN_WEBP_CHUNKS = new Set(["VP8 ", "VP8L", "VP8X", "ALPH", "ANIM", "ANMF", "ICCP"]);

/**
 * A WebP whose RIFF size is exactly the file, walked chunk by chunk to the end, every chunk one
 * of the image's own. False on a trailing payload, a short file or a metadata chunk.
 */
function isPlainWebp(buffer) {
  if (!isWebp(buffer)) return false;
  if (buffer.readUInt32LE(4) + 8 !== buffer.length) return false;
  let offset = 12;
  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) return false;
    const type = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (!PLAIN_WEBP_CHUNKS.has(type)) return false;
    offset += 8 + size + (size % 2);
  }
  return offset === buffer.length;
}

module.exports = { isJpeg, isWebp, isPng, sniffImageType, isWholeJpeg, hasOnlyImageMarkers, isPlainJpeg, isPlainWebp };
