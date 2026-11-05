const express = require("express");
const multer = require("multer");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const { requireProjectEnabled } = require("../projectEnabled");
const { createBatch, getBatch, retryFailed, streamBatch } = require("./batchController");
const { listUploads, getUpload, cancelUpload, retiredUploadRoute } = require("./controller");
const { receiveDerivatives } = require("./derivativeController");

// Derivatives are held in memory and handed straight to R2: a few hundred KB each, and writing them
// to disk on the way past would be the one thing this whole change exists to avoid. The ceiling is
// well above the ~200KB preview the browser aims for, so a large frame is not rejected outright.
// Thirteen text fields at most: the photo details, the two ids, the flags, `capturedAt` and the
// desktop's `checksum`.
const derivativeUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 2, fields: 13 } });

/**
 * The upload dock's routes, behind whichever permission guard the mounting module chooses.
 *
 * Image Selection mounts it under its projects with Project Management; Album Proofing mounts it
 * again under its own routes with its own grant. This file knows nothing about albums, and a page
 * upload never needs the Image Selection permission.
 *
 * No original reaches this router. The only bytes it accepts are the compressed preview and
 * thumbnail a client built (`/derivatives`); the chunked flow that once assembled a master on this
 * server is retired, and its three paths answer 410 so an old client learns why.
 */
function createUploadsRouter(guard) {
  const router = express.Router({ mergeParams: true });
  router.use(protect);
  router.use(guard);
  router.get("/", listUploads);
  // A disabled project takes no new photos (`requireProjectEnabled`); reading and cancelling stay open.
  router.post("/batches", requireProjectEnabled, createBatch);
  router.get("/batches/:batchId", getBatch);
  router.post("/batches/:batchId/retry-failed", requireProjectEnabled, retryFailed);
  router.get("/batches/:batchId/events", streamBatch);
  router.post("/initiate", retiredUploadRoute);
  // How photos arrive: the client sends the two derivatives it built and keeps the original.
  router.post("/derivatives", requireProjectEnabled, (req, res, next) => {
    derivativeUpload.fields([{ name: "thumbnail", maxCount: 1 }, { name: "preview", maxCount: 1 }])(req, res, (err) => {
      if (err) return res.status(400).json({ message: err.code === "LIMIT_FILE_SIZE" ? "Prepared image exceeds the maximum allowed size." : err.message });
      next();
    });
  }, receiveDerivatives);
  router.get("/:uploadId", getUpload);
  router.put("/:uploadId/chunks/:chunkIndex", retiredUploadRoute);
  router.post("/:uploadId/complete", retiredUploadRoute);
  router.delete("/:uploadId", cancelUpload);
  return router;
}

// Uploading is part of working on the project's photos, like its folders: each Visual Curation
// module's own permission does it for a project in that module (projects/modules.js). This used to
// be a bare check on the legacy `role` column, which no role could satisfy however the Roles screen
// was filled in, and then Project Management's alone, which shut AI Culling and AI Editing out.
module.exports = createUploadsRouter(require("../projects/modules").requireWorkspaceAccess());
module.exports.createUploadsRouter = createUploadsRouter;
