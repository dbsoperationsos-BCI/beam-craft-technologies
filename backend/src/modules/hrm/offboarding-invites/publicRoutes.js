const express = require("express");
const { createPublicLinkLimiter } = require("../../../middleware/rateLimit");
const { getPublicInvite, verifyPublicInvite, submitPublicInvite } = require("./controller");

const router = express.Router();

// Public, and resolving short codes as well as 64-hex tokens, so they must not be enumerable:
// without a throttle a script could walk the code space for live forms. Only a miss is counted, so
// HR opening several real links in a row is never refused; a scanner is.
router.use(createPublicLinkLimiter("offboarding"));

/*
 * Never cached, for the reason the onboarding form beside this one learned the hard way: a form that
 * cannot be opened answers **410 Gone**, and a 410 is cacheable by default - so somebody who saw
 * "this form has already been submitted" had that answer written down by their browser, and a form
 * HR raised again went on showing the same sentence. The 200 needs it just as much: the form's state
 * changes under a link that is meant to be opened more than once.
 */
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store, must-revalidate");
  res.set("Pragma", "no-cache");
  next();
});

router.get("/invites/:token", getPublicInvite);
router.post("/invites/:token/verify", verifyPublicInvite);
router.post("/invites/:token/submit", submitPublicInvite);

module.exports = router;
