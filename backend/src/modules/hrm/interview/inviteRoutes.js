const express = require("express");
const { requireTemplateOn } = require("../../../services/messageTemplateSwitches");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
// The WhatsApp module's own send limiter, keyed per user: one paired account gets one budget
// across every screen that sends from it, rather than a fresh 30 a minute per router.
const { limits: whatsappLimits } = require("../../sales/whatsapp-chat/security");
const { createInvite, listInvites, updateInvite, cancelInvite, sendInviteEmail, sendInviteWhatsApp } = require("./invites");

/**
 * The application invites, behind the same permission as the register they write into: sending a
 * candidate the form is a step of working the candidate, so `HRM / Interview` covers it - a GET
 * reads the list, everything else raises, corrects, cancels or sends one.
 */
const router = express.Router();
router.use(protect);
router.use(requireModule("HRM", "Interview"));
router.get("/", listInvites);
router.post("/", createInvite);
router.patch("/:id", updateInvite);
router.patch("/:id/cancel", cancelInvite);
router.post("/:id/send-email", sendInviteEmail);
/*
 * The same screening form on WhatsApp, from the sender's own paired account.
 *
 * Beside the email because it is the same act by another route, and on the router's own
 * `HRM / Interview` guard. The WhatsApp module's per-user send limiter is mounted here as it is on
 * every other path that reaches the socket - one paired account, one budget, wherever the send is
 * pressed from.
 */
router.post("/:id/send-whatsapp", requireTemplateOn("INTERVIEW_APPLICATION_INVITE"), whatsappLimits.send, sendInviteWhatsApp);

module.exports = router;
