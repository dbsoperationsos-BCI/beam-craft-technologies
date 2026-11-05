const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const { getStatus, queueProject } = require("./controller");

// Mounted at /api/image-selection/projects/:projectId/faces. The same permission as the gallery
// these people are found in: a screen may not be given a finer permission than the endpoint it
// reads, and the workspace that will one day show this status reads Project Management.
const router = express.Router({ mergeParams: true });
router.use(protect);
router.use(requireModule("IMAGE_SELECTION", "Project Management"));
router.get("/status", getStatus);
router.post("/queue", queueProject);

module.exports = router;
