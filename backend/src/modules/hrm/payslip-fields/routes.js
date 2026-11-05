const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { checkAnyPermission, checkPermission } = require("../../../middleware/permissionMiddleware");
const controller = require("./controller");

/*
 * Settings → Payroll rules → Edit Payslip's Personal details and PF details (`/api/hrm/payslip-fields`).
 * Reading them is the payroll rules' or the employee record's - Settings lists them, Edit Employee →
 * Payslip Details asks for them; changing them is `HRM / Payroll Register` Read / Write, from
 * somebody who reaches every branch (the service checks that).
 */
const router = express.Router();
router.use(protect);

const reads = checkAnyPermission([
  { module: "HRM", feature: "Payroll Register", level: "READ" },
  { module: "HRM", feature: "Employee Management", level: "READ" },
]);
const writes = checkPermission("HRM", "Payroll Register", "READ_WRITE");

// The payslip's original items - above `/:id`, so "built-in" is not read as a detail's id.
router.get("/built-in", reads, controller.listBuiltIns);
router.put("/built-in", writes, controller.setBuiltIn);
router.get("/", reads, controller.listFields);
router.post("/", writes, controller.createField);
router.put("/:id", writes, controller.updateField);
router.delete("/:id", writes, controller.removeField);

module.exports = router;
