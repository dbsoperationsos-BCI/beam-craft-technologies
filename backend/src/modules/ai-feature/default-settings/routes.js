const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const { MODULE, SETTINGS_FEATURE } = require("../shared/permissions");
const { getDefaults, saveDefaults } = require("./controller");

// The studio-wide template behind More → Event Default Settings: its own permission, so reading
// the defaults is granted apart from running events. GET needs Read, PUT Read / Write.
const router = express.Router();
router.use(protect);
router.use(requireModule(MODULE, SETTINGS_FEATURE));
router.get("/", getDefaults);
router.put("/", saveDefaults);

module.exports = router;
