const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const { listActivityLogs, activityLogOptions, getActivityLog, exportActivityLogs } = require("./controller");

const router = express.Router();

router.use(protect);
/*
 * ADMIN / User Activity Logs, for the whole router: a GET needs Read, anything else Read / Write.
 *
 * The same permission the Administration screen answers to, so the screen and the endpoint cannot
 * disagree. Only reads exist today - the log is written by the middleware, never through here - but
 * a route added later is guarded the moment it is written.
 */
router.use(requireModule("ADMIN", "User Activity Logs"));

router.get("/", listActivityLogs);
router.get("/options", activityLogOptions);
router.get("/export", exportActivityLogs);
// After `/options` and `/export`, so neither word is read as a line id.
router.get("/:id", getActivityLog);

module.exports = router;
