const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { health, chatStream, analyzeLead, analyzeCall, summarize, chat, crmChat, crmChatStream } = require("./controller");
const { requireModule } = require("../../../middleware/permissionMiddleware");

const router = express.Router();
// The same JWT as the rest of the CRM. These read a lead's whole history - remarks, calls,
// transcripts, WhatsApp - and none of that is public.
router.use(protect);

// Health says whether the model is running and nothing about any lead, so it sits above the
// permission check: the panel has to be able to explain itself to someone who cannot use it.
router.get("/health", health);

/*
 * Everything below reads CRM data, so it answers to the same permission as the CRM itself.
 *
 * This router had only `protect` - any signed-in user, including one with no CRM access at all,
 * could read a lead's remarks, calls and WhatsApp through it, or ask for a summary of the whole
 * pipeline. The panel is hidden from them on the client, but a hidden button is not a permission
 * check.
 */
router.use(requireModule("SALES", "CRM Leads"));
router.post("/analyze-lead", analyzeLead);
router.post("/analyze-call", analyzeCall);
router.post("/summarize", summarize);
router.post("/chat", chat);
// The same answer as /chat, delivered as it is generated.
router.post("/chat/stream", chatStream);

// The module rather than one lead: pipeline, follow-ups, sources, conversions.
router.post("/crm/chat", crmChat);
router.post("/crm/chat/stream", crmChatStream);

module.exports = router;
