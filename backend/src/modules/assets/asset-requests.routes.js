const express = require("express");
const { protect } = require("../../middleware/authMiddleware"); const { requireModule } = require("../../middleware/permissionMiddleware");
const controller = require("./asset-requests.controller");
const router = express.Router();
router.use(protect);

// Raising a request and deciding one are different jobs held by different people: an employee asks
// for an asset, somebody else says yes. Asking is part of managing assets and travels with the
// screen; Asset Request Approval carries the whole queue and the decision.
router.get("/", requireModule("ASSET", "Asset Management"), controller.list);
router.post("/", requireModule("ASSET", "Asset Management"), controller.create);
/*
 * Approving *creates the asset that was asked for*, through the assets module's own creator, with
 * the whole Add Asset form behind it including who will manage it - so it is a second way onto the
 * register besides `Asset Administration`, and it deliberately stays on the approval permission
 * alone. Deciding a request is the job; being handed the register is not a separate question the
 * studio wanted to answer twice. Whoever may approve may therefore add, by approving.
 */
router.post("/:requestId/approve", requireModule("ASSET", "Asset Request Approval"), controller.approve);
router.post("/:requestId/reject", requireModule("ASSET", "Asset Request Approval"), controller.reject);
module.exports = router;
