const express = require("express");
const multer = require("multer");
const { protect } = require("../../middleware/authMiddleware");
const { health, chat, chatStream, voice, confirm, tools, conversations, removeConversation } = require("./controller");

/*
 * Held in memory and handed straight to ffmpeg - a dictated question is seconds long and never
 * needs to touch this server's disk beyond the temporary file the transcriber makes and removes.
 *
 * 10MB is minutes of speech at the bitrate a browser records, and far below what would hurt.
 */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

/**
 * The central AI gateway's routes.
 *
 * Everything is behind `protect`, including health: the health response lists which modules the
 * caller may open, which is a description of their access rather than a status page.
 *
 * There is no `requireModule` here, and that is deliberate rather than an omission. This one router
 * serves every module, so the module being asked for is part of the request - a fixed middleware
 * could only ever check one of them. The check happens in `buildAccessContext`, against the module
 * the caller actually asked for, using the same `iamService` the middleware uses.
 */
const router = express.Router();
router.use(protect);

router.get("/health", health);
// What this session may do, filtered the same way the model's own list is.
router.get("/tools", tools);
router.post("/chat", chat);
// The same answer, delivered as it is written.
router.post("/chat/stream", chatStream);
// Speech to text, through the studio's own whisper rather than a browser service.
router.post("/voice", upload.single("audio"), voice);
// Carries out a change the assistant proposed, against the token issued for it.
router.post("/confirm", confirm);
// Threads, always scoped to the caller and the module they name.
router.get("/conversations", conversations);
router.delete("/conversations/:id", removeConversation);

module.exports = router;
