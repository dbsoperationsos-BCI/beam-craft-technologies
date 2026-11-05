const { createHash } = require("crypto");
const { z } = require("zod");
const { POSITIONS } = require("./geometry");

/**
 * What a watermark preset is made of, and the copy of one an event keeps.
 *
 * The snapshot an event stores in `gallery.watermarkSnapshot` is the preset's look at the moment it
 * was chosen - `{ presetId, name, type, logoKey, logoWidth, logoHeight, text, textColor,
 * fontWeight, position, size, opacity, offsetX, offsetY, takenAt }` - with `logoKey` pointing at
 * the event's own copy of the logo, so the event never depends on the preset still existing.
 */
const MAX_PRESETS = 20;
const TYPES = ["LOGO", "TEXT"];
const FONT_WEIGHTS = ["REGULAR", "BOLD"];
const RANGES = Object.freeze({ size: [5, 60], opacity: [5, 100], offset: [-30, 30] });
// Bumped whenever the drawing itself changes, so every cached watermarked photo is redrawn.
const RENDER_VERSION = 1;

const int = (min, max) => z.coerce.number().int().min(min).max(max);
const hex = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Choose a colour as #RRGGBB.").transform((value) => value.toUpperCase());

/** A preset as the screen sends it. `logo` is a data URL of a newly picked file; absent keeps the stored one. */
const presetBodySchema = z.object({
  name: z.string().trim().min(1, "Give the watermark a name.").max(80),
  type: z.enum(TYPES),
  logo: z.string().max(8 * 1024 * 1024).optional(),
  text: z.string().trim().max(120).optional().nullable(),
  textColor: hex.optional().nullable(),
  fontWeight: z.enum(FONT_WEIGHTS).optional().nullable(),
  position: z.enum(POSITIONS),
  size: int(...RANGES.size),
  opacity: int(...RANGES.opacity),
  offsetX: int(...RANGES.offset).default(0),
  offsetY: int(...RANGES.offset).default(0),
}).strict().superRefine((value, ctx) => {
  if (value.type === "TEXT" && !value.text) ctx.addIssue({ code: "custom", path: ["text"], message: "Type the watermark text." });
});

/** The text-mark preview the screen asks for while a TEXT preset is being drawn. */
const textMarkSchema = z.object({ text: z.string().trim().min(1).max(120), textColor: hex, fontWeight: z.enum(FONT_WEIGHTS) }).strict();

const LOOK_KEYS = ["type", "logoKey", "logoWidth", "logoHeight", "text", "textColor", "fontWeight", "position", "size", "opacity", "offsetX", "offsetY"];

/** The parts of a preset that decide how a photo looks, normalised: TEXT carries no logo and LOGO no text. */
function lookOf(source) {
  const look = Object.fromEntries(LOOK_KEYS.map((key) => [key, source?.[key] ?? null]));
  if (look.type === "TEXT") { look.logoKey = null; look.logoWidth = null; look.logoHeight = null; look.textColor = look.textColor || "#FFFFFF"; look.fontWeight = look.fontWeight || "BOLD"; }
  else { look.text = null; look.textColor = null; look.fontWeight = null; }
  return look;
}

/** One name for one look: a cached watermarked photo is reused only for exactly the look it was drawn with. */
const configHash = (snapshot) => createHash("sha256").update(JSON.stringify([RENDER_VERSION, ...LOOK_KEYS.map((key) => lookOf(snapshot)[key])])).digest("hex");

/**
 * Where an event draws its watermark: `{ view, download }`, each true only when its switch is on and
 * a preset is chosen. A gallery group that has only the old single `watermark` switch (one not yet
 * read through `mergeGroup`) is read as both set to it.
 */
function watermarkUses(gallery) {
  const legacy = gallery?.watermarkOnView == null && gallery?.watermarkOnDownload == null;
  const chosen = Boolean(gallery?.watermarkPresetId);
  const view = legacy ? Boolean(gallery?.watermark) : Boolean(gallery?.watermarkOnView);
  const download = legacy ? Boolean(gallery?.watermark) : Boolean(gallery?.watermarkOnDownload);
  return { view: chosen && view, download: chosen && download };
}

/** Whether an event's gallery settings ask for a watermark, anywhere, that can actually be drawn. */
function activeSnapshot(gallery) {
  const uses = watermarkUses(gallery);
  const snapshot = uses.view || uses.download ? gallery.watermarkSnapshot : null;
  if (!snapshot || !TYPES.includes(snapshot.type)) return null;
  if (snapshot.type === "LOGO" && !snapshot.logoKey) return null;
  if (snapshot.type === "TEXT" && !snapshot.text) return null;
  return snapshot;
}

module.exports = { MAX_PRESETS, TYPES, FONT_WEIGHTS, RANGES, RENDER_VERSION, presetBodySchema, textMarkSchema, lookOf, configHash, watermarkUses, activeSnapshot };
