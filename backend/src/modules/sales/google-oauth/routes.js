const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { callback, disconnect, connection, pickerToken, spreadsheetTabs, start } = require("./controller");
const { requireModule } = require("../../../middleware/permissionMiddleware");

const router = express.Router();

router.get("/callback", callback);
router.use(protect);
// Every route here answers for SALES / CRM Leads: a GET needs Read, anything else Read / Write.
router.use(requireModule("SALES", "CRM Leads"));
router.post("/start", start);
router.get("/connection", connection);
router.delete("/connection", disconnect);
router.get("/picker-token", pickerToken);
router.get("/spreadsheets/:spreadsheetId/tabs", spreadsheetTabs);

module.exports = router;
