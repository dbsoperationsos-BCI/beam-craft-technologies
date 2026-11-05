import { readExifCaptureDate } from "../../../../lib/aiMediaUpload/exifDate.mjs";
import { buildDerivatives } from "../../../../lib/imageDerivatives.mjs";

/**
 * The web compression worker: one photo in, the event's preview AND thumbnail out, off the main
 * thread - through the same `buildDerivatives` every other Virtual Curation upload runs, so the
 * AI Feature invents no recipe of its own. The original is decoded once, upright, both derivatives
 * are cut from that frame (the thumbnail never from the preview) and the frame is released.
 *
 * Message in:  { id, file, config: { derivatives, thumbnailType } }   (config: lib/aiMediaUpload/config.mjs `compressionFromSettings`)
 * Message out: { id, ok: true, blob, thumbnail, width, height, fingerprint, outputBytes, capturedAt }
 *           or { id, ok: false, code: "UNDECODABLE" | "COMPRESSION_FAILED", message, fingerprint }
 *
 * The fingerprint is the SHA-256 of the ORIGINAL bytes - what the server keeps as the photo's
 * identity - and is computed even when the decode fails, so a duplicate HEIC is still a duplicate.
 * `capturedAt` is the original's EXIF capture time (ISO), read before the re-encode drops the EXIF,
 * so the folder still orders by when the photo was taken. Re-encoding drops the metadata a guest
 * gallery must not carry. The imports are relative paths to plain modules, which the bundler
 * resolves without any alias.
 */
async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function compress(file, config) {
  const bytes = await file.arrayBuffer();
  const fingerprint = await sha256Hex(bytes);
  const captured = readExifCaptureDate(bytes);
  const capturedAt = captured ? captured.toISOString() : null;
  const options = config.derivatives || {};
  try {
    const source = new Blob([bytes], { type: file.type || "image/jpeg" });
    source.name = file.name;
    const made = await buildDerivatives(source, { ...options, thumbnail: { ...(options.thumbnail || {}), type: config.thumbnailType || "image/webp" } });
    return { blob: made.preview, thumbnail: made.thumbnail, width: made.previewWidth, height: made.previewHeight, fingerprint, outputBytes: made.preview.size + made.thumbnail.size, capturedAt };
  } catch (error) {
    const failure = new Error(error?.code === "UNDECODABLE" ? `${file.name} could not be read as an image by this browser.` : (error?.message || "The image could not be encoded."));
    failure.code = error?.code === "UNDECODABLE" ? "UNDECODABLE" : "COMPRESSION_FAILED";
    failure.fingerprint = fingerprint;
    throw failure;
  }
}

self.onmessage = async (event) => {
  const { id, file, config } = event.data || {};
  try {
    const result = await compress(file, config || {});
    self.postMessage({ id, ok: true, ...result });
  } catch (error) {
    self.postMessage({ id, ok: false, code: error.code || "COMPRESSION_FAILED", message: error.message, fingerprint: error.fingerprint || null });
  }
};
