const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { checkPermission } = require("../../../middleware/permissionMiddleware");
const { getOrgChart } = require("./controller");

const router = express.Router();
router.use(protect);

/**
 * The chart is read at READ of the permission that already governs the Employee Repository, which
 * is the screen it is shown inside.
 *
 * A router of its own rather than another route on the master-data one next door: that router lets
 * any signed-in session through on GET, deliberately, because the department and designation lists
 * it serves fill pickers all over the app. The chart is not reference data — it is a picture of the
 * studio's reporting lines — so it is guarded on its own instead of inheriting that exemption.
 */
router.get("/:employeeId", checkPermission("HRM", "Employee Management", "READ"), getOrgChart);

module.exports = router;
