const express = require("express");
const { createPublicLinkLimiter } = require("../../../middleware/rateLimit");
const { getPublicInvite, verifyPublicInvite, submitPublicInvite } = require("./controller");

const router = express.Router();

// These routes are public and now resolve short codes as well as 64-hex tokens, so they must not
// be enumerable: without a throttle a script could walk the code space for live invites. Only a
// miss is counted, so HR opening many real links in a row is never refused; a scanner is.
router.use(createPublicLinkLimiter("onboarding"));

/*
 * Never cached, and this one is not a precaution - it is a bug that was found in the wild.
 *
 * An invite that cannot be opened answers **410 Gone**, and a 410 is cacheable by default: with no
 * `Cache-Control` on it, the browser is free to decide for itself how long it stays fresh. So a
 * candidate who submitted their form, opened their link and saw "This onboarding invite has already
 * been submitted" had that answer cached - and when HR sent the submission back to them, the link
 * went on showing the same sentence. The invite was open; their browser was reading its own copy of
 * the refusal, and nothing the studio did could reach them. The 200 needs it just as much: an
 * invite's state changes underneath a link that is meant to be opened more than once.
 *
 * `no-store` rather than `no-cache`, which still permits a stored copy and only requires it to be
 * revalidated; nothing here should be written down at all. The ETag goes with it, since a stored
 * response is what an ETag exists to revalidate.
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
