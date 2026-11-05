const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { checkPermission, requireModule } = require("../../../middleware/permissionMiddleware");
const controller = require("./controller");

const router = express.Router();
router.use(protect);

/*
 * Settings → Project Management → Payment reminder, behind `SETTINGS / Payment Reminder`: Read to see
 * who sends it and when, Read / Write to change either. `requireModule` follows the method, so a
 * route added here later is guarded the moment it is written.
 */
router.use(requireModule("SETTINGS", "Payment Reminder"));

router.get("/", controller.getReminder);
// Who may be chosen as the sender - only to whoever may choose.
router.get("/senders/candidates", checkPermission("SETTINGS", "Payment Reminder", "READ_WRITE"), controller.listReminderCandidates);
router.put("/send-at", controller.setReminderSendAt);
router.put("/senders", controller.setReminderSender);

module.exports = router;
