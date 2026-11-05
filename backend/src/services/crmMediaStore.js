const { GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { r2Client, bucket, isConfigured } = require("../config/r2");
const { IDENTIFIER_PATTERN } = require("./identifiers");

/**
 * Private per-client files in R2, filed so a person can read the bucket.
 *
 * The CRM keeps two kinds of client file - what was said over WhatsApp, and what was attached to
 * a remark - and both want the same shape: one folder per client, four folders inside it.
 *
 *   <root>/<client>-<enquiry id>/images/…
 *                               /audios/…
 *                               /videos/…
 *                               /files/…
 *
 * The enquiry id is part of the folder name on purpose. Two clients genuinely share a name in
 * this CRM already, and a folder per name alone would silently merge two people's files. The
 * name leads so the folder is still recognisable at a glance.
 *
 * Nothing here is public. Objects are read by the server and streamed through an authenticated
 * endpoint - the bucket's public URL is never built for them, so a leaked link cannot exist.
 * This is deliberately separate from `objectStorage.js`, which exists for assets that *are*
 * public and date-partitioned; the two want opposite things.
 */

// WhatsApp's media vocabulary and the browser's mime types both map onto four folders. A sticker
// is an image, and anything unrecognised is a file - "files" is the honest home for "we did not
// know what this was" as well as for documents.
const FOLDERS = { image: "images", sticker: "images", audio: "audios", video: "videos", document: "files" };

function folderFor(kind) {
  return FOLDERS[String(kind || "").toLowerCase()] || "files";
}

// The same four folders, decided from a mime type instead - which is what a browser upload has.
function folderForMime(mimetype) {
  const type = String(mimetype || "");
  if (type.startsWith("image/")) return "images";
  if (type.startsWith("audio/")) return "audios";
  if (type.startsWith("video/")) return "videos";
  return "files";
}

/**
 * A client's name reduced to one path segment.
 *
 * Lower case, punctuation collapsed to hyphens, length-capped. A name is typed by a person and
 * can contain anything at all - slashes, dots, scripts the bucket console will not render - so
 * what reaches a key is only ever `[a-z0-9-]`.
 */
function clientSlug(name) {
  const slug = String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "unnamed";
}

/*
 * The lead id, checked rather than trusted: it reaches an object key, and the CRM's own format is
 * the only thing that belongs there.
 *
 * The pattern was written out here as `/^DBS-[A-Z]{2}-EID-\d{1,12}$/`, which is the shape an enquiry
 * id had *before* it carried its vertical and its branch: `DBS-DD-EID-4867`. Every id minted since
 * is `DBS-EID-DD-HYD-000024`, so this matched none of them - and `buildKey` answers "" for an id it
 * cannot place, so every WhatsApp attachment and every remark file belonging to a current lead had
 * nowhere to be filed. Silently, because "" is the deliberate answer for a file that cannot be
 * placed rather than an error.
 *
 * `IDENTIFIER_PATTERN` from the identifiers service instead, which is the one place that knows what
 * the studio's codes look like. It is loose about *which* scheme - it will take a Call ID as
 * happily as an enquiry id - and that is right here: this is a check that the id is safe to put in
 * an object key, made of `DBS`, capitals, hyphens and digits and nothing else, and whose file it is
 * was settled before this was called.
 */
function safeEnquiryId(enquiryId) {
  const id = String(enquiryId || "").trim().toUpperCase();
  return IDENTIFIER_PATTERN.test(id) ? id : "";
}

function clientFolder(enquiryId, clientName) {
  const id = safeEnquiryId(enquiryId);
  if (!id) return "";
  return `${clientSlug(clientName)}-${id}`;
}

// One segment, safe characters, bounded. Separators are stripped rather than escaped, so a name
// can only ever name a file inside the folder the key already decided on.
function safeFileName(candidate) {
  const base = String(candidate || "").split(/[\\/]/).pop() || "";
  const cleaned = base.replace(/[^\w.-]+/g, "_").replace(/^\.+/, "");
  return cleaned.slice(0, 120) || `file-${Date.now()}`;
}

/**
 * The key an object is stored under, or "" when it cannot be built.
 *
 * Returning "" rather than throwing: a caller that cannot place a file should still be able to
 * carry on without it, rather than losing the message or remark it belonged to.
 */
function buildKey({ root, enquiryId, clientName, folder, fileName }) {
  const prefix = String(root || "").replace(/^\/+|\/+$/g, "");
  const client = clientFolder(enquiryId, clientName);
  if (!prefix || !client || !folder) return "";
  return `${prefix}/${client}/${folder}/${safeFileName(fileName)}`;
}

// Whether a stored path is an object key rather than a local file name or a data URI. Local names
// never contain a separator, so the slash is what tells them apart; a `data:` URI is neither.
function isObjectKey(value) {
  return typeof value === "string" && value.includes("/") && !value.startsWith("data:");
}

function storageReady() {
  return isConfigured;
}

/**
 * Puts one file in the bucket.
 *
 * Private and uncached: this is one client's material, not an asset. `no-store` keeps it out of
 * any proxy between the bucket and the server.
 */
async function putObject({ key, buffer, contentType }) {
  if (!isConfigured || !key || !buffer?.length) return "";
  await r2Client().send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType || "application/octet-stream",
    CacheControl: "no-store",
  }));
  return key;
}

/**
 * Reads one file back, as a stream for an endpoint to pipe.
 *
 * Streamed rather than buffered: a video can be tens of megabytes, and holding one per concurrent
 * viewer in the server's memory is how a panel takes the API down with it.
 */
async function getObject(key) {
  if (!isConfigured || !isObjectKey(key)) return null;
  try {
    const result = await r2Client().send(new GetObjectCommand({ Bucket: bucket, Key: String(key) }));
    return {
      stream: result.Body,
      contentType: result.ContentType || "application/octet-stream",
      contentLength: result.ContentLength,
    };
  } catch (error) {
    // Absent is an answer, not a failure: a file can be removed from the bucket and the thread or
    // the remark still has to render, saying the file is no longer stored.
    if (error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404) return null;
    console.error("[crm-media] Unable to read from R2:", error.message);
    return null;
  }
}

// Best-effort, and never throws: removing a file must not fail the thing that asked for it.
async function removeObject(key) {
  if (!isConfigured || !isObjectKey(key)) return false;
  try {
    await r2Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: String(key) }));
    return true;
  } catch (error) {
    console.error("[crm-media] Unable to delete from R2:", error.message);
    return false;
  }
}

module.exports = {
  putObject,
  getObject,
  removeObject,
  buildKey,
  isObjectKey,
  storageReady,
  clientFolder,
  clientSlug,
  safeEnquiryId,
  safeFileName,
  folderFor,
  folderForMime,
};
