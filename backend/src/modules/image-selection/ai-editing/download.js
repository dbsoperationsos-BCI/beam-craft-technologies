const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const repository = require("./repository");
const r2Storage = require("../storage/r2");
const { recipeIsEmpty } = require("./recipe");
const { attachmentDisposition: disposition } = require("../../../services/contentDisposition");

/**
 * Download Edited: the saved edit masters of the photos asked for, and nothing else.
 *
 * A photo is downloadable only when its edit is RENDERED, has an output in storage, the applied
 * recipe is a real edit, and the recipe saved since matches it (an edit changed after its last
 * Apply is "outdated": the output on file is not what the studio last asked for). A tick in the
 * bay, an open editor or a slider moved but not applied is never an edit. The file served is the
 * edit's `outputKey` - the full-resolution JPEG the engine rendered (on the server, or on the
 * desktop from the original), the same master Send to Signature Album reads - never the preview,
 * the thumbnail or the original; a missing one is reported, never replaced.
 *
 * Two steps, because a download cannot carry the session header:
 * 1. `plan` (behind protect + AI Editing READ): which of the asked photos are downloadable, which
 *    are not and why, and a ticket - minutes-lived, signed with a key derived for this purpose
 *    alone (a ticket can never pass as a login token), naming the project, the person and each
 *    photo's edit version.
 * 2. `streamArchive` (the ticket is the credential): one JPEG when one photo is downloadable, a
 *    ZIP otherwise, streamed from R2 one file at a time - never the whole batch in memory. A photo
 *    re-edited or reset since the ticket was made is left out (its version moved), and anything
 *    that could not be fetched is named in a NOT-INCLUDED.txt inside the archive.
 */
const TICKET_SCOPE = "ai-editing-download";
const TICKET_TTL = "10m";
const MAX_PHOTOS = 2000;
const MAX_CONCURRENT = 4;
const IN_PROGRESS = new Set(["QUEUED", "RENDERING", "WAITING_FOR_DESKTOP"]);

function httpError(status, message, details) { const error = new Error(message); error.status = status; if (details) error.details = details; return error; }

function ticketKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw httpError(500, "Downloads are not configured on this server.");
  // A key of its own: the auth guard verifies with JWT_SECRET itself, so it rejects a ticket.
  return crypto.createHmac("sha256", secret).update(TICKET_SCOPE).digest("hex");
}

/** Whether one bay row can be downloaded as an edited photo, and if not, why (a stable code). */
function editDownloadState(upload) {
  const edit = upload?.edit;
  if (!upload || upload.status !== "READY" || !edit) return "notEdited";
  if (IN_PROGRESS.has(edit.status)) return "inProgress";
  if (edit.status === "FAILED") return "failed";
  if (edit.status !== "RENDERED" || !edit.outputKey || recipeIsEmpty(edit.appliedRecipe)) return "notEdited";
  // Saved since the last Apply and not the same edit: the output on file is outdated.
  const { recipeMatchesApplied } = require("./service");
  if (!recipeIsEmpty(edit.recipe) && !recipeMatchesApplied(edit.recipe, edit.appliedRecipe)) return "outdated";
  return "ready";
}

/** `DSC_0001 (edited).jpg`, made unique inside one archive: `DSC_0001 (edited) (2).jpg`. */
function uniqueNames(fileNames) {
  const seen = new Map();
  return fileNames.map((raw) => {
    const name = String(raw || "photo").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_");
    const key = name.toLowerCase();
    const count = (seen.get(key) || 0) + 1;
    seen.set(key, count);
    return count === 1 ? name : name.replace(/(\.[^.]+)?$/, (ext) => ` (${count})${ext || ""}`);
  });
}

