/**
 * The AI Editing recipe: what the photographer asked for on one photo, as plain data the web, the
 * desktop and the render engine all agree on. Mirrored word for word in the web
 * (`frontend/src/lib/aiEditingRecipe.mjs`) and the desktop (`src/modules/image-selection/editing/
 * editingRecipe.js`), with a test on each side against this file.
 *
 * A recipe is `{ style, adjustments, advanced, tools, reference, referenceProfile }`:
 *
 * - `style`: one of STYLES, a named professional look the engine applies before the adjustments -
 *   tone curve, colour grade, skin treatment, grain where the look wants it. "natural" is no look.
 * - `adjustments`: ten sliders, each -100..100 with 0 meaning "leave it". `null` on one of the
 *   auto-able sliders (exposure, highlights, shadows, whites, blacks, temperature, tint) means "let
 *   the AI choose", which Auto Edit sets; the render answers with the number it chose.
 * - `advanced`: HSL per hue band (hue / sat / lum, -100..100), colour balance for shadows, midtones
 *   and highlights (r / g / b, -100..100) and detail (clarity, texture). All 0 by default.
 * - `tools`: each AI tool with its own settings, or absent when off. `removeObject.masks` are
 *   rectangles in fractions of the frame painted on the preview. The ten RETOUCH tools (facial
 *   skin, body skin, eyebrows, eye sclera, iris and pupil, lips, teeth, hair, facial hair,
 *   clothes) each carry one `amount`, 0..100: the region is found by the engine from the face
 *   landmarks and the skin and subject outlines, and only that region is touched.
 * - `reference`: `{ strength }` once a reference photo is stored on the edit; the render measures
 *   the reference into an editing PROFILE (below) and keeps it on the edit.
 * - `referenceProfile`: the measured look of a reference, as slider deltas and tone colours - the
 *   portable "make these look like this" the batch apply copies onto other photos, with no reference
 *   bytes needed per photo. Written by the engine, carried by the recipe, never typed by hand.
 *
 * `normalizeRecipe` is the only way a recipe is accepted: unknown keys are dropped, numbers are
 * clamped, and anything malformed becomes the default rather than a refusal.
 */

const ENGINE_VERSION = "2.1.0";

const ADJUSTMENTS = Object.freeze(["exposure", "contrast", "highlights", "shadows", "whites", "blacks", "temperature", "tint", "vibrance", "saturation"]);
const AUTO_EXPOSURE_FIELDS = Object.freeze(["exposure", "highlights", "shadows", "whites", "blacks"]);
const AUTO_WHITE_BALANCE_FIELDS = Object.freeze(["temperature", "tint"]);
const AUTO_COLOR_FIELDS = Object.freeze(["contrast", "vibrance", "saturation"]);

const STYLES = Object.freeze([
  { id: "natural", label: "Natural Wedding", description: "A clean, true-to-life finish - only your adjustments and tools." },
  { id: "warmWedding", label: "Warm Wedding", description: "Soft warmth, gentle highlights, flattering skin." },
  { id: "luxuryWedding", label: "Luxury Wedding", description: "Rich but restrained: deep tones, creamy highlights, refined skin." },
  { id: "cinematic", label: "Cinematic", description: "Teal shadows, warm highlights, deeper contrast." },
  { id: "moody", label: "Moody", description: "Lifted blacks, muted colour, darker mid-tones." },
  { id: "brightAiry", label: "Bright & Airy", description: "Lighter exposure, open shadows, pastel colour." },
  { id: "editorial", label: "Editorial", description: "Crisp, neutral, magazine-clean with controlled contrast." },
  { id: "filmLook", label: "Film Look", description: "Faded blacks, warm grain and a softened curve." },
  { id: "classic", label: "Classic", description: "Timeless, slightly warm, honest colour and gentle contrast." },
  { id: "goldenHour", label: "Golden Hour", description: "Sunset warmth in the highlights, soft amber shadows." },
]);
const STYLE_IDS = STYLES.map((style) => style.id);

const CROP_ASPECTS = Object.freeze([
  { id: "original", label: "Original" },
  { id: "1:1", label: "Square 1:1", ratio: 1 },
  { id: "4:5", label: "Portrait 4:5", ratio: 4 / 5 },
  { id: "5:7", label: "Print 5:7", ratio: 5 / 7 },
  { id: "2:3", label: "Classic 2:3", ratio: 2 / 3 },
  { id: "3:2", label: "Landscape 3:2", ratio: 3 / 2 },
  { id: "16:9", label: "Wide 16:9", ratio: 16 / 9 },
]);
const CROP_ASPECT_IDS = CROP_ASPECTS.map((aspect) => aspect.id);

