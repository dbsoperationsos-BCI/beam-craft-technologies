const prisma = require("../../../config/db");

// `originalPath` decides where the worker reads from: the studio's own drive or NAS for a
// registered photo, the upload root for one that came through the browser.
// `project.albumProofing` decides which of the studio's compression presets the worker follows.
const findUpload = (id) => prisma.imageSelectionUpload.findUnique({ where: { id }, select: { id: true, batchId: true, storageName: true, originalPath: true, status: true, fileName: true, folderId: true, projectId: true, project: { select: { projectName: true, albumProofing: true } } } });

// Object keys embed the folder path, and folders are a self-referencing tree of unknown
// depth, so the ancestor chain is walked one level at a time. Depth is 2-3 in practice;
// the guard only exists so a cycle introduced by bad data cannot hang a worker.
async function folderChain(folderId) {
  const chain = [];
  let currentId = folderId;
  for (let depth = 0; currentId && depth < 20; depth += 1) {
    const folder = await prisma.imageSelectionFolder.findUnique({ where: { id: currentId }, select: { id: true, name: true, parentId: true } });
    if (!folder) break;
    chain.unshift({ id: folder.id, name: folder.name });
    currentId = folder.parentId;
  }
  return chain;
}
const markStarted = (id) => prisma.imageSelectionUpload.update({ where: { id }, data: { processingStartedAt: new Date(), processingError: null, processingAttempts: { increment: 1 } } });

/**
 * `countUploaded` folds the "this photo arrived" count into the same transaction as the "this photo
 * is finished" count. The derivative route needs that: it has nothing else to do after the photo
 * lands, so counting arrival separately left a batch permanently one photo short of its total
 * whenever the finishing step threw — the retry then saw a registered photo and did nothing.
 *
 * Every photo of a project increments the same project row and the same batch row, and photos
 * finish eight at a time, so InnoDB regularly shoots one of the colliding transactions (P2034).
 * The victim rolled back whole, so it is simply run again after a short stagger — without the
 * retry each collision dropped that photo's derivatives and stalled its batch one short.
 */
async function finalize(id, batchId, uploadData, batchField, { countUploaded = false } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(async (transaction) => {
        const upload = await transaction.imageSelectionUpload.update({ where: { id }, data: uploadData });
        if (batchField === "compressedFiles") await transaction.imageSelectionProject.update({ where: { id: upload.projectId }, data: { totalPhotoSize: { increment: upload.sizeBytes } } });
        if (!batchId) return upload;
        const batchData = { [batchField]: { increment: 1 } };
        if (countUploaded) batchData.uploadedFiles = { increment: 1 };
        await transaction.imageSelectionUploadBatch.update({ where: { id: batchId }, data: batchData });
        const batch = await transaction.imageSelectionUploadBatch.findUnique({ where: { id: batchId }, select: { totalFiles: true, compressedFiles: true, failedFiles: true } });
        if (batch.compressedFiles + batch.failedFiles >= batch.totalFiles) await transaction.imageSelectionUploadBatch.update({ where: { id: batchId }, data: { status: batch.failedFiles ? "COMPLETED_WITH_ERRORS" : "COMPLETED", completedAt: new Date() } });
        return upload;
      });
    } catch (error) {
      if (error?.code !== "P2034" || attempt >= 4) throw error;
      // Jittered so the photos that just collided do not all charge back in step.
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1) + Math.random() * 100));
    }
  }
}

const markReady = (id, batchId, data, options) => finalize(id, batchId, { ...data, status: "READY", processingCompletedAt: new Date(), processingError: null }, "compressedFiles", options);
const markFailed = (id, batchId, message) => finalize(id, batchId, { status: "PROCESSING_FAILED", processingCompletedAt: new Date(), processingError: message.slice(0, 2000) }, "failedFiles");

// Every READY photo with the columns recovery and the derivative audit decide on - its keys, where
// its original is, and the project's name and module for the renderer. Read in pages on the id so
// a studio's whole table never arrives in one query; `projectId` narrows it to one project.
async function listReadyWithKeys({ projectId = null } = {}) {
  const select = { id: true, projectId: true, folderId: true, fileName: true, thumbnailKey: true, previewKey: true, originalPath: true, storageRootId: true, storageName: true, createdAt: true, project: { select: { projectName: true, albumProofing: true } } };
  const rows = [];
  let cursor = null;
  for (;;) {
    const page = await prisma.imageSelectionUpload.findMany({
      where: { status: "READY", ...(projectId ? { projectId } : {}) },
      select, orderBy: { id: "asc" }, take: 1000,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    rows.push(...page);
    if (page.length < 1000) return rows;
    cursor = page[page.length - 1].id;
  }
}

module.exports = { findUpload, folderChain, listReadyWithKeys, markStarted, markReady, markFailed };
