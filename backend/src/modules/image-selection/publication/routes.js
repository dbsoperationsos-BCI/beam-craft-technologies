const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const { getStatus, publishGallery, revokeGallery, regeneratePin } = require("./controller");

const router = express.Router({ mergeParams: true });
router.use(protect);
// Every route here answers for IMAGE_SELECTION / Project Management: a GET needs Read, anything else Read / Write.
router.use(requireModule("IMAGE_SELECTION", "Project Management"));
router.get("/", getStatus);
router.post("/", publishGallery);
router.delete("/", revokeGallery);
router.post("/regenerate-pin", regeneratePin);

module.exports = router;
