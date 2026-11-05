const crypto = require("crypto");
const fsp = require("fs/promises");
const path = require("path");
const repository = require("./repository");
const { createSettingsService } = require("../settings/service");
const { resolveWithinRoot, assertReadable, isInsideRoot, normalizeRoot, safeSegment, uniqueName, separatorFor } = require("./paths");

/**
 * Originals on the studio's own drive or NAS.
 *
 * The master file never leaves where the photographer put it. This module does two things with it
 * and nothing else: it *registers* the file — recording where it is so the rest of the module can
 * find it — and, when staff explicitly ask, it *copies* a selected original into the Selected
 * Output Path. It never moves, rewrites or deletes a source file, and it never makes a second
 * permanent copy of one: the preview the client sees is built by the existing processing worker and
 * lives only in R2.
 */

// What the studio actually shoots. Anything else in the folder is skipped rather than registered,
// because the client gallery can only show what Sharp can open.
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".heic", ".heif", ".avif", ".cr2", ".cr3", ".nef", ".arw", ".raf", ".rw2", ".orf", ".dng"]);
const MIME_TYPES = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".tif": "image/tiff", ".tiff": "image/tiff", ".heic": "image/heic", ".heif": "image/heif", ".avif": "image/avif" };
const mimeFor = (extension) => MIME_TYPES[extension] || "image/x-raw";

function httpError(status, message, details) { const error = new Error(message); error.status = status; if (details) error.details = details; return error; }
const isImage = (fileName) => IMAGE_EXTENSIONS.has(path.extname(fileName).toLowerCase());

/**
 * Joins a name onto a directory using the separator that directory's *root* uses, not the one this
 * server happens to run on.
 *
 * `resolveWithinRoot` in paths.js already resolves with `path.win32` or `path.posix` to match the
 * root's flavour, and everything built from its result has to agree with it. A plain `path.join`
 * follows the host instead: this server on Linux, reading a `\\DBS-NAS\Wedding` share or a
 * `D:\DBS-Originals` drive, would build `\\DBS-NAS\Wedding/Project-001/DSC_4582.CR3` — a mixed
 * path that is then stored on the row and handed back to the filesystem.
 */
const joinUnder = (directory, name) => (separatorFor(directory) === "\\" ? path.win32 : path.posix).join(directory, name);

/**
 * The trails to try for one picked file, in the order they should be tried.
 *
 * A browser's `webkitRelativePath` always begins with the name of the folder the studio picked. So
 * setting the Original Storage Path *to* that folder, rather than to its parent, doubles the name:
 * `…\images\Folder 2` joined with `Folder 2\DSC08659.JPG` addresses a `Folder 2\Folder 2` that does
 * not exist. Both readings of the root are therefore accepted.
 *
 * The literal join is tried first, because a folder genuinely can contain another of the same name
 * — `Wedding\Wedding` is a real thing a photographer might have — and that file has to keep winning
 * over the de-duplicated guess. Only when nothing is there does the leading segment get dropped.
 */
function trailCandidates(segments, root) {
  const leaf = String(root ?? "").split(/[/\\]+/).filter(Boolean).pop() || "";
  const candidates = [segments];
  if (segments.length > 1 && leaf && segments[0].toLowerCase() === leaf.toLowerCase()) candidates.push(segments.slice(1));
  return candidates;
}

