const store = require("../../../services/crmMediaStore");

/**
 * Where a remark's attachments live.
 *
 * They used to live in the database. The browser read each picked file with `readAsDataURL` and
 * the base64 went into the lead's own JSON columns - so a photo attached to a note was carried,
 * in full, by every query that read that lead: the CRM table, the info panel, the popup, and
 * every backup and replica besides. Base64 costs a third more than the bytes it encodes, and the
 * plain-text summary column beside it caps at 64KB.
 *
 *   crm/remarks/<client>-<enquiry id>/images | audios | videos | files
 *
 * The same shape as the WhatsApp folders next to it, because it is the same client's material
 * filed the same way; the layout, slugging and bucket calls are shared in
 * `services/crmMediaStore`.
 *
 * Nothing here is public. What is stored against the remark is the object key, and the only way
 * to read one is the authenticated endpoint that streams it.
 */

const ROOT = "crm/remarks";

/*
 * Attachments picked before the lead exists.
 *
 * Add Lead can carry attachments on a remark for a lead that has no id yet, so there is no client
 * folder to file them under. They go here rather than being refused, and the note keeps its file.
 * Dated so the folder can be swept by age if it ever needs to be.
 */
const UNFILED = "unfiled";

function unfiledFolder() {
  const now = new Date();
  return `${UNFILED}/${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * The key one attachment is stored under.
 *
 * A lead id gives the client's own folder; without one the file is unfiled, which is the Add Lead
 * case. Either way the caller gets a key it can store against the remark.
 */
function buildAttachmentKey({ enquiryId, clientName, mimetype, fileName }) {
  const folder = store.folderForMime(mimetype);
  const key = store.buildKey({ root: ROOT, enquiryId, clientName, folder, fileName });
  if (key) return key;
  return `${ROOT}/${unfiledFolder()}/${folder}/${store.safeFileName(fileName)}`;
}

/**
 * Stores one attachment and answers with what the remark should hold.
 *
 * The shape matches what the composer already keeps for each file - id, name, type, size - with
 * `key` where the base64 `url` used to be. The browser asks the server for the bytes by key, so
 * nothing about the file travels with the lead any more.
 */
async function storeAttachment({ enquiryId, clientName, file }) {
  if (!file?.buffer?.length) return null;
  // Prefixed so two files of the same name on one lead do not overwrite each other - the same
  // photo can honestly be attached to two different remarks.
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${file.originalname || "file"}`;
  const key = buildAttachmentKey({ enquiryId, clientName, mimetype: file.mimetype, fileName: unique });
  const stored = await store.putObject({ key, buffer: file.buffer, contentType: file.mimetype });
  if (!stored) return null;
  return {
    key: stored,
    name: String(file.originalname || "file").slice(0, 200),
    type: file.mimetype || "application/octet-stream",
    size: file.size || file.buffer.length,
  };
}

module.exports = {
  storeAttachment,
  buildAttachmentKey,
  readAttachment: store.getObject,
  removeAttachment: store.removeObject,
  isAttachmentKey: store.isObjectKey,
  storageReady: store.storageReady,
  ROOT,
  UNFILED,
};
