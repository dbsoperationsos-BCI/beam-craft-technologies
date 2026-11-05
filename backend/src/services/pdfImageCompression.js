const sharp = require("sharp");

/**
 * Photographs handed to the PDF printer as JPEG, sized for the sheet.
 *
 * Chrome writes a JPEG into a PDF as it is - compressed - but anything else it decodes and stores as
 * raw pixels. The quotation's pictures are WebP, so a 186 KB cover photograph went into the PDF as
 * 3.8 MB, and a 6 KB thumbnail as 60 KB: a five-page-tall quotation came to about 6 MB. While the
 * PDF renderer prints, each picture the page asks for is fetched here instead, turned into a JPEG no
 * wider than the sheet needs, and handed to the browser - so the PDF keeps the JPEG and stays small.
 *
 * The page itself is untouched: the client's link still shows the originals, and only the printed
 * copy is built from these. Anything this cannot improve - a picture with see-through parts (a
 * logo), an SVG, one it cannot read - is left to load exactly as it did.
 */

/*
 * The sheet is 1080 CSS px wide and printed at a device scale of 1, so nothing is ever drawn wider
 * than that. 1280 keeps a little over 1x for a photograph cropped to fill its frame, which is what
 * stays sharp on zoom, without paying for the 1600-2400px the originals are uploaded at.
 */
const MAX_WIDTH_PX = 1280;
// Quality 80 with mozjpeg: no visible loss on a photograph at the size it is printed.
const JPEG_QUALITY = 80;
// A picture this large is not one the page should be printing; it is left alone rather than read.
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
const CONVERTIBLE = new Set(["webp", "png", "jpeg", "avif", "tiff", "gif"]);
// Pixels a picture may have before it is not read at all: 50 MP is far beyond any photograph a
// quotation carries (the covers are 3.8 MP) and keeps a hostile one from decoding to a gigabyte.
const MAX_INPUT_PIXELS = 50_000_000;
// Pictures converted at once; the rest wait their turn rather than decoding side by side.
const MAX_CONCURRENT = 3;
// Nothing is reused between renders, so sharp's cache only holds memory.
sharp.cache(false);
const read = (buffer) => sharp(buffer, { animated: false, limitInputPixels: MAX_INPUT_PIXELS });

let running = 0;
const waiting = [];
async function oneAtATime(task) {
  if (running >= MAX_CONCURRENT) await new Promise((resolve) => { waiting.push(resolve); });
  running += 1;
  try {
    return await task();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}

/*
 * The picture's bytes, or null past `MAX_SOURCE_BYTES`. Counted as they arrive rather than trusted
 * from Content-Length, which a server can leave out or misstate - the download stops at the cap.
 */
async function fetchCapped(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok || !response.body) return null;
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_SOURCE_BYTES) {
    await response.body.cancel().catch(() => {});
    return null;
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > MAX_SOURCE_BYTES) {
      await response.body.cancel().catch(() => {});
      return null;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

/**
 * The JPEG to print in place of `buffer`, or null where the original should be used: not a raster
 * photograph, see-through, animated, or unreadable. Metadata is not carried over.
 */
async function compressImageForPdf(buffer) {
  try {
    const meta = await read(buffer).metadata();
    if (!CONVERTIBLE.has(meta.format) || (meta.pages || 1) > 1) return null;
    // A picture with real transparency would print its clear parts black as a JPEG; one whose
    // alpha channel is fully opaque (a PNG saved with one anyway) is a photograph like any other.
    if (meta.hasAlpha && !(await read(buffer).stats()).isOpaque) return null;
    const jpeg = await read(buffer)
      .rotate()
      .resize({ width: MAX_WIDTH_PX, withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
    // A small JPEG already could come out larger; keep whichever is smaller.
    if (meta.format === "jpeg" && jpeg.length >= buffer.length) return null;
    return jpeg;
  } catch {
    return null;
  }
}

/**
 * Has `page` print its pictures as JPEG (see above). Call before the page is loaded. Every other
 * request - the page, its scripts, the API, the fonts - goes on exactly as before, and so does any
 * picture this fails to fetch or improve.
 */
async function installPdfImageCompression(page) {
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (request.isInterceptResolutionHandled()) return;
    const url = request.url();
    if (request.resourceType() !== "image" || !/^https?:\/\//i.test(url)) {
      request.continue().catch(() => {});
      return;
    }
    void (async () => {
      let jpeg = null;
      try {
        jpeg = await oneAtATime(async () => {
          const source = await fetchCapped(url);
          return source ? compressImageForPdf(source) : null;
        });
      } catch {
        jpeg = null;
      }
      if (request.isInterceptResolutionHandled()) return;
      if (jpeg) await request.respond({ status: 200, contentType: "image/jpeg", headers: { "Access-Control-Allow-Origin": "*" }, body: jpeg }).catch(() => {});
      else await request.continue().catch(() => {});
    })();
  });
}

module.exports = { compressImageForPdf, installPdfImageCompression, fetchCapped, MAX_WIDTH_PX, JPEG_QUALITY, MAX_SOURCE_BYTES, MAX_INPUT_PIXELS };
