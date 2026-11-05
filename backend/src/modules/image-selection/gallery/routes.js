const express = require("express");
const { protect } = require("../../../middleware/authMiddleware"); const { requireModule } = require("../../../middleware/permissionMiddleware");
const { listImages, getSelectionSummary, updateSelection, getSelectedManifest, markSelectedDownloaded, original, thumbnail, preview } = require("./controller");

const router = express.Router({ mergeParams: true });
router.use(protect); router.use(requireModule("IMAGE_SELECTION", "Project Management"));
router.get("/", listImages);
router.get("/selection-summary", getSelectionSummary);
router.get("/selected/manifest", getSelectedManifest);
router.post("/selected/downloaded", markSelectedDownloaded);
router.patch("/:imageId/selection", updateSelection);
router.get("/:imageId/original", original);
router.get("/:imageId/thumbnail", thumbnail);
router.get("/:imageId/preview", preview);

module.exports = router;
