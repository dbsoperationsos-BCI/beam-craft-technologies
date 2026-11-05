const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireWorkspaceAccess } = require("../projects/modules");
const { listFolders, createFolder, renameFolder, deleteFolder } = require("./controller");

const router = express.Router({ mergeParams: true });
router.use(protect);
// The folder tree is the photo workspace every Visual Curation module works in, so each module's own
// permission opens it - for a project in that module: a GET needs Read, anything else Read / Write
// (projects/modules.js). Photo Selection's permission alone is never required for another module's work.
router.use(requireWorkspaceAccess());
router.get("/", listFolders);
router.post("/", createFolder);
router.patch("/:folderId", renameFolder);
router.delete("/:folderId", deleteFolder);

module.exports = router;