/** The eight hue bands of the HSL panel, in wheel order. */
const HSL_BANDS = Object.freeze(["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"]);
const HSL_CHANNELS = Object.freeze(["hue", "sat", "lum"]);
const BALANCE_RANGES = Object.freeze(["shadows", "midtones", "highlights"]);
const BALANCE_CHANNELS = Object.freeze(["r", "g", "b"]);
const DETAIL_FIELDS = Object.freeze(["clarity", "texture"]);

/**
 * Every tool, its settings and their ranges as [min, max, default]. A tool present in `tools` is
 * on; the engine reports in `capabilities` which it can actually run on this server.
 */
const TOOLS = Object.freeze({
  autoExposure: { label: "Auto Exposure", settings: {} },
  autoWhiteBalance: { label: "Auto White Balance", settings: {} },
  colorEnhance: { label: "Color Enhancement", settings: { strength: [0, 100, 50] } },
  retouchFace: { label: "Skin Retouch", settings: { smoothing: [0, 100, 40], blemishes: [0, 100, 50], underEyes: [0, 100, 40], skinTone: [0, 100, 30], shine: [0, 100, 40], exposure: [-100, 100, 0], teeth: [0, 100, 40] } },
  faceEnhance: { label: "Face Enhancement", settings: { brightness: [0, 100, 25], eyes: [0, 100, 40], detail: [0, 100, 25] } },
  denoise: { label: "Denoise", settings: { strength: [0, 100, 50], detail: [0, 100, 60] } },
  sharpen: { label: "Sharpen", settings: { amount: [0, 100, 35] } },
  removeObject: { label: "Remove Object", settings: {}, masks: true },
  enhanceSky: { label: "Enhance Sky", settings: { strength: [0, 100, 50], exposure: [-100, 100, 0], warmth: [0, 100, 0] } },
  background: { label: "Background", settings: { brightness: [-100, 100, 0], blur: [0, 100, 0], calm: [0, 100, 0] } },
  autoCrop: { label: "Smart Crop", settings: {}, aspect: true },
  // Retouching by region, one intensity each; the defaults favour a natural wedding finish.
  facialSkin: { label: "Facial Skin", settings: { amount: [0, 100, 40] } },
  bodySkin: { label: "Body Skin", settings: { amount: [0, 100, 35] } },
  eyebrows: { label: "Eyebrows", settings: { amount: [0, 100, 30] } },
  eyeSclera: { label: "Eye Sclera", settings: { amount: [0, 100, 35] } },
  irisPupil: { label: "Iris and Pupil", settings: { amount: [0, 100, 35] } },
  lips: { label: "Lips", settings: { amount: [0, 100, 30] } },
  teeth: { label: "Teeth", settings: { amount: [0, 100, 35] } },
  hair: { label: "Hair", settings: { amount: [0, 100, 30] } },
  facialHair: { label: "Facial Hair", settings: { amount: [0, 100, 25] } },
  clothes: { label: "Clothes", settings: { amount: [0, 100, 30] } },
});
const TOOL_IDS = Object.keys(TOOLS);
/** The region retouching tools, in the order the panel lists them. */
const RETOUCH_TOOL_IDS = Object.freeze(["facialSkin", "bodySkin", "eyebrows", "eyeSclera", "irisPupil", "lips", "teeth", "hair", "facialHair", "clothes"]);

/** The fields of a reference profile, each a slider delta (-100..100) or a tone colour. */
const PROFILE_FIELDS = Object.freeze(["exposure", "contrast", "highlights", "shadows", "temperature", "tint", "vibrance", "saturation", "skinWarmth"]);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
function number(value, min, max, fallback) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.round(clamp(parsed, min, max));
}

function normalizeAdjustments(input) {
  const source = input && typeof input === "object" ? input : {};
  const out = {};
  for (const key of ADJUSTMENTS) {
    const value = source[key];
    if (value === null && (AUTO_EXPOSURE_FIELDS.includes(key) || AUTO_WHITE_BALANCE_FIELDS.includes(key))) out[key] = null;
    else out[key] = number(value, -100, 100, 0);
  }
  return out;
}

