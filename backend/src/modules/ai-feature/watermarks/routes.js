const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { checkPermission, checkAnyPermission } = require("../../../middleware/permissionMiddleware");
const { MODULE, FEATURE, SETTINGS_FEATURE } = require("../shared/permissions");
const c = require("./controller");

/**
 * Watermark Presets, under /api/ai-feature/watermark-presets. Making, changing and deleting a preset
 * is studio configuration, so AI Event Default Settings Read / Write - the permission the defaults
 * panel answers to. Reading the list is also needed by whoever creates or configures an event, so
 * Read on either AI Feature or AI Event Default Settings lets a caller see it; an event is only ever
 * handed a preset id the server checks exists (watermarks/service.assertPreset).
 */
const router = express.Router();
router.use(protect);

const read = checkAnyPermission([{ module: MODULE, feature: FEATURE, level: "READ" }, { module: MODULE, feature: SETTINGS_FEATURE, level: "READ" }]);
const write = checkPermission(MODULE, SETTINGS_FEATURE, "READ_WRITE");

router.get("/", read, c.listPresets);
router.post("/", write, c.createPreset);
// Drawing a text mark changes nothing, and the event forms preview a TEXT preset with it too.
router.post("/text-mark", read, c.textMark);
router.put("/:presetId", write, c.updatePreset);
router.delete("/:presetId", write, c.deletePreset);

module.exports = router;
