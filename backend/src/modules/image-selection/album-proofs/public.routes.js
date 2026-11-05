const express = require("express");
const controller = require("./public.controller");
const { createRateLimiter, clientIp } = require("../../../middleware/rateLimit");

// The client's proof API: no login — the token names the proof, the PIN (rate limited, bcrypt)
// opens a scoped JWT session, and every route re-resolves the publication so a revoked or expired
// link stops answering immediately. Sequential database ids never appear here.
const router = express.Router({ mergeParams: true });

// The lookup that opens a link is limited per address: plenty for a client reloading their page,
// far too few to walk the short codes looking for live ones.
const lookupLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 300,
  keys: (req) => [`album-proof-lookup:${clientIp(req)}`],
  message: (minutes) => `Too many requests. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
});

router.get("/:token", lookupLimiter, controller.meta);
router.post("/:token/verify-pin", controller.verifyPin);
router.get("/:token/proof", controller.proof);
router.post("/:token/corrections", controller.addCorrection);
router.patch("/:token/corrections/:correctionId", controller.editCorrection);
router.delete("/:token/corrections/:correctionId", controller.deleteCorrection);
router.post("/:token/submit-corrections", controller.submitCorrections);
router.post("/:token/approve", controller.approve);

module.exports = router;
