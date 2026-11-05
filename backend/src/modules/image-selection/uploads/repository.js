const prisma = require("../../../config/db");

const uploadSelect = { id: true, projectId: true, folderId: true, batchId: true, fileName: true, mimeType: true, sizeBytes: true, uploadedBytes: true, chunkSize: true, totalChunks: true, uploadedChunks: true, status: true, processingError: true, width: true, height: true, imageFormat: true, orientation: true, capturedAt: true, thumbnailName: true, processedName: true, compressedName: true, compressedSizeBytes: true, processingAttempts: true, processingStartedAt: true, processingCompletedAt: true, completedAt: true, createdAt: true, updatedAt: true };
// The name comes back too because R2 derivative keys are built from it, so the bucket can be
// browsed by a human rather than by cuid.
const findProject = (projectId) => prisma.imageSelectionProject.findFirst({ where: { id: projectId, deletedAt: null }, select: { id: true, projectName: true } });
/**
 * The photo already sitting in this folder, matched on the trail the browser reported.
 *
 * Scoped to the destination folder, not the whole project. The same master legitimately belongs in
 * more than one folder — a shoot's photos go to Engagement and to Wedding, and the client picks
 * against each selection item separately — so matching project-wide meant the second folder silently
 * received nothing: every photo was reported as a duplicate of the copy in the first. What this is
 * for is re-picking the same folder into the same place, which must not file the photo twice.
 *
 * The batch and status come back too: a photo the batch itself left half-finished has to be finished
 * rather than waved through as a duplicate.
 */
const findByOriginalPath = (projectId, folderId, originalPath) => prisma.imageSelectionUpload.findFirst({ where: { projectId, folderId: folderId || null, originalPath }, select: { id: true, batchId: true, status: true, storageName: true, sizeBytes: true } });
const findFolder = (projectId, folderId) => prisma.imageSelectionFolder.findFirst({ where: { id: folderId, projectId, deletedAt: null }, select: { id: true } });
const findUpload = (projectId, uploadId) => prisma.imageSelectionUpload.findFirst({ where: { id: uploadId, projectId }, select: { ...uploadSelect, storageName: true } });
const listUploads = (projectId, folderId) => prisma.imageSelectionUpload.findMany({ where: { projectId, folderId: folderId || null, status: { not: "CANCELLED" } }, select: uploadSelect, orderBy: { createdAt: "desc" } });
const createUpload = (data) => prisma.imageSelectionUpload.create({ data, select: uploadSelect });
const updateProgress = (id, data) => prisma.imageSelectionUpload.update({ where: { id }, data, select: uploadSelect });
const completeUpload = (id) => prisma.imageSelectionUpload.update({ where: { id }, data: { status: "PROCESSING", completedAt: new Date(), processingError: null }, select: uploadSelect });
const cancelUpload = (id) => prisma.imageSelectionUpload.update({ where: { id }, data: { status: "CANCELLED" }, select: uploadSelect });

module.exports = { findProject, findFolder, findByOriginalPath, findUpload, listUploads, createUpload, updateProgress, completeUpload, cancelUpload };
