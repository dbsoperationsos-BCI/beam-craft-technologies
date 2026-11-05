const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { checkPermission, requireModule } = require("../../../middleware/permissionMiddleware");
const { mountBulkDelete } = require("../../../services/bulkDelete");
const controller = require("./controller");
const payslipTemplate = require("../../settings/template-settings/controller");

const router = express.Router();
router.use(protect);
/*
 * HRM → Payroll → Main Page and Settings → Payroll rules (with its extra columns), behind their own permission
 * `HRM / Payroll Register` - what each employee is paid is not for everybody who can open Payroll.
 *
 * `requireModule` on the whole router: a GET reads the register, the payment options or the rules;
 * anything else brings a month up to date, changes or removes a row or changes the rules - and a route
 * added later is covered the moment it is written.
 */
router.use(requireModule("HRM", "Payroll Register"));
router.get("/", controller.list);
router.get("/options", controller.options);
router.get("/period", controller.period);
router.get("/rules", controller.getRules);
router.put("/rules", controller.saveRules);
// Settings → Payroll rules → the payslip template's preview and its sample PDF. Above `/:id`.
router.get("/payslip-template", payslipTemplate.getPayslipTemplate);
router.get("/payslip-template/sample.pdf", payslipTemplate.downloadSamplePayslip);
// Settings → Payroll rules → Generate payslips on. Above `/:id`.
// Settings → Payroll rules → Payroll starts from. Above `/:id`.
router.get("/payroll-start", controller.getPayrollStart);
router.put("/payroll-start", controller.savePayrollStart);
router.get("/payslip-generation", controller.getPayslipGeneration);
router.put("/payslip-generation", controller.savePayslipGeneration);
// Settings → Payroll rules → Hold salary during notice. Above `/:id`.
router.get("/notice-hold", controller.getNoticeHold);
router.put("/notice-hold", controller.saveNoticeHold);
// Settings → Payroll rules → Extra columns. Above `/:id`, which would otherwise read "components" as a row.
router.get("/components", controller.listComponents);
router.post("/components", controller.createComponent);
router.put("/components/:id", controller.updateComponent);
router.delete("/components/:id", controller.removeComponent);
// The month brought up to date as the Main Page opens it - in place of Generate and Refresh.
router.post("/sync", controller.sync);
/*
 * Skip, and undoing it, change Payroll → Advance Salary, Recovery or Policy Breach as well: beside this
 * module's Read / Write (the router's guard), they need that module's Read / Write. Any other `:kind`
 * is not here.
 */
const SKIP_FEATURES = { advance: "Payroll Advance", recovery: "Payroll Recovery", "policy-breach": "Payroll Policy Breach" };
const writesSkipped = (req, res, next) => {
  const feature = SKIP_FEATURES[req.params.kind];
  if (!feature) return res.status(404).json({ message: "This payroll row could not be found." });
  return checkPermission("HRM", feature, "READ_WRITE")(req, res, next);
};
router.post("/:id/skip/:kind", writesSkipped, controller.skip);
router.delete("/:id/skip/:kind", writesSkipped, controller.undoSkip);
/*
 * The ticked rows, from the Main Page's selection: Mark Paid with one payment, and Delete through the
 * single Remove (a paid row is refused and left ticked). Both are selections, so both ask for
 * `ADMIN / Table Select All` as well - `mountBulkDelete` adds it for the delete. Above `/:id`.
 */
router.post("/mark-paid", checkPermission("ADMIN", "Table Select All", "READ_WRITE"), controller.markPaid);
mountBulkDelete(router, { deleteOne: (id, req) => controller.removeRow(req, id), noun: "payroll row" });
router.post("/:id/restore", controller.restore);
router.put("/:id", controller.update);
router.delete("/:id", controller.remove);

module.exports = router;
