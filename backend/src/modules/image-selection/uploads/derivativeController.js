const crypto = require("crypto");
const repository = require("./repository");
const batchRepository = require("./batchRepository");
const progress = require("./progress");
const processingRepository = require("../processing/repository");
const r2 = require("../storage/r2");
const { buildDerivativeKey } = require("../storage/keys");
const { derivativeSchema } = require("./validation");
// The People filter's hook: told, never awaited, once the photo is READY. See faces/hook.js.
const faceHook = require("../faces/hook");

/**
 * Receives the thumbnail and preview a browser built, and nothing else.
 *
 * This is the whole of what arrives from a studio machine now. The master stays where the
 * photographer put it — this server never holds it, in any form, however briefly — so there is no
 * original to write, no queue to wait for and no worker to run: the row is READY the moment the two
 * derivatives are in R2. `originalPath` records the trail the browser reported so the same browser
 * can find the file again when the studio asks for the originals.
 */
function httpError(status, message) { const error = new Error(message); error.status = status; return error; }

async function receiveDerivatives(req, res) {
  const result = derivativeSchema.safeParse(req.body);
  if (!result.success) return res.status(400).json({ message: "Invalid photo details.", errors: result.error.flatten() });
  const body = result.data;
  const thumbnail = req.files?.thumbnail?.[0];
  const preview = req.files?.preview?.[0];
  if (!thumbnail || !preview) return res.status(400).json({ message: "Both a thumbnail and a preview are required." });

  try {
    if (!r2.isConfigured()) throw httpError(503, `Object storage is not configured: ${r2.missingConfig().join(", ")}.`);
    const project = await repository.findProject(req.params.projectId);
    if (!project) throw httpError(404, "Image Selection project not found.");
    if (body.folderId && !(await repository.findFolder(project.id, body.folderId))) throw httpError(404, "Folder not found.");
    const batch = body.batchId ? await batchRepository.findBatch(project.id, body.batchId) : null;
    if (body.batchId && !batch) throw httpError(404, "Upload batch not found.");
    if (batch && (batch.folderId || null) !== (body.folderId || null)) throw httpError(409, "Upload folder does not match the batch.");

    // A file is registered once per folder, so re-picking a folder to add the few new frames in it
    // does not create a second row for a photo the client may already have selected. Per folder and
    // not per project: the same master belongs in Engagement and in Wedding at once, and the client
    // picks against each selection item separately.
    //
    // Only a READY row is a duplicate, though. A row in any other state is a photo whose earlier
    // attempt got as far as registering itself and no further, and nothing on this server can move
    // it on: the original never left the studio machine, so there is no queue and no worker that
    // could pick it up. The derivatives for it are in hand right now, so it is finished onto the row
    // it already has. Waving those rows through as duplicates is what left a batch sitting at
    // "1 in queue" for good, with neither side able to finish it.
    const existing = await repository.findByOriginalPath(project.id, body.folderId, body.relativePath);
    /*
     * `replaceExisting` says this is the same spread done again — a correction round's whole
     * purpose — so a READY row is not a duplicate to wave through but the row to write over. The
     * two derivative keys are reused, which is safe because every frozen version holds copies of
     * its own: what an earlier round was reviewed with cannot be reached from here.
     */
    const unfinished = Boolean(existing) && (existing.status !== "READY" || body.replaceExisting);
    if (existing && !unfinished) {
      // The photo is not sent again, but this batch still reserved a slot for it in `totalFiles`.
      // Settling that slot is what lets the batch reach its total and report itself complete.
      if (body.batchId) {
        await batchRepository.increment(body.batchId, ["uploadedFiles", "compressedFiles"]);
        await progress.publish(body.batchId, { id: existing.id, status: existing.status, progress: 100 }).catch(() => {});
      }
      return res.status(200).json({ data: { duplicate: true, id: existing.id, message: "already registered" } });
    }

    // Reusing the storage name keeps a retried photo from stranding the objects the first attempt
    // wrote — the same two keys are simply overwritten.
    const storageName = existing?.storageName || crypto.randomUUID();
    const folders = body.folderId ? await processingRepository.folderChain(body.folderId) : [];
    const keyFor = (variant) => buildDerivativeKey({ projectName: project.projectName, projectId: project.id, folders, variant, fileName: body.fileName, storageName });
    const thumbnailKey = keyFor("thumbnail");
    const previewKey = keyFor("preview");
    await r2.putObject(thumbnailKey, thumbnail.buffer, "image/webp");
    await r2.putObject(previewKey, preview.buffer, "image/jpeg");

    const upload = unfinished ? existing : await repository.createUpload({
      projectId: project.id,
      folderId: body.folderId || null,
      batchId: body.batchId || null,
      fileName: body.fileName,
      storageName,
      // The trail inside the folder the studio picked. Only that browser can turn it back into a
      // file, which is exactly the point: this server is never able to open an original.
      originalPath: body.relativePath,
      mimeType: body.mimeType,
      sizeBytes: BigInt(body.sizeBytes),
      uploadedBytes: BigInt(body.sizeBytes),
      chunkSize: 0,
      totalChunks: 0,
      uploadedChunks: 0,
      status: "PROCESSING",
      createdByUserId: req.user.id,
      completedAt: new Date(),
    });
    // Reuses the worker's own finishing step, so the batch counters and the "all done" transition
    // behave exactly as they do for a photo that went through the queue. Arrival is counted here
    // too, in the same transaction: there is no queue to wait for, so a photo that finishes has
    // arrived, and counting the two apart is what let a failure here strand the whole batch.
    const ready = await processingRepository.markReady(upload.id, body.batchId || null, {
      thumbnailKey, previewKey, width: body.width, height: body.height, imageFormat: body.imageFormat || null, compressedSizeBytes: BigInt(preview.size),
      // A repaired row joins the batch that finished it, so it is not left filed under the run that
      // failed. Its folder already matches — that is what the lookup above matched on.
      ...(unfinished ? { batchId: body.batchId || null, completedAt: new Date() } : {}),
    }, { countUploaded: true });
    faceHook.enqueueAfterReady(upload.id);
    if (body.batchId) await progress.publish(body.batchId, { id: upload.id, status: "READY", progress: 100, width: ready.width, height: ready.height, compressedSizeBytes: Number(preview.size) }).catch(() => {});
    return res.status(201).json({ data: { id: upload.id, status: "READY" } });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    console.error("Unable to store Image Selection derivatives:", error);
    return res.status(500).json({ message: "Unable to store the prepared photo." });
  }
}

module.exports = { receiveDerivatives };
