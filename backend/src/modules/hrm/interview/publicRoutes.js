const express = require("express");
const { createPublicLinkLimiter } = require("../../../middleware/rateLimit");
const { getPublicInvite, verifyPublicInvite, submitPublicInvite } = require("./invites");

/**
 * The public application form, answered by token rather than by a session - exactly as the
 * onboarding form's routes are, and for the same two reasons stated there.
 */
const router = express.Router();

// Short codes as well as tokens resolve here, so the code space must not be enumerable. Only a
// miss is counted, so opening many real links in a row is never refused; a scanner is.
router.use(createPublicLinkLimiter("interview-apply"));

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
