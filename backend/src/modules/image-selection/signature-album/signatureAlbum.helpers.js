const r2 = require("../storage/r2");
const { THEME_DEFAULTS, THEME_EDITABLE_KEYS, LOGO_VARIANTS, DEFAULT_ENDING_MESSAGE, DEFAULT_FOOTER_TEXT, LIMITS, TRANSFORM_LIMITS } = require("./signatureAlbum.constants");

/*
 * Pure helpers: nothing here touches the database or the request, so every rule the album relies
 * on - what "ready" means, how a status is read, where a design value comes from - can be checked
 * without either.
 */

function httpError(status, message, details) {
  const error = new Error(message);
  error.status = status;
  if (details) error.details = details;
  return error;
}

function addMonths(date, months) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + Number(months || 0));
  return next;
}

// The day the client reads, in the studio's own time zone - the wording the WhatsApp message and
// the Review & Share card both use, so the two cannot disagree.
function formatDay(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "long", year: "numeric" }).format(date);
}

// Where the client link points. Production names the album subdomain; development falls back to
// the frontend's own /a route, so nothing has to be configured locally.
function albumBaseUrl() {
  return (process.env.SIGNATURE_ALBUM_PUBLIC_URL || `${process.env.FRONTEND_URL || "http://localhost:3000"}/a`).replace(/\/+$/, "");
}
const clientUrlFor = (shortCode) => (shortCode ? `${albumBaseUrl()}/${shortCode}` : null);

/*
 * Why the album cannot go out yet, as a list the panel can show and the publish can refuse on.
 * Empty means READY. The checks are the six the specification names; each message is what the
 * studio sees, so they are sentences rather than codes.
 */
function publishProblems(album, { chapterCount = 0, photoCount = 0, now = new Date() } = {}) {
  const problems = [];
  if (!album.coverImageId && !album.coverAlbumPhotoId) problems.push({ code: "COVER", message: "Please select a cover image." });
  if (!String(album.title || "").trim()) problems.push({ code: "TITLE", message: "Give the album a title." });
  // A photo in the album is always in a chapter - an upload makes the album's first one - so a
  // missing chapter is only ever said as the missing photo it really is.
  if (photoCount < 1) problems.push({ code: "PHOTOS", message: "Upload at least one photo." });
  else if (chapterCount < 1) problems.push({ code: "CHAPTERS", message: "Add at least one chapter." });
  if (album.expiresAt && new Date(album.expiresAt) <= now) problems.push({ code: "EXPIRY", message: "The expiry date has passed. Choose a later date." });
  return problems;
}

/*
 * The status the studio reads. Stored PUBLISHED is still PUBLISHED until the expiry passes, then
 * EXPIRED; anything unpublished is READY when nothing blocks publishing and DRAFT otherwise.
 */
function deriveStatus(album, problems, now = new Date()) {
  if (album.status === "EXPIRED") return "EXPIRED";
  if (album.status === "PUBLISHED") return album.expiresAt && new Date(album.expiresAt) <= now ? "EXPIRED" : "PUBLISHED";
  return problems.length ? "DRAFT" : "READY";
}

const isExpired = (album, now = new Date()) => Boolean(album.expiresAt && new Date(album.expiresAt) <= now);

/*
 * The design as every page draws it: the theme's preset, with the five values the album stores
 * laid over it. `customized` says whether any of those five differ from the preset - what the
 * Design panel warns about before replacing them - and `overrides` carries them raw so a chosen
 * colour can be told from an inherited one. Muted text, the border and the overlay are always
 * the theme's; the page turns the overlay's tone and strength into a gradient.
 */
/*
 * Whether a colour reads as a dark ground: the same relative-luminance cut the page uses for its
 * muted tones (`isDark` in the frontend's signatureAlbum.mjs), so the server and the page agree
 * about which of the two Global Logos a background wants. Anything that is not a six-digit hex is
 * read as light, the way the page reads it.
 */
function isDarkColor(hex) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!match) return false;
  const value = parseInt(match[1], 16);
  return (0.2126 * ((value >> 16) & 255) + 0.7152 * ((value >> 8) & 255) + 0.0722 * (value & 255)) / 255 < 0.45;
}

