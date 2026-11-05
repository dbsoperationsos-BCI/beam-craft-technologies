const store = require("../../../services/crmMediaStore");

/**
 * Where a WhatsApp conversation's files live.
 *
 * On R2 rather than beside the code. A photo a client sent is their record as much as the
 * studio's, and keeping it on the application server tied it to one machine, put it in whatever
 * the deploy happened to copy, and grew without bound on a disk nobody was watching. It also
 * meant a rebuilt server lost every attachment in every thread.
 *
 *   crm/whatsapp-chat/<client>-<enquiry id>/images | audios | videos | files
 *
 * The layout, the slugging and the bucket calls are shared with remark attachments in
 * `services/crmMediaStore` - the two file the same client's material the same way, and only the
 * root differs. This module is what says which root, and translates WhatsApp's own media
 * vocabulary onto the four folders.
 */

const ROOT = "crm/whatsapp-chat";

function buildMediaKey({ enquiryId, clientName, mediaType, fileName }) {
  return store.buildKey({
    root: ROOT,
    enquiryId,
    clientName,
    folder: store.folderFor(mediaType),
    fileName,
  });
}

async function putMedia({ enquiryId, clientName, mediaType, fileName, buffer, contentType }) {
  const key = buildMediaKey({ enquiryId, clientName, mediaType, fileName });
  if (!key) return "";
  return store.putObject({ key, buffer, contentType });
}

module.exports = {
  putMedia,
  getMedia: store.getObject,
  deleteMedia: store.removeObject,
  isRemoteKey: store.isObjectKey,
  storageReady: store.storageReady,
  buildMediaKey,
  clientFolder: store.clientFolder,
  clientSlug: store.clientSlug,
  folderFor: store.folderFor,
  safeFileName: store.safeFileName,
  ROOT,
};
