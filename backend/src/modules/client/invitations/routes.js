const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { checkPermissions } = require("../../../middleware/permissionMiddleware");
const { createPublicLinkLimiter, createRateLimiter } = require("../../../middleware/rateLimit");
const { teamOverview, saveTemplate, removeTemplate, saveSong, removeSong, publicInvitation, invitationCard, invitationVideo, teamInvitations, markPaid, markPaidMany, setTerms, removeInvitations } = require("./controller");

// Client Management -> Invitation Cards, on its own permission: Read to see the designs and songs,
// Read / Write to change them.
const router = express.Router();
router.use(protect);
const level = (access) => checkPermissions([{ module: "CLIENT", feature: "Invitation Cards", level: access }]);
router.get("/", level("READ"), teamOverview);
router.post("/designs", level("READ_WRITE"), saveTemplate);
router.put("/designs/:id", level("READ_WRITE"), saveTemplate);
router.delete("/designs/:id", level("READ_WRITE"), removeTemplate);
router.post("/songs", level("READ_WRITE"), saveSong);
router.put("/songs/:id", level("READ_WRITE"), saveSong);
router.delete("/songs/:id", level("READ_WRITE"), removeSong);
// The clients' invitations from priced designs, and recording one paid.
router.get("/invitations", level("READ"), teamInvitations);
// Several at once, before `/:id`, which would otherwise take "paid" for an invitation.
router.post("/invitations/paid", level("READ_WRITE"), markPaidMany);
router.post("/invitations/delete", level("READ_WRITE"), removeInvitations);
router.post("/invitations/:id/paid", level("READ_WRITE"), markPaid);
router.put("/invitations/:id/terms", level("READ_WRITE"), setTerms);

// The guest's page: public by design - the 16-character token in the link is what opens it, and
// the limiter counts only the links that open nothing.
const publicRouter = express.Router();
publicRouter.use(createPublicLinkLimiter("invitation"));
// The picture is drawn by a headless browser, so each one is real work: a few a minute per network.
const cardLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keys: (req) => [`invitation-card:${req.ip}`],
  message: (minutes) => `Too many downloads. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
});
publicRouter.get("/:token/card.png", cardLimit, invitationCard);
// A video is a recording and an encode - heavier still, so fewer.
const videoLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keys: (req) => [`invitation-video:${req.ip}`],
  message: (minutes) => `Too many video downloads. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
});
publicRouter.get("/:token/video.mp4", videoLimit, invitationVideo);
publicRouter.get("/:token", publicInvitation);

module.exports = { router, publicRouter };
