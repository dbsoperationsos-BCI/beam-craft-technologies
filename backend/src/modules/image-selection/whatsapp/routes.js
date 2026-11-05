const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const { limits } = require("../../sales/whatsapp-chat/security");
const { send, status, listGroups, linkGroup, unlinkGroup, sendGroup } = require("./controller");

const router = express.Router({ mergeParams: true });
router.use(protect);
// Every route here answers for IMAGE_SELECTION / Project Management: a GET needs Read, anything else Read / Write.
router.use(requireModule("IMAGE_SELECTION", "Project Management"));
router.post("/send", send);
router.get("/notifications/:notificationId", status);
// The project's WhatsApp group. Reading the picker's list is a read; linking, unlinking and
// sending are writes. The send shares the CRM chat's per-person send limit, because it is the
// same paired account going out through the same socket.
router.get("/groups", listGroups);
router.post("/group", linkGroup);
router.delete("/group", unlinkGroup);
router.post("/send-group", limits.send, sendGroup);

module.exports = router;
