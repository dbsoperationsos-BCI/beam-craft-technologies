const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const controller = require("./controller");

/*
 * HRM → Payslip, behind `HRM / My Payslip` (Read): the signed-in employee's own payslips. Nothing in
 * the request names whose - every route answers for the login's own employee record alone.
 */
const router = express.Router();
router.use(protect);
router.use(requireModule("HRM", "My Payslip"));

router.get("/", controller.listMyPayslips);
router.get("/:year/:month/pdf", controller.downloadMyPayslip);

module.exports = router;
