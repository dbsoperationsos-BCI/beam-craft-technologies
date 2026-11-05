/**
 * What the application calls itself when the studio has not said: the name the bundled mark
 * carries.
 */
export const BUNDLED_BRAND_NAME = "Beam Craft";

/**
 * The studio's name for a sentence that is *about* the studio: the Global Name from Settings, and
 * the bundled brand where that field is blank.
 *
 * Deliberately not `brandNameFor` in `@/components/shared/BrandFallbackLogo`. That rule writes a
 * name beside the mark, and an unset field must draw nothing there — a caption is allowed to be
 * absent. A sentence is not: "Complete your onboarding details for ." is broken text, and the
 * reader is owed a name whether or not anybody has typed one.
 *
 * The same fallback covers the moment before the branding endpoint has answered, for the same
 * reason: the sentence is written before the name arrives, and swaps to the studio's own the
 * instant it does.
 */
export function brandNameInProse(branding) {
  const name = String(branding?.studioName ?? "").trim();
  return name || BUNDLED_BRAND_NAME;
}

/**
 * The two Global Logo fields, compared the way the API stores them.
 *
 * Settings → Global Logo carries a name and a logo. The form holds the name as typed and the logo
 * as either the stored https link, a freshly picked data URI, or "" once Remove photo is pressed;
 * the record holds the name trimmed and the logo as a link or null. Comparing the two in the
 * record's shape is what lets the panel tell an edit from a form that has merely been opened -
 * and a Save that only ever writes an edit cannot clear the studio's branding by being pressed on
 * an untouched form.
 */
export function normalizeBrandingDraft(fields = {}) {
  return {
    studioName: String(fields?.studioName ?? "").trim(),
    // What the credentials email calls this system. Trimmed like the name, and "" means unset:
    // the email then uses the name it ships with.
    loginCredentialName: String(fields?.loginCredentialName ?? "").trim(),
    galleryLogoUrl: fields?.galleryLogoUrl || null,
    // The dark-theme logo and the two tab marks travel with it: same shape, same "" means
    // cleared, same null stored.
    galleryLogoDarkUrl: fields?.galleryLogoDarkUrl || null,
    faviconUrl: fields?.faviconUrl || null,
    faviconDarkUrl: fields?.faviconDarkUrl || null,
  };
}

/** The fields the Branding Logo form edits, in the order it shows them. */
export const BRANDING_FIELDS = ["studioName", "loginCredentialName", "galleryLogoUrl", "galleryLogoDarkUrl", "faviconUrl", "faviconDarkUrl"];

/** What the save notice calls each field. */
const BRANDING_FIELD_LABELS = {
  studioName: "Global Name",
  loginCredentialName: "Login Credential Name",
  galleryLogoUrl: "Global Logo",
  galleryLogoDarkUrl: "Global Logo (dark mode)",
  faviconUrl: "Favicon",
  faviconDarkUrl: "Favicon (dark mode)",
};

/**
 * Whether the application's theme wants the dark-mode marks: anything but the light theme. Named
 * here rather than read off the theme list in `@/lib/theme`, so the rule can be held by
 * `node --test` beside the rest of the branding rules.
 */
export function themeWantsDarkMark(theme) {
  return Boolean(theme) && String(theme) !== "light";
}

/**
 * The Global Logo a surface should show: the mark uploaded for its theme, then the one uploaded
 * for the other, and "" where neither exists - which every reader takes as the bundled mark.
 *
 * The light mark is the one every white surface reads directly (`galleryLogoUrl`) - a PDF, a
 * quotation page, a client gallery, a document's snapshot - and none of them come through here.
 * This is for the surfaces that follow the application's theme: the top bar, the sign-in page.
 *
 * @param {{galleryLogoUrl?: string|null, galleryLogoDarkUrl?: string|null}|null} branding
 * @param {boolean} dark whether the surface is in a dark theme - see `themeWantsDarkMark`.
 * @returns {{src: string, ownMark: boolean}} the mark, and whether it was uploaded for this theme
 *   rather than borrowed from the other - the top bar inverts a borrowed light mark to read on its
 *   dark bar, and must leave a mark drawn for the dark bar alone.
 */
export function logoFor(branding, dark = false) {
  const light = String(branding?.galleryLogoUrl ?? "").trim();
  const night = String(branding?.galleryLogoDarkUrl ?? "").trim();
  if (dark) return night ? { src: night, ownMark: true } : { src: light, ownMark: false };
  return light ? { src: light, ownMark: true } : { src: night, ownMark: false };
}

/** Whether saving `draft` would change anything in `saved`. Nothing read yet is nothing to save. */
export function hasBrandingChanges(saved, draft) {
  if (!saved) return false;
  const before = normalizeBrandingDraft(saved);
  const after = normalizeBrandingDraft(draft);
  return BRANDING_FIELDS.some((field) => before[field] !== after[field]);
}

/**
 * What the save notice should say, given what the save is about to change. Saving only the name
 * used to be announced as "Global Logo saved.", which reads as a logo having been stored when the
 * studio had typed a name and left the logo alone; the notice names the field, or both.
 */
export function brandingSavedNotice(saved, draft) {
  const before = normalizeBrandingDraft(saved);
  const after = normalizeBrandingDraft(draft);
  // Named parts, in the order the form shows them, so the notice says what was actually written.
  const parts = BRANDING_FIELDS.filter((field) => before[field] !== after[field]).map((field) => BRANDING_FIELD_LABELS[field]);
  if (!parts.length) return "Global Logo saved.";
  if (parts.length === 1) return `${parts[0]} saved.`;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]} saved.`;
}

/**
 * Whether the Login Slide form differs from the stored list: a different count, or a different
 * picture in any position. Order counts, because the order sent is the order the page turns
 * through. Nothing read yet is nothing to save, as with the Global Logo.
 */
export function haveSlidesChanged(saved, draft) {
  if (!Array.isArray(saved)) return false;
  const after = Array.isArray(draft) ? draft : [];
  return saved.length !== after.length || saved.some((slide, index) => slide !== after[index]);
}
