const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { checkAnyPermission, requireModule } = require("../../../middleware/permissionMiddleware");
const controller = require("./controller");
const { mountBulkDelete } = require("../../../services/bulkDelete");
const { isSuperAdmin } = require("../../../services/administrator");

const router = express.Router();
router.use(protect);

/*
 * The requests, which two screens read: Employee Attendance's Leave, Permission and Approvals tabs
 * (`HRM / Employee Attendance`) and HRM → Request (`HRM / Requests`). Either permission opens them.
 * Read is enough to look **and** to raise, edit, revert or delete one's own request - asking for
 * leave is something every employee does, and the service holds each of those verbs to the caller's
 * own employee record. Approving and rejecting are Read as well: the controller allows them only to the
 * approvers named on that request. Declared above the router-wide guard below, which admits
 * Employee Attendance alone.
 */
const REQUEST_PERMISSIONS = [["HRM", "Employee Attendance"], ["HRM", "Requests"]];
const requestsFor = (level) => checkAnyPermission(REQUEST_PERMISSIONS.map(([module, feature]) => ({ module, feature, level })));
const readRequests = requestsFor("READ");
const writeRequests = requestsFor("READ_WRITE");
const requestGuard = (req, res, next) => (req.method === "GET" || req.method === "HEAD" ? readRequests : writeRequests)(req, res, next);

router.get("/requests", requestGuard, controller.listRequests);
// Who this login's own requests will go to, for the Raise Request form. Before `/requests/:id`
// would matter, and its own path rather than a query on the list, which answers with requests.
router.get("/requests/approvers", requestGuard, controller.listMyApprovers);
// The worked Sundays and holidays this login can still claim a comp-off for, for the same form.
router.get("/requests/comp-off-options", requestGuard, controller.listMyCompOffOptions);
// This login's own Casual Leave balance, and what a leave over given dates would come to - for the
// same form. Its own employee only (`requireEmployee`), like the two above.
router.get("/requests/leave-balance", requestGuard, controller.getLeaveBalance);
// How many permissions this login has used in a date's month or pay cycle, against Attendance Rules'
// limit - for the Permission form. Its own employee only, like the balance above.
router.get("/requests/permission-usage", requestGuard, controller.getPermissionUsage);
// A Correction's day as the server reads it - Current Status and the Change To options. Before
// `/requests/:id`, like the two above.
router.get("/requests/correction-day", requestGuard, controller.getCorrectionDay);
// One's own request: Read is enough (see above). The controller raises it for the caller alone.
router.post("/requests", readRequests, controller.createRequest);
// Deciding is its own verb rather than a status on a PATCH: an approval and a rejection are things
// an approver did, not edits the requester could have made, and each appends to the event log.
// Read, like raising: who may decide is not a permission level but whether this login is named on
// the request's own approval rows, which the controller checks (`service.canDecide`) and refuses
// everybody else - administrators included. Holding Read / Write on top of being named added
// nothing but a way for a named approver to be shown a queue they could not answer.
router.post("/requests/:id/approve", readRequests, controller.approveRequest);
router.post("/requests/:id/reject", readRequests, controller.rejectRequest);
// The third answer: back to the raiser to be fixed, with the reason they are shown. Any approver on
// the list, while the request is not approved.
router.post("/requests/:id/send-back", readRequests, controller.sendBackRequest);
// The employee's own two verbs: giving back an approved day, and taking back an unanswered ask.
// Read, like raising: each refuses any request that is not the caller's own.
// The raiser correcting their own request: the same body as raising one, and everybody asked again.
router.patch("/requests/:id", readRequests, controller.updateRequest);
// The raiser's own two verbs: taking a request back out of the queues, and marking it deleted.
router.post("/requests/:id/revert", readRequests, controller.revertRequest);
/*
 * Deleting a selection of requests outright, for a Super Admin alone - either kind (the account's
 * own SUPER_ADMIN column, or the SUPER_ADMIN role). A permission cannot say "Super Admin only",
 * since any role can be granted any permission, so the guard asks the account itself. On top of
 * Write on the requests and `ADMIN / Table Select All`, which `mountBulkDelete` adds. Above
 * `/requests/:id`, which would otherwise read "bulk" as a request id.
 *
 * The single-row Delete below is unchanged: it marks one's own request Deleted and keeps it.
 */
