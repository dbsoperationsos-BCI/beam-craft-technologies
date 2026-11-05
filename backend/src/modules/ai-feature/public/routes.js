const express = require("express");
const { createRateLimiter, clientIp } = require("../../../middleware/rateLimit");
const c = require("./controller");

/**
 * The guest surface, mounted at /api/public/ai-feature. No JWT: the link's code names the event,
 * and after joining a scoped guest session names the guest. Rate limited at the router because a
 * selfie search is the costliest thing this server does on request.
 */
const router = express.Router();
// Watermarked copies by signed address, ahead of the router's own limit: a gallery page asks for a
// tile and a preview per photo, which would spend the read budget in one scroll. Its own bucket is
// wide, and each address can only ever draw one photo once.
router.get("/w/:mediaId/:hash/:variant", createRateLimiter({ windowMs: 15 * 60 * 1000, max: 5000, keys: (req) => [`ai-event-watermark:${clientIp(req)}`], message: (minutes) => `Too many requests. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` }), c.watermarkedCopy);
router.use(createRateLimiter({ windowMs: 15 * 60 * 1000, max: 600, keys: (req) => [`ai-event-guest:${clientIp(req)}`], message: (minutes) => `Too many requests. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` }));
/*
 * Phone codes. Each limiter below is one bucket shared by every route it is mounted on (a limiter
 * keeps its own counts, so the same key on two limiters would be two buckets). They guard the server
 * per address and are wide enough for a venue whose guests share one network; what an SMS may cost
 * is held in notifications/otp.js - per guest, per number, per event and by dial code.
 *
 * `codeSends` counts a request only when a code was actually sent (the controller sets
 * `res.locals.codeSent`): a join that opens a guest straight away, or a refused request, is given
 * back. That includes `/join`, whose code step sends the first code.
 */
const perMinutes = (minutes) => `Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
const codeSends = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 60, keys: (req) => [{ key: `ai-event-code-send:${clientIp(req)}`, forgiving: true }], forgiveOn: (res) => !res.locals?.codeSent, message: (minutes) => `Too many codes asked for. ${perMinutes(minutes)}` });
const codeChecks = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 100, keys: (req) => [`ai-event-code-check:${clientIp(req)}`], message: (minutes) => `Too many attempts. ${perMinutes(minutes)}` });
const summarySwitch = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 60, keys: (req) => [`ai-event-summary-switch:${clientIp(req)}`], message: (minutes) => `Too many attempts. ${perMinutes(minutes)}` });
router.get("/:code", c.getMeta);
router.post("/:code/join", createRateLimiter({ windowMs: 15 * 60 * 1000, max: 40, keys: (req) => [`ai-event-join:${clientIp(req)}`], message: (minutes) => `Too many attempts. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` }), codeSends, c.join);
router.post("/:code/join/verify", codeChecks, c.joinVerify);
router.post("/:code/join/resend", codeSends, c.joinResend);
router.get("/:code/me", c.me);
router.post("/:code/rsvp", c.rsvp);
router.get("/:code/folders", c.folders);
router.get("/:code/gallery", c.gallery);
router.get("/:code/my-photos", c.myPhotos);
router.post("/:code/my-photos/:matchId/reject", c.rejectMatch);
// The guest's own selfies (up to SELFIE_LIMIT): list, each one's private thumbnail, and remove.
router.get("/:code/selfies", c.listSelfies);
router.get("/:code/selfies/:selfieId/thumbnail", c.selfieThumbnail);
router.delete("/:code/selfies/:selfieId", c.removeSelfie);
router.post("/:code/whatsapp/code", codeSends, c.whatsappCode);
router.post("/:code/whatsapp/verify", codeChecks, c.whatsappVerify);
router.post("/:code/whatsapp/consent", summarySwitch, c.whatsappConsent);
router.post("/:code/whatsapp/stop", summarySwitch, c.whatsappStop);
router.post("/:code/selfie", createRateLimiter({ windowMs: 60 * 60 * 1000, max: 20, keys: (req) => [`ai-event-selfie:${clientIp(req)}`], message: (minutes) => `Too many selfie searches. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` }), c.selfie);
// A guest's photo upload buffers up to two parts in memory and decodes them, so it has a bucket of
// its own rather than sharing the read routes': a phone adding a few hundred photos in an hour is
// welcome; a script posting thousands is not.
router.post("/:code/upload", createRateLimiter({ windowMs: 60 * 60 * 1000, max: 300, keys: (req) => [`ai-event-upload:${clientIp(req)}`], message: (minutes) => `Too many uploads. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` }), c.guestUpload);

module.exports = router;
