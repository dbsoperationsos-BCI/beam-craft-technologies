const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const controller = require("./controller");

const router = express.Router();
router.use(protect);
/*
 * Accounts Manager's Due / Overdue / On Hold tabs, under the screen's own ACCOUNTS / Cash Management:
 * a GET needs Read, anything else Read / Write - which is also what recording the cash that clears a
 * payment needs.
 */
router.use(requireModule("ACCOUNTS", "Cash Management"));

router.get("/", controller.listPayments);
// Above "/:id": a project's payments still open, for Add Entry's "Settles payment".
router.get("/project/:projectId/open", controller.openForProject);
router.get("/:id", controller.getPayment);
router.patch("/:id/hold", controller.setHold);
router.post("/:id/clear", controller.clearPayment);
router.post("/:id/partial", controller.partPayment);

module.exports = router;
