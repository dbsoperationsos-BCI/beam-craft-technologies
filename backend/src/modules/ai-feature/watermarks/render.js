const path = require("path");
const sharp = require("sharp");
const { placeWatermark } = require("./geometry");

/**
 * Drawing a watermark: the mark (a logo, or text set in Montserrat) is made once as a transparent
 * PNG, scaled to where `placeWatermark` puts it, faded to the preset's opacity and laid over the
 * photo. The photo given is never written back - the caller stores what comes out as a new object.
 *
 * Text is set with the two Montserrat files beside this module (SIL Open Font License, OFL.txt), so
 * the server draws the same letters on every machine whatever fonts it has installed; the preset
 * screen's preview asks this same code for its text image (`textMark`), so what the studio sees is
 * what a guest gets.
 */
const FONT_FILES = { REGULAR: path.join(__dirname, "fonts", "Montserrat-Regular.ttf"), BOLD: path.join(__dirname, "fonts", "Montserrat-Bold.ttf") };
const escapeMarkup = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

// A handful of text marks are drawn over and over (one per event, many photos), so the last few are kept.
const textCache = new Map();
const TEXT_CACHE_SIZE = 32;

/** The text as a tight transparent PNG, large enough to be scaled down onto any photo. */
async function textMark({ text, textColor = "#FFFFFF", fontWeight = "BOLD" }) {
  const weight = FONT_FILES[fontWeight] ? fontWeight : "BOLD";
  const cacheKey = JSON.stringify([text, textColor, weight]);
  if (textCache.has(cacheKey)) return textCache.get(cacheKey);
  const markup = `<span foreground="${textColor}">${escapeMarkup(text)}</span>`;
  const drawn = await sharp({ text: { text: markup, font: `Montserrat ${weight === "BOLD" ? "Bold" : "Regular"}`, fontfile: FONT_FILES[weight], rgba: true, dpi: 600 } }).png().toBuffer();
  const { data, info } = await sharp(drawn).trim({ threshold: 0 }).png().toBuffer({ resolveWithObject: true });
  const mark = { buffer: data, width: info.width, height: info.height };
  textCache.set(cacheKey, mark);
  if (textCache.size > TEXT_CACHE_SIZE) textCache.delete(textCache.keys().next().value);
  return mark;
}

/** The mark a snapshot describes. `loadLogo(key)` answers the logo's bytes, or null when the object is gone. */
async function markFor(snapshot, loadLogo) {
  if (snapshot.type === "TEXT") return textMark(snapshot);
  const bytes = await loadLogo(snapshot.logoKey);
  if (!bytes) throw Object.assign(new Error("The watermark logo is missing from storage."), { code: "LOGO_MISSING" });
  const { width, height } = await sharp(bytes).metadata();
  return { buffer: bytes, width, height };
}

/**
 * The photo with the mark on it, in the photo's own format. `mark` comes from `markFor`, so a
 * batch of photos for one event decodes its logo once.
 */
async function applyWatermark(photo, snapshot, mark) {
  const meta = await sharp(photo).metadata();
  // A tag that turns the frame sideways swaps which side is which once it is applied.
  const turned = meta.orientation >= 5;
  const imageWidth = turned ? meta.height : meta.width;
  const imageHeight = turned ? meta.width : meta.height;
  const place = placeWatermark({ imageWidth, imageHeight, markWidth: mark.width, markHeight: mark.height, position: snapshot.position, size: snapshot.size, offsetX: snapshot.offsetX, offsetY: snapshot.offsetY });
  if (!place) throw new Error("The photo has no size to draw on.");
  const overlay = await sharp(mark.buffer)
    .resize(place.width, place.height, { fit: "fill" })
    .ensureAlpha()
    // Fades only the alpha band: colour stays as drawn, the mark lets the photo through.
    .linear([1, 1, 1, Number(snapshot.opacity) / 100], [0, 0, 0, 0])
    .png()
    .toBuffer();
  const out = sharp(photo).rotate().composite([{ input: overlay, left: place.left, top: place.top }]);
  if (meta.format === "webp") return { buffer: await out.webp({ quality: 82 }).toBuffer(), contentType: "image/webp", extension: "webp" };
  if (meta.format === "png") return { buffer: await out.png().toBuffer(), contentType: "image/png", extension: "png" };
  return { buffer: await out.jpeg({ quality: 86, mozjpeg: true }).toBuffer(), contentType: "image/jpeg", extension: "jpg" };
}

module.exports = { FONT_FILES, textMark, markFor, applyWatermark };
