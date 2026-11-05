const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { checkAnyPermission, checkPermission } = require("../../../middleware/permissionMiddleware");
const { listTemplates, getTemplate, saveTemplate,
  setTemplateEnabled, listLeadWelcomeVerticals, listSwitches, setSwitch } = require("./controller");
const { WISH_SWITCHES } = require("../../../services/messageTemplateSwitches");

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
  // The Attendance Register's Send reads the attendance report, and the register is behind this.
  { module: "HRM", feature: "Attendance Approval", level: "READ" },
  // Create Project's Client Login Ready hands a client their login in the Client Login Credential
  // wording, and only somebody holding User Management makes a client login.
  { module: "ADMIN", feature: "User Management", level: "READ" },
  // The CRD Documents screen's CRD Link Ready hands a client their CRD form in the CRD Document Link
  // wording - without this its users would get the built-in text, silently.
  { module: "PROJECT", feature: "CRD Documents", level: "READ" },
  // The Feedback page's thank-you and issues messages, written from the studio's templates.
  { module: "PROJECT", feature: "Feedback", level: "READ" },
]);
const maySettings = checkPermission("SETTINGS", "Message Template", "READ_WRITE");

/*
 * Each message's ON / OFF (`services/messageTemplateSwitches.js`). Read by whoever reads a message,
 * and by the screens that send one without reading it first - the Interview invite, a client's login
 * from Create Project - so their Send WhatsApp is absent while the message is OFF, and by the Wishes
 * Scheduler. Switched by whoever rewords that message: `SETTINGS / Wishes` for the wishes,
 * `SETTINGS / Message Template` for every other.
 */
const maySeeSwitches = checkAnyPermission([
  { module: "SETTINGS", feature: "Message Template", level: "READ" },
  { module: "SETTINGS", feature: "Wishes", level: "READ" },
  { module: "ACCOUNTS", feature: "Cash Management", level: "READ" },
  { module: "HRM", feature: "Employee Management", level: "READ" },
  { module: "HRM", feature: "Interview", level: "READ" },
  { module: "ADMIN", feature: "User Management", level: "READ" },
  { module: "SALES", feature: "Sales Manager", level: "READ" },
  { module: "PROJECT", feature: "CRD Documents", level: "READ" },
  // The Feedback page sends the client its thank-you or issues message.
  { module: "PROJECT", feature: "Feedback", level: "READ" },
]);
const maySwitch = (req, res, next) => (WISH_SWITCHES.has(String(req.params.key || ""))
  ? checkPermission("SETTINGS", "Wishes", "READ_WRITE")
  : maySettings)(req, res, next);

router.get("/", mayRead, listTemplates);
// New Lead Welcome's wording per vertical: the verticals and their two template keys, for the editor
// alone - only Settings writes these, so reading the list is Settings' Read. Above `/:key`.
router.get("/lead-welcome/verticals", checkPermission("SETTINGS", "Message Template", "READ"), listLeadWelcomeVerticals);
// Above `/:key`, which would otherwise read "switches" as a template key.
router.get("/switches", maySeeSwitches, listSwitches);
router.put("/switches/:key", maySwitch, setSwitch);
router.get("/:key", mayRead, getTemplate);
router.put("/:key", maySettings, saveTemplate);
// The switch on its own, so a message can be turned off without publishing a wording - above nothing
// and behind the same guard as saving one, because switching a message off is changing what the
// studio sends.
router.put("/:key/enabled", maySettings, setTemplateEnabled);

module.exports = router;
