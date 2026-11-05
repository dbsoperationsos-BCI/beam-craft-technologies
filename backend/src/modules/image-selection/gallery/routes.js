const express = require("express");
const { protect } = require("../../../middleware/authMiddleware"); const { requireModule } = require("../../../middleware/permissionMiddleware");
const { requireWorkspaceAccess } = require("../projects/modules");
const { listImages, getSelectionSummary, updateSelection, getSelectedManifest, markSelectedDownloaded, original, thumbnail, preview } = require("./controller");

const router = express.Router({ mergeParams: true });
router.use(protect);
// A photo's original, thumbnail and preview are drawn by every module working on the project - AI
// Culling's review and AI Editing's bay fall back to them - so each module's own permission opens
// them, for a project in that module. The client gallery's list and selection stay Photo Selection's.
const photoSelection = requireModule("IMAGE_SELECTION", "Project Management");
router.get("/:imageId/original", requireWorkspaceAccess(), original);
router.get("/:imageId/thumbnail", requireWorkspaceAccess(), thumbnail);
router.get("/:imageId/preview", requireWorkspaceAccess(), preview);
router.use(photoSelection);
router.get("/", listImages);
router.get("/selection-summary", getSelectionSummary);
router.get("/selected/manifest", getSelectedManifest);
router.post("/selected/downloaded", markSelectedDownloaded);
router.patch("/:imageId/selection", updateSelection);

module.exports = router;