function normalizeAdvanced(input) {
  const source = input && typeof input === "object" ? input : {};
  const hsl = {};
  for (const band of HSL_BANDS) {
    const given = source.hsl && typeof source.hsl === "object" ? source.hsl[band] || {} : {};
    hsl[band] = Object.fromEntries(HSL_CHANNELS.map((channel) => [channel, number(given[channel], -100, 100, 0)]));
  }
  const colorBalance = {};
  for (const range of BALANCE_RANGES) {
    const given = source.colorBalance && typeof source.colorBalance === "object" ? source.colorBalance[range] || {} : {};
    colorBalance[range] = Object.fromEntries(BALANCE_CHANNELS.map((channel) => [channel, number(given[channel], -100, 100, 0)]));
  }
  const detailGiven = source.detail && typeof source.detail === "object" ? source.detail : {};
  const detail = Object.fromEntries(DETAIL_FIELDS.map((field) => [field, number(detailGiven[field], -100, 100, 0)]));
  return { hsl, colorBalance, detail };
}

function normalizeMasks(masks) {
  if (!Array.isArray(masks)) return [];
  return masks
    .filter((mask) => mask && typeof mask === "object")
    .map((mask) => {
      const x = clamp(Number(mask.x) || 0, 0, 1);
      const y = clamp(Number(mask.y) || 0, 0, 1);
      const w = clamp(Number(mask.w) || 0, 0, 1 - x);
      const h = clamp(Number(mask.h) || 0, 0, 1 - y);
      return { x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000, w: Math.round(w * 10000) / 10000, h: Math.round(h * 10000) / 10000 };
    })
    .filter((mask) => mask.w > 0 && mask.h > 0)
    .slice(0, 50);
}

function normalizeTools(input) {
  const source = input && typeof input === "object" ? input : {};
  const out = {};
  for (const id of TOOL_IDS) {
    const given = source[id];
    if (!given) continue;
    const spec = TOOLS[id];
    const settings = given && typeof given === "object" ? given : {};
    const tool = {};
    for (const [name, [min, max, fallback]] of Object.entries(spec.settings)) tool[name] = number(settings[name], min, max, fallback);
    if (spec.masks) {
      tool.masks = normalizeMasks(settings.masks);
      if (!tool.masks.length) continue;
    }
    if (spec.aspect) tool.aspect = CROP_ASPECT_IDS.includes(settings.aspect) ? settings.aspect : "original";
    out[id] = tool;
  }
  return out;
}

const tone = (given) => (given && typeof given === "object" ? Object.fromEntries(BALANCE_CHANNELS.map((channel) => [channel, number(given[channel], -100, 100, 0)])) : { r: 0, g: 0, b: 0 });
/** A measured reference look, clamped; null when nothing usable is there. */
function normalizeProfile(input) {
  if (!input || typeof input !== "object") return null;
  const profile = {};
  for (const field of PROFILE_FIELDS) profile[field] = number(input[field], -100, 100, 0);
  profile.shadowTone = tone(input.shadowTone);
  profile.highlightTone = tone(input.highlightTone);
  profile.summary = typeof input.summary === "string" ? input.summary.slice(0, 200) : "";
  return profile;
}

/** The recipe every write and every render goes through. */
function normalizeRecipe(input) {
  const source = input && typeof input === "object" ? input : {};
  const reference = source.reference && typeof source.reference === "object" ? { strength: number(source.reference.strength, 0, 100, 70) } : null;
  return {
    style: STYLE_IDS.includes(source.style) ? source.style : "natural",
    adjustments: normalizeAdjustments(source.adjustments),
    advanced: normalizeAdvanced(source.advanced),
    tools: normalizeTools(source.tools),
    reference,
    referenceProfile: normalizeProfile(source.referenceProfile),
  };
}

const EMPTY_RECIPE = Object.freeze(normalizeRecipe({}));

const zeros = (object) => Object.values(object).every((value) => (value && typeof value === "object" ? zeros(value) : value === 0));
/** Whether a recipe changes anything at all - a photo with this recipe needs no render to be sent on. */
function recipeIsEmpty(recipe) {
  const normalized = normalizeRecipe(recipe);
  if (normalized.style !== "natural" || normalized.reference || normalized.referenceProfile) return false;
  if (Object.keys(normalized.tools).length) return false;
  if (!zeros(normalized.advanced)) return false;
  return ADJUSTMENTS.every((key) => normalized.adjustments[key] === 0);
}

module.exports = {
  ENGINE_VERSION, ADJUSTMENTS, AUTO_EXPOSURE_FIELDS, AUTO_WHITE_BALANCE_FIELDS, AUTO_COLOR_FIELDS,
  STYLES, STYLE_IDS, CROP_ASPECTS, CROP_ASPECT_IDS, HSL_BANDS, HSL_CHANNELS, BALANCE_RANGES, BALANCE_CHANNELS, DETAIL_FIELDS,
  TOOLS, TOOL_IDS, RETOUCH_TOOL_IDS, PROFILE_FIELDS, EMPTY_RECIPE,
  normalizeRecipe, normalizeMasks, normalizeProfile, recipeIsEmpty,
};
