const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { list } = require("./controller");

const router = express.Router();
router.use(protect);

/*
 * Signing in is the whole of the guard on *opening* the calendar, and that is deliberate.
 *
 * It used to answer for SALES / CRM Leads, which described where the screen sat rather than what
 * it holds: the diary is reached from the Calendar icon on the topbar, everybody in the studio has
 * a day, and the studio's declared holidays are the same fact for all of them. A permission on
 * this router meant an employee could not see that the office is shut on the 20th.
 *
 * Nothing is widened by that. What is *drawn* is decided source by source in the service, against
 * each module's own Read permission - so a viewer who may not open Project Management still never
 * sees a shoot, and a viewer holding no module permission at all gets the holidays and an
 * otherwise empty month rather than a 403. Opening the calendar has never been a way to read a
 * module, and it is still not one; see `service.js`.
 */
router.get("/", list);

module.exports = router;
