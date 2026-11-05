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
    // The tab mark travels with the logo: same shape, same "" means cleared, same null stored.
    faviconUrl: fields?.faviconUrl || null,
  };
}

/** Whether saving `draft` would change anything in `saved`. Nothing read yet is nothing to save. */
export function hasBrandingChanges(saved, draft) {
  if (!saved) return false;
  const before = normalizeBrandingDraft(saved);
  const after = normalizeBrandingDraft(draft);
  return before.studioName !== after.studioName
    || before.loginCredentialName !== after.loginCredentialName
    || before.galleryLogoUrl !== after.galleryLogoUrl
    || before.faviconUrl !== after.faviconUrl;
}

/**
 * What the save notice should say, given what the save is about to change. Saving only the name
 * used to be announced as "Global Logo saved.", which reads as a logo having been stored when the
 * studio had typed a name and left the logo alone; the notice names the field, or both.
 */
export function brandingSavedNotice(saved, draft) {
  const before = normalizeBrandingDraft(saved);
  const after = normalizeBrandingDraft(draft);
  const nameChanged = before.studioName !== after.studioName;
  const credentialNameChanged = before.loginCredentialName !== after.loginCredentialName;
  const logoChanged = before.galleryLogoUrl !== after.galleryLogoUrl;
  const faviconChanged = before.faviconUrl !== after.faviconUrl;
  // Named parts, in the order the form shows them, so the notice says what was actually written.
  const parts = [nameChanged && "Global Name", credentialNameChanged && "Login Credential Name", logoChanged && "Global Logo", faviconChanged && "Favicon"].filter(Boolean);
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
