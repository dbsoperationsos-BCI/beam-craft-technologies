const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const { requireProjectEnabled } = require("../projectEnabled");
const { limits } = require("../../sales/whatsapp-chat/security");
const { send, status, listGroups, linkGroup, unlinkGroup, sendGroup, notifyApp } = require("./controller");

const router = express.Router({ mergeParams: true });
router.use(protect);
// Every route here answers for IMAGE_SELECTION / Project Management: a GET needs Read, anything else Read / Write.
router.use(requireModule("IMAGE_SELECTION", "Project Management"));
// Every send reaches the client, so a disabled project sends nothing (`requireProjectEnabled`).
router.post("/send", requireProjectEnabled, send);
router.get("/notifications/:notificationId", status);
// The project's WhatsApp group. Reading the picker's list is a read; linking, unlinking and
// sending are writes. The send shares the CRM chat's per-person send limit, because it is the
// same paired account going out through the same socket.
router.get("/groups", listGroups);
router.post("/group", linkGroup);
router.delete("/group", unlinkGroup);
router.post("/send-group", limits.send, requireProjectEnabled, sendGroup);
// Send to Client: the client's app is told the photos are ready (WhatsApp itself opens in the browser).
router.post("/notify-app", requireProjectEnabled, notifyApp);

module.exports = router;
