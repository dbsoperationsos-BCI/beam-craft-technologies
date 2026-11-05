const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const { options, dashboard, report } = require("./controller");

const router = express.Router();
router.use(protect);
/*
 * `SALES / Reports & Analytics` - the reports' own permission, matching the menu entry that opens
 * them. They answered for `CRM Leads` until then, so a manager could not be given the numbers
 * without the board of leads behind them, and Role Management offered no row to say otherwise.
 *
 * The rows are narrowed all the same: `reportScope` in the controller resolves the studio's one
 * data rule against whichever permission guarded the request, so holding this and not `CRM Leads`
 * reports on the leads the reader may see and no others. Every route here is a GET, which
 * `requireModule` grants on Read - reading a report is not a privilege beyond opening the screen.
 */
router.use(requireModule("SALES", "Reports & Analytics"));

// Above the ":report" route, which would otherwise read either of these as the name of a report.
router.get("/options", options);
router.get("/dashboard", dashboard);
router.get("/:report", report);

module.exports = router;
