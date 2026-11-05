import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { DEFAULT_TEXT, EXPORT_DPI, EXPORT_SCALE, FALLBACK_DPI, PAGE_MM, PAGE_POINTS, POSTER_SIZE, QR_QUIET_MODULES, QR_TEMPLATES, TEXT_LIMITS, drawPoster, pdfFromJpeg, posterFileName, posterText, qrLayout, qrMatrix, scaleForDpi, templateById } from "../src/lib/qrPoster.mjs";

const KIT = { url: "https://studio.example/e/5G5TVW", shortCode: "5G5TVW", pin: "3955", event: { name: "Shivaharshan & Pavithra" } };
const GRID = { size: 21, modules: "1".repeat(7) + "0".repeat(14) + "0".repeat(21 * 20) };
const read = (...parts) => fs.readFileSync(path.join(process.cwd(), "src", ...parts), "utf8");

/** A 2D context that records what is drawn, so a poster can be checked without a browser. */
function recorder() {
  const texts = []; const rects = []; const images = [];
  const ctx = new Proxy({ letterSpacing: "0px", measureText: (text) => ({ width: String(text).length * 20 }), fillText: (text) => texts.push(String(text)), rect: (...args) => rects.push(args), drawImage: (...args) => images.push(args), createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }) }, {
    get: (target, key) => (key in target ? target[key] : () => {}),
    set: (target, key, value) => { target[key] = value; return true; },
  });
  return { ctx, texts, rects, images };
}

test("ten designs, each with its own id, name and palette", () => {
  assert.equal(QR_TEMPLATES.length, 10);
  assert.equal(new Set(QR_TEMPLATES.map((item) => item.id)).size, 10);
  for (const item of QR_TEMPLATES) { assert.ok(item.name && item.palette.background && item.palette.ink && item.palette.accent, item.id); assert.equal(typeof item.dark, "boolean"); }
  assert.equal(templateById("nope").id, QR_TEMPLATES[0].id);
});

test("the words: defaults, the event's own name, the studio's edits trimmed to their limits, an emptied line left off", () => {
  const text = posterText(KIT);
  assert.equal(text.heading, DEFAULT_TEXT.heading);
  assert.equal(text.footer, "Shivaharshan & Pavithra");
  assert.equal(text.pin, "3955");
  assert.equal(text.link, "studio.example/e/5G5TVW");
  const edited = posterText(KIT, { heading: "  Scan   for your photos ", footer: "", note: "x".repeat(500), showPin: false });
  assert.equal(edited.heading, "Scan for your photos");
  assert.equal(edited.footer, "");
  assert.equal(edited.note.length, TEXT_LIMITS.note);
  assert.equal(edited.pin, "");
  // Nothing is invented: no event name and no PIN means neither line.
  const bare = posterText({ url: KIT.url, event: {} });
  assert.equal(bare.footer, ""); assert.equal(bare.pin, "");
  for (const value of Object.values(bare)) assert.doesNotMatch(String(value), /undefined|null/);
});

test("the QR grid is read exactly as the server sent it, and a damaged one is refused rather than drawn", () => {
  const matrix = qrMatrix(GRID);
  assert.equal(matrix.size, 21);
  assert.equal(matrix.dark(0, 0), true); assert.equal(matrix.dark(6, 0), true); assert.equal(matrix.dark(7, 0), false); assert.equal(matrix.dark(0, 1), false);
  assert.throws(() => qrMatrix({ size: 21, modules: "101" }));
  assert.throws(() => qrMatrix({ size: 2, modules: "1x01" }));
  assert.throws(() => qrMatrix(null));
});

test("every design draws the real QR - one whole-pixel square per dark module - and only the words it was given", () => {
  const darkModules = 7;
  for (const template of QR_TEMPLATES) {
    for (const scale of [1, EXPORT_SCALE]) {
      const { ctx, texts, rects } = recorder();
      drawPoster(ctx, template, posterText(KIT), { matrix: qrMatrix(GRID), logos: { onLight: null, onDark: null }, fontFamily: "Montserrat", studioName: "Don't Blink Studioz" }, scale);
      assert.equal(rects.length, darkModules, template.id);
      const sizes = [...new Set(rects.map(([, , w]) => w))];
      // At print size every module is the same whole number of pixels; a preview's snapped edges differ by one at most.
      if (scale === EXPORT_SCALE) assert.equal(sizes.length, 1);
      else assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1);
      assert.ok(rects.every((rect) => rect.every(Number.isInteger)), "every module on the pixel grid");
      const all = texts.join(" | ");
      assert.match(all, /SHIVAHARSHAN & PAVITHRA/); assert.match(all, /PIN {2}3955/); assert.match(all, /Don't Blink Studioz/, "no logo at all: the studio's name stands in");
      assert.doesNotMatch(all, /undefined|null|NaN/);
    }
  }
});

