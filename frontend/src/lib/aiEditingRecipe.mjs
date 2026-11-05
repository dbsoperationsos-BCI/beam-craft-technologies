/**
 * The AI Editing recipe, the web's copy of `backend/src/modules/image-selection/ai-editing/
 * recipe.js` - the same styles, sliders, advanced panels, tools and ranges, so what the editing
 * screen offers is exactly what the render engine understands. Plain module (no React) so
 * `node --test` holds it against the backend's file. Change the backend first, then this, then the
 * desktop's.
 */

export const ADJUSTMENTS = Object.freeze([
  { id: "exposure", label: "Exposure", auto: true },
  { id: "contrast", label: "Contrast", auto: false },
  { id: "highlights", label: "Highlights", auto: true },
  { id: "shadows", label: "Shadows", auto: true },
  { id: "whites", label: "Whites", auto: true },
  { id: "blacks", label: "Blacks", auto: true },
  { id: "temperature", label: "Temperature", auto: true },
  { id: "tint", label: "Tint", auto: true },
  { id: "vibrance", label: "Vibrance", auto: false },
  { id: "saturation", label: "Saturation", auto: false },
]);
export const ADJUSTMENT_IDS = ADJUSTMENTS.map((entry) => entry.id);
const AUTO_IDS = new Set(ADJUSTMENTS.filter((entry) => entry.auto).map((entry) => entry.id));

