const express = require("express");
const multer = require("multer");
const { protect } = require("../../../middleware/authMiddleware");
const { limits, validateParams } = require("./security");
const { status, stream, connect, disconnect, disconnectUser, setUserChatSettings, thread, send, sendMedia, media, markRead, history, act, users, chatSettings, setChatSettings, setChatLimitsHandler } = require("./controller");
const { checkAnyPermission, requireModule } = require("../../../middleware/permissionMiddleware");
const prisma = require("../../../config/db");

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

/*
 * Whether **this** caller's own WhatsApp is linked, and whether they are allowed to link it.
 *
 * Above the CRM Leads guard, and deliberately: it is the same handler as `/session` below, but the
 * question is about the person asking rather than about any lead. HR sending an onboarding invite
 * or a new joiner's login from their own paired account needs to know whether they have one before
 * offering the button - and they hold `HRM / Employee Management`, not `SALES / CRM Leads`, so
 * behind that guard the answer was a 403 and the button could never be drawn honestly.
 *
 * It returns nothing but the caller's own link state and the two switches over it. No lead, no
 * thread, no message and nobody else's session - so there is nothing here for CRM Leads to guard.
 */
router.get("/my-session", limits.read, status);

/*
 * ── Linking your own account, for whoever actually messages anybody ──────────────────────────────
 *
 * Above the CRM Leads guard for the same reason `/my-session` is, and it is the other half of that
 * decision: HR could be told they were not linked and then had nowhere to link. The session is per
 * **user** - credentials live in a folder per user id and `connect` reads `req.user.id` - so neither of
 * these routes touches a lead, a thread or anybody else's account. Pairing somebody else's is not
 * something they can be asked to do.
 *
 * **Not `protect` alone.** Each request is a real registration against a WhatsApp number; WhatsApp
 * refuses codes to an account that registers repeatedly and can ban the number outright. So it answers
 * to whichever of the three jobs actually sends a message: the CRM's chat, the interview register's
 * candidate messages and screening forms, and the repository's onboarding invites and joiner logins.
 * Somebody who holds none of them has nothing to send and no reason to register a number.
 *
 * **Or Allow WhatsApp, on its own.** The tick on somebody's Employee Preference is what puts the
 * "Link your WhatsApp to continue" gate in front of them, and the studio set it deliberately - so it is
 * also enough to link, whatever their roles hold. Without this the gate could demand a link that this
 * route then refused, and somebody holding none of the three features was locked behind a dialog with
 * no way through. The tick is set by an administrator per person, exactly like a grant.
 *
 * The switches over it are unchanged and checked in the handler: the studio-wide one and the per-user
 * one both refuse before a socket is opened.
 */
const mayPairByPermission = checkAnyPermission([
  { module: "SALES", feature: "CRM Leads", level: "READ" },
  { module: "HRM", feature: "Interview", level: "READ" },
  { module: "HRM", feature: "Employee Management", level: "READ" },
]);
async function mayPair(req, res, next) {
  try {
    const account = await prisma.user.findUnique({ where: { id: req.user.id }, select: { whatsappRequired: true } });
    if (account?.whatsappRequired === true) return next();
  } catch (error) {
    // The same answer the permission guards give when they cannot check: a fixed message, never the
    // database's own text.
    console.error("Unable to check WhatsApp access.", error);
    return res.status(500).json({ message: "Unable to check WhatsApp access." });
  }
  return mayPairByPermission(req, res, next);
}
/*
 * **Deliberately not rate limited** - see security.js: the limit was met by the very people it was not
 * aimed at, somebody pressing Refresh code while trying to link. Which means a caller has to bring its
 * own pacing, and there are two now: `WhatsAppChatPanel` and the interview candidate popup's WhatsApp
 * tab. Both pair from a button a person presses, and neither may ever call this on mount.
 */
router.post("/session/connect", mayPair, connect);
router.post("/session/logout", mayPair, limits.logout, disconnect);

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