function createOriginalsService(repo = repository, dependencies = {}) {
  const settings = dependencies.settings || createSettingsService();
  const queue = dependencies.queue || null;
  const fs = dependencies.fs || fsp;
  // The upload dock's counters. Injectable so a unit test can watch them without a database or a
  // Redis channel; null in a test that does not care.
  const batches = dependencies.batches || null;
  const progress = dependencies.progress || null;

  async function roots() {
    const { originalStoragePath, selectedOutputPath } = await settings.read();
    return { originalRoot: normalizeRoot(originalStoragePath), selectedRoot: normalizeRoot(selectedOutputPath) };
  }

  async function requireProject(projectId) {
    const project = await repo.findProject(projectId);
    if (!project) throw httpError(404, "Active Image Selection project not found.");
    return project;
  }

  /**
   * Lists what is in a folder under the Original Storage Path, so staff can see what would be
   * registered before anything is written. `relativePath` is joined onto the configured root and
   * refused if it escapes it — the browser never names an absolute location.
   */
  async function browse(relativePath = "") {
    const { originalRoot } = await roots();
    if (!originalRoot) throw httpError(409, "Set the Original Storage Path in Project Settings before importing photos.");
    const directory = resolveWithinRoot(originalRoot, relativePath ? String(relativePath).split(/[/\\]+/) : []);
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch (error) { throw httpError(error.code === "ENOENT" ? 404 : 400, error.code === "ENOENT" ? "That folder was not found under the Original Storage Path." : "That folder could not be read."); }
    return {
      root: originalRoot,
      path: directory,
      folders: entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort((a, b) => a.localeCompare(b)),
      files: entries.filter((entry) => entry.isFile() && isImage(entry.name)).map((entry) => entry.name).sort((a, b) => a.localeCompare(b)),
    };
  }

  /**
   * Registers every photo in a folder against a project, without copying a byte of it.
   *
   * Each file becomes an upload row whose `originalPath` points at the file where it already sits.
   * The row goes straight to PROCESSING and is queued for the existing worker, which reads the
   * original, builds the thumbnail and preview, and uploads only those to R2.
   */
  async function register(projectId, { folderId = null, relativePath = "", recursive = false, userId = null }) {
    const project = await requireProject(projectId);
    const { originalRoot } = await roots();
    if (!originalRoot) throw httpError(409, "Set the Original Storage Path in Project Settings before importing photos.");
    if (folderId && !(await repo.findFolder(project.id, folderId))) throw httpError(404, "Folder not found on this project.");

    const directory = resolveWithinRoot(originalRoot, relativePath ? String(relativePath).split(/[/\\]+/) : []);
    const files = await collect(directory, recursive);
    const known = new Set((await repo.listRegisteredPaths(project.id)).map((row) => String(row.originalPath).toLowerCase()));

    const registered = [];
    const skipped = [];
    for (const file of files) {
      const upload = await claim({ project, folderId, file, userId, known });
      if (upload) registered.push(upload); else skipped.push({ fileName: file.name, reason: "already registered" });
    }
    return { root: originalRoot, path: directory, registered: registered.length, skipped, items: registered };
  }

  /**
   * One upload row for a file that stays exactly where it is. Returns null when this project already
   * knows the path, which is what makes re-running a scan — or re-picking the same folder — add only
   * what is new instead of duplicating a photo the client may already have selected.
   */
  async function claim({ project, folderId, batchId = null, file, userId, known }) {
    if (known.has(file.path.toLowerCase())) return null;
    const upload = await repo.createUpload({
      projectId: project.id,
      folderId,
      batchId,
      fileName: file.name,
      // No file is written here; the name only has to be unique, because R2 derivative keys and
      // the legacy on-disk layout are both built from it.
      storageName: crypto.randomUUID(),
      originalPath: file.path,
      mimeType: mimeFor(path.extname(file.name).toLowerCase()),
      sizeBytes: BigInt(file.size),
      uploadedBytes: BigInt(file.size),
      chunkSize: 0,
      totalChunks: 0,
      uploadedChunks: 0,
      status: "PROCESSING",
      createdByUserId: userId,
      completedAt: new Date(),
    });
    known.add(file.path.toLowerCase());
    // A registered photo skips straight past "uploading" — there was never anything to upload — so
    // the batch is told the file has arrived the moment its row exists, which is the same point a
    // chunk-uploaded one reports it.
    if (batchId && batches) await batches.increment(batchId, "uploadedFiles").catch(() => {});
    if (batchId && progress) await progress.publish(batchId, { id: upload.id, status: "PROCESSING", progress: 100 }).catch(() => {});
    if (queue) await queue.enqueue(upload.id).catch(() => {});
    return upload;
  }

  /**
   * Registers the files the studio picked in the ordinary upload control, from their paths alone.
   *
   * The browser sends each file's `webkitRelativePath` — `Wedding/Day 1/IMG_0001.CR3` — and no bytes
   * at all. Each trail is joined onto the Original Storage Path and refused if it escapes it, so the
   * folder the studio picks has to be one that sits under that root; anything the server cannot find
   * there is reported against that file and the rest of the folder still goes in.
   */
  async function registerFiles(projectId, { folderId = null, batchId = null, files = [], userId = null }) {
    const project = await requireProject(projectId);
    const { originalRoot } = await roots();
    if (!originalRoot) throw httpError(409, "Set the Original Storage Path in Project Settings before adding photos.");
    if (folderId && !(await repo.findFolder(project.id, folderId))) throw httpError(404, "Folder not found on this project.");
    if (batchId && batches) {
      const batch = await batches.findBatch(project.id, batchId);
      if (!batch) throw httpError(404, "Upload batch not found.");
      if ((batch.folderId || null) !== (folderId || null)) throw httpError(409, "Upload folder does not match the batch.");
    }

    const known = new Set((await repo.listRegisteredPaths(project.id)).map((row) => String(row.originalPath).toLowerCase()));
    const registered = [];
    const skipped = [];

    for (const relative of files) {
      const segments = String(relative).split(/[/\\]+/).filter(Boolean);
      const name = segments[segments.length - 1] || String(relative);
      if (!isImage(name)) { skipped.push({ fileName: name, reason: "not a supported image" }); continue; }

      // Each spelling of the trail is tried in turn; the first that names a real file wins.
      const attempted = [];
      let found = null;
      let refused = null;
      for (const candidate of trailCandidates(segments, originalRoot)) {
        let full;
        try { full = resolveWithinRoot(originalRoot, candidate); }
        catch (error) { refused = error.message; continue; }
        attempted.push(full);
        let stat;
        try { stat = await fs.stat(full); } catch { continue; }
        if (!stat.isFile()) continue;
        found = { path: full, size: stat.size };
        break;
      }
      if (!found) {
        // A trail that never resolved at all was refused for escaping the root, which is a different
        // thing from one that resolved to a file that is not there.
        skipped.push({ fileName: name, reason: attempted.length ? `Not found under ${originalRoot} — looked in ${attempted.join(" and ")}.` : refused });
        continue;
      }
      const upload = await claim({ project, folderId, batchId, file: { name, path: found.path, size: found.size }, userId, known });
      if (upload) registered.push(upload); else skipped.push({ fileName: name, reason: "already registered" });
    }

    return { root: originalRoot, registered: registered.length, skipped, items: registered };
  }

  /**
   * Registers photos the desktop app scanned, without this server touching a file.
   *
   * The desktop is the machine that can see the originals — a VPS cannot stat a studio NAS — so
   * its metadata is trusted the same way the browser derivative upload's is. Each photo is
   * recorded as `storageRootId` + a relative trail, the durable identity any workstation can
   * resolve through its own mapping. Registration is idempotent per (folder, trail): re-running a
   * scan adds what is new and reports the rest as duplicates, and a trail that tries to climb out
   * of its root is refused — this server never resolves these paths, but the workstation that
   * copies originals later will.
   */
  // `holdForCulling`: registered through the AI Culling tab, so every new photo is held for
  // culling before Photo Selection. A path already registered is a duplicate and stays as it is.
  async function registerBatch(projectId, { folderId = null, storageRootId, files = [], userId = null, holdForCulling = false, holdForEditing = false }) {
    const project = await requireProject(projectId);
    const storageRoot = await repo.findStorageRoot(storageRootId);
    if (!storageRoot) throw httpError(404, "Storage root not found. Add it under Settings → Storage Roots first.");
    if (folderId && !(await repo.findFolder(project.id, folderId))) throw httpError(404, "Folder not found on this project.");

    const known = new Set((await repo.listRegisteredFolderPaths(project.id)).map((row) => `${row.folderId || ""}:${String(row.originalPath).toLowerCase()}`));
    const registered = [];
    const duplicates = [];
    const skipped = [];

    for (const file of files) {
      const segments = String(file.relativePath).split(/[/\\]+/).filter(Boolean);
      const name = file.fileName || segments[segments.length - 1] || String(file.relativePath);
      if (!segments.length || segments.some((segment) => segment === "." || segment === "..")) {
        skipped.push({ fileName: name, reason: "the path may not leave its storage root" });
        continue;
      }
      if (!isImage(name)) { skipped.push({ fileName: name, reason: "not a supported image" }); continue; }
      const relative = segments.join("/");
      const key = `${folderId || ""}:${relative.toLowerCase()}`;
      if (known.has(key)) { duplicates.push({ fileName: name }); continue; }
      const upload = await repo.createUpload({
        projectId: project.id,
        folderId,
        fileName: name,
        storageName: crypto.randomUUID(),
        originalPath: relative,
        storageRootId: storageRoot.id,
        mimeType: mimeFor(path.extname(name).toLowerCase()),
        sizeBytes: BigInt(file.sizeBytes),
        uploadedBytes: BigInt(file.sizeBytes),
        chunkSize: 0,
        totalChunks: 0,
        uploadedChunks: 0,
        // PROCESSING and no queue: nothing on this server can move a desktop photo on. The row
        // waits here until the desktop posts its thumbnail and preview, which finishes it exactly
        // as the derivative endpoint finishes any other unfinished row.
        status: "PROCESSING",
        ...(file.width ? { width: file.width } : {}),
        ...(file.height ? { height: file.height } : {}),
        ...(file.capturedAt ? { capturedAt: new Date(file.capturedAt) } : {}),
        createdByUserId: userId,
        completedAt: new Date(),
        ...(holdForCulling ? { cullingHoldAt: new Date() } : {}),
        ...(holdForEditing ? { editingHoldAt: new Date() } : {}),
      });
      known.add(key);
      registered.push({ id: upload.id, fileName: upload.fileName });
    }

    return { storageRoot: storageRoot.name, registered: registered.length, duplicates: duplicates.length, skipped, items: registered };
  }

  async function collect(directory, recursive) {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => { throw httpError(404, "That folder was not found under the Original Storage Path."); });
    const files = [];
    for (const entry of entries) {
      const full = joinUnder(directory, entry.name);
      if (entry.isDirectory()) { if (recursive) files.push(...(await collect(full, true))); continue; }
      if (!entry.isFile() || !isImage(entry.name)) continue;
      const stat = await fs.stat(full);
      files.push({ name: entry.name, path: full, size: stat.size });
    }
    return files.sort((a, b) => a.name.localeCompare(b.name));
  }

  const deliverableName = (config) => config?.name || config?.shootDeliverable?.deliverableName || config?.postProductionAllocation?.serviceName || "Unsorted";

  /**
   * Copies the client's chosen originals into the Selected Output Path, filed under the project,
   * the selection item, and the shoot and folder each photo came from.
   *
   * Only ids reach this function — the paths come from the database and are re-checked against the
   * configured root before anything is opened. A missing source is reported against that one photo
   * and the rest of the copy carries on, because one file moved on the NAS is not a reason to
   * abandon a hundred that are still there.
   */
  async function copySelected(projectId, { deliverableConfigId = null } = {}) {
    const project = await requireProject(projectId);
    const { originalRoot, selectedRoot } = await roots();
    if (!selectedRoot) throw httpError(409, "Set the Selected Output Path in Project Settings before copying originals.");
    if (deliverableConfigId && !(await repo.findDeliverableConfig(project.id, deliverableConfigId)))
      throw httpError(404, "Selection item not found on this project.");

    // The selection state this copy takes out, read before the selections are: a client submission
    // landing while the files are being copied is newer than it, and stays to be downloaded.
    const selectionAsOf = new Date();
    const images = await repo.listSelectedOriginals(project.id, deliverableConfigId);
    if (!images.length) throw httpError(409, "No photos have been selected for this project yet.");

    const takenPerDirectory = new Map();
    const copied = [];
    const failed = [];
    let destinationRoot = "";

    for (const image of images) {
      const items = image.photoSelections.length ? image.photoSelections.map((selection) => deliverableName(selection.deliverableConfig)) : ["Unsorted"];
      for (const item of items) {
        const trail = [
          safeSegment(project.projectName, "Project"),
          safeSegment(item),
          safeSegment(image.folder?.parent?.name || image.folder?.name, "Unsorted"),
          ...(image.folder?.parent ? [safeSegment(image.folder.name)] : []),
        ];
        const directory = resolveWithinRoot(selectedRoot, trail);
        if (!destinationRoot) destinationRoot = resolveWithinRoot(selectedRoot, [trail[0]]);
        try {
          // The stored path is trusted only as far as the root allows: a row written when the
          // Original Storage Path was somewhere else is refused rather than read.
          const source = assertReadable(image.originalPath, originalRoot);
          await fs.access(source);
          if (!takenPerDirectory.has(directory)) takenPerDirectory.set(directory, new Set());
          const name = uniqueName(takenPerDirectory.get(directory), image.fileName);
          const target = joinUnder(directory, name);
          await fs.mkdir(directory, { recursive: true });
          // copyFile, never rename: the source is the master and must survive untouched.
          await fs.copyFile(source, target);
          copied.push({ imageId: image.id, fileName: image.fileName, item, path: target });
        } catch (error) {
          failed.push({ imageId: image.id, fileName: image.fileName, item, reason: reasonFor(error) });
        }
      }
    }

    // Only a complete copy is a download, as for the browser's Download Selected: one that could not
    // copy every original leaves the project on Yet to Download to be run again, and one that found
    // nothing to copy leaves it where it was. The dashboard's "Downloaded" and "Yet to Download"
    // read this stamp against the latest submission.
    if (copied.length && !failed.length) await repo.markSelectedDownloaded(project.id, selectionAsOf, deliverableConfigId ? [deliverableConfigId] : null).catch((error) => console.warn("Could not record the selected-originals download:", error?.message || error));
    return { root: selectedRoot, destination: destinationRoot, total: copied.length + failed.length, copied, failed };
  }

  function reasonFor(error) {
    if (error?.code === "ENOENT") return "Original file unavailable";
    if (error?.code === "EACCES" || error?.code === "EPERM") return "Permission denied reading the original";
    if (error?.code === "ENOSPC") return "No space left in the Selected Output Path";
    if (error?.status === 409 || error?.status === 400) return error.message;
    return error?.message || "Original file unavailable";
  }

  return { browse, register, registerFiles, registerBatch, copySelected, roots };
}

module.exports = { createOriginalsService, isImage, IMAGE_EXTENSIONS, mimeFor, isInsideRoot, separatorFor, trailCandidates };