export const STYLES = Object.freeze([
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
export const STYLE_IDS = STYLES.map((style) => style.id);

export const CROP_ASPECTS = Object.freeze([
  { id: "original", label: "Original" },
  { id: "1:1", label: "Square 1:1", ratio: 1 },
  { id: "4:5", label: "Portrait 4:5", ratio: 4 / 5 },
  { id: "5:7", label: "Print 5:7", ratio: 5 / 7 },
  { id: "2:3", label: "Classic 2:3", ratio: 2 / 3 },
  { id: "3:2", label: "Landscape 3:2", ratio: 3 / 2 },
  { id: "16:9", label: "Wide 16:9", ratio: 16 / 9 },
]);
export const CROP_ASPECT_IDS = CROP_ASPECTS.map((aspect) => aspect.id);

/** The eight hue bands of the HSL panel, in wheel order, with their labels. */
export const HSL_BANDS = Object.freeze(["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"]);
export const HSL_BAND_LABELS = Object.freeze({ red: "Red", orange: "Orange (skin)", yellow: "Yellow", green: "Green", aqua: "Aqua", blue: "Blue", purple: "Purple", magenta: "Magenta" });
export const HSL_CHANNELS = Object.freeze(["hue", "sat", "lum"]);
export const HSL_CHANNEL_LABELS = Object.freeze({ hue: "Hue", sat: "Saturation", lum: "Luminance" });
export const BALANCE_RANGES = Object.freeze(["shadows", "midtones", "highlights"]);
export const BALANCE_RANGE_LABELS = Object.freeze({ shadows: "Shadows", midtones: "Midtones", highlights: "Highlights" });
export const BALANCE_CHANNELS = Object.freeze(["r", "g", "b"]);
export const BALANCE_CHANNEL_LABELS = Object.freeze({ r: "Cyan ↔ Red", g: "Magenta ↔ Green", b: "Yellow ↔ Blue" });
export const DETAIL_FIELDS = Object.freeze(["clarity", "texture"]);
export const DETAIL_LABELS = Object.freeze({ clarity: "Clarity", texture: "Texture" });

/** Every tool, its settings as `[min, max, default]`, in the order the panel lists them. */
export const TOOLS = Object.freeze([
  { id: "autoExposure", label: "Auto Exposure", group: "auto", settings: {}, hint: "Exposure, highlights, shadows, whites and blacks from the photo's own light - dresses and suits recovered, skin kept." },
  { id: "autoWhiteBalance", label: "Auto White Balance", group: "auto", settings: {}, hint: "Temperature and tint from the neutral mid-tones, skin left out; tungsten, green and blue casts corrected." },
  { id: "colorEnhance", label: "Color Enhancement", group: "auto", settings: { strength: [0, 100, 50] }, hint: "Local contrast, gentle vibrance and an overall colour balance - never a saturation push." },
  { id: "retouchFace", label: "Skin Retouch", group: "ai", settings: { smoothing: [0, 100, 40], blemishes: [0, 100, 50], underEyes: [0, 100, 40], skinTone: [0, 100, 30], shine: [0, 100, 40], exposure: [-100, 100, 0], teeth: [0, 100, 40] }, labels: { smoothing: "Skin smoothing", blemishes: "Blemish reduction", underEyes: "Under-eye correction", skinTone: "Skin tone balance", shine: "Shine reduction", exposure: "Skin exposure", teeth: "Teeth whitening" }, hint: "Texture is kept; nothing reshapes a face." },
  { id: "faceEnhance", label: "Face Enhancement", group: "ai", settings: { brightness: [0, 100, 25], eyes: [0, 100, 40], detail: [0, 100, 25] }, labels: { brightness: "Face exposure", eyes: "Eye enhancement", detail: "Facial detail" } },
  { id: "denoise", label: "Denoise", group: "ai", settings: { strength: [0, 100, 50], detail: [0, 100, 60] }, labels: { strength: "Strength", detail: "Keep detail" }, hint: "For night receptions and dark venues; hair, lashes, jewellery and fabric are kept." },
  { id: "sharpen", label: "Sharpen", group: "ai", settings: { amount: [0, 100, 35] }, hint: "Eyes, hair and details; skin is protected, no halos." },
  { id: "removeObject", label: "Remove Object", group: "ai", settings: {}, masks: true, hint: "Paint over wires, poles, bags, bins and background people; Suggest marks people in the background." },
  { id: "enhanceSky", label: "Enhance Sky", group: "ai", settings: { strength: [0, 100, 50], exposure: [-100, 100, 0], warmth: [0, 100, 0] }, labels: { strength: "Strength", exposure: "Sky exposure", warmth: "Sunset warmth" }, hint: "Recovers and deepens a sky it finds; does nothing indoors." },
  { id: "background", label: "Background", group: "ai", settings: { brightness: [-100, 100, 0], blur: [0, 100, 0], calm: [0, 100, 0] }, labels: { brightness: "Background brightness", blur: "Background blur", calm: "Calm distractions" }, hint: "Separates the people from the background; the subject stays as shot." },
  { id: "autoCrop", label: "Smart Crop", group: "ai", settings: {}, aspect: true, hint: "Keeps every face and the headroom, then crops to the aspect." },
  // Retouching by region: one intensity each, the region found by the engine, nothing outside it touched.
  { id: "facialSkin", label: "Facial Skin", group: "retouch", settings: { amount: [0, 100, 40] }, labels: { amount: "Intensity" }, hint: "Blemishes and uneven tone on the face; pores, texture and makeup are kept." },
  { id: "bodySkin", label: "Body Skin", group: "retouch", settings: { amount: [0, 100, 35] }, labels: { amount: "Intensity" }, hint: "Visible skin beyond the face - arms, neck, shoulders; clothes and background are left alone." },
  { id: "eyebrows", label: "Eyebrows", group: "retouch", settings: { amount: [0, 100, 30] }, labels: { amount: "Intensity" }, hint: "Fills and defines the brows a little; their shape is not changed." },
  { id: "eyeSclera", label: "Eye Sclera", group: "retouch", settings: { amount: [0, 100, 35] }, labels: { amount: "Intensity" }, hint: "Takes redness and yellow out of the whites of the eyes; the iris and the skin around are untouched." },
  { id: "irisPupil", label: "Iris and Pupil", group: "retouch", settings: { amount: [0, 100, 35] }, labels: { amount: "Intensity" }, hint: "A little more detail and depth in the iris; its colour and shape stay as they are." },
  { id: "lips", label: "Lips", group: "retouch", settings: { amount: [0, 100, 30] }, labels: { amount: "Intensity" }, hint: "Smooths dry lines on the lips; their colour and edges are kept." },
  { id: "teeth", label: "Teeth", group: "retouch", settings: { amount: [0, 100, 35] }, labels: { amount: "Intensity" }, hint: "Restrained whitening of the visible teeth only - never the gums or the lips." },
  { id: "hair", label: "Hair", group: "retouch", settings: { amount: [0, 100, 30] }, labels: { amount: "Intensity" }, hint: "Tames flyaway strands at the edge of the hair; the hair itself is kept." },
  { id: "facialHair", label: "Facial Hair", group: "retouch", settings: { amount: [0, 100, 25] }, labels: { amount: "Intensity" }, hint: "Cleans noise and stray marks in a beard or moustache; its texture is kept." },
  { id: "clothes", label: "Clothes", group: "retouch", settings: { amount: [0, 100, 30] }, labels: { amount: "Intensity" }, hint: "Lint, dust and small marks on plain areas of clothing; patterns, embroidery and colours are never changed." },
]);
export const TOOL_IDS = TOOLS.map((tool) => tool.id);
/** The region retouching tools, in the order the panel lists them. */
export const RETOUCH_TOOL_IDS = Object.freeze(TOOLS.filter((tool) => tool.group === "retouch").map((tool) => tool.id));
export const toolById = (id) => TOOLS.find((tool) => tool.id === id) || null;
export const PROFILE_FIELDS = Object.freeze(["exposure", "contrast", "highlights", "shadows", "temperature", "tint", "vibrance", "saturation", "skinWarmth"]);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
function number(value, min, max, fallback) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.round(clamp(parsed, min, max));
}

function normalizeAdjustments(input) {
  const source = input && typeof input === "object" ? input : {};
  const out = {};
  for (const id of ADJUSTMENT_IDS) {
    const value = source[id];
    if (value === null && AUTO_IDS.has(id)) out[id] = null;
    else out[id] = number(value, -100, 100, 0);
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

export function normalizeMasks(masks) {
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
  for (const spec of TOOLS) {
    const given = source[spec.id];
    if (!given) continue;
    const settings = given && typeof given === "object" ? given : {};
    const tool = {};
    for (const [name, [min, max, fallback]] of Object.entries(spec.settings)) tool[name] = number(settings[name], min, max, fallback);
    if (spec.masks) {
      tool.masks = normalizeMasks(settings.masks);
      if (!tool.masks.length) continue;
    }
    if (spec.aspect) tool.aspect = CROP_ASPECT_IDS.includes(settings.aspect) ? settings.aspect : "original";
    out[spec.id] = tool;
  }
  return out;
}

const tone = (given) => (given && typeof given === "object" ? Object.fromEntries(BALANCE_CHANNELS.map((channel) => [channel, number(given[channel], -100, 100, 0)])) : { r: 0, g: 0, b: 0 });
/** A measured reference look, clamped; null when nothing usable is there. */
export function normalizeProfile(input) {
  if (!input || typeof input !== "object") return null;
  const profile = {};
  for (const field of PROFILE_FIELDS) profile[field] = number(input[field], -100, 100, 0);
  profile.shadowTone = tone(input.shadowTone);
  profile.highlightTone = tone(input.highlightTone);
  profile.summary = typeof input.summary === "string" ? input.summary.slice(0, 200) : "";
  return profile;
}

/** The recipe every save and every render goes through - the backend's own normalization. */
export function normalizeRecipe(input) {
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

export const EMPTY_RECIPE = Object.freeze(normalizeRecipe({}));

const zeros = (object) => Object.values(object).every((value) => (value && typeof value === "object" ? zeros(value) : value === 0));
/** Whether a recipe changes anything at all. */
/**
 * Whether a saved recipe is what the last render applied - the backend's own rule
 * (`ai-editing/service.js recipeMatchesApplied`, held identical by a test): a slider left to the
 * AI (null) reads as the number the render chose, so "Auto" never looks like an unapplied change.
 */
export function recipeMatchesApplied(recipe, applied) {
  if (!applied) return false;
  const saved = normalizeRecipe(recipe);
  const rendered = normalizeRecipe(applied);
  for (const key of Object.keys(saved.adjustments)) if (saved.adjustments[key] === null) saved.adjustments[key] = rendered.adjustments[key];
  return JSON.stringify(saved) === JSON.stringify(rendered);
}

export function recipeIsEmpty(recipe) {
  const normalized = normalizeRecipe(recipe);
  if (normalized.style !== "natural" || normalized.reference || normalized.referenceProfile) return false;
  if (Object.keys(normalized.tools).length) return false;
  if (!zeros(normalized.advanced)) return false;
  return ADJUSTMENT_IDS.every((id) => normalized.adjustments[id] === 0);
}

/** How many advanced settings are away from zero (for the panel's fold count). */
export function advancedCount(recipe) {
  const { advanced } = normalizeRecipe(recipe);
  let count = 0;
  const walk = (object) => { for (const value of Object.values(object)) { if (value && typeof value === "object") walk(value); else if (value !== 0) count += 1; } };
  walk(advanced);
  return count;
}

/** The default settings of a tool when it is switched on. */
export function defaultToolSettings(id) {
  const spec = toolById(id);
  if (!spec) return {};
  const out = {};
  for (const [name, [, , fallback]] of Object.entries(spec.settings)) out[name] = fallback;
  if (spec.masks) out.masks = [];
  if (spec.aspect) out.aspect = "original";
  return out;
}

/**
 * A CSS filter that approximates the basic sliders for the live preview while the real render is
 * pending. The engine's output is the truth; this is only so a slider feels alive.
 */
export function approximateCssFilter(recipe) {
  const { adjustments } = normalizeRecipe(recipe);
  const parts = [];
  const exposure = adjustments.exposure || 0;
  if (exposure) parts.push(`brightness(${(2 ** ((exposure / 100) * 2)).toFixed(3)})`);
  const contrast = adjustments.contrast || 0;
  if (contrast) parts.push(`contrast(${(1 + contrast / 100 * 0.6).toFixed(3)})`);
  const saturation = (adjustments.saturation || 0) + (adjustments.vibrance || 0) / 2;
  if (saturation) parts.push(`saturate(${(1 + saturation / 100 * 0.8).toFixed(3)})`);
  const temperature = adjustments.temperature || 0;
  if (temperature > 0) parts.push(`sepia(${(temperature / 100 * 0.35).toFixed(3)})`);
  if (temperature < 0) parts.push(`hue-rotate(${Math.round(temperature / 100 * -12)}deg)`);
  return parts.join(" ");
}

/** A one-line summary of what a recipe asks for, for a tile's caption. */
export function summarizeRecipe(recipe) {
  const normalized = normalizeRecipe(recipe);
  const parts = [];
  if (normalized.style !== "natural") parts.push(STYLES.find((style) => style.id === normalized.style)?.label || normalized.style);
  const sliders = ADJUSTMENT_IDS.filter((id) => normalized.adjustments[id] !== 0).length;
  if (sliders) parts.push(`${sliders} adjustment${sliders === 1 ? "" : "s"}`);
  const advanced = advancedCount(normalized);
  if (advanced) parts.push(`${advanced} advanced`);
  parts.push(...Object.keys(normalized.tools).map((id) => toolById(id)?.label || id));
  if (normalized.referenceProfile || normalized.reference) parts.push("Reference style");
  return parts.join(" · ");
}
