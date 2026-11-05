const express = require("express");
const { requireProjectLink } = require("../projects/moduleLinks");
const multer = require("multer");
const { LIMITS } = require("./signatureAlbum.constants");
const { protect } = require("../../../middleware/authMiddleware");
const { requireAlbumAccess, requireSettingsAccess } = require("./signatureAlbum.permissions");
const { checkPermission } = require("../../../middleware/permissionMiddleware");
const c = require("./signatureAlbum.controller");

/*
 * /api/image-selection/signature-albums - the studio side.
 *
 * Two guards on one router. The studio-wide defaults answer to SETTINGS / Organization, the
 * permission of the panel they are edited in; everything else answers to IMAGE_SELECTION /
 * Signature Album - a GET reads, anything else writes. Both mounted per prefix rather than per
 * route, so a route added later is covered the moment it is written.
 */
const router = express.Router();
router.use(protect);

// A photo uploaded to the album arrives as the two derivatives the browser built, never the
// original - held in memory just long enough to go to R2, at the project upload's own ceiling.
const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: LIMITS.MAX_UPLOAD_BYTES, files: 2 } });
const receivePhoto = (req, res, next) => photoUpload.fields([{ name: "thumbnail", maxCount: 1 }, { name: "preview", maxCount: 1 }])(req, res, (err) => {
  if (err) return res.status(400).json({ message: err.code === "LIMIT_FILE_SIZE" ? "Prepared image exceeds the maximum allowed size." : "Send one thumbnail and one preview." });
  return next();
});

const settingsRouter = express.Router();
settingsRouter.use(requireSettingsAccess());
settingsRouter.get("/", c.getSettings);
settingsRouter.patch("/", c.saveSettings);
router.use("/settings", settingsRouter);

const albums = express.Router();
albums.use(requireAlbumAccess());
// The project's album, and what it may be built from.
albums.get("/media/:projectId/:imageId/thumbnail", c.thumbnail);
albums.get("/media/:projectId/:imageId/preview", c.preview);
albums.get("/projects/:projectId/sources/folders", c.sourceFolders);
albums.get("/projects/:projectId/sources/images", c.sourceImages);
albums.get("/projects/:projectId", c.getAlbum);
albums.post("/projects/:projectId", c.createAlbum);
// Photos sent in from the AI Culling tab, by reference (READ_WRITE, as any POST under this guard).
// AI Culling -> Signature Album: these read a culling run (its photos, and for the plan where
// each original is), so they need AI Culling's own permission (Read, as the culling router asks)
// besides the album's - an album-only role cannot read a run through them.
const readsCulling = checkPermission("IMAGE_SELECTION", "AI Culling", "READ");
// AI Culling → Signature Album: only into an album the project is linked to (projects/modules.js).
albums.post("/projects/:projectId/import", readsCulling, requireProjectLink([["culling", "album"]]), c.importUploads);
// AI Culling -> Send Photos from the desktop: which of a finalized run's photos still need the
// album's own copy (the workstation then compresses them with the album's preset and uploads the
// derivatives to /:albumId/photos). A POST that makes the album when the project has none yet, so
// it is guarded exactly as the import is.
albums.post("/projects/:projectId/import/plan", readsCulling, requireProjectLink([["culling", "album"]]), c.importPlan);
// The album itself.
albums.patch("/:albumId", c.updateAlbum);
albums.delete("/:albumId", c.deleteAlbum);
albums.patch("/:albumId/design", c.updateDesign);
albums.patch("/:albumId/access", c.updateAccess);
// Chapters. `reorder` sits above `:chapterId` so the word is never read as an id.
albums.post("/:albumId/chapters", c.createChapter);
albums.patch("/:albumId/chapters/reorder", c.reorderChapters);
albums.patch("/:albumId/chapters/:chapterId", c.updateChapter);
albums.delete("/:albumId/chapters/:chapterId", c.deleteChapter);
albums.get("/:albumId/chapters/:chapterId/items", c.listChapterItems);
// Photos uploaded to the album itself - its own library, never the project's photos.
albums.get("/:albumId/photos", c.listPhotos);
albums.post("/:albumId/photos", receivePhoto, c.uploadPhoto);
// Select All and bulk delete. Above `:photoId` so neither word is read as an id.
albums.get("/:albumId/photos/ids", c.listPhotoIds);
albums.post("/:albumId/photos/remove", c.deletePhotos);
albums.delete("/:albumId/photos/:photoId", c.deletePhoto);
// Items and highlights.
albums.post("/:albumId/items", c.addItems);
albums.post("/:albumId/items/remove", c.removeItems);
albums.patch("/:albumId/items/reorder", c.reorderItems);
albums.patch("/:albumId/items/:itemId", c.updateItem);
albums.delete("/:albumId/items/:itemId", c.removeItem);
albums.get("/:albumId/highlights", c.listHighlights);
albums.patch("/:albumId/highlights/reorder", c.reorderHighlights);
// The preview: the client's page, built by the client's own builder, behind the studio's guard.
albums.get("/:albumId/preview", c.previewContent);
albums.get("/:albumId/preview/chapters/:chapterId/items", c.previewChapterItems);
// Publishing and sharing.
albums.post("/:albumId/publish", c.publish);
albums.post("/:albumId/unpublish", c.unpublish);
albums.post("/:albumId/share-link", c.regenerateLink);
albums.post("/:albumId/reset-pin", c.resetPin);
albums.get("/:albumId/share", c.shareDetails);
albums.post("/:albumId/share/whatsapp-group", c.sendToGroup);
router.use("/", albums);

module.exports = router;
