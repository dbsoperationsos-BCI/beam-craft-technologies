const store = require("../../../services/crmMediaStore");

/**
 * Where a task's files live.
 *
 *   hrm/tasks/<task code>/images | audios | videos | files
 *
 * The task code rather than the row id, so somebody reading the bucket can find TSK-000042 without
 * the database open — the same reasoning that puts the client's name in the CRM's folders. The four
 * folders, the slugging and the bucket calls are `services/crmMediaStore`, shared rather than
 * written again here: a task's brief and a client's photo want exactly the same thing of storage.
 *
 * Nothing here is public. What the row keeps is the object key, and the only way to read one is the
 * authenticated endpoint that streams it — so a file handed over with a task has no URL that works
 * without a login, and the endpoint answers the same "not found" for a task the reader may not see.
 */

const ROOT = "hrm/tasks";

/*
 * ── What may be handed over with a task ───────────────────────────────────────────────────────
 *
 * A brief, a reference shot, the sheet the work is done from: pictures, PDFs, the office formats
 * and a zip of several. An allowlist rather than a blocklist, because the interesting question is
 * what the studio actually attaches - everything here has a reason to be on a task - and a
 * blocklist is a list of what somebody thought of.
 *
 * Both halves of a file have to agree with the list, because either one alone is wrong:
 *
 * - The **extension** decides where it can, and it decides *against* as well as for. A browser that
 *   cannot place a file sends `application/octet-stream` - which .docx routinely arrives as - so
 *   refusing on the type alone would refuse the file for the browser's uncertainty rather than for
 *   what it is. And a declared type is only a claim: `payload.exe` sent as `image/png` is accepted
 *   by a type check and downloads as an executable, which is why an extension that is not on the
 *   list refuses the file whatever it says it is.
 * - The **type** decides for a file with no extension at all, where there is nothing else to go on.
 */
const ALLOWED_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/csv", "text/plain",
  "application/zip", "application/x-zip-compressed",
]);

const ALLOWED_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "webp", "gif", "heic", "heif",
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv", "txt", "zip",
]);

/** What the refusal says, so nobody has to guess what would have been accepted. */
const ALLOWED_LABEL = "Images, PDFs, Word, Excel and PowerPoint files, CSV, text and ZIP";

const extensionOf = (name) => String(name || "").split(".").pop().toLowerCase();

/** Whether this file is one the studio attaches to a task. */
function isAllowedFile({ mimetype, originalname } = {}) {
  const name = String(originalname || "");
  const extension = name.includes(".") ? extensionOf(name) : "";
  // A named extension is the answer, either way - it is the half a claimed MIME type cannot argue
  // with, and it is what the file downloads as.
  if (extension) return ALLOWED_EXTENSIONS.has(extension);
  return ALLOWED_TYPES.has(String(mimetype || "").toLowerCase());
}

/** A task code reduced to one safe path segment; the row id is the fallback for a task without one. */
function taskFolder(taskCode, taskId) {
  const safe = String(taskCode || "").trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe || `task-${taskId}`;
}

/** The key one file is stored under. */
function buildAttachmentKey({ taskCode, taskId, mimetype, fileName }) {
  const folder = store.folderForMime(mimetype);
  return `${ROOT}/${taskFolder(taskCode, taskId)}/${folder}/${store.safeFileName(fileName)}`;
}

/**
 * Stores one picked file and answers with what the row should hold.
 *
 * The name is made unique before it is filed: the same photo can honestly be attached to two tasks,
 * and two files of one name in one folder would otherwise overwrite each other — silently, since
 * the second write succeeds.
 */
async function storeAttachment({ taskCode, taskId, file }) {
  if (!file?.buffer?.length) return null;
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${file.originalname || "file"}`;
  const key = buildAttachmentKey({ taskCode, taskId, mimetype: file.mimetype, fileName: unique });
  const stored = await store.putObject({ key, buffer: file.buffer, contentType: file.mimetype });
  if (!stored) return null;
  return {
    key: stored,
    name: String(file.originalname || "file").slice(0, 255),
    type: file.mimetype || "application/octet-stream",
    size: file.size || file.buffer.length,
  };
}

module.exports = {
  ROOT,
  ALLOWED_LABEL,
  isAllowedFile,
  taskFolder,
  buildAttachmentKey,
  storeAttachment,
  readAttachment: store.getObject,
  removeAttachment: store.removeObject,
  storageReady: store.storageReady,
};
