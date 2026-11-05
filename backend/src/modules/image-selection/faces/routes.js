const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const { gate, desktopAiEnabled, ingestLimiter } = require("../../desktop/flags");
const { getStatus, queueProject, ingestFaces } = require("./controller");
const { requireWorkspaceAccess } = require("../projects/modules");

// Mounted at /api/image-selection/projects/:projectId/faces. The same permission as the gallery
// these people are found in: a screen may not be given a finer permission than the endpoint it
// reads, and the workspace that will one day show this status reads Project Management.
const router = express.Router({ mergeParams: true });
router.use(protect);
// The Virtual Curation desktop's hand-off of faces it found itself. Registered before the
// router-wide guard so the switch is asked first: with DESKTOP_VIRTUAL_CURATION_ENABLED or
// DESKTOP_AI_ENABLED off the path is the same 404 an unknown path gets, and never a 403 that would
// tell a signed-in prober the route exists and which permission it wants. On, the same
// Project Management guard as the rest of the router decides (a POST asks Read / Write).
// The desktop finds faces while it culls as well as for Photo Selection, so AI Culling's own
// Read / Write takes the hand-off for a project in AI Culling, as Project Management's does for one
// in Photo Selection (projects/modules.js).
router.post("/ingest", gate(desktopAiEnabled), ingestLimiter, requireWorkspaceAccess(["photos", "culling"]), ingestFaces);
router.use(requireModule("IMAGE_SELECTION", "Project Management"));
router.get("/status", getStatus);
router.post("/queue", queueProject);

module.exports = router;
