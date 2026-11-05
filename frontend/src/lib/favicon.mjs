/**
 * Which mark the browser tab shows.
 *
 * Two uploads, one per tab strip. A bare mark disappears on a strip of its own colour - black
 * lettering on a dark strip, white on a light one - and a studio whose icon has no ground of its
 * own needs a mark drawn for each. A studio whose icon carries its own ground uploads it once:
 * whichever strip has no mark of its own wears the other's, so one file still serves both tabs
 * without being uploaded twice.
 *
 * Neither upload is required. With none, the tab wears the bundled mark below, which carries its
 * own white ground and reads on either strip.
 */

/** The mark that ships with the application, for a studio that has uploaded none. */
export const BUNDLED_FAVICON = "/brand/favicon.svg";

/**
 * The mark for the tab: the one uploaded for this strip, then the one uploaded for the other,
 * then the bundled one.
 *
 * `dark` is the *browser's* strip - `prefers-color-scheme` - not the application's theme. A person
 * reading the app in its light theme on a dark desktop still has a dark tab, and the tab is what
 * this mark is drawn on.
 *
 * @param {{faviconUrl?: string|null, faviconDarkUrl?: string|null}|null} branding
 * @param {boolean} dark whether the tab strip is dark.
 * @returns {string} the URL to hand the `<link rel="icon">`.
 */
export function faviconFor(branding, dark = false) {
  const light = clean(branding?.faviconUrl);
  const night = clean(branding?.faviconDarkUrl);
  if (dark) return night || light || BUNDLED_FAVICON;
  return light || night || BUNDLED_FAVICON;
}

const iconType = (url) => (/\.svg(\?|#|$)/i.test(url) || url.startsWith("data:image/svg") ? "image/svg+xml" : "image/png");

/**
 * The tab icons the server writes into the page, so the studio's own marks are there from the first
 * byte rather than swapped in by script afterwards - a swap the browser may not honour, and one
 * Next's own metadata can undo. One icon per tab strip, chosen by the browser through
 * `prefers-color-scheme`, each resolved by `faviconFor` (the strip's upload, then the other, then
 * the bundled mark), so the bundled mark only appears when nothing is uploaded at all.
 *
 * @returns {{url: string, type: string, media?: string}[]} for `metadata.icons.icon`.
 */
export function faviconIcons(branding) {
  const light = faviconFor(branding, false);
  const dark = faviconFor(branding, true);
  if (light === dark) return [{ url: light, type: iconType(light) }];
  return [
    { url: light, type: iconType(light), media: "(prefers-color-scheme: light)" },
    { url: dark, type: iconType(dark), media: "(prefers-color-scheme: dark)" },
  ];
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
