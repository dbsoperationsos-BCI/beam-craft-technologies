const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const { compressImageForPdf, MAX_WIDTH_PX } = require("../src/services/pdfImageCompression");

/*
 * The quotation PDF's pictures: Chrome stores a JPEG in a PDF as it is but decodes anything else to
 * raw pixels, which is how a 186 KB WebP cover became 3.8 MB of PDF. The renderer hands it JPEGs
 * sized for the 1080px sheet instead - and leaves alone anything a JPEG would spoil.
 */

// A photograph-like picture: noise, so it does not compress to nothing.
const photo = (width, height, format) => {
  const raw = Buffer.alloc(width * height * 3);
  for (let index = 0; index < raw.length; index += 1) raw[index] = (index * 7919) % 251;
  const image = sharp(raw, { raw: { width, height, channels: 3 } });
  return (format === "png" ? image.png() : format === "jpeg" ? image.jpeg({ quality: 95 }) : image.webp({ quality: 80 })).toBuffer();
};

test("a WebP photograph becomes a JPEG no wider than the sheet needs", async () => {
  const jpeg = await compressImageForPdf(await photo(1600, 2400, "webp"));
  assert.ok(jpeg, "converted");
  const meta = await sharp(jpeg).metadata();
  assert.equal(meta.format, "jpeg");
  assert.equal(meta.width, MAX_WIDTH_PX);
  assert.equal(meta.height, 1920, "the proportions are kept");
});

test("a small picture is never enlarged", async () => {
  const meta = await sharp(await compressImageForPdf(await photo(200, 104, "webp"))).metadata();
  assert.equal(meta.width, 200);
  assert.equal(meta.height, 104);
});

test("an opaque PNG is a photograph like any other; a see-through one is left alone", async () => {
  assert.ok(await compressImageForPdf(await photo(400, 300, "png")));
  const transparent = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  assert.equal(await compressImageForPdf(transparent), null, "a logo's clear parts would print black as a JPEG");
});

test("what it cannot read or improve is left to load as it was", async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
  assert.equal(await compressImageForPdf(svg), null, "an SVG is drawn as vectors already");
  assert.equal(await compressImageForPdf(Buffer.from("not an image")), null);
  assert.equal(await compressImageForPdf(Buffer.alloc(0)), null);
  // A JPEG that is already as small as it gets is kept, not made larger.
  const tiny = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#ffffff" } }).jpeg({ quality: 30 }).toBuffer();
  assert.equal(await compressImageForPdf(tiny), null);
});

test("the quotation renderer prints through it, and only the quotation renderer", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "src", "services", "quotationPdfService.js"), "utf8");
  const install = source.indexOf("await installPdfImageCompression(page);");
  const navigate = source.indexOf("await page.goto(url");
  assert.ok(install > 0 && install < navigate, "installed before the page loads");
});

test("a picture past 50 megapixels is not decoded at all", async () => {
  // 8000 x 8000, one colour: a few kilobytes on disk, 64 MP - and about a quarter of a gigabyte - decoded.
  const huge = await require("sharp")({ create: { width: 8000, height: 8000, channels: 3, background: "#808080" } }).png().toBuffer();
  assert.ok(huge.length < 2_000_000, "small as a file");
  assert.equal(await compressImageForPdf(huge), null);
});

test("a download is cut off at 25 MB as it arrives, whatever the server claims its size is", async () => {
  const http = require("node:http");
  const { fetchCapped, MAX_SOURCE_BYTES } = require("../src/services/pdfImageCompression");
  let sent = 0;
  // Chunked, no Content-Length: the case a header check alone lets through.
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "image/webp" });
    const chunk = Buffer.alloc(1024 * 1024, 1);
    const pump = () => {
      while (sent < MAX_SOURCE_BYTES * 3) {
        sent += chunk.length;
        if (!res.write(chunk)) { res.once("drain", pump); return; }
      }
      res.end();
    };
    pump();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    assert.equal(await fetchCapped(`http://127.0.0.1:${port}/big.webp`), null);
    // A picture under the cap comes through whole.
    const small = http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "image/webp" }); res.end(Buffer.alloc(1000, 2)); });
    await new Promise((resolve) => small.listen(0, "127.0.0.1", resolve));
    try {
      const body = await fetchCapped(`http://127.0.0.1:${small.address().port}/small.webp`);
      assert.equal(body.length, 1000);
    } finally { small.close(); }
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
});
