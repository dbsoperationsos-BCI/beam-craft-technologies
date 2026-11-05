const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const { getConsent, setConsent, listModels } = require("./controller");

// The studio's culling-training consent and the model registry's read-only view sit with the
// rest of Image Selection's studio settings, under the same permission: reading needs Read,
// changing the consent Read / Write.
const router = express.Router();
router.use(protect);
router.use(requireModule("SETTINGS", "Organization"));
router.get("/consent", getConsent);
router.patch("/consent", setConsent);
router.get("/models", listModels);

module.exports = router;
