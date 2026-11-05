const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const { listStorageRoots, createStorageRoot, updateStorageRoot, deleteStorageRoot } = require("./controller");

const router = express.Router();

router.use(protect);
// Storage roots serve the upload/registration workflow, so they answer for the module's permission:
// reading the list needs Read, changing the roots needs Read / Write.
//
// There were two guards here. The first named `Upload & Gallery`, which had been merged into
// Project Management and so existed in no catalogue - a guard naming a permission nobody can hold
// refuses everybody but a Super Admin, and it ran first, so the correct guard below it never
// decided anything. The dead line is gone.
router.use(requireModule("IMAGE_SELECTION", "Project Management"));
router.get("/", listStorageRoots);
router.post("/", createStorageRoot);
router.patch("/:storageRootId", updateStorageRoot);
router.delete("/:storageRootId", deleteStorageRoot);

module.exports = router;
