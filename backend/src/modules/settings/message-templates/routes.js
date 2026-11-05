const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { checkAnyPermission, checkPermission } = require("../../../middleware/permissionMiddleware");
const { listTemplates, getTemplate, saveTemplate } = require("./controller");

const router = express.Router();
router.use(protect);

/*
 * Writing a message is Settings'; reading one is whoever sends it.
 *
 * The wording is a studio setting, so `ADMIN / System Settings` `READ_WRITE` is what changes it -
 * the same permission behind Studio Branding and the rest of the overlay.
 *
 * Reading is deliberately wider, and it has to be: the screens that *send* these messages are not
 * the screens that write them. Accounts records a receipt and needs the receipt's wording; giving
 * the read to `ADMIN / System Settings` alone would leave the accounts clerk holding a record and
 * no message for it - a screen refused the data it exists to show, which is exactly what Rule 4's
 * "a screen may not be given a finer permission than the endpoint it reads" warns about.
 *
 * So each sending module's own permission is named here as it arrives. Cash Management reads the
 * receipt; `HRM / Employee Management` reads the onboarding invite and the login credentials, which
 * are handed over from the employee screens. A message the CRM sends adds `SALES / CRM Leads`.
 */
const mayRead = checkAnyPermission([
  { module: "SETTINGS", feature: "Message Template", level: "READ" },
  { module: "ACCOUNTS", feature: "Cash Management", level: "READ" },
  { module: "HRM", feature: "Employee Management", level: "READ" },
]);
const maySettings = checkPermission("SETTINGS", "Message Template", "READ_WRITE");

router.get("/", mayRead, listTemplates);
router.get("/:key", mayRead, getTemplate);
router.put("/:key", maySettings, saveTemplate);

module.exports = router;
