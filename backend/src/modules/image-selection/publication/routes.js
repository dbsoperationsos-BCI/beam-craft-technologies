const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const { requireProjectEnabled } = require("../projectEnabled");
const { getStatus, publishGallery, revokeGallery, regeneratePin } = require("./controller");

const router = express.Router({ mergeParams: true });
router.use(protect);
// Every route here answers for IMAGE_SELECTION / Project Management: a GET needs Read, anything else Read / Write.
router.use(requireModule("IMAGE_SELECTION", "Project Management"));
router.get("/", getStatus);
// Publishing and a new PIN put the gallery in front of the client, so a disabled project gets
// neither (`requireProjectEnabled`); unpublishing only takes it away, and stays open.
router.post("/", requireProjectEnabled, publishGallery);
router.delete("/", revokeGallery);
router.post("/regenerate-pin", requireProjectEnabled, regeneratePin);

module.exports = router;