function createEditDownloads(repo = repository, dependencies = {}) {
  const r2 = dependencies.r2 || r2Storage;
  const archiver = dependencies.archiver || require("archiver");
  const { editedFileName } = require("./service");

  async function plan(projectId, uploadIds, userId) {
    // A soft-deleted or unknown project answers 404, as every AI Editing route does.
    if (!(await repo.findProject(projectId))) throw httpError(404, "Image Selection project not found.");
    const ids = [...new Set(uploadIds)].slice(0, MAX_PHOTOS);
    const rows = await repo.listUploads(projectId, ids);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const excluded = { notEdited: 0, outdated: 0, inProgress: 0, failed: 0, missing: 0 };
    const ready = [];
    for (const id of ids) {
      const state = editDownloadState(byId.get(id));
      if (state === "ready") ready.push(byId.get(id)); else excluded[state] += 1;
    }
    if (ready.length && !r2.isConfigured()) throw httpError(503, "Object storage is not configured on this server.");
    // The output must still be in storage: checked now, so the count said before the download is true.
    const found = [];
    for (let index = 0; index < ready.length; index += 16) {
      const batch = ready.slice(index, index + 16);
      found.push(...(await Promise.all(batch.map((row) => r2.objectExists(row.edit.outputKey).catch(() => false)))));
    }
    const present = ready.filter((row, index) => found[index]);
    excluded.missing += ready.length - present.length;
    const names = uniqueNames(present.map((row) => editedFileName(row.fileName)));
    const included = present.map((row, index) => ({ uploadId: row.id, fileName: row.fileName, downloadName: names[index], bytes: row.edit.outputBytes ?? null }));
    const ticket = included.length
      ? jwt.sign({ scope: TICKET_SCOPE, projectId, sub: userId, items: present.map((row) => [row.id, row.edit.version]) }, ticketKey(), { expiresIn: TICKET_TTL })
      : null;
    return { asked: ids.length, included, excluded, ticket };
  }

  function verify(ticket) {
    let payload;
    try { payload = jwt.verify(String(ticket || ""), ticketKey(), { algorithms: ["HS256"] }); } catch { throw httpError(401, "This download has expired. Press Download again."); }
    if (payload.scope !== TICKET_SCOPE || !payload.projectId || !Array.isArray(payload.items)) throw httpError(401, "Invalid download.");
    return payload;
  }

  /**
   * What the ticket names, re-read now: only photos whose edit is still downloadable at the same
   * version. `{ projectId, files: [{ key, name }], skipped: [fileName] }`.
   */
  async function resolve(ticket) {
    const payload = verify(ticket);
    if (!(await repo.findProject(payload.projectId))) throw httpError(404, "Image Selection project not found.");
    const versions = new Map(payload.items.map(([id, version]) => [id, version]));
    const rows = await repo.listUploads(payload.projectId, [...versions.keys()]);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const usable = [];
    const skipped = [];
    for (const id of versions.keys()) {
      const row = byId.get(id);
      if (row && editDownloadState(row) === "ready" && row.edit.version === versions.get(id)) usable.push(row);
      else skipped.push(row?.fileName || id);
    }
    const names = uniqueNames(usable.map((row) => editedFileName(row.fileName)));
    return { projectId: payload.projectId, files: usable.map((row, index) => ({ key: row.edit.outputKey, name: names[index], fileName: row.fileName })), skipped };
  }


  // Archives streaming at once on this server: each holds a connection while it reads its photos
  // from storage one by one, so a burst is turned away (429) rather than queued without end.
  let streaming = 0;
  async function streamArchive(ticket, res) {
    if (streaming >= MAX_CONCURRENT) throw httpError(429, "Several downloads are already running. Try again in a minute.");
    streaming += 1;
    try { await streamResolved(ticket, res); } finally { streaming -= 1; }
  }
  async function streamResolved(ticket, res) {
    const { files, skipped } = await resolve(ticket);
    if (!files.length) throw httpError(409, "None of these photos has a saved edit to download any more. Apply the edits, then download again.");
    if (files.length === 1 && !skipped.length) {
      let body = null;
      try { body = await r2.getObjectStream(files[0].key); } catch { body = null; }
      if (!body) throw httpError(409, `The edited ${files[0].fileName} is no longer in storage. Apply the edit again.`);
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Content-Disposition", disposition(files[0].name));
      res.setHeader("Cache-Control", "private, no-store");
      await new Promise((resolve, reject) => { body.on("error", reject); res.on("finish", resolve); res.on("close", resolve); body.pipe(res); });
      return;
    }
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", disposition(`edited-photos-${new Date().toISOString().slice(0, 10)}.zip`));
    res.setHeader("Cache-Control", "private, no-store");
    // JPEGs are already compressed: stored, not deflated - no quality touched, less CPU.
    const archive = archiver("zip", { store: true });
    const done = new Promise((resolve, reject) => { archive.on("error", reject); res.on("close", resolve); archive.on("end", resolve); });
    archive.pipe(res);
    const missing = [...skipped];
    // One object at a time: each R2 stream is opened only when the one before it was written.
    for (const file of files) {
      if (res.destroyed) break;
      let body = null;
      try { body = await r2.getObjectStream(file.key); } catch { body = null; }
      if (!body) { missing.push(file.fileName); continue; }
      await new Promise((resolve, reject) => {
        const onEntry = () => { archive.off("error", onError); resolve(); };
        const onError = (error) => { archive.off("entry", onEntry); reject(error); };
        archive.once("entry", onEntry); archive.once("error", onError);
        archive.append(body, { name: file.name });
      });
    }
    if (missing.length) archive.append(`These photos were not included: their saved edit changed or could not be read from storage. Apply the edit and download again.\r\n\r\n${missing.join("\r\n")}\r\n`, { name: "NOT-INCLUDED.txt" });
    await archive.finalize();
    await done;
  }

  return { plan, resolve, streamArchive, verify };
}

module.exports = { createEditDownloads, editDownloadState, uniqueNames, TICKET_SCOPE, MAX_PHOTOS, MAX_CONCURRENT };
