const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { checkPermission, requireModule } = require("../../../middleware/permissionMiddleware");
const { list, pending, options, people, assignees, create, createMany, setIssueStatus, sendWhatsApp } = require("./controller");
const { limits: whatsappLimits } = require("../../sales/whatsapp-chat/security");

const router = express.Router();

router.use(protect);
// Every route here answers for PROJECT / Feedback: reading the list and the form's options needs
// Read, giving feedback is a write. Mounted on the router so a route added later is guarded the
// moment it is written.
router.use(requireModule("PROJECT", "Feedback"));
router.get("/options", options);
router.get("/pending", pending);
// Who worked on a shoot (`?shootId=`), by area - Shoot Completion Feedback's Appreciation and Not
// Satisfied lists. For somebody giving feedback (Read & Write), since it lists the studio's people.
router.get("/projects/:projectId/people", checkPermission("PROJECT", "Feedback", "READ_WRITE"), people);
// Who an Average or Poor review can be given to as a task - for somebody giving feedback (Read &
// Write), since it lists the studio's logins, not for a reader of it.
router.get("/assignees", checkPermission("PROJECT", "Feedback", "READ_WRITE"), assignees);
router.get("/", list);
router.post("/", create);
// Give Feedback over the ticked rows, in batches - READ_WRITE through `requireModule`, like the one-row save.
router.post("/bulk", createMany);
// A feedback under Issues moved on to Issues sorted or Rejected - READ_WRITE, as a PATCH.
router.patch("/:id/status", setIssueStatus);
// Feedback Thank You / Feedback Issues to the client on WhatsApp - READ_WRITE through `requireModule`,
// rate limited like every send that reaches a WhatsApp socket.
router.post("/:id/send-whatsapp", whatsappLimits.send, sendWhatsApp);

module.exports = router;
