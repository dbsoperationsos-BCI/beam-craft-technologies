const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const { previewPurge, purgeActivityLog } = require("./controller");

/*
 * Settings → Activity Log Purge. `requireModule` on the whole router: the preview (GET) needs Read,
 * the delete (POST) Read / Write. The delete is itself a write, so the activity log records who
 * purged it and when - a line newer than anything it removed, so it survives its own purge.
 */
const router = express.Router();

router.use(protect);
router.use(requireModule("SETTINGS", "Activity Log Purge"));

router.get("/", previewPurge);
router.post("/", purgeActivityLog);

module.exports = router;
