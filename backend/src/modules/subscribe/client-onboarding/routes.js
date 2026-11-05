const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { checkPermission } = require("../../../middleware/permissionMiddleware");
const { mountBulkDelete } = require("../../../services/bulkDelete");
const { listInvites, createInvite, cancelInvite, updateInviteContact, sendInvite, updateInvite, deleteInvite, deleteRow, saveSubscription, publishSubscription, discardPending, checkSiteNow, resetAdminPassword, createSiteKey } = require("./controller");

// SUBSCRIBE -> Media Studio Operations / Account Manager: the team's side of client onboarding.
const router = express.Router();
const reads = checkPermission("SUBSCRIBE", "Client Onboarding", "READ");
const writes = checkPermission("SUBSCRIBE", "Client Onboarding", "READ_WRITE");

router.use(protect);
router.get("/invites", reads, listInvites);
router.post("/invites", writes, createInvite);
router.patch("/invites/:id/cancel", writes, cancelInvite);
// View All Invites: correct who a link is for (the link is kept), and email it.
router.patch("/invites/:id/contact", writes, updateInviteContact);
router.post("/invites/:id/send", writes, sendInvite);
// Select all -> Delete, ahead of `/invites/:id` so "bulk" is never read as an id.
mountBulkDelete(router, { path: "/invites/bulk", guard: writes, deleteOne: (id) => deleteRow(id), noun: "client" });
router.put("/invites/:id/subscription", writes, saveSubscription);
// Update site / Discard changes: a live client's saved change goes live as the next version, or is dropped.
router.post("/invites/:id/subscription/publish", writes, publishSubscription);
router.delete("/invites/:id/subscription/pending", writes, discardPending);
// Check now: a read of the site, not a change to the client, so it needs only READ.
router.post("/invites/:id/health-check", reads, checkSiteNow);
// Reset password: a new Admin password at once, shown once in the message to send.
router.post("/invites/:id/reset-password", writes, resetAdminPassword);
// Site key: a new key for the client's server at once, replacing the old; shown once, only its hash kept.
router.post("/invites/:id/site-key", writes, createSiteKey);
router.patch("/invites/:id", writes, updateInvite);
router.delete("/invites/:id", writes, deleteInvite);

module.exports = router;
