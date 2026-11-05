const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { checkPermission } = require("../../../middleware/permissionMiddleware");
const { status, report } = require("./controller");

const router = express.Router();
// The credential behind these reports belongs to the server rather than to whoever opens the page,
// but the call data itself is the CRM's - who rang whom, and for how long - so being signed in is
// not enough to read it. Both routes ask for READ: a report is a query that happens to be posted,
// because it takes a shaped body, and posting one changes nothing (CLAUDE.md Rule 4).
router.use(protect);
const readsCallData = checkPermission("SALES", "CRM Leads", "READ");

router.get("/status", readsCallData, status);
// One route for all six reports: they take the same shaped body and differ only in which rules
// apply, which the service decides. A route each would be six copies of this line.
router.post("/reports/:report", readsCallData, report);

module.exports = router;
