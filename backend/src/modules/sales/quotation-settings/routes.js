const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { checkAnyPermission } = require("../../../middleware/permissionMiddleware");
const { getQuotationSettings, saveQuotationSettings } = require("./controller");

const router = express.Router();

router.use(protect);
/*
 * Two ways in, because two screens read these rates.
 *
 * The Quotation Generator reads them to price with, under `SALES / Quotation Management`, as it
 * always has. Settings -> Quotation Settings -> General is where they are now *edited*, and that
 * screen is an administrator's - it sits beside the brand configuration, on `ADMIN / System
 * Settings` - so the administrator's read and write open them too. A GET needs either Read; a PUT
 * needs either Read / Write.
 */
const level = (access) => checkAnyPermission([
  { module: "SALES", feature: "Quotation Management", level: access },
  { module: "SETTINGS", feature: "Quotation Settings", level: access },
]);
router.get("/", level("READ"), getQuotationSettings);
router.put("/", level("READ_WRITE"), saveQuotationSettings);

module.exports = router;
