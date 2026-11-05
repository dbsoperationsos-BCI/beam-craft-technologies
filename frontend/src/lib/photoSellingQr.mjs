import { QR_TEMPLATES, TEXT_FIELDS, posterText, templateById } from "./qrPoster.mjs";

/**
 * Photo Selling's QR posters: the shared designs and drawing in `qrPoster.mjs` - one definition for
 * every poster in the app - with Photo Selling's own words. The AI Feature's defaults ("Register
 * your face") never print on a sales poster: every field is always filled from here, so
 * `posterText`'s own defaults are never reached.
 *
 * The words mirror the server's (`settings/service.js` QR_DEFAULT_TEXT); a gallery and the settings
 * each keep their own copy, saved with them.
 */
export const SALE_QR_DEFAULT_TEXT = Object.freeze({ heading: "YOUR PHOTOS", subheading: "ARE READY", instruction: "SCAN TO VIEW & BUY", note: "FIND YOUR PHOTOS WITH A SELFIE", showPin: true });
export const SALE_QR_TEMPLATES = QR_TEMPLATES;
export const saleTemplateById = templateById;

/** The saved words, completed with Photo Selling's defaults; `footer` stays the gallery's name unless set. */
export function saleQrWords(saved = {}) {
  const words = { ...SALE_QR_DEFAULT_TEXT };
  for (const { key } of TEXT_FIELDS) if (saved?.[key] !== undefined && saved?.[key] !== null) words[key] = saved[key];
  if (saved?.showPin !== undefined) words.showPin = saved.showPin !== false;
  return words;
}

/** What the poster prints, for `drawPoster`: every field given, so no AI Feature default can appear. */
export function salePosterText(kit, words) {
  const edits = {};
  for (const { key } of TEXT_FIELDS) edits[key] = key === "footer" && words.footer === undefined ? kit?.event?.name || "" : words[key] ?? "";
  edits.showPin = words.showPin !== false;
  return posterText(kit, edits);
}

/** Only what the server takes for the words: the five lines and whether the PIN prints. */
export function qrWordsPayload(words) {
  const out = {};
  for (const { key } of TEXT_FIELDS) if (words[key] !== undefined) out[key] = String(words[key] ?? "");
  out.showPin = words.showPin !== false;
  return out;
}
