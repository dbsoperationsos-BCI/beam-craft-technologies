const express = require("express");
const { protect } = require("../../middleware/authMiddleware");
const { requireModule } = require("../../middleware/permissionMiddleware");
const controller = require("./recycling-bin.controller");

/*
 * Resource Management → Recycling Bin: deleted projects, restored or deleted permanently.
 * GET reads at READ; restoring and deleting permanently ask READ_WRITE on the same permission.
 */
const router = express.Router();
router.use(protect);
router.use(requireModule("ASSET", "Recycling Bin"));
router.get("/projects", controller.listProjects);
// The read-only view of one deleted project (READ, the list's own scope).
router.get("/projects/:id", controller.getProject);
router.post("/projects/:id/restore", controller.restoreProject);
router.delete("/projects/:id", controller.deleteProjectPermanently);
module.exports = router;
