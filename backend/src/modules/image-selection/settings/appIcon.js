const sharp = require("sharp");
const { createSettingsService } = require("./service");
const { getPublicObjectBuffer, keyFromUrl } = require("../../../services/objectStorage");
const { MAX_FAVICON_BYTES } = require("../../../services/imageStorage");

/*
 * The installed app's icons, drawn from the favicon uploaded in Settings → Branding.
 *
 * A home screen icon has to be a square PNG at fixed sizes, and the upload is a PNG or SVG of any
 * shape, so each size is rendered here: the mark centred on a white square, the way the bundled
 * icons are. `maskable` sits at 70% because Android cuts its own shape from the square and keeps
 * only the middle 80%; the iOS icon at 85% because iOS rounds the corners of the full square.
 *
 * Only the studio's own upload is read - a `data:` URI (local development, no storage configured)
 * or a file in this server's public bucket, read by key. A favicon pasted as some other web address
 * is never fetched: the server does not go out to an address it was handed. Anything else answers
 * null and the caller sends the bundled icon instead.
 */
// A null-prototype map, so a name like `constructor` or `__proto__` is simply not a variant.
const VARIANTS = Object.freeze(Object.assign(Object.create(null), {
  "icon-192": { size: 192, scale: 1 },
  "icon-512": { size: 512, scale: 1 },
  "maskable-192": { size: 192, scale: 0.7 },
  "maskable-512": { size: 512, scale: 0.7 },
  "apple-touch-icon-180": { size: 180, scale: 0.85 },
}));

const isVariant = (variant) => typeof variant === "string" && Object.hasOwn(VARIANTS, variant);

const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };
// A favicon that could not be read or drawn is not tried again for this long, so a broken one does
// not cost a storage read and a render on every request.
const FAILURE_TTL_MS = 60 * 1000;
// Base64 is four characters for every three bytes; checked before decoding so an oversized value is
// refused without ever being turned into a buffer.
const MAX_FAVICON_BASE64_CHARS = Math.ceil(MAX_FAVICON_BYTES / 3) * 4;

const settings = createSettingsService();

/*
 * Rendered icons for the favicon currently set, keyed by the favicon itself: a new upload is a new
 * cache and the old one is dropped rather than kept growing. Each entry is the render in flight (so
 * two first requests share one render), its PNG, or a remembered failure.
 */
let cache = { source: null, entries: new Map() };

function cacheFor(source) {
  if (cache.source !== source) cache = { source, entries: new Map() };
  return cache;
}

/** The uploaded favicon's bytes, or null when it is not one this server may read. */
async function faviconBytes(source) {
  if (typeof source !== "string" || !source) return null;
  const dataUri = /^data:image\/(png|svg\+xml);base64,/i.exec(source.trim());
  if (dataUri) {
    const encoded = source.trim().slice(dataUri[0].length);
    if (!encoded || encoded.length > MAX_FAVICON_BASE64_CHARS) return null;
    return Buffer.from(encoded, "base64");
  }
  const key = keyFromUrl(source.trim());
  return key ? getPublicObjectBuffer(key) : null;
}

/** Renders one variant from the favicon's bytes, as a PNG buffer. */
async function render(bytes, { size, scale }) {
  const inner = Math.round(size * scale);
  const mark = await sharp(bytes, { limitInputPixels: 64_000_000 })
    .resize(inner, inner, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: WHITE } })
    .composite([{ input: mark, gravity: "centre" }])
    .png()
    .toBuffer();
}

async function draw(source, spec) {
  const bytes = await faviconBytes(source);
  if (!bytes || bytes.length > MAX_FAVICON_BYTES) return null;
  return render(bytes, spec);
}

/**
 * What is already known about `variant` for the favicon last drawn, without touching the database:
 * `{ png }` when it has been drawn, `{ png: null }` when drawing it failed recently, or undefined
 * when it has to be drawn. The route uses this to let a known answer past the rate limit.
 */
function cachedAppIcon(variant) {
  if (!isVariant(variant) || !cache.source) return undefined;
  const entry = cache.entries.get(variant);
  if (!entry || entry.pending) return undefined;
  if (entry.failedAt && Date.now() - entry.failedAt > FAILURE_TTL_MS) return undefined;
  return { png: entry.png || null };
}

/**
 * The PNG for `variant`, drawn from the studio's favicon, or null when there is no favicon this
 * server can read or draw - the caller then answers with the bundled icon.
 */
async function appIcon(variant) {
  if (!isVariant(variant)) return null;
  const { faviconUrl } = await settings.read();
  if (!faviconUrl) return null;
  // The cache this request belongs to, held on to: if the favicon changes while this render runs,
  // its result lands in the old cache and is dropped with it, never served for the new favicon.
  const mine = cacheFor(faviconUrl);
  const existing = mine.entries.get(variant);
  if (existing?.pending) return existing.pending;
  if (existing?.png) return existing.png;
  if (existing?.failedAt && Date.now() - existing.failedAt <= FAILURE_TTL_MS) return null;

  const pending = draw(faviconUrl, VARIANTS[variant])
    .then((png) => {
      mine.entries.set(variant, png ? { png } : { failedAt: Date.now() });
      return png;
    })
    .catch((error) => {
      mine.entries.set(variant, { failedAt: Date.now() });
      throw error;
    });
  mine.entries.set(variant, { pending });
  return pending;
}

module.exports = { appIcon, cachedAppIcon, faviconBytes, isVariant, VARIANTS };
