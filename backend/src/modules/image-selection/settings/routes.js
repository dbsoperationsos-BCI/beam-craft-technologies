const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const { getSettings, saveSettings } = require("./controller");

const router = express.Router();

router.use(protect);
// Every route here answers for ADMIN / System Settings: a GET needs Read, anything else Read / Write.
router.use(requireModule("SETTINGS", "Organization"));
router.get("/", getSettings);
router.patch("/", saveSettings);

module.exports = router;
