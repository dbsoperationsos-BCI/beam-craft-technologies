const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const { listFolders, createFolder, renameFolder, deleteFolder } = require("./controller");

const router = express.Router({ mergeParams: true });
router.use(protect);
// Every route here answers for IMAGE_SELECTION / Project Management: a GET needs Read, anything else Read / Write.
router.use(requireModule("IMAGE_SELECTION", "Project Management"));
router.get("/", listFolders);
router.post("/", createFolder);
router.patch("/:folderId", renameFolder);
router.delete("/:folderId", deleteFolder);

module.exports = router;
