const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const controller = require("./controller");

const router = express.Router();
router.use(protect);
/*
 * HRM → Payroll → Policy Breach, behind its own permission `HRM / Payroll Policy Breach` - kept apart
 * from Recovery's, because a fine for breaking a policy is not something everybody who may read what
 * an employee owes should read.
 *
 * `requireModule` on the whole router: a GET reads the register (and the employee list its form picks
 * from), anything else records, corrects or removes a policy breach, and a route added later is
 * covered the moment it is written.
 */
router.use(requireModule("HRM", "Payroll Policy Breach"));
router.get("/", controller.list);
router.get("/employees", controller.employees);
router.get("/:id/history", controller.history);
router.post("/", controller.create);
router.put("/:id", controller.update);
router.delete("/:id", controller.remove);

module.exports = router;
