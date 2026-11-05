const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { checkPermission, requireModule } = require("../../../middleware/permissionMiddleware");
const controller = require("./controller");

const { listWishes, saveWish } = controller;

const router = express.Router();
router.use(protect);

/*
 * Settings → Wishes, behind `SETTINGS / Wishes`: reading the wishes needs Read, rewording one Read /
 * Write. `requireModule` follows the method, so a route added here later is guarded the moment it is
 * written. Only the wish keys are reachable here - the rest of the message templates answer to
 * `SETTINGS / Message Template` on their own router.
 */
router.use(requireModule("SETTINGS", "Wishes"));

router.get("/", listWishes);
// The Wishes Scheduler - above `/:key`, so its paths are not read as a wish's key.
router.get("/scheduler", controller.getScheduler);
// Who may be chosen as Priority 1 - only to whoever may choose, as the attendance report's list is.
router.get("/scheduler/senders/candidates", checkPermission("SETTINGS", "Wishes", "READ_WRITE"), controller.listSchedulerCandidates);
router.put("/scheduler/group", controller.setSchedulerGroup);
router.put("/scheduler/send-at", controller.setSchedulerSendAt);
router.put("/scheduler/senders", controller.setSchedulerSender);
router.put("/:key", saveWish);

module.exports = router;
