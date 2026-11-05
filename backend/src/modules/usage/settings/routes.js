const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { checkPermission } = require("../../../middleware/permissionMiddleware");
const { getSettings, saveSettings } = require("./controller");

const router = express.Router();

router.use(protect);

/*
 * The read is open to anybody signed in and the write is not.
 *
 * `requireModule` on the whole router would be the usual shape here, and it is the wrong one: it
 * would guard the GET too, and every browser in the studio needs the timeout to know when to stop
 * counting somebody as active. A user who could not read it would fall back to the built-in three
 * minutes and quietly disagree with everybody else.
 *
 * So the write alone names the permission - the same ADMIN / System Settings that governs Studio
 * Branding and the Image Selection settings beside it.
 */
router.get("/", getSettings);
router.patch("/", checkPermission("SETTINGS", "Application Monitoring", "READ_WRITE"), saveSettings);

module.exports = router;
