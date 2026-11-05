/**
 * Which mark the browser tab shows.
 *
 * One mark, worn on every tab. There used to be two of everything here — an uploaded pair and a
 * bundled pair — because a bare mark disappears on a tab strip of its own colour: black lettering
 * on a dark strip, white on a light one. The mark itself is what solved that. It carries its own
 * white rounded ground, so it reads on either strip, and the moment that is true the browser's
 * `prefers-color-scheme` has nothing left to decide here.
 *
 * The upload is not required. With none, the tab wears the bundled mark below, which is the
 * studio's own icon rather than a placeholder.
 */

/** The mark that ships with the application, for a studio that has uploaded none. */
export const BUNDLED_FAVICON = "/brand/favicon.svg";

/**
 * The mark for the tab: what the studio uploaded, or the bundled one.
 *
 * @param {{faviconUrl?: string|null}|null} branding
 * @returns {string} the URL to hand the `<link rel="icon">`.
 */
export function faviconFor(branding) {
  return clean(branding?.faviconUrl) || BUNDLED_FAVICON;
}

/** The file type a favicon may be uploaded as. SVG stays sharp at every size a tab asks for. */
export const FAVICON_ACCEPT = "image/png,image/svg+xml";
/*
 * Five megabytes, which is far more than a tab icon needs and deliberately so: the studio uploads
 * whatever its designer exported, and being refused for a file that works perfectly well is worse
 * than carrying a few hundred kilobytes it did not have to. The browser caches it, so the size is
 * paid once per visitor rather than per page.
 */
export const MAX_FAVICON_BYTES = 5 * 1024 * 1024;

/** Whether a picked file is one the API will take, so the answer comes before the upload does. */
export function faviconFileError(file) {
  if (!file) return "";
  if (!["image/png", "image/svg+xml"].includes(file.type)) return "A favicon must be a PNG or an SVG.";
  if (file.size > MAX_FAVICON_BYTES) return "A favicon must be smaller than 5 MB.";
  return "";
}

function clean(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}
