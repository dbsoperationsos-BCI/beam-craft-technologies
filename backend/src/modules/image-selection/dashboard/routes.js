const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const { dashboard } = require("./controller");

const router = express.Router();

router.use(protect);
// The dashboard summarises what the Projects page lists, so it answers for the same permission:
// IMAGE_SELECTION / Project Management, READ to look. Nothing here writes, so nothing asks for more.
router.use(requireModule("IMAGE_SELECTION", "Project Management"));
router.get("/", dashboard);

module.exports = router;
