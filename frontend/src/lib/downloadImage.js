/**
 * Saving a photo the browser is already showing.
 *
 * Two kinds of source reach this, because a profile photo is stored as whichever the server could
 * produce: a `data:` URI when object storage is not configured, and an absolute URL on the public
 * bucket when it is. A data URI is already the bytes, so it goes straight to disk with no request
 * at all.
 *
 * A URL cannot be saved by pointing an anchor at it. Across origins the `download` attribute is
 * ignored - the browser navigates to the image instead of saving it - and a `fetch` needs a CORS
 * header the bucket does not have to send. So the bytes come from `readBytes`, which the caller
 * supplies: for a profile photo that is the app's own API, which is allowed to read the bucket and
 * hands back the file. Either way this ends in a saved file or an error, never a new tab.
 */
const EXTENSION_BY_MIME = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
};

/** The MIME type a `data:` URI declares, or "" for anything else. */
function mimeOf(source) {
  const match = /^data:([a-z0-9.+/-]+);/i.exec(String(source || ""));
  return match ? match[1].toLowerCase() : "";
}

function extensionFor(source, blobType) {
  return EXTENSION_BY_MIME[mimeOf(source)] || EXTENSION_BY_MIME[String(blobType || "").toLowerCase()] || "jpg";
}

/**
 * A file name a file system will accept, built from the person's name. Anything that is not a
 * letter, a digit or a dash becomes a dash, so a name with a slash in it cannot describe a path.
 */
function fileNameFor(baseName, extension) {
  const stem = String(baseName || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${stem || "profile"}-photo.${extension}`;
}

function saveFromHref(href, fileName) {
  const link = document.createElement("a");
  link.href = href;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/**
 * Saves `source` as a file named after `baseName`.
 *
 * `readBytes` is asked for the file whenever the source is not already the bytes. It answers with
 * a Blob. Anything it throws is the caller's to show - there is no quiet fallback, because a
 * download that silently becomes something else is worse than one that says it failed.
 */
export default async function downloadImage(source, baseName, readBytes) {
  const url = String(source || "");
  if (!url) throw new Error("There is no photo to download.");

  if (url.startsWith("data:")) {
    saveFromHref(url, fileNameFor(baseName, extensionFor(url)));
    return;
  }

  if (typeof readBytes !== "function") throw new Error("This photo cannot be downloaded from here.");
  const blob = await readBytes();
  const objectUrl = URL.createObjectURL(blob);
  saveFromHref(objectUrl, fileNameFor(baseName, extensionFor(url, blob.type)));
  // Revoked on the next tick: the click above only queues the download, and revoking in the same
  // turn would pull the bytes out from under it.
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}
