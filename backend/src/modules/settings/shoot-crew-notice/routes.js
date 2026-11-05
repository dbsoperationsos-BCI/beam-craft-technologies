const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const controller = require("./controller");

const router = express.Router();
router.use(protect);

/*
 * Settings → Project Management → Shoot crew notice, behind `SETTINGS / Shoot Crew Notice`: Read to
 * see whether each arm is on and what is waiting, Read / Write to switch either. `requireModule`
 * follows the method, so a route added here later is guarded the moment it is written.
 *
 * The vendor arm answers to the **same** permission as the crew arm, deliberately: who sends each is
 * read off the project rather than chosen here, so neither is more privileged than the other and a
 * second Settings permission would only be one more thing to grant. The eight wordings - two for the
 * crew, six for a vendor - are message templates and answer to `SETTINGS / Message Template` on their
 * own router.
 */
router.use(requireModule("SETTINGS", "Shoot Crew Notice"));

router.get("/", controller.getNotice);
router.put("/enabled", controller.setEnabled);
router.put("/vendor/enabled", controller.setVendorEnabled);

module.exports = router;
