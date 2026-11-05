const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const { listHolidays, createHoliday, updateHoliday, deleteHoliday } = require("./controller");

const router = express.Router();
router.use(protect);

/*
 * The studio's declared holidays answer for `ADMIN / System Settings`, like everything else the
 * Settings overlay writes: reading the list needs Read, declaring, moving or removing one needs
 * Read / Write. `requireModule` follows the method, so a route added here later is guarded the
 * moment it is written.
 *
 * Deliberately *not* the wider read the message templates take. Nothing outside Settings asks this
 * endpoint for the list: the attendance rules read the same table directly to decide what a day
 * is, and the studio calendar reads it through its own source — so the employee who needs to *see*
 * a holiday is served by those, and never by a permission on this router. Whoever may open the
 * screen that changes them is the only audience here.
 */
router.use(requireModule("SETTINGS", "Holidays"));

router.get("/", listHolidays);
router.post("/", createHoliday);
router.put("/:id", updateHoliday);
router.delete("/:id", deleteHoliday);

module.exports = router;