test("a drawn logo replaces the studio's name, on the right background", () => {
  const light = { naturalWidth: 400, naturalHeight: 100, id: "light" }; const dark = { naturalWidth: 400, naturalHeight: 100, id: "dark" };
  const ivory = recorder(); drawPoster(ivory.ctx, templateById("ivory"), posterText(KIT), { matrix: qrMatrix(GRID), logos: { onLight: light, onDark: dark }, fontFamily: "Montserrat", studioName: "Studio" });
  assert.equal(ivory.images[0][0], light); assert.doesNotMatch(ivory.texts.join(" "), /Studio\b/);
  const gold = recorder(); drawPoster(gold.ctx, templateById("black-gold"), posterText(KIT), { matrix: qrMatrix(GRID), logos: { onLight: light, onDark: dark }, fontFamily: "Montserrat", studioName: "Studio" });
  assert.equal(gold.images[0][0], dark, "a dark design draws the dark mark");
  assert.equal(gold.images.at(-1)[0], light, "the QR's white centre always carries the light mark");
});

test("file names are safe and say which event and which design", () => {
  assert.equal(posterFileName("Shivaharshan & Pavithra", "black-gold", "png"), "shivaharshan-pavithra-qr-poster-black-gold.png");
  assert.equal(posterFileName("Café ‘Reception’ / Hall:2", "ivory", "pdf"), "cafe-reception-hall-2-qr-poster-ivory.pdf");
  assert.equal(posterFileName("", "ivory", "png"), "event-qr-poster-ivory.png");
  assert.equal(posterFileName("..\\..\\x", "ivory", "exe"), "x-qr-poster-ivory.png");
  assert.ok(posterFileName("a".repeat(300), "sage", "png").length < 90);
});

test("the PDF is one page at print size holding the JPEG exactly as it was made", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
  const pdf = pdfFromJpeg(jpeg, Math.round(POSTER_SIZE.width * EXPORT_SCALE), Math.round(POSTER_SIZE.height * EXPORT_SCALE));
  const text = Buffer.from(pdf).toString("latin1");
  assert.ok(text.startsWith("%PDF-1.4"));
  assert.ok(text.trimEnd().endsWith("%%EOF"));
  assert.match(text, /\/MediaBox \[0 0 1683.78 2383.94\]/, "A1 portrait: 594 × 841 mm");
  assert.match(text, /q 1683.78 0 0 2383.94 0 0 cm \/Im0 Do Q/, "the image fills the page edge to edge");
  assert.match(text, /\/Width 7016 \/Height 9933/);
  assert.equal((text.match(/\/Type \/Page[^s]/g) || []).length, 1, "one page");
  assert.match(text, /\/Filter \/DCTDecode \/Length 7/);
  const start = text.indexOf("stream\n", text.indexOf("/DCTDecode")) + 7;
  assert.deepEqual([...pdf.subarray(start, start + jpeg.length)], [...jpeg]);
  // Every cross-reference offset points at its object.
  const xref = Number(text.match(/startxref\n(\d+)/)[1]);
  assert.ok(text.slice(xref).startsWith("xref"));
  const offsets = [...text.slice(xref).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
  offsets.forEach((offset, index) => assert.ok(text.slice(offset).startsWith(`${index + 1} 0 obj`), `object ${index + 1}`));
});

test("the Share dialog's footer is QR Template and Done, and the poster is drawn from the server's kit", () => {
  const share = read("components", "ai-feature", "event", "ShareDialog.js");
  const order = ["QR Template</Button>", "Done</Button>"].map((label) => share.indexOf(label));
  assert.ok(order.every((at, index) => at > -1 && (index === 0 || at > order[index - 1])), "QR Template | Done");
  assert.equal(share.includes("Revoke link</Button>"), false, "no revoking from this dialog");
  assert.equal(share.includes("Regenerate</Button>"), false, "no footer Regenerate: Reset PIN and New link code live in their fields");
  const dialog = read("components", "ai-feature", "event", "QrTemplateDialog.js");
  assert.match(dialog, /getAiSharePoster\(eventId\)/, "read fresh on every open, so a regenerated link is the one printed");
  assert.match(dialog, /saveBlob\(blob, fileName\)/);
  assert.match(read("services", "ai-feature", "ai-feature.service.js"), /getAiSharePoster = \(id\) => apiRequest\(`\$\{eventPath\(id\)\}\/share\/poster`\)/);
});

