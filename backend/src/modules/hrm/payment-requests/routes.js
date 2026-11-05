const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const controller = require("./controller");

const router = express.Router();
router.use(protect);
// Every route here answers for ACCOUNTS / Payment Request Approval: a GET needs Read, anything else
// Read / Write. The module lives under hrm/ for historical reasons; what it is about is money.
router.use(requireModule("ACCOUNTS", "Payment Request Approval"));
// Keep this static route above the identifier routes below it.
router.get("/options", controller.options);
router.get("/", controller.listRequests);
router.post("/", controller.createRequest);
router.get("/:id", controller.getRequest);
// Editing is only ever a correction to a request nobody has decided yet: the controller refuses
// anything but PENDING, because approving has already written a cash entry from the amount.
router.patch("/:id", controller.updateRequest);
// Deciding is its own verb rather than a status field on a PATCH: approving writes a cash entry and
// rejecting demands a reason, so neither is an edit of the request the requester could have made.
router.post("/:id/approve", controller.approveRequest);
router.post("/:id/reject", controller.rejectRequest);
router.delete("/:id", controller.withdrawRequest);

module.exports = router;
