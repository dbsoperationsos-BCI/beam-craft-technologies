const express = require("express");
const { protect } = require("../../../middleware/authMiddleware"); const { requireModule } = require("../../../middleware/permissionMiddleware");
const { browseOriginals, registerOriginals, registerOriginalFiles, registerOriginalBatch, copySelectedOriginals } = require("./controller");

// Mounted twice: once under a project, for importing into it and copying its selections out, and
// once on its own for browsing the Original Storage Path before a project is chosen.
const router = express.Router({ mergeParams: true });
router.use(protect); router.use(requireModule("IMAGE_SELECTION", "Project Management"));
router.get("/browse", browseOriginals);
router.post("/register", registerOriginals);
router.post("/register-files", registerOriginalFiles);
router.post("/register-batch", registerOriginalBatch);
router.post("/copy-selected", copySelectedOriginals);

module.exports = router;
