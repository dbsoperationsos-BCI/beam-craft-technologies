const prisma = require("../../../config/db");
const { httpError } = require("../../ai-feature/shared/http");
const config = require("../shared/config");

/**
 * Photo Selling's own settings: one row in `photo_sale_setting`, read and written here and nowhere
 * else. Nothing in the AI Feature's settings is read in its place, and nothing here is read by the
 * AI Feature - the two can change independently.
 *
 * - Gallery defaults: what a new gallery starts with - price, tax, PIN, how closely a face must match
 *   a guest's selfie, accent colour, watermark design and QR poster. Copied onto the gallery when it
 *   is created, so a later change here never alters a gallery that already exists.
 * - Download policy: how often, and for how long after payment, a bought photo can be downloaded.
 *   Frozen onto each order at checkout, so a later change never takes away what a buyer was sold.
 *
 * Until the studio saves anything, the defaults below stand (the download policy's from the
 * environment, `PHOTO_SELLING_DOWNLOAD_LIMIT` / `_DAYS`). The row is written on the first save.
 */
const ID = "default";
const QR_TEXT_KEYS = ["heading", "subheading", "instruction", "note", "footer"];
const QR_TEXT_LIMITS = Object.freeze({ heading: 32, subheading: 36, instruction: 32, note: 90, footer: 60 });
/** Photo Selling's own poster words - the AI Feature's ("Register your face") never print on a sales poster. */
const QR_DEFAULT_TEXT = Object.freeze({ heading: "YOUR PHOTOS", subheading: "ARE READY", instruction: "SCAN TO VIEW & BUY", note: "FIND YOUR PHOTOS WITH A SELFIE", showPin: true });

function codeDefaults() {
  const policy = config.downloadPolicy();
  return {
    pricePaise: null, taxRateBps: 0, pricesIncludeTax: true, requirePin: false,
    matchStrictness: "STANDARD", accentColor: null, watermarkPresetId: null, qrTemplateId: "ivory", qrText: { ...QR_DEFAULT_TEXT },
    downloadLimit: policy.limit, downloadDays: policy.days,
    // Guest selfie search on (the store as it always was); WhatsApp photo-match messages off.
    selfieSearchEnabled: true, whatsappNotify: false,
  };
}

/** Poster words: only the known keys, each a trimmed string within its limit, plus `showPin`. */
function cleanQrText(value, base = QR_DEFAULT_TEXT) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const out = {};
  for (const key of QR_TEXT_KEYS) {
    const text = source[key] === undefined ? base[key] : source[key];
    if (text !== undefined && text !== null) out[key] = String(text).replace(/\s+/g, " ").trim().slice(0, QR_TEXT_LIMITS[key]);
  }
  out.showPin = source.showPin === undefined ? base.showPin !== false : source.showPin !== false;
  return out;
}

function serialize(row) {
  const base = codeDefaults();
  const merged = row ? { ...base, ...Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null && value !== undefined)) } : base;
  return {
    pricePaise: merged.pricePaise ?? null, taxRateBps: merged.taxRateBps, pricesIncludeTax: merged.pricesIncludeTax,
    requirePin: merged.requirePin, matchStrictness: merged.matchStrictness,
    accentColor: merged.accentColor ?? null, watermarkPresetId: merged.watermarkPresetId ?? null,
    qrTemplateId: merged.qrTemplateId, qrText: cleanQrText(row?.qrText),
    downloads: { limit: merged.downloadLimit, days: merged.downloadDays },
    selfieSearchEnabled: merged.selfieSearchEnabled !== false, whatsappNotify: Boolean(merged.whatsappNotify),
    updatedAt: row?.updatedAt || null, saved: Boolean(row),
  };
}

async function get() {
  return serialize(await prisma.photoSaleSetting.findUnique({ where: { id: ID } }));
}

const FIELDS = ["pricePaise", "taxRateBps", "pricesIncludeTax", "requirePin", "matchStrictness", "accentColor", "watermarkPresetId", "qrTemplateId", "selfieSearchEnabled", "whatsappNotify"];

/** Saves what was sent (a validated, partial body); answers the settings as they now stand. */
async function save(body, user) {
  const data = {};
  for (const key of FIELDS) if (body[key] !== undefined) data[key] = body[key];
  const current = await prisma.photoSaleSetting.findUnique({ where: { id: ID } });
  // Words not sent keep what was saved, as a gallery's do.
  if (body.qrText !== undefined) data.qrText = cleanQrText(body.qrText, cleanQrText(current?.qrText));
  if (body.downloads?.limit !== undefined) data.downloadLimit = body.downloads.limit;
  if (body.downloads?.days !== undefined) data.downloadDays = body.downloads.days;
  if (data.watermarkPresetId) {
    const preset = await prisma.aiWatermarkPreset.findUnique({ where: { id: data.watermarkPresetId }, select: { id: true } });
    if (!preset) throw httpError(400, "That watermark design no longer exists. Choose another.");
  }
  data.updatedByUserId = user?.id ?? null;
  const row = await prisma.photoSaleSetting.upsert({ where: { id: ID }, create: { id: ID, ...data }, update: data });
  return serialize(row);
}

/**
 * The settings screen's WhatsApp status: what the server has in place and whether Meta has approved
 * the template - never a token, id or raw error (notifications/config.readiness, templateStatus).
 */
async function whatsappStatus() {
  const readiness = require("../notifications/config").readiness();
  const template = await require("../notifications/templateStatus").templateStatus();
  return { ...readiness, template };
}

module.exports = { ID, QR_DEFAULT_TEXT, QR_TEXT_KEYS, QR_TEXT_LIMITS, codeDefaults, cleanQrText, get, save, whatsappStatus };
