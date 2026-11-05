const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { checkPermission, checkPermissions, requireModule } = require("../../../middleware/permissionMiddleware");
const controller = require("./controller");

const router = express.Router();
router.use(protect);
/*
 * Releasing the money an approved request asked for, from Accounts Manager → Pending.
 *
 * **Above the router-wide guard on purpose.** Authorising a spend and releasing it are different
 * jobs held by different people, and `requireModule` below asks Read / Write on Payment Request
 * Approval of every non-GET — which is the approver's level, so mounting this under it would have
 * meant only an approver could pay, and the separation would have existed in one direction only.
 *
 * So this names its own pair: **Read** on Payment Request, because the queue it is reached
 * from is that permission's list, and **Read / Write** on Cash Management, because what it writes is
 * cash entries. Nothing here reads `req.permission`, which is the one thing `requireModule` would
 * have set.
 */
router.post(
  "/:id/pay",
  checkPermissions([
    { module: "ACCOUNTS", feature: "Payment Request", level: "READ" },
    { module: "ACCOUNTS", feature: "Cash Management", level: "READ_WRITE" },
  ]),
  controller.payRequest,
);
/*
 * Deciding a request - approving, rejecting, or correcting one so it can be decided - answers to
 * `ACCOUNTS / Payment Request Approver`, and **above** the router-wide guard on purpose.
 *
 * That guard asks Read / Write on `Payment Request` of every non-GET, which is the
 * permission that lets somebody **raise** a request. Mounting these under it would mean an approver
 * had to be able to raise requests too, which is exactly the pairing the two permissions exist to
 * separate: one person asking for money and allowing it was one tick in Role Management.
 *
 * Correcting sits with deciding, not with raising. The figure an approver is looking at should not
 * change under them between reading it and deciding it; a requester who got their own ask wrong
 * withdraws it and raises the one they meant.
 */
const decides = checkPermission("ACCOUNTS", "Payment Request Approver", "READ_WRITE");
router.post("/:id/approve", decides, controller.approveRequest);
router.post("/:id/reject", decides, controller.rejectRequest);
// The controller refuses anything but PENDING, because approving has already written a cash entry
// from the amount.
router.patch("/:id", decides, controller.updateRequest);

// Everything else here answers for ACCOUNTS / Payment Request: a GET needs Read, anything
// else Read / Write. The module lives under hrm/ for historical reasons; what it is about is money.
router.use(requireModule("ACCOUNTS", "Payment Request"));
// Keep these static routes above the identifier routes below it.
router.get("/options", controller.options);
/*
 * The expense line's shoot picker, typed into: every shoot, not the page `options` opens on. Its own
 * route rather than a bigger `options` because the answer depends on what is typed - see
 * `searchShoots`, and the 786 shoots of 986 the old cap put out of reach.
 */
router.get("/shoots", controller.searchShoots);
router.get("/vendors", controller.searchVendors);
/*
 * Asset Management → Vendors → Vendor Payments reads this: the studio's bills to its vendors and
 * what has been paid against each. On this router rather than in the assets module on purpose - who
 * may read what the studio is paying is this permission's answer, not Vendor Management's, and the
 * Vendors screen offers the view only to somebody who holds it.
 */
router.get("/vendor-payments", controller.vendorPayments);
router.get("/", controller.listRequests);
router.post("/", controller.createRequest);
router.get("/:id", controller.getRequest);
// Withdrawing is the requester taking their own ask back, so it answers to the permission that let
// them raise it - the router-wide guard above - and the controller then refuses anybody else's row.
router.delete("/:id", controller.withdrawRequest);

module.exports = router;
