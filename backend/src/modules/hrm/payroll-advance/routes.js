const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { checkPermission, requireModule } = require("../../../middleware/permissionMiddleware");
const controller = require("./controller");

const router = express.Router();
router.use(protect);
/*
 * HRM → Payroll → Advance Salary, behind its own permission `HRM / Payroll Advance` - kept apart from
 * `HRM / Payroll`, because what each employee has been advanced is not something everybody who can
 * open Payroll should read.
 *
 * `requireModule` on the whole router: a GET reads the register (and the employee list its form
 * picks from - the same permission, so the form never asks for more than the screen holds),
 * anything else records, corrects or removes an advance, and a route added later is covered the
 * moment it is written.
 */
router.use(requireModule("HRM", "Payroll Advance"));
router.get("/", controller.list);
router.get("/employees", controller.employees);
router.get("/:id/history", controller.history);
router.post("/", controller.create);
/*
 * Convert to Recovery writes to Payroll → Recovery as well: on top of this module's Read / Write (the
 * router's guard, for a POST), it needs `HRM / Payroll Recovery` Read / Write. Undoing it is offered
 * on the recovery, under the Recovery router, the other way round.
 */
const writesRecovery = checkPermission("HRM", "Payroll Recovery", "READ_WRITE");
router.post("/convert-to-recovery", writesRecovery, controller.convertToRecovery);
router.put("/:id", controller.update);
router.delete("/:id", controller.remove);

module.exports = router;
