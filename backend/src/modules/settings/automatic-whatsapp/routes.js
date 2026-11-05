const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { checkPermission, requireModule } = require("../../../middleware/permissionMiddleware");
const controller = require("./controller");

const router = express.Router();
router.use(protect);

/*
 * Settings → User Settings → Automatic WhatsApp Message, behind `SETTINGS / Automatic WhatsApp
 * Message`: reading how a notification stands needs Read, changing it Read / Write. `requireModule`
 * follows the method, so a notification added here later is guarded the moment it is written. The
 * wording itself is a message template and answers to `SETTINGS / Message Template` on its own router.
 */
router.use(requireModule("SETTINGS", "Automatic WhatsApp Message"));

router.get("/photo-selection", controller.getPhotoSelection);
// Who may be chosen as Priority 1 - only to whoever may choose, as the attendance report's list is.
router.get("/photo-selection/senders/candidates", checkPermission("SETTINGS", "Automatic WhatsApp Message", "READ_WRITE"), controller.listPhotoSelectionCandidates);
router.put("/photo-selection/enabled", controller.setPhotoSelectionEnabled);
router.put("/photo-selection/group", controller.setPhotoSelectionGroup);
router.put("/photo-selection/senders", controller.setPhotoSelectionSender);

// New Lead Welcome: the switch alone - it goes to the lead, from the lead's owner, so there is no
// group or sender to choose. `requireModule` above makes the PUT Read / Write.
router.get("/lead-welcome", controller.getLeadWelcome);
router.put("/lead-welcome/enabled", controller.setLeadWelcomeEnabled);

// Interview Welcome: the switch and the senders it goes from (shown under Templates beside the
// wording). Who may be chosen is the same list as Photo Selection's, to whoever may choose.
router.get("/interview-welcome", controller.getInterviewWelcome);
router.get("/interview-welcome/senders/candidates", checkPermission("SETTINGS", "Automatic WhatsApp Message", "READ_WRITE"), controller.listPhotoSelectionCandidates);
router.put("/interview-welcome/enabled", controller.setInterviewWelcomeEnabled);
router.put("/interview-welcome/sender", controller.setInterviewWelcomeSender);

module.exports = router;
