const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { listProjects, createProject, editProject, saveSettings, duplicateProject, archiveProject, restoreProject, deleteProject } = require("./controller");
const { requireModule } = require("../../../middleware/permissionMiddleware");

const router = express.Router();

router.use(protect);
// Every route here answers for IMAGE_SELECTION / Project Management: a GET needs Read, anything else Read / Write.
router.use(requireModule("IMAGE_SELECTION", "Project Management"));
router.get("/projects", listProjects);
router.post("/projects", createProject);
router.patch("/projects/:projectId", editProject);
router.delete("/projects/:projectId", deleteProject);
router.patch("/projects/:projectId/settings", saveSettings);
router.post("/projects/:projectId/duplicate", duplicateProject);
router.post("/projects/:projectId/archive", archiveProject);
router.post("/projects/:projectId/restore", restoreProject);

module.exports = router;
