const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const { getSettings, saveSettings, listReferrals, updatePayout } = require("./controller");

const router = express.Router();
router.use(protect);
/*
 * The referral register is its own screen, and its own permission.
 *
 * Who referred whom is typed on the employee form and is guarded there by
 * `HRM / Employee Management`, because it is a fact about the hire. What the studio owes for it,
 * the amount behind that, and the act of marking an instalment paid are all
 * `HRM / Employee Referral` - the permission that opens the Employee Referral screen these routes
 * serve. It was `ACCOUNTS / Payroll Management` while the register was a section inside a settings
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
router.patch("/payouts/:payoutId", updatePayout);

module.exports = router;
