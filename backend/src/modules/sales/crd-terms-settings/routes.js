const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const { getSettings, saveSettings } = require("./controller");

const router = express.Router();

router.use(protect);
// Reuses SALES / CRD Documents rather than a permission of its own — this is the same screen's
// settings, not a separate concern. A GET needs Read, anything else Read / Write.
// The terms behind the CRD form, so it answers for the same permission the documents do -
// `PROJECT / CRD Documents` since migration 20260909130000.
router.use(requireModule("PROJECT", "CRD Documents"));
router.get("/", getSettings);
router.patch("/", saveSettings);

module.exports = router;
