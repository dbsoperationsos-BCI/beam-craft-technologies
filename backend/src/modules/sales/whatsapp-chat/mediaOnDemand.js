/**
 * A WhatsApp chat's files, fetched from WhatsApp when somebody asks for one - never kept.
 *
 * The studio's phone already holds every photo, voice note and document a client sent, so the CRM
 * does not keep a second copy of any of them, nor of the files it sends. What it keeps is the
 * message as WhatsApp delivered it (`rawMessage`), which carries the file's address on WhatsApp's
 * servers and the key that decrypts it. View and Download ask WhatsApp for the file at that moment
 * and pass it straight through to the browser; nothing is written on the way.
 *
 * WhatsApp holds media for a few weeks only. Past that the fetch fails, and the answer is the
 * phone - which is where the studio said old files are to be seen.
 */

const MEDIA_KEYS = ["imageMessage", "videoMessage", "audioMessage", "documentMessage", "stickerMessage"];

/**
 * The stored message with its binary fields as Buffers again.
 *
 * Saved with `JSON.stringify`, so a Buffer was written as `{ type: "Buffer", data: [...] }` and
 * comes back as a plain object - which the decryption cannot use. A bare Uint8Array is written as
 * an object of numbered keys; both are turned back.
 */
function reviveRaw(raw) {
  if (!raw) return null;
  try {
    const text = typeof raw === "string" ? raw : JSON.stringify(raw);
    return JSON.parse(text, (_key, value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return value;
      if (value.type === "Buffer" || value.buffer === true) {
        const data = value.data ?? value.value;
        return typeof data === "string" ? Buffer.from(data, "base64") : Buffer.from(data || []);
      }
      const keys = Object.keys(value);
      if (keys.length && keys.every((key, index) => key === String(index)) && keys.every((key) => Number.isInteger(value[key]))) {
        return Buffer.from(keys.map((key) => value[key]));
      }
      return value;
    });
  } catch {
    return null;
  }
}

// The part of the message that describes the file - `imageMessage`, `documentMessage` and so on.
function fileContent(raw) {
  const content = raw?.message || {};
  const key = MEDIA_KEYS.find((name) => content[name]);
  return key ? content[key] : null;
}

// A protobuf Long arrives as a number, a string, or `{ low, high }` once it has been through JSON.
function longToNumber(value) {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return Number(value) || null;
  if (typeof value === "object" && "low" in value) return (Number(value.high) || 0) * 2 ** 32 + (value.low >>> 0);
  return null;
}

/** What WhatsApp said the file is. */
function contentTypeOf(content, mediaType = "") {
  const declared = String(content?.mimetype || "").split(";")[0].trim();
  if (declared) return declared;
  if (mediaType === "image") return "image/jpeg";
  if (mediaType === "sticker") return "image/webp";
  if (mediaType === "video") return "video/mp4";
  if (mediaType === "audio") return "audio/ogg";
  return "application/octet-stream";
}

/**
 * What the chat shows for a file without fetching it: its name, its size and - for a photo or a
 * video - the small blurred preview WhatsApp sends inside the message itself.
 */
function mediaDetails(rawMessage, mediaType = "") {
  const content = fileContent(reviveRaw(rawMessage));
  if (!content) return { fileName: "", size: null, thumbnail: "", contentType: contentTypeOf(null, mediaType) };
  const thumb = Buffer.isBuffer(content.jpegThumbnail) && content.jpegThumbnail.length ? content.jpegThumbnail : null;
  return {
    fileName: String(content.fileName || ""),
    size: longToNumber(content.fileLength),
    thumbnail: thumb ? `data:image/jpeg;base64,${thumb.toString("base64")}` : "",
    contentType: contentTypeOf(content, mediaType),
  };
}

// Baileys logs while it asks the phone to re-upload an expired file, and fails without a logger.
const QUIET_LOGGER = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, child() { return QUIET_LOGGER; } };

/**
 * The file, as a stream straight from WhatsApp, or null when WhatsApp no longer has it.
 *
 * `socket` is the owner's live connection, used only when WhatsApp's link to the file has expired
 * and the phone has to be asked to upload it again; without one, files still on WhatsApp's servers
 * download all the same.
 */
async function openMediaStream(message, socket = null, { download } = {}) {
  const raw = reviveRaw(message?.rawMessage);
  const content = fileContent(raw);
  if (!content) return null;
  const fetchFile = download || require("@whiskeysockets/baileys").downloadMediaMessage;
  try {
    const stream = await fetchFile(raw, "stream", {}, {
      logger: QUIET_LOGGER,
      reuploadRequest: socket?.updateMediaMessage ? (msg) => socket.updateMediaMessage(msg) : async () => {
        throw new Error("WhatsApp is not linked, so the phone cannot be asked for this file again.");
      },
    });
    return { stream, contentType: contentTypeOf(content, message.mediaType) };
  } catch (error) {
    console.warn("[whatsapp] File not available from WhatsApp:", error?.message || error);
    return null;
  }
}

module.exports = { reviveRaw, mediaDetails, openMediaStream, contentTypeOf };
