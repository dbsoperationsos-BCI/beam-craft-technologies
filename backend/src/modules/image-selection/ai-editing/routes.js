const express = require("express");
const { requireWorkspaceAccess } = require("../projects/modules");
const { requireProjectLink } = require("../projects/moduleLinks");
const multer = require("multer");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule, checkPermission } = require("../../../middleware/permissionMiddleware");
const c = require("./controller");
const gallery = require("../gallery/controller");
const { gate, desktopAiEnabled, editingLimiter } = require("../../desktop/flags");

/*
 * /api/image-selection/projects/:projectId/ai-editing - the AI Editing tab.
 *
 * One guard on the whole router, IMAGE_SELECTION / AI Editing: a GET reads (the bay, a photo, the
 * engine's capabilities), anything else writes (adding photos, saving and applying an edit, the
 * reference photo, the send). The one send - to the Signature Album - ALSO carries the album's own
 * permission, so a role that may edit but may not touch the album is refused by the destination
 * exactly as it would be on that tab. There is no send into Photo Selection from here: Photo
 * Selection is filled by AI Culling's send of a finalized run's Keeps (`ai-culling/routes.js`).
 */
const router = express.Router({ mergeParams: true });
router.use(protect);
router.use(requireModule("IMAGE_SELECTION", "AI Editing"));
// ...and only for a project in AI Editing (projects/modules.js).
router.use(requireWorkspaceAccess(["editing"]));

// A reference photo: one file, held in memory long enough to be re-encoded and stored.
const referenceUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
const receiveReference = (req, res, next) => referenceUpload.single("reference")(req, res, (err) => {
  if (err) return res.status(400).json({ message: err.code === "LIMIT_FILE_SIZE" ? "The reference photo must be 8 MB or smaller." : "Send one reference photo." });
  return next();
});

// An edited master the desktop app rendered from the original on its own disk: one JPEG, held
// in memory long enough to be bounded, re-read for its size and stored; the original never comes.
const outputUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 48 * 1024 * 1024, files: 1, fields: 2 } });
const receiveOutput = (req, res, next) => outputUpload.single("output")(req, res, (err) => {
  if (err) return res.status(400).json({ message: err.code === "LIMIT_FILE_SIZE" ? "The edited photo must be 48 MB or smaller." : "Send one edited photo." });
  return next();
});

router.get("/capabilities", c.capabilities);
router.get("/", c.list);
// The edits waiting for the desktop app that holds their originals (a web Apply on a desktop-registered
// photo lands here instead of rendering from the preview); the desktop drains it. Behind the desktop
// hand-off switch like the other desktop-only routes.
router.get("/pending", gate(desktopAiEnabled), editingLimiter, c.pending);
// AI Culling → AI Editing: the ticked photos join the bay.
// With `albumSync` ("AI Editing + Signature Album"), the photos' saved edits will later be written
// into the album, so the album's own guard applies as well.
const albumWrite = checkPermission("IMAGE_SELECTION", "Signature Album", "READ_WRITE");
// Into the editing bay only of a project linked to AI Editing - and, with the album sync, linked to
// the Signature Album too (projects/modules.js).
router.post("/photos/add", (req, res, next) => (req.body?.albumSync !== undefined ? albumWrite(req, res, next) : next()), requireProjectLink((req) => (req.body?.albumSync ? [["culling", "editing"], ["editing", "album"]] : [["culling", "editing"]])), c.addPhotos);
// AI Editing → Signature Album: the destination's guard beside this router's own.
router.post("/send-to-signature-album", checkPermission("IMAGE_SELECTION", "Signature Album", "READ_WRITE"), requireProjectLink([["editing", "album"]]), c.sendToSignatureAlbum);
// The automatic album sync's Retry: it writes the album, so it needs the album's guard too.
router.post("/album-sync/retry", checkPermission("IMAGE_SELECTION", "Signature Album", "READ_WRITE"), requireProjectLink([["editing", "album"]]), c.retryAlbumSync);
router.get("/photos/:uploadId", c.getPhoto);
// A derivative still on local disk, served under this router's own guard (the gallery's handlers,
// which read the same row), so a role holding AI Editing alone sees the bay.
const asGalleryImage = (handler) => (req, res) => { req.params.imageId = req.params.uploadId; return handler(req, res); };
router.get("/photos/:uploadId/thumbnail", asGalleryImage(gallery.thumbnail));
router.get("/photos/:uploadId/preview", asGalleryImage(gallery.preview));
router.patch("/photos/:uploadId/recipe", c.saveRecipe);
router.post("/photos/:uploadId/render", c.render);
// The desktop's own render, handed over (behind the desktop hand-off switch, like the culling signals).
router.post("/photos/:uploadId/output", gate(desktopAiEnabled), receiveOutput, c.storeOutput);
// The desktop could not render from the original (unavailable, changed, unreadable): the edit fails
// with that named state and the studio words, never with the preview standing in. Body
// `{ state, detail?, fromStatus? }`: the drain of `/pending` sends `fromStatus: "WAITING_FOR_DESKTOP"`
// so its report lands only on an edit still waiting (409 otherwise); the desktop user's own Apply omits it.
router.post("/photos/:uploadId/local-source", gate(desktopAiEnabled), editingLimiter, c.reportLocalSource);
router.post("/photos/:uploadId/reset", c.reset);
// What the engine would mark for removal (background people) - a proposal, applied only by Apply.
router.post("/photos/:uploadId/suggest", c.suggest);
// One recipe onto the ticked photos or the whole bay scope; each render is its own job.
router.post("/batch-apply", c.batchApply);
router.post("/photos/:uploadId/reference", receiveReference, c.storeReference);
router.delete("/photos/:uploadId/reference", c.removeReference);

module.exports = router;
