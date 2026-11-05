const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { leads, list } = require("./controller");
const { requireModule } = require("../../../middleware/permissionMiddleware");

const router = express.Router();
router.use(protect);
// Every route here answers for SALES / CRM Leads: a GET needs Read, anything else Read / Write.
router.use(requireModule("SALES", "CRM Leads"));
// Keep this static route ahead of anything that could read as an identifier.
router.get("/leads", leads);
// Read only. Scheduling and cancelling stay on the lead's own endpoints, which own the
// Google Calendar side of a meeting.
router.get("/", list);

module.exports = router;