function resolveDesign(album) {
  const theme = THEME_DEFAULTS[album.theme] ? album.theme : "EDITORIAL";
  const preset = THEME_DEFAULTS[theme];
  const stored = Object.fromEntries(THEME_EDITABLE_KEYS.map((key) => [key, album[key] || null]));
  const value = (key) => stored[key] || preset[key];
  const backgroundColor = value("backgroundColor");
  return {
    theme,
    coverStyle: album.coverStyle,
    layoutStyle: album.layoutStyle,
    imageSpacing: album.imageSpacing,
    coverAlignment: album.coverAlignment,
    backgroundColor,
    textColor: value("textColor"),
    accentColor: value("accentColor"),
    headingFont: value("headingFont"),
    bodyFont: value("bodyFont"),
    mutedTextColor: preset.mutedTextColor,
    // Which Global Logo the pages draw (AUTO / DARK / LIGHT), and whether the effective
    // background - the theme's or the studio's own - is a dark ground. AUTO is decided from the
    // second, so a background changed by hand moves the mark with it.
    logoVariant: LOGO_VARIANTS.includes(album.logoVariant) ? album.logoVariant : "AUTO",
    darkSurface: isDarkColor(backgroundColor),
    borderColor: preset.borderColor,
    overlay: preset.overlay,
    customized: THEME_EDITABLE_KEYS.some((key) => stored[key] && String(stored[key]).toLowerCase() !== String(preset[key]).toLowerCase()),
    overrides: stored,
  };
}

/*
 * How a photo sits in its frame, with the defaults filled in: null columns read as FILL, centred,
 * no zoom - exactly what every frame drew before positioning existed - so an item never adjusted
 * is unchanged. The page turns these four values into CSS; nothing here is a style string.
 */
function transformOf(row, prefix = "") {
  const key = (name) => (prefix ? `${prefix}${name[0].toUpperCase()}${name.slice(1)}` : name);
  const clamp = (value, min, max, fallback) => (typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback);
  return {
    displayMode: row?.[key("displayMode")] === "FIT" ? "FIT" : "FILL",
    focalX: clamp(row?.[key("focalX")], TRANSFORM_LIMITS.MIN_FOCAL, TRANSFORM_LIMITS.MAX_FOCAL, 50),
    focalY: clamp(row?.[key("focalY")], TRANSFORM_LIMITS.MIN_FOCAL, TRANSFORM_LIMITS.MAX_FOCAL, 50),
    zoom: clamp(row?.[key("zoom")], TRANSFORM_LIMITS.MIN_ZOOM, TRANSFORM_LIMITS.MAX_ZOOM, 1),
    // Whether the studio ever adjusted it, so the editor can say "default" honestly.
    adjusted: row?.[key("displayMode")] != null || row?.[key("focalX")] != null || row?.[key("focalY")] != null || row?.[key("zoom")] != null,
  };
}

/*
 * The public R2 address of a derivative, or null where there is none to give: no key, or no
 * `R2_PUBLIC_BASE_URL` to put in front of it. `r2.publicUrl` joins the base and the key as they
 * are, so on a machine with keys in the database and no base configured - CI, a fresh development
 * database copied from production - it answers a bare "/p/1.jpg" that nothing serves. Only an
 * absolute address is a URL the client can load; anything else falls through to the API route.
 */
function r2Url(key) {
  const url = key ? r2.publicUrl(key) : null;
  return url && /^https?:\/\//i.test(url) ? url : null;
}

/*
 * A photo as the album refers to it. The same two derivative URLs the client gallery serves - the
 * R2 object when the photo has one, otherwise the API route `base` names, which streams the local
 * derivative behind whatever session that route demands. Never the original.
 */
function serializeImageRef(image, base) {
  if (!image) return null;
  return {
    imageId: image.id,
    fileName: image.fileName,
    width: image.width ?? null,
    height: image.height ?? null,
    capturedAt: image.capturedAt ?? null,
    thumbnailUrl: r2Url(image.thumbnailKey) || `${base}/${image.id}/thumbnail`,
    previewUrl: r2Url(image.previewKey) || `${base}/${image.id}/preview`,
  };
}

// The footer line with the studio's name in it, for a studio that has not written its own.
function footerTextFor(settings, studioName) {
  const template = settings?.footerText || DEFAULT_FOOTER_TEXT;
  return template.replace(/\{studioName\}/g, studioName || "");
}
const endingMessageFor = (album, settings) => album.endingMessage || settings?.defaultEndingMessage || DEFAULT_ENDING_MESSAGE;

/*
 * The studio's branding as the album shows it - name, mark, footer line, the ending's message and
 * links - from the studio-wide album settings and the studio's own settings. One function, read
 * by the client page and by the workspace's live preview, so the two cannot show different
 * endings. A published album keeps the name and logo it went out with (`brandingSnapshot`); the
 * live settings fill only what the snapshot lacks.
 *
 * `logoUrl` null is not "no logo": the page draws the application's bundled mark in that case,
 * the fallback every other surface shows, so a studio with the logo switch on never gets an
 * empty space where the mark goes.
 */
/*
 * The one mark the album's pages draw, chosen from the studio's two Global Logos.
 *
 * `marks` are the two uploads named after the ground each is drawn for: `light` is Settings'
 * light-mode logo (dark lettering, for a light surface) and `dark` its dark-mode logo (light
 * lettering, for a dark surface). The tone wanted is the album's pinned variant, or - on AUTO -
 * whatever the effective background asks for. The mark for that ground is used when it exists;
 * otherwise the other is borrowed and `ownMark` is false, which is the page's cue to set the
 * borrowed mark on a small plate of its own ground rather than invert or fade it - the artwork is
 * never altered. No upload at all is `url` null: the page draws the bundled mark in the wanted
 * tone, which ships in both.
 */
