const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const controller = require("./controller");

const router = express.Router();
router.use(protect);
/*
 * Every route here answers for HRM / Employee Attendance: a GET needs Read, anything else Read /
 * Write. `readOnlyReads: false` is deliberately *not* passed — an employee reading their own
 * attendance is the ordinary case, and marking a day is the write.
 *
 * Deciding somebody else's request is a second question that this guard cannot ask, because the
 * approvers are named on the requester's employee record rather than held as a permission: the
 * three Leave Approval slots. So the approve, reject and settings routes are guarded here for
 * access to the module and again in the controller for the right to that particular act — either
 * being a named approver, or holding HRM / Attendance Approval.
 */
router.use(requireModule("HRM", "Employee Attendance"));

// Keep these static routes above anything that takes an identifier.
router.get("/settings", controller.getSettings);
router.put("/settings", controller.updateSettings);
/*
 * The holiday calendar is not here any more. A company-declared holiday is a studio setting rather
 * than an attendance decision about one person, so it is written in Settings -> Holidays behind
 * ADMIN / System Settings - `modules/settings/holidays`. Attendance still *reads* the same table
 * when it judges a day; it simply no longer writes it.
 */

/*
 * Where each branch's office is, which is what turns the coordinates this module has always
 * recorded into a verdict about whether somebody was at work. Reading is open to anyone who may
 * open the screen - the studio's own addresses are not a disclosure - and writing is checked in the
 * controller for Attendance Approval, like the shift and the weekly offs beside it.
 */
router.get("/office-locations", controller.listOfficeLocations);
router.put("/office-locations", controller.saveOfficeLocation);
router.delete("/office-locations/:branchId", controller.deleteOfficeLocation);

/*
 * One capture's photograph. Guarded twice over: by the module permission on this router, and then
 * per photograph in the controller, which admits only the employee it is of or an Attendance
 * Approval holder. Everybody in the studio holds Employee Attendance, so the router guard alone
 * would have made every selfie readable by every colleague.
 */
router.get("/selfie/:eventId", controller.getSelfie);

/*
 * The line shown after a check-in. Several per weekday so the same sentence does not greet somebody
 * every Monday; which one shows is worked out from the date, so the studio agrees on it and it does
 * not shuffle on reload. Writing is checked in the controller for Attendance Approval.
 */
router.get("/quotes", controller.listQuotes);
router.post("/quotes", controller.createQuote);
router.delete("/quotes/:id", controller.deleteQuote);

router.get("/today", controller.getToday);
router.post("/login", controller.markLogin);
router.post("/logout", controller.markLogout);
router.get("/summary", controller.getSummary);

router.get("/requests", controller.listRequests);
router.post("/requests", controller.createRequest);
// Deciding is its own verb rather than a status on a PATCH: an approval and a rejection are things
// an approver did, not edits the requester could have made, and each appends to the event log.
router.post("/requests/:id/approve", controller.approveRequest);
router.post("/requests/:id/reject", controller.rejectRequest);
// The employee's own two verbs: giving back an approved day, and taking back an unanswered ask.
router.post("/requests/:id/cancel", controller.cancelRequest);
router.delete("/requests/:id", controller.withdrawRequest);

/*
 * The studio's register, and one day of it in full.
 *
 * Last, and in this order, because `/:sessionId` would otherwise swallow every static path above
 * it — Express matches in the order routes are declared, so a route taking an identifier belongs
 * after everything that does not. Both are guarded again in the controller: this router answers to
 * `HRM / Employee Attendance`, which the whole studio holds, and reading two hundred colleagues'
 * mornings is not what that permission is for.
 */
router.get("/", controller.getRegister);
router.get("/:sessionId", controller.getRegisterDetail);
// HR changing a record directly, for the two cases this module already told people to ask HR
// about. Attendance Approval only, checked in the controller, and it appends to the audit trail
// rather than quietly replacing what was captured.
router.patch("/:sessionId", controller.editAttendance);

module.exports = router;