test("the code fills its white card: the card is the quiet zone, modules are over 80% of it at every size it is drawn", () => {
  const card = { x: 284, y: 470, size: 620 };
  // 33 modules is the smallest code a guest link makes at High correction (a 30-character URL); longer links only fill more.
  for (const size of [33, 37, 41, 45]) {
    for (const scale of [0.16, 0.45, 1, EXPORT_SCALE]) {
      const layout = qrLayout(size, card, scale);
      const cardPx = card.size * scale;
      const modules = size * layout.cell;
      assert.ok(modules / cardPx >= 0.79 && modules / cardPx <= 0.9, `${size} @ ${scale}: ${(modules / cardPx).toFixed(3)}`);
      assert.ok(layout.total / cardPx >= 0.96, `the quiet zone and the card are one margin, not two (${size} @ ${scale})`);
      const leftMargin = layout.left - card.x * scale; const rightMargin = (card.x + card.size) * scale - (layout.left + layout.total);
      assert.ok(Math.abs(leftMargin - rightMargin) <= 1, "centred");
      assert.ok(leftMargin + QR_QUIET_MODULES * layout.cell >= QR_QUIET_MODULES * layout.cell, "never less than the four-module quiet zone");
      if (scale === EXPORT_SCALE) { assert.equal(layout.whole, true); assert.ok(Number.isInteger(layout.cell) && Number.isInteger(layout.left)); }
    }
  }
});

test("a small preview draws seamless, pixel-aligned modules that fill the card like the print does", () => {
  const { ctx, rects } = recorder();
  const grid = { size: 33, modules: "1".repeat(33 * 33) };
  drawPoster(ctx, templateById("ivory"), posterText(KIT), { matrix: qrMatrix(grid), logos: { onLight: null, onDark: null }, fontFamily: "Montserrat" }, 0.16);
  assert.equal(rects.length, 33 * 33);
  assert.ok(rects.every(([x, y, w, h]) => [x, y, w, h].every(Number.isInteger) && w >= 2 && h >= 2), "every edge on the pixel grid");
  // Neighbours meet exactly: no gap and no overlap along a row.
  const row = rects.slice(0, 33);
  row.slice(1).forEach(([x], index) => assert.equal(x, row[index][0] + row[index][2]));
});

test("every design is the same A1 portrait page: 594 x 841 mm, 7016 x 9933 px at 300 dpi, 3508 x 4967 at 150", () => {
  assert.deepEqual(PAGE_MM, { width: 594, height: 841 });
  assert.deepEqual(POSTER_SIZE, { width: 1188, height: 1682 }, "half-millimetre layout units");
  assert.ok(Math.abs(POSTER_SIZE.width / POSTER_SIZE.height - 594 / 841) < 1e-9);
  const px = (dpi) => [Math.round(POSTER_SIZE.width * scaleForDpi(dpi)), Math.round(POSTER_SIZE.height * scaleForDpi(dpi))];
  assert.deepEqual(px(EXPORT_DPI), [7016, 9933]);
  assert.deepEqual(px(FALLBACK_DPI), [3508, 4967]);
  assert.deepEqual(PAGE_POINTS, { width: 1683.78, height: 2383.94 });
  // No design carries a page size of its own: they all draw on POSTER_SIZE.
  for (const template of QR_TEMPLATES) assert.equal(["width", "height", "size", "page"].some((key) => key in template), false, template.id);
});

test("the A1 layout fits the page on every design, even with a two-line heading, a two-line note and the PIN", () => {
  const long = posterText(KIT, { heading: "Scan here to get every one of your photos", note: "x ".repeat(44), footer: "A very long event name that needs two lines to fit on the poster" });
  for (const template of QR_TEMPLATES) {
    const ys = [];
    const { ctx } = recorder();
    ctx.fillText = (text, x, y) => ys.push(y);
    drawPoster(ctx, template, long, { matrix: qrMatrix({ size: 33, modules: "0".repeat(33 * 33) }), logos: { onLight: null, onDark: null }, fontFamily: "Montserrat" }, 1);
    assert.ok(Math.max(...ys) < POSTER_SIZE.height - 30, `${template.id}: last line at ${Math.max(...ys)}`);
    assert.ok(Math.min(...ys) > 60, `${template.id}: first line inside the top margin`);
  }
});
