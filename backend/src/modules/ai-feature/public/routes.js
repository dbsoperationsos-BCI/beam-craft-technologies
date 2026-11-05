const express = require("express");
const { createRateLimiter, clientIp } = require("../../../middleware/rateLimit");
const c = require("./controller");

/**
 * The guest surface, mounted at /api/public/ai-feature. No JWT: the link's code names the event,
 * and after joining a scoped guest session names the guest. Rate limited at the router because a
 * selfie search is the costliest thing this server does on request.
 */
const router = express.Router();
router.use(createRateLimiter({ windowMs: 15 * 60 * 1000, max: 600, keys: (req) => [`ai-event-guest:${clientIp(req)}`], message: (minutes) => `Too many requests. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` }));
router.get("/:code", c.getMeta);
router.post("/:code/join", createRateLimiter({ windowMs: 15 * 60 * 1000, max: 40, keys: (req) => [`ai-event-join:${clientIp(req)}`], message: (minutes) => `Too many attempts. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` }), c.join);
router.get("/:code/me", c.me);
router.post("/:code/rsvp", c.rsvp);
router.get("/:code/folders", c.folders);
router.get("/:code/gallery", c.gallery);
router.get("/:code/my-photos", c.myPhotos);
router.post("/:code/my-photos/:matchId/reject", c.rejectMatch);
router.post("/:code/selfie", createRateLimiter({ windowMs: 60 * 60 * 1000, max: 20, keys: (req) => [`ai-event-selfie:${clientIp(req)}`], message: (minutes) => `Too many selfie searches. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` }), c.selfie);
router.post("/:code/upload", c.guestUpload);

module.exports = router;
