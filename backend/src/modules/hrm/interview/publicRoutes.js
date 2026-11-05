const express = require("express");
const { createRateLimiter, clientIp } = require("../../../middleware/rateLimit");
const { getPublicInvite, verifyPublicInvite, submitPublicInvite } = require("./invites");

/**
 * The public application form, answered by token rather than by a session - exactly as the
 * onboarding form's routes are, and for the same two reasons stated there.
 */
const router = express.Router();

// Short codes as well as tokens resolve here, so the code space must not be enumerable: one real
// candidate filling the form fits in a fraction of this allowance; a scanner does not.
router.use(createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 60,
  keys: (req) => [`interview-apply:${clientIp(req)}`],
  message: (minutes) => `Too many requests. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
}));

// Never cached: a 410 is cacheable by default, and an invite's state changes under a link that
// is meant to be opened more than once.
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store, must-revalidate");
  res.set("Pragma", "no-cache");
  next();
});

router.get("/invites/:token", getPublicInvite);
router.post("/invites/:token/verify", verifyPublicInvite);
router.post("/invites/:token/submit", submitPublicInvite);

module.exports = router;
