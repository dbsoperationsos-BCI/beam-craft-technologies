const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const { getSettings, saveSettings, listReferrals, updatePayout, deleteReferral } = require("./controller");
const { deleteReferral: deleteReferralRecord } = require("./service");
const { mountBulkDelete } = require("../../../services/bulkDelete");

const router = express.Router();
router.use(protect);
/*
 * The referral register is its own screen, and its own permission.
 *
 * Who referred whom is typed on the employee form and is guarded there by
 * `HRM / Employee Management`, because it is a fact about the hire. What the studio owes for it and
 * the amount behind that are `HRM / Employee Referral` - the permission that opens the Employee
 * Referral screen these routes serve. An instalment is handed over in one of two ways, each settling
 * it once: as the referrer's Referral Bonus on Payroll → Main Page in its due month (paying that
 * month records it here), or by hand on this screen's ⋮ (`PATCH /payouts/:payoutId`) when it was paid
 * outside payroll - which payroll then leaves out, since it carries only what is still Pending. It was `ACCOUNTS / Payroll Management` while the register was a section inside a settings
 * panel and had no screen of its own to be named after; a permission is granted where the screen it
 * opens lives, so it moved with the screen. Payroll Management now guards nothing.
 *
 * `requireModule` rather than per-route guards: a GET reads the register, anything else changes a
 * figure or hands money over, and a route added here later is covered the moment it is written.
 */
router.use(requireModule("HRM", "Employee Referral"));
router.get("/settings", getSettings);
router.put("/settings", saveSettings);
router.get("/", listReferrals);
// Settling one instalment by hand (cash, a transfer) - READ_WRITE, as every non-GET here.
router.patch("/payouts/:payoutId", updatePayout);
// Delete - READ_WRITE, as every non-GET here; the ticked rows' bulk Delete also needs
// `ADMIN / Table Select All`. `/bulk` before `/:id`, so it is never read as an id.
mountBulkDelete(router, { deleteOne: (id, req) => deleteReferralRecord(id, req.user.id), noun: "referral" });
router.delete("/:id", deleteReferral);

module.exports = router;