const superAdminOnly = async (req, res, next) => {
  try {
    if (await isSuperAdmin(req.user?.id)) return next();
    return res.status(403).json({ message: "Only a Super Admin can delete requests permanently." });
  } catch (error) {
    console.error("Unable to check Super Admin access.", error);
    return res.status(500).json({ message: "Unable to check Super Admin access." });
  }
};
mountBulkDelete(router, { path: "/requests/bulk", guard: [writeRequests, superAdminOnly], deleteOne: controller.hardDeleteRequestRecord, noun: "request" });
router.delete("/requests/:id", readRequests, controller.deleteRequest);
// Read by the raise dialog on either screen for the permission time limit. Writing stays below.
router.get("/settings", requestGuard, controller.getSettings);

/*
 * Settings → Employee → Payroll rules → Attendance calculator. Above the module guard below: the page belongs to
 * holders of `HRM / Attendance Calculator` whatever else their roles hold, and the controller admits them alone -
 * it reads anybody's month and salary.
 */
router.get("/calculator/employees", controller.listCalculatorEmployees);
// The page's pay period and payback day. Read to see them, Read / Write to change them.
router.get("/calculator/period", controller.getPayPeriod);
router.put("/calculator/period", controller.savePayPeriod);
router.get("/calculator", controller.getCalculation);

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

// Keep these static routes above anything that takes an identifier. `GET /settings` is above.
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

router.get("/today", controller.getToday);
// Opening the camera for a check-in or check-out; the token it returns must come back with the capture.
router.post("/capture-token", controller.startCapture);
router.post("/login", controller.markLogin);
router.post("/logout", controller.markLogout);
// The logout pressed after the login's 18 hours: taken as an Extra Time request for the Permission
// Approver, with the day left Absent until they answer it.
router.post("/extra-time", controller.markExtraTime);
// What logging out now would mark today as, for the Logout box's warning.
router.get("/logout-preview", controller.getLogoutPreview);
// A break inside the logged-in day: Break In, then Break Off, which answers with the summary.
router.post("/break/start", controller.startBreak);
router.post("/break/end", controller.endBreak);
// This login's breaks over a range - the Self Dashboard's Break Summary table.
router.get("/breaks", controller.getBreaks);
router.get("/summary", controller.getSummary);
// The `/requests` routes are above the router-wide guard, open to either permission.

/*
 * The register's daily WhatsApp report: the named group and how the last send went, each eligible
 * sender's own WhatsApp for pairing (name resolution happens per sender at send time, not here), and
 * naming or clearing the group. Static paths, so above the `/:sessionId` routes below. Checked in the
 * controller - reading on the register's own permission, the rest on Read / Write of it.
 */
router.get("/report-group", controller.getReportGroup);
router.get("/report-group/session", controller.getReportGroupSession);
router.post("/report-group/session/connect", controller.connectReportGroupSession);
router.put("/report-group", controller.setReportGroupName);
router.put("/report-group/send-at", controller.setReportSendAt);
router.put("/report-group/enabled", controller.setReportEnabled);
router.delete("/report-group", controller.unlinkReportGroup);
// Priority 1, 2 and 3 of the report's senders: who can be picked, and setting them.
router.get("/report-group/senders/candidates", controller.listReportSenderCandidates);
router.put("/report-group/senders", controller.setReportSenders);

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
// The administrator's Dashboard: the studio's attendance over a range. Above `/:sessionId` with
// the rest of the static paths, and administrators only, checked in the controller.
router.get("/overview", controller.getOverview);
router.get("/:sessionId", controller.getRegisterDetail);
// HR changing a record directly, for the two cases this module already told people to ask HR
// about. Attendance Approval only, checked in the controller, and it appends to the audit trail
// rather than quietly replacing what was captured.
router.patch("/:sessionId", controller.editAttendance);

module.exports = router;
