const express = require("express");
const { protect } = require("../../../middleware/authMiddleware"); const { requireModule } = require("../../../middleware/permissionMiddleware");
const { requireProjectEnabled } = require("../projectEnabled");
const { requireWorkspaceAccess } = require("../projects/modules");
const { browseOriginals, registerOriginals, registerOriginalFiles, registerOriginalBatch, copySelectedOriginals } = require("./controller");

// Mounted twice: once under a project, for importing into it and copying its selections out, and
// once on its own for browsing the Original Storage Path before a project is chosen.
const router = express.Router({ mergeParams: true });
router.use(protect);
// Browsing and registering originals is how the desktop imports a shoot into any module, so each
// module's own permission does it, for a project in that module (off a project: any of them).
// Copying a client's selected originals out is Photo Selection's alone.
router.get("/browse", requireWorkspaceAccess(), browseOriginals);
// Registering originals is how the desktop uploads, so a disabled project takes none.
router.post("/register", requireWorkspaceAccess(), requireProjectEnabled, registerOriginals);
router.post("/register-files", requireWorkspaceAccess(), requireProjectEnabled, registerOriginalFiles);
router.post("/register-batch", requireWorkspaceAccess(), requireProjectEnabled, registerOriginalBatch);
router.post("/copy-selected", requireModule("IMAGE_SELECTION", "Project Management"), copySelectedOriginals);

module.exports = router;
