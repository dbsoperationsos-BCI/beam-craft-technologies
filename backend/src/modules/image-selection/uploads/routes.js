const crypto = require("crypto");
const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const { CHUNK_SIZE } = require("./service");
const { createBatch, getBatch, retryFailed, streamBatch } = require("./batchController");
const { listUploads, getUpload, initiateUpload, uploadChunk, completeUpload, cancelUpload } = require("./controller");
const { receiveDerivatives } = require("./derivativeController");

const incomingRoot = path.resolve(process.env.IMAGE_SELECTION_UPLOAD_ROOT || path.join(__dirname, "../../../../uploads/image-selection"), ".incoming");
const storage = multer.diskStorage({ destination: (_req, _file, callback) => { fs.mkdirSync(incomingRoot, { recursive: true }); callback(null, incomingRoot); }, filename: (_req, _file, callback) => callback(null, `${crypto.randomUUID()}.chunk`) });
// Give multer headroom above the exact chunk size — its own limit check is just a safety ceiling.
// The precise "does this chunk match the expected size" check happens in service.js (saveChunk),
// which returns a clear JSON error instead of multer's generic "File too large".
const chunkUpload = multer({ storage, limits: { fileSize: CHUNK_SIZE + 1024 * 1024, files: 1, fields: 1 } });
// Derivatives are held in memory and handed straight to R2: a few hundred KB each, and writing them
// to disk on the way past would be the one thing this whole change exists to avoid. The ceiling is
// well above the ~200KB preview the browser aims for, so a large frame is not rejected outright.
const derivativeUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 2, fields: 12 } });

/**
 * The upload dock's routes, behind whichever permission guard the mounting module chooses.
 *
 * Image Selection mounts it under its projects with Project Management; Album Proofing mounts it
 * again under its own routes with its own grant. This file knows nothing about albums, and a page
 * upload never needs the Image Selection permission.
 */
function createUploadsRouter(guard) {
  const router = express.Router({ mergeParams: true });
  router.use(protect);
  router.use(guard);
  router.get("/", listUploads);
  router.post("/batches", createBatch);
  router.get("/batches/:batchId", getBatch);
  router.post("/batches/:batchId/retry-failed", retryFailed);
  router.get("/batches/:batchId/events", streamBatch);
  router.post("/initiate", initiateUpload);
  // How photos arrive now: the browser sends the two derivatives it built and keeps the original.
  router.post("/derivatives", (req, res, next) => {
    derivativeUpload.fields([{ name: "thumbnail", maxCount: 1 }, { name: "preview", maxCount: 1 }])(req, res, (err) => {
      if (err) return res.status(400).json({ message: err.code === "LIMIT_FILE_SIZE" ? "Prepared image exceeds the maximum allowed size." : err.message });
      next();
    });
  }, receiveDerivatives);
  router.get("/:uploadId", getUpload);
  router.put("/:uploadId/chunks/:chunkIndex", (req, res, next) => {
    chunkUpload.single("chunk")(req, res, (err) => {
      if (err) {
        // Multer may already have written part of the chunk before rejecting it. Nothing else ever
        // looks in .incoming again, so without this the rejected bytes stay on disk for good.
        if (req.file?.path) fs.promises.rm(req.file.path, { force: true }).catch(() => {});
        return res.status(400).json({ message: err.code === "LIMIT_FILE_SIZE" ? "Chunk exceeds the maximum allowed size." : err.message });
      }
      next();
    });
  }, uploadChunk);
  router.post("/:uploadId/complete", completeUpload);
  router.delete("/:uploadId", cancelUpload);
  return router;
}

// Uploading is part of managing an Image Selection project, like its folders and its gallery - one
// permission covers the module. This used to be a bare check on the legacy `role` column, which no
// role could satisfy however the Roles screen was filled in.
module.exports = createUploadsRouter(requireModule("IMAGE_SELECTION", "Project Management"));
module.exports.createUploadsRouter = createUploadsRouter;
