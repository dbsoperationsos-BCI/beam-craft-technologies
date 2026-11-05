const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { checkPermission, requireModule } = require("../../../middleware/permissionMiddleware");
const controller = require("./controller");

const router = express.Router();
router.use(protect);
/*
 * HRM → Payroll → Recovery, behind its own permission `HRM / Payroll Recovery` - kept apart from
 * `HRM / Payroll`, because what each employee owes is not something everybody who can open Payroll
 * (and, later, their own payslip) should read.
 *
 * `requireModule` on the whole router: a GET reads the register (and the employee list its form
 * picks from - the same permission, so the form never asks for more than the screen holds),
 * anything else records, corrects or removes a recovery, and a route added later is covered the
 * moment it is written.
 */
router.use(requireModule("HRM", "Payroll Recovery"));
router.get("/", controller.list);
router.get("/employees", controller.employees);
router.get("/:id/history", controller.history);
router.post("/", controller.create);
/*
 * Undoing Advance Salary's Convert to Recovery hands the advances back to that register, so on top of
 * this module's Read / Write (the router's guard, for a POST) it needs `HRM / Payroll Advance`
 * Read / Write.
 */
router.post("/:id/undo-conversion", checkPermission("HRM", "Payroll Advance", "READ_WRITE"), controller.undoConversion);
router.put("/:id", controller.update);
router.delete("/:id", controller.remove);

module.exports = router;
