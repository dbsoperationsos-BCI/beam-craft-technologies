const express = require("express");
const { createRateLimiter, clientIp } = require("../../../middleware/rateLimit");
const { getSiteSubscription } = require("./siteApi");

// A client's server reading its subscription: no session - the site key is the credential - so rate-limited
// and never cached. By address only: a bucket per X-Site would let anyone lock a real site out by naming it.
// A site reads every 5 minutes and before a sign-in at most once a minute; 300 leaves room for several on one server.
const router = express.Router();

router.use(createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 300,
  keys: (req) => [`client-site:${clientIp(req)}`],
  message: (minutes) => `Too many requests. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
}));

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  res.set("Pragma", "no-cache");
  next();
});

router.get("/subscription", (req, res) => getSiteSubscription(req, res));

module.exports = router;
