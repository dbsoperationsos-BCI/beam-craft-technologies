const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { health, chatStream, analyzeLead, analyzeCall, summarize, chat, crmChat, crmChatStream } = require("./controller");
const { checkPermission } = require("../../../middleware/permissionMiddleware");

const router = express.Router();
// The same JWT as the rest of the CRM. These read a lead's whole history - remarks, calls,
// transcripts, WhatsApp - and none of that is public.
router.use(protect);

// Health says whether the model is running and nothing about any lead, so it sits above the
// permission check: the panel has to be able to explain itself to someone who cannot use it.
router.get("/health", health);

/*
 * Everything below reads CRM data, so it answers to the same permission as the CRM itself - at
 * READ, because Nebula only answers: nothing here writes. The routes are POSTs only because the
 * question travels in the body, so `requireModule` (which reads a POST as a write) would have
 * asked READ_WRITE of somebody who may only look. Which leads, within that, is decided per request
 * by the board's own data scope (`controller.js`).
 */
router.use(checkPermission("SALES", "CRM Leads", "READ"));
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