function logoFor(design, marks = {}) {
  const tone = design?.logoVariant === "DARK" || design?.logoVariant === "LIGHT" ? design.logoVariant : (design?.darkSurface ? "DARK" : "LIGHT");
  const own = tone === "DARK" ? marks.dark : marks.light;
  const other = tone === "DARK" ? marks.light : marks.dark;
  return { tone, url: own || other || null, ownMark: Boolean(own) || !other };
}

function brandingFor(album, settings, studio) {
  const snapshot = album.brandingSnapshot || {};
  const studioName = snapshot.studioName || studio.studioName;
  // A published album keeps the marks it went out with; an album published before the dark-mode
  // logo was carried on the snapshot reads today's, so a dark album gains the right mark without
  // being republished.
  const marks = settings.useGlobalLogo
    ? { light: snapshot.galleryLogoUrl || studio.galleryLogoUrl || null, dark: snapshot.galleryLogoDarkUrl || studio.galleryLogoDarkUrl || null }
    : {};
  const logo = logoFor(resolveDesign(album), marks);
  return {
    studioName: settings.showStudioName ? studioName : null,
    logoUrl: settings.showStudioLogo ? logo.url : null,
    // The chosen mark with its tone, for the page to draw the right bundled mark or plate when the
    // upload for this ground is missing. Null when the logo switch is off, like `logoUrl`.
    logo: settings.showStudioLogo ? logo : null,
    showLogo: settings.showStudioLogo,
    showFooter: settings.showBrandingFooter,
    footerText: settings.showBrandingFooter ? footerTextFor(settings, studioName) : null,
    ending: {
      message: endingMessageFor(album, settings),
      showLogo: settings.endingShowLogo && settings.showStudioLogo,
      websiteUrl: settings.endingShowWebsite ? settings.websiteUrl : null,
      instagramUrl: settings.endingShowInstagram ? settings.instagramUrl : null,
    },
    performance: { initialPhotosLoaded: settings.initialPhotosLoaded, lazyLoadBatch: settings.lazyLoadBatch, preloadNextImages: settings.preloadNextImages },
    // Running numbers on the photos are the studio-wide Settings switch's alone.
    showImageNumbers: settings.showImageNumbers,
  };
}

/*
 * Reordering by a list of ids: the ids given come first in that order, anything not named keeps
 * its place after them, and an id that is not in the list is refused rather than silently dropped.
 */
function applyOrder(currentIds, orderedIds) {
  const known = new Set(currentIds);
  const unknown = orderedIds.filter((id) => !known.has(id));
  if (unknown.length) throw httpError(400, "The order names something that is not in this list.", { unknown });
  const seen = new Set();
  const next = [];
  for (const id of orderedIds) if (!seen.has(id)) { seen.add(id); next.push(id); }
  for (const id of currentIds) if (!seen.has(id)) { seen.add(id); next.push(id); }
  return next;
}

/*
 * The name of the album's PDF: the title as a file name - lower case, letters and digits, hyphens
 * between, never a path separator, a control character or anything a file system could read as a
 * path of its own - then "-signature-album.pdf" ("ranju-raj-signature-album.pdf").
 */
function fileSlug(text, fallback = "album") {
  const slug = String(text || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/g, "");
  return slug || fallback;
}
function albumPdfFileName(album) {
  const slug = fileSlug(album?.title, "");
  return `${slug ? `${slug}-` : ""}signature-album.pdf`;
}

// The album's counts for the header - photos, chapters, highlights - from item rows alone.
function summarizeItems(items) {
  return {
    photoCount: items.length,
    highlightCount: items.filter((item) => item.isHighlight).length,
    highlightLimit: LIMITS.MAX_HIGHLIGHTS,
  };
}

/*
 * Whether a buffer is what the browser said it built. An uploaded photo's derivatives are served
 * straight from the album's link, so the bytes are checked rather than the declared type trusted:
 * a WebP opens "RIFF....WEBP", a JPEG with the SOI marker FF D8 FF.
 */
const isWebp = (buffer) => Buffer.isBuffer(buffer) && buffer.length > 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
const isJpeg = (buffer) => Buffer.isBuffer(buffer) && buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;

module.exports = {
  isWebp, isJpeg,
  httpError, addMonths, formatDay, albumBaseUrl, clientUrlFor, publishProblems, deriveStatus, isExpired,
  resolveDesign, isDarkColor, logoFor, r2Url, serializeImageRef, footerTextFor, endingMessageFor, brandingFor, transformOf, applyOrder, summarizeItems,
  fileSlug, albumPdfFileName,
};
