const express = require("express");
const { getMeta, verifyPin, startPreview, listFolders, listFolderImages, listSelected, submitSelection, updateSelection, clearSelection, thumbnail, preview, listPeople } = require("./controller");

const router = express.Router();
router.get("/:token", getMeta);
router.post("/:token/verify-pin", verifyPin);
router.post("/:token/preview-session", startPreview);
router.get("/:token/folders", listFolders);
// The People filter: who has been found in the gallery (or one folder of it). Read-only, and empty when the filter is off.
router.get("/:token/people", listPeople);
router.get("/:token/selected", listSelected);
router.post("/:token/submit-selection", submitSelection);
router.get("/:token/folders/:folderId/images", listFolderImages);
router.post("/:token/images/:imageId/selection", updateSelection);
router.post("/:token/selection/clear", clearSelection);
router.get("/:token/images/:imageId/thumbnail", thumbnail);
router.get("/:token/images/:imageId/preview", preview);

module.exports = router;