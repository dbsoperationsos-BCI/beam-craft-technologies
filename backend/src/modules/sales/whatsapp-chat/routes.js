const express = require("express");
const multer = require("multer");
const { protect } = require("../../../middleware/authMiddleware");
const { limits, validateParams } = require("./security");
const { status, stream, connect, disconnect, disconnectUser, setUserChatSettings, thread, send, sendMedia, media, markRead, history, act, users, chatSettings, setChatSettings, setChatLimitsHandler } = require("./controller");
const { requireModule } = require("../../../middleware/permissionMiddleware");

// Held in memory and passed straight to WhatsApp. The cap is WhatsApp's own limit for a document,
// so nothing is accepted here that it would refuse anyway. One file per request: the endpoint
// sends a single attachment, and accepting more would only give an uploader somewhere to put them.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024, files: 1, fields: 8 },
});

const router = express.Router();

/*
 * Every route here is behind `protect`, and every route that names a lead, a message or a user
 * validates that id before the handler runs. The ids reach database queries and file names, so
 * they are checked once, at the door, rather than in each handler.
 *
 * The rate limits are per user and per action - see security.js for why each is where it is.
 * Pairing is the tightest: WhatsApp refuses to issue codes to an account that registers
 * repeatedly, so a loop on Connect can lock the studio's own number out.
 */
router.use(protect);
// Every route here answers for SALES / CRM Leads: a GET needs Read, anything else Read / Write.
router.use(requireModule("SALES", "CRM Leads"));

router.get("/session", limits.read, status);
router.get("/users", limits.read, users);
router.post("/users/:userId/disconnect", limits.logout, validateParams, disconnectUser);
// One CRM's own switch. Reaching into somebody else's WhatsApp answers to SETTINGS / User
// Settings Read / Write, which the controller checks - the router's CRM Leads guard cannot tell
// a CRM's own session from a colleague's.
router.post("/users/:userId/settings", limits.settings, validateParams, setUserChatSettings);
// The studio-wide switch. Readable by anyone signed in, movable only with User Settings Read /
// Write - which the controller checks, for the same reason.
router.get("/settings", limits.read, chatSettings);
router.post("/settings", limits.settings, setChatSettings);
// The studio's usage limits. Separate from the switch above so a mistyped number cannot be one
// keystroke from disconnecting everybody, and guarded the same way: User Settings Read / Write,
// checked in the controller because the router's CRM Leads guard answers a different question.
router.post("/settings/limits", limits.settings, setChatLimitsHandler);
router.post("/session/connect", connect);
router.post("/session/logout", limits.logout, disconnect);
router.get("/leads/:id/messages", limits.read, validateParams, thread);
/*
 * The open line the panel waits on, so a client's reply reaches the screen as it lands rather than
 * on the next poll.
 *
 * Deliberately not behind `limits.read`. That limiter counts requests in a window, and this is one
 * request that stays open for as long as the panel is - so a CRM opening and closing a handful of
 * leads in a minute would spend the whole budget on connections that are each doing less work than
 * a single poll used to. What holds the number down instead is that a panel opens exactly one, and
 * closes it on the way out.
 */
router.get("/leads/:id/stream", validateParams, stream);
router.post("/leads/:id/messages", limits.send, validateParams, send);
router.post("/leads/:id/attachments", limits.send, validateParams, upload.single("file"), sendMedia);
router.post("/leads/:id/read", limits.read, validateParams, markRead);
router.post("/leads/:id/history", limits.read, validateParams, history);
router.post("/leads/:id/messages/:messageId/actions", limits.send, validateParams, act);
router.get("/messages/:messageId/media", limits.media, validateParams, media);

module.exports = router;
