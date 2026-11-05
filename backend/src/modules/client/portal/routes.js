const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { createRateLimiter } = require("../../../middleware/rateLimit");
const { getClientPreProduction, saveClientPreProduction, getClientCrd, getClientNotifications, registerPushToken, removePushToken, requireClient, getClientProject, getClientProjects, getClientPackage, getClientPayments, getClientQuotationPdf, getClientQuotationView, getClientReceipt, getClientOffers, ownChatProject, getClientReferrals, createClientReferral, getClientCoins, getClientReviews, clientProjectIds } = require("./controller");

/*
 * The client portal. Every route here must also be listed in `CLIENT_ROUTES` (authMiddleware), or
 * `protect` refuses a client token before it arrives.
 *
 * Guarded by role, not by an IAM permission: a client account holds no role a permission could be
 * granted through, and the portal belongs to the CLIENT role outright - the one case CLAUDE.md's
 * Rule 4 allows a role guard for. Staff are refused (`requireClient`); they read projects through
 * the studio's own screens.
 */
const router = express.Router();

// Per account, across all of a client's devices: the app on a phone and the website on a computer,
// each with a chat open (a check every few seconds) and screens being opened, stay well under it; a
// script looping does not. 60 was met by one client browsing their own app quickly.
const portalLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 180,
  keys: (req) => [`client-portal:${req.user?.id}`],
  message: (minutes) => `Too many requests. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
});

/*
 * The two files are printed by the headless browser (the quotation) or the PDF renderer (receipts),
 * so each fetch is real work on the server. Per account: a client saving their own papers never
 * meets it; a loop cannot keep the renderer busy.
 */
const downloadLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keys: (req) => [`client-portal-download:${req.user?.id}`],
  message: (minutes) => `Too many downloads. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
});

router.use(protect, requireClient, portalLimit);

router.get("/projects", getClientProjects);
router.post("/push-token", registerPushToken);
router.delete("/push-token", removePushToken);
router.get("/project", getClientProject);
router.get("/payments", getClientPayments);
// What the booking includes, shoot by shoot: its services and deliverables.
router.get("/package", getClientPackage);
router.get("/reviews", getClientReviews);
router.get("/notifications", getClientNotifications);
router.get("/crd", getClientCrd);
router.get("/pre-production", getClientPreProduction);
router.patch("/pre-production/:shootId", saveClientPreProduction);
router.get("/quotation/pdf", downloadLimit, getClientQuotationPdf);
// Chat with the studio: the client's chats, a new one on a topic, one chat, and a message in it.
const chatRoutes = require("../chats/controller").clientRoutes(ownChatProject);
router.get("/chats", chatRoutes.list);
router.post("/chats", chatRoutes.start);
router.get("/chats/:id", chatRoutes.read);
router.post("/chats/:id/messages", chatRoutes.reply);
router.get("/offers", getClientOffers);
router.get("/referrals", getClientReferrals);
router.get("/coins", getClientCoins);
router.post("/referrals", createClientReferral);
router.get("/quotation/view", getClientQuotationView);
router.get("/receipt", downloadLimit, getClientReceipt);
// Invitation Cards: the shoots with designs and the client's invitations, one shoot's designs, and
// one invitation of their own - started, read, saved, deleted.
const invitationRoutes = require("../invitations/controller").clientRoutes(clientProjectIds);
router.get("/invitations", invitationRoutes.overview);
router.get("/invitations/designs", invitationRoutes.designs);
router.post("/invitations", invitationRoutes.create);
router.get("/invitations/:id", invitationRoutes.read);
router.put("/invitations/:id", invitationRoutes.update);
router.post("/invitations/:id/unlock", invitationRoutes.unlock);
// Requests about the booking's services and deliverables: the booking's, and a new one.
const requestRoutes = require("../requests/controller").clientRoutes(ownChatProject);
router.get("/requests", requestRoutes.list);
router.post("/requests", requestRoutes.create);
router.delete("/requests/:id", requestRoutes.remove);
router.delete("/invitations/:id", invitationRoutes.remove);

module.exports = router;
