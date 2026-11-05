/**
 * How a WhatsApp chat file is named and described before anything is fetched.
 *
 * The CRM keeps no copy of these files - View and Download fetch each from WhatsApp when pressed -
 * so the bubble is drawn from what the message says about its file: kind, name, size, type.
 */
import { formatBytes } from "./aiFeature.mjs";

const KIND_LABELS = { image: "Photo", sticker: "Sticker", video: "Video", audio: "Audio", document: "Document" };

const EXTENSIONS = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "video/mp4": "mp4", "video/3gpp": "3gp", "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a",
  "audio/aac": "aac", "audio/webm": "webm", "application/pdf": "pdf",
};

/** The kind of file in plain words: "Photo", "Video", "Document". */
export const mediaKindLabel = (message) => KIND_LABELS[message?.mediaType] || "File";

/** The name a download is saved under: the client's own name for it, or one made from its kind. */
export function mediaFileName(message) {
  const given = String(message?.mediaName || "").trim();
  if (given) return given;
  const mime = String(message?.mediaMime || "").split(";")[0].trim();
  const extension = EXTENSIONS[mime] || mime.split("/")[1]?.replace(/[^a-z0-9]/gi, "").slice(0, 8) || "bin";
  return `${String(message?.mediaType || "file")}-${String(message?.id || "").slice(-8) || "whatsapp"}.${extension}`;
}

/** "Photo · 1.2 MB", or just the kind when WhatsApp did not say how big it is. */
export function mediaSummary(message) {
  const size = Number(message?.mediaSize);
  return size > 0 ? `${mediaKindLabel(message)} · ${formatBytes(size)}` : mediaKindLabel(message);
}

/**
 * How the file can be looked at in the browser: "viewer" opens it over the page, "player" plays it
 * in the bubble, and "" means it can only be downloaded (a Word file, a spreadsheet).
 */
export function mediaViewMode(message) {
  const type = message?.mediaType;
  if (type === "image" || type === "sticker" || type === "video") return "viewer";
  if (type === "audio") return "player";
  if (type === "document" && String(message?.mediaMime || "").startsWith("application/pdf")) return "viewer";
  if (type === "document" && String(message?.mediaMime || "").startsWith("image/")) return "viewer";
  return "";
}
