import { fileExtension, fileRelativePath, shouldIgnoreFile } from "../imageUploadValidation.mjs";

/**
 * What the user picked, sorted into what the pipeline does with each: photos are compressed here;
 * videos (the AI Feature takes photos only) and anything else are listed as skipped so the count
 * of "selected" always matches what the person dropped.
 */
export const PHOTO_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "heic", "heif", "tif", "tiff", "avif", "bmp", "gif"]);
export const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "m4v", "webm", "mkv", "avi"]);
// What createImageBitmap can be expected to decode. HEIC/TIFF are not among them in any browser today.
export const BROWSER_DECODABLE = new Set(["jpg", "jpeg", "png", "webp", "avif", "bmp", "gif"]);

export const AI_MEDIA_ACCEPT = ["image/*", ...Array.from(PHOTO_EXTENSIONS, (ext) => `.${ext}`)].join(",");

export function classifyFile(file) {
  const extension = fileExtension(file);
  const type = String(file?.type || "").toLowerCase();
  const name = String(file?.name || "").toLowerCase();
  if (name.startsWith("._") || name === ".ds_store" || name === "thumbs.db" || name === "desktop.ini") return "ignored";
  // Videos before the photo ignore-list: that list (imageUploadValidation) treats video extensions as noise.
  if (VIDEO_EXTENSIONS.has(extension) || type.startsWith("video/")) return "video";
  if (shouldIgnoreFile(file)) return "ignored";
  if (PHOTO_EXTENSIONS.has(extension) || type.startsWith("image/")) return "photo";
  return "unsupported";
}

/** The path the server keeps beside the photo: relative, forward slashes, never a leading slash. */
export function relativePathOf(file) {
  const raw = String(fileRelativePath(file) || file?.name || "").replace(/\\/g, "/").replace(/^\/+/, "");
  return raw || file?.name || "";
}

/**
 * Turns a FileList or array into upload entries. Hidden system files are dropped silently (a
 * `.DS_Store` is not a photo anyone selected); unsupported files are kept as skipped rows.
 */
export function toUploadEntries(files) {
  const entries = [];
  for (const file of Array.from(files || [])) {
    const kind = classifyFile(file);
    if (kind === "ignored") continue;
    entries.push({ file, name: file.name, size: file.size || 0, relativePath: relativePathOf(file), kind, decodable: kind === "photo" && BROWSER_DECODABLE.has(fileExtension(file)) });
  }
  return entries;
}
