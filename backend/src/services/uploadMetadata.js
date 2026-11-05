const { storeImage, discardUploads, isHttpUrl } = require("./imageStorage");
const { deleteObject } = require("./objectStorage");

/**
 * Images kept on a record as a list of links, with what is known about each file kept beside it.
 *
 * A form sends one flat list back: the files already on the record return as the links they are
 * stored under, and anything just picked arrives as an inline data URI. Telling those apart, and
 * carrying the metadata of the ones that are staying, is the same job on a cash entry's payment
 * proof and on a payment request's bills and QR code, which is why it lives here rather than in
 * either module.
 *
 * Each stored file is the upload's own receipt plus who added it when:
 *
 *   { url, key, mimeType, byteSize, width, height, originalByteSize, uploadedAt, uploadedBy }
 *
 * `key` is the object's path inside the bucket, kept so a file can be removed without parsing it
 * back out of the link. Nothing here verifies the file: storing what the upload reported is the
 * whole job.
 */
async function attachFiles(sources, existing, { folder, userId }) {
  if (sources === undefined) return { files: undefined, uploads: [] };
  if (sources === null) return { files: null, uploads: [] };

  const held = new Map((Array.isArray(existing) ? existing : []).filter((file) => file?.url).map((file) => [file.url, file]));
  const uploads = [];
  const files = [];
  try {
    for (const source of sources) {
      const link = String(source).trim();
      // Matched before the URL test so a file inlined in local development, where there is no
      // bucket to point at, keeps its metadata across an edit as a hosted one does.
      const alreadyHeld = held.get(link);
      if (alreadyHeld) { files.push(alreadyHeld); continue; }
      if (isHttpUrl(link)) { files.push({ url: link }); continue; }

      const stored = await storeImage(source, { folder });
      if (!stored) continue;
      uploads.push(stored);
      files.push({
        url: stored.url,
        key: stored.key,
        mimeType: stored.mimeType,
        byteSize: stored.byteSize,
        width: stored.width,
        height: stored.height,
        originalByteSize: stored.originalByteSize,
        uploadedAt: new Date().toISOString(),
        uploadedBy: userId,
      });
    }
    return { files, uploads };
  } catch (error) {
    await discardUploads(uploads);
    throw error;
  }
}

/**
 * Best-effort removal of the objects an edit dropped. Every upload belongs to the one record that
 * made it — nothing here is shared the way a bulk asset upload is — so a dropped link can go
 * without checking whether another row still points at it.
 */
async function removeDroppedFiles(previous, next) {
  if (next === undefined) return;
  const kept = new Set((next || []).map((file) => file?.url).filter(Boolean));
  const dropped = (Array.isArray(previous) ? previous : []).map((file) => file?.url).filter((url) => url && !kept.has(url));
  await Promise.all(dropped.map((url) => deleteObject(url)));
}

/** The bare links of a stored list, which is what a form re-sends and what a gallery draws. */
const fileUrls = (files) => (Array.isArray(files) ? files : []).map((file) => file?.url).filter(Boolean);

module.exports = { attachFiles, removeDroppedFiles, fileUrls, discardUploads };
