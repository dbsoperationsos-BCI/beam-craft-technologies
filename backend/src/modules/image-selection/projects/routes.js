const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { listProjects, createProject, editProject, saveSettings, duplicateProject, archiveProject, restoreProject, deleteProject } = require("./controller");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const { requireCreatePermissions } = require("./moduleProjects");

const router = express.Router();

router.use(protect);
// Every route here answers for IMAGE_SELECTION / Project Management - Photo Selection's own projects:
// a GET needs Read, anything else Read / Write. On each route rather than `router.use`: this router
// is mounted on the whole /api/image-selection prefix, so a router-wide guard also stood in front of
// every route mounted after it - the folders, AI Culling and AI Editing among them - and asked Photo
// Selection's permission of work that answers to each module's own.
const photoSelection = requireModule("IMAGE_SELECTION", "Project Management");
router.get("/projects", photoSelection, listProjects);
// Creating a project also creates the module projects its ticks name, so each of those modules'
// own Read / Write is asked too (moduleProjects.js), not Project Management's alone.
router.post("/projects", photoSelection, requireCreatePermissions, createProject);
router.patch("/projects/:projectId", photoSelection, editProject);
router.delete("/projects/:projectId", photoSelection, deleteProject);
router.patch("/projects/:projectId/settings", photoSelection, saveSettings);
router.post("/projects/:projectId/duplicate", photoSelection, duplicateProject);
router.post("/projects/:projectId/archive", photoSelection, archiveProject);
router.post("/projects/:projectId/restore", photoSelection, restoreProject);

module.exports = router;
