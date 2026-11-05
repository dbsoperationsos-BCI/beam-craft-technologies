export const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024 * 1024;
export const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/tiff", "image/heic", "image/heif"]);
// Some browsers hand us an empty File.type for formats they cannot preview themselves —
// HEIC/HEIF and TIFF most often. The extension is the only signal left, so map it back to a
// MIME type the backend's initiate-upload schema already accepts.
const EXTENSION_IMAGE_TYPES = new Map([["jpg", "image/jpeg"], ["jpeg", "image/jpeg"], ["jpe", "image/jpeg"], ["png", "image/png"], ["webp", "image/webp"], ["tif", "image/tiff"], ["tiff", "image/tiff"], ["heic", "image/heic"], ["heif", "image/heif"]]);
// Derived from the map above so the two can never drift apart.
export const SUPPORTED_IMAGE_EXTENSIONS = new Set(EXTENSION_IMAGE_TYPES.keys());
// Windows and macOS write these into folders on their own. They are not user content, so they
// are dropped before validation and never reach the queue, the backend, or any visible count.
const IGNORED_FILE_NAMES = new Set(["thumbs.db", "desktop.ini", ".ds_store"]);
// A wedding or event card is a mixed bag: footage, RAW negatives and camera sidecars sit beside
// the JPEGs. None of them belong in Image Selection, and none of them are a mistake worth
// reporting — they are skipped in silence and counted only in aggregate.
const IGNORED_EXTENSIONS = new Set([
  // Video containers, including the low-res proxies and telemetry drones leave behind.
  "mp4", "mov", "avi", "mkv", "mts", "m2ts", "m4v", "mpg", "mpeg", "wmv", "3gp", "insv", "lrv", "srt",
  // Audio: reception recordings and scratch tracks that travel with the footage.
  "mp3", "wav", "aac", "m4a", "flac", "ogg", "wma", "aiff", "aif", "opus",
  // Camera RAW negatives.
  "dng", "cr2", "cr3", "nef", "arw", "raf", "orf", "rw2", "srw", "pef", "rwl", "x3f", "nrw", "sr2", "srf", "dcr", "kdc", "mef", "3fr", "erf", "iiq", "raw",
  // Camera and editor sidecars written next to the shot.
  "dat", "thm", "xmp", "aae",
]);
const UNSUPPORTED_FORMAT = "Unsupported image format. Use JPEG, PNG, WebP, TIFF, HEIC, or HEIF.";
const EMPTY_FILE = "The file is empty.";
const TOO_LARGE = "The file exceeds the 10 GB limit.";
const REASON_TYPES = new Map([[UNSUPPORTED_FORMAT, "unsupported"], [EMPTY_FILE, "empty"], [TOO_LARGE, "too-large"]]);

export function fileExtension(file) { const name = (file?.name || "").toLowerCase(); const dot = name.lastIndexOf("."); return dot > 0 ? name.slice(dot + 1) : ""; }
// Two Set lookups, no scan of the rest of the selection.
export function shouldIgnoreFile(file) { const name = (file?.name || "").toLowerCase(); if (IGNORED_FILE_NAMES.has(name) || name.startsWith("._")) return true; return IGNORED_EXTENSIONS.has(fileExtension(file)); }
// Folder picks give a path; drag-and-drop and loose files only give a name.
// `dbsRelativePath` is stamped on by the folder picker in UploadManager: a File that came from a
// directory handle has an empty read-only `webkitRelativePath`, so the trail is carried alongside.
export function fileRelativePath(file) { return file?.dbsRelativePath || file?.webkitRelativePath || file?.name || ""; }
// Stable per-file identity reused for upload runtime keys, the resume manifest, and React keys.
export function fileIdentity(file) { return `${fileRelativePath(file)}:${file?.size}:${file?.lastModified}`; }
export function resolveImageMimeType(file) { if (file?.type) return file.type; return EXTENSION_IMAGE_TYPES.get(fileExtension(file)) || ""; }

export function validateImageFile(file) { if (!SUPPORTED_IMAGE_TYPES.has(resolveImageMimeType(file))) return UNSUPPORTED_FORMAT; if (!file.size) return EMPTY_FILE; if (file.size > MAX_IMAGE_UPLOAD_BYTES) return TOO_LARGE; return null; }
export function isUploadableImage(file) { return !shouldIgnoreFile(file) && !validateImageFile(file); }

// Single pass over the selection. Known non-image files vanish into the `ignored` tally, genuinely
// unexpected files are validated once, and every rejection carries a stable id so the error list
// can be keyed without falling back to the array index.
export function splitImageFiles(files) {
  const accepted = [];
  const rejected = [];
  const seen = new Set();
  let ignored = 0;
  for (const file of files || []) {
    if (shouldIgnoreFile(file)) { ignored += 1; continue; }
    const reason = validateImageFile(file);
    if (!reason) { accepted.push(file); continue; }
    const id = `${fileIdentity(file)}#${REASON_TYPES.get(reason) || "invalid"}`;
    if (seen.has(id)) continue;
    seen.add(id);
    rejected.push({ id, name: file.name, relativePath: fileRelativePath(file), type: REASON_TYPES.get(reason) || "invalid", reason });
  }
  return { accepted, rejected, ignored };
}
