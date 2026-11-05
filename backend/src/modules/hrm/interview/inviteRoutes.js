const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const { createInvite, listInvites, updateInvite, cancelInvite, sendInviteEmail } = require("./invites");

/**
 * The application invites, behind the same permission as the register they write into: sending a
 * candidate the form is a step of working the candidate, so `HRM / Interview` covers it - a GET
 * reads the list, everything else raises, corrects, cancels or sends one.
 */
const router = express.Router();
router.use(protect);
router.use(requireModule("HRM", "Interview"));
router.get("/", listInvites);
router.post("/", createInvite);
router.patch("/:id", updateInvite);
router.patch("/:id/cancel", cancelInvite);
router.post("/:id/send-email", sendInviteEmail);

module.exports = router;
