const express = require("express");
const c = require("./controller");
const { protect } = require("../../../middleware/authMiddleware");
const { checkPermission } = require("../../../middleware/permissionMiddleware");
const { createRateLimiter, clientIp } = require("../../../middleware/rateLimit");

/**
 * Download Edited, both steps. Mounted in server.js ahead of the Image Selection project router,
 * whose guards (session, and Project Management read/write for any POST) cover every
 * /api/image-selection path:
 * - the plan is a POST that only reads, so it carries its own session guard and AI Editing READ -
 *   a viewer of the bay may download its edits;
 * - the file cannot carry the session header, so the short-lived ticket the plan answered with is
 *   the credential.
 * The ticket is signed with a key of its own and names the project, the person and each photo's
 * edit version; the file route is rate limited per address and takes nothing but the ticket.
 */
const router = express.Router({ mergeParams: true });
// Per address, generous enough for a studio sharing one connection; a burst of archives is also
// capped server-wide (download.js, 429).
const downloadLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 200,
  keys: (req) => [`ai-editing-download:${clientIp(req)}`],
  message: (minutes) => `Too many downloads. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
});
// A plan checks storage for every photo asked about, so it is limited per person.
const planLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 120,
  keys: (req) => [`ai-editing-download-plan:${req.user?.id || clientIp(req)}`],
  message: (minutes) => `Too many download requests. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
});
router.post("/downloads/plan", protect, planLimiter, checkPermission("IMAGE_SELECTION", "AI Editing", "READ"), c.downloadPlan);
router.post("/downloads/archive", downloadLimiter, express.urlencoded({ extended: false, limit: "512kb" }), c.downloadArchive);

module.exports = router;
