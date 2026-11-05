const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { cancel, list, schedule } = require("./controller");
const { requireModule } = require("../../../middleware/permissionMiddleware");

const router = express.Router();
router.use(protect);
// Every route here answers for SALES / CRM Leads: a GET needs Read, anything else Read / Write.
router.use(requireModule("SALES", "CRM Leads"));
router.get("/", list);
// A meeting with no lead, from the Calendar's Add Meet (Read / Write). A lead's own meetings are
// still scheduled and cancelled on the lead's endpoints.
router.post("/", schedule);
router.delete("/:id", cancel);

module.exports = router;
