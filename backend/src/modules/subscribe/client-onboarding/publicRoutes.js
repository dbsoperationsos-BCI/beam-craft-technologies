const express = require("express");
const { createRateLimiter, clientIp } = require("../../../middleware/rateLimit");
const { getPublicInvite, submitPublicInvite } = require("./controller");

// The company's onboarding link: no session, so rate-limited and never cached, like /api/onboarding.
const router = express.Router();

router.use(createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 60,
  keys: (req) => [`client-onboarding:${clientIp(req)}`],
  message: (minutes) => `Too many requests. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
}));

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store, must-revalidate");
  res.set("Pragma", "no-cache");
  next();
});

router.get("/invites/:token", getPublicInvite);
router.post("/invites/:token/submit", submitPublicInvite);

module.exports = router;
