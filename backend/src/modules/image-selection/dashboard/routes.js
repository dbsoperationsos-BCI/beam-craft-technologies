const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const { dashboard, setExpand } = require("./controller");

const router = express.Router();

router.use(protect);
// The dashboard summarises what the Projects page lists, so it answers for the same permission:
// IMAGE_SELECTION / Project Management, READ to look and READ_WRITE for the one write below.
router.use(requireModule("IMAGE_SELECTION", "Project Management"));
router.get("/", dashboard);
// Expand → a project's Enabled switch. Disabling holds back uploads, publishing and the client's
// link for everyone, so it is a PUT under the module guard: Project Management Read / Write only.
router.put("/expand/:projectId", setExpand);

module.exports = router;
