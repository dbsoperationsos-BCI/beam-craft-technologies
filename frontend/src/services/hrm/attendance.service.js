import { apiRequest } from "@/services/api/client";

/**
 * Employee Attendance.
 *
 * Every one of these used to be a `window.localStorage` read or write, which made an attendance
 * record device-specific, erasable with the site data, and editable by the person it judged. The
 * screen now asks the server for all of it — including the statuses and totals, which are decided
 * against the studio's shift, weekly offs and holiday calendar rather than a cutoff hardcoded in
 * the browser.
 */

const base = "/api/hrm/attendance";

/** The working-day rules, plus whether this login may change them. */
export function getAttendanceSettings() {
  return apiRequest(`${base}/settings`);
}

export function saveAttendanceSettings(payload) {
  return apiRequest(`${base}/settings`, { method: "PUT", body: JSON.stringify(payload) });
}

/*
 * Declaring a holiday is not here. The studio's holidays are a studio setting rather than an
 * attendance one: they are written in Settings → Holidays through
 * `services/settings/holidays.service.js`, behind ADMIN / System Settings. Attendance still reads
 * them - the server applies them when it judges a day - it simply no longer writes them.
 */

/**
 * Today as the server sees it: the open or finished session, the employee behind the login, and
 * the rules. Asked on every load rather than remembered, so a second device shows the same day.
 */
export function getTodayAttendance() {
  return apiRequest(`${base}/today`);
}

/**
 * Starts one live capture, `type` being `CHECK_IN` or `CHECK_OUT`. Asked for when the camera opens;
 * the `captureToken` it returns goes back with the selfie and position, and expires after
 * `ttlSeconds`, so a photo that was not taken just now on this screen is refused.
 */
export function startAttendanceCapture(type) {
  return apiRequest(`${base}/capture-token`, { method: "POST", body: JSON.stringify({ type }) });
}

/**
 * Marks the day's login. The timestamp is the server's — a clock the person being judged can set
 * is not evidence of when they arrived — so none is sent. `faceVerified` reports whether a real
 * face detector confirmed the selfie, which the server records rather than trusts.
 */
export function markAttendanceLogin(payload) {
  return apiRequest(`${base}/login`, { method: "POST", body: JSON.stringify(payload) });
}

/**
 * Marks the day's logout. Carries a live selfie, a live position and a capture token exactly as the
 * login does — ending a day is as much a claim about where somebody was as starting one.
 */
export function markAttendanceLogout(payload) {
  return apiRequest(`${base}/logout`, { method: "POST", body: JSON.stringify(payload) });
}

/**
 * What logging out now would mark today as - `{ status, workedMinutes }`, or null with no open login -
 * for the Logout box to warn before the logout.
 */
export function getLogoutPreview() {
  return apiRequest(`${base}/logout-preview`);
}

/**
 * Break In: starts a break now, inside today's logged-in day. Carries the same evidence a login does -
 * `{ selfie, faceVerified, captureToken, latitude, longitude, accuracy }`, the token from
 * `startAttendanceCapture("BREAK_START")`. Answers with today's break summary.
 */
export function startAttendanceBreak(payload) {
  return apiRequest(`${base}/break/start`, { method: "POST", body: JSON.stringify(payload) });
}

/**
 * Break Off: ends the running break, with a live selfie and position like Break In (token from
 * `startAttendanceCapture("BREAK_END")`). Answers `{ ended, today }` - this break, and the day's summary.
 */
export function endAttendanceBreak(payload) {
  return apiRequest(`${base}/break/end`, { method: "POST", body: JSON.stringify(payload) });
}

/**
 * Where each branch's office is, and how far from it a day may be marked. Reading is open to
 * anybody who may open the screen; `canManage` says whether this login may change them.
 */
/**
 * The studio's register for one day: one row per active employee, whether or not they marked
 * anything. A list of sessions could never answer "who has not checked in today", which is the
 * first question this screen is opened to ask.
 */
export function getAttendanceRegister({ date, branchId, status, search } = {}) {
  const params = new URLSearchParams();
  if (date) params.set("date", date);
  if (branchId) params.set("branchId", branchId);
  if (status) params.set("status", status);
  if (search) params.set("search", search);
  const query = params.toString();
  return apiRequest(`${base}${query ? `?${query}` : ""}`);
}

/**
 * The studio's attendance over a range - the administrator's Dashboard.
 *
 * The register answers one day and the summary answers one person; this answers the studio over a
 * stretch of days, which is the question an administrator opens the page with. Administrators only,
 * refused by the server to anybody else.
 */
export function getAttendanceOverview({ from, to, branchId, employeeIds } = {}) {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (branchId) params.set("branchId", branchId);
  // One comma-separated list rather than a repeated parameter, which the server refuses.
  if (employeeIds?.length) params.set("employeeIds", employeeIds.join(","));
  const query = params.toString();
  return apiRequest(`${base}/overview${query ? `?${query}` : ""}`);
}

/**
 * Settings → Employee → Payroll rules → Attendance calculator: `{ cycleDay, paybackDay }` - the day the pay cycle
 * turns over (25: the 25th to the 25th) and the day of the following month salary is paid out, each
 * 1 to 31. Administrators only; the server checks.
 */
export function getPayPeriod() {
  return apiRequest(`${base}/calculator/period`);
}

export function savePayPeriod({ cycleDay, paybackDay }) {
  return apiRequest(`${base}/calculator/period`, { method: "PUT", body: JSON.stringify({ cycleDay, paybackDay }) });
}

/**
 * The Attendance Register's daily WhatsApp report: the named group and how the last send went, this
 * person's own WhatsApp (to pair it), and naming or clearing the group. Reading needs the register;
 * the rest Read / Write on HRM / Attendance Approval - the server checks both.
 */
export function getAttendanceReportGroup() {
  return apiRequest(`${base}/report-group`);
}

export function getAttendanceReportWhatsappSession() {
  return apiRequest(`${base}/report-group/session`);
}

export function connectAttendanceReportWhatsapp() {
  return apiRequest(`${base}/report-group/session/connect`, { method: "POST" });
}

/** Administrator only: the plain-text name each sender's own WhatsApp is searched for at send time. */
export function setAttendanceReportGroupName(groupName) {
  return apiRequest(`${base}/report-group`, { method: "PUT", body: JSON.stringify({ groupName }) });
}

/** When the daily report is sent: `"HH:MM"` (24-hour, India time), or `""` for the default 10:00 am. */
export function setAttendanceReportSendAt(sendAt) {
  return apiRequest(`${base}/report-group/send-at`, { method: "PUT", body: JSON.stringify({ sendAt }) });
}
// The report's switch: off keeps the time, the senders and the group, and sends nothing.
export function setAttendanceReportEnabled(enabled) {
  return apiRequest(`${base}/report-group/enabled`, { method: "PUT", body: JSON.stringify({ enabled }) });
}

export function unlinkAttendanceReportGroup() {
  return apiRequest(`${base}/report-group`, { method: "DELETE" });
}

/** Who can be picked as the report's Priority 1: active employees with Allow WhatsApp ticked. */
export function listAttendanceReportSenderCandidates() {
  return apiRequest(`${base}/report-group/senders/candidates`);
}

/** Who sends it: `{ mode, senderUserId, userIds }` - Sender or Rotation, the one sender, the rotation order. */
export function setAttendanceReportSenders(input) {
  return apiRequest(`${base}/report-group/senders`, { method: "PUT", body: JSON.stringify(input) });
}

/** One person's day in full: both captures, where they were taken, and any correction about it. */
export function getAttendanceDay(sessionId) {
  return apiRequest(`${base}/${sessionId}`);
}

export function getAttendanceOfficeLocations() {
  return apiRequest(`${base}/office-locations`);
}

export function saveAttendanceOfficeLocation(payload) {
  return apiRequest(`${base}/office-locations`, { method: "PUT", body: JSON.stringify(payload) });
}

export function removeAttendanceOfficeLocation(branchId) {
  return apiRequest(`${base}/office-locations/${branchId}`, { method: "DELETE" });
}

/**
 * Where an attendance photo is shown from.
 *
 * A path, not a link to storage: attendance selfies are the one kind of image in this application
 * that is never served from the public bucket. The endpoint admits the employee it is of and
 * Attendance Approval holders, and nothing else — so the server decides, rather than the browser
 * being handed a URL that works for anybody who has it.
 *
 * Shown through `AuthImage`, which sends the staff token with the request. A bare `<img src>` sends
 * no `Authorization` header and `protect` reads nothing else, so a guarded picture put straight into
 * an image tag never loads.
 */
export function attendanceSelfiePath(eventId) {
  return eventId ? `${base}/selfie/${eventId}` : null;
}

/**
 * One day as a Correction reads it: `{ date, currentStatus, message, options }` - the day's status as
 * the server classifies it (null, with `message` saying why, where there is nothing to correct) and
 * what it may be changed to.
 */
export function getCorrectionDay(date) {
  return apiRequest(`${base}/requests/correction-day?date=${encodeURIComponent(date)}`);
}

/** One row per calendar day in the range, with the totals and the target the range actually owes. */
export function getAttendanceSummary({ from, to, totals = false } = {}) {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  // `totals` asks for the figures without a row per day. It is what makes a range longer than two
  // years answerable at all, and what stops a year of dashboard being 365 rows nobody reads.
  if (totals) params.set("totals", "1");
  const query = params.toString();
  return apiRequest(`${base}/summary${query ? `?${query}` : ""}`);
}

/**
 * `scope: "own"` is what this employee raised; `scope: "team"` is what they were named an approver
 * on, or everything for an Attendance Approval holder. The server decides which from the token.
 */
export function getAttendanceRequests({ scope = "own", type } = {}) {
  const params = new URLSearchParams({ scope });
  if (type) params.set("type", type);
  return apiRequest(`${base}/requests?${params.toString()}`);
}

/**
 * The logout pressed after the login's 18 hours: taken as an Extra Time request for the Permission
 * Approver, with `date` the day that was never logged out of and `reason` the employee's own words.
 * The day stays Absent until it is approved; approving writes the logout onto it.
 */
export function sendExtraTime({ date, reason }) {
  return apiRequest(`${base}/extra-time`, { method: "POST", body: JSON.stringify({ date, reason }) });
}

/** Who this login's own requests go to, keyed by request type: `{ LEAVE: [{ id, employeeName, employeeCode }], ... }`. */
export function getMyAttendanceApprovers() {
  return apiRequest(`${base}/requests/approvers`);
}

/**
 * The weekly offs and declared holidays this login worked a full day on and can still claim a comp-off for, newest first:
 * `{ date, weekday, holidayName, loginAt, logoutAt, workedMinutes, workedLabel }` each.
 */
/** This login's breaks over `{ from, to }`, one row each, with the range's count and total. */
export function getAttendanceBreaks({ from, to } = {}) {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  return apiRequest(`${base}/breaks?${params.toString()}`);
}

export function getMyCompOffOptions() {
  return apiRequest(`${base}/requests/comp-off-options`);
}

/** How many permissions this login has used in `date`'s month or pay cycle, against Attendance Rules' limit. */
export function getMyPermissionUsage({ date, excludeRequestId } = {}) {
  const params = new URLSearchParams({ date });
  if (excludeRequestId) params.set("excludeRequestId", String(excludeRequestId));
  return apiRequest(`${base}/requests/permission-usage?${params.toString()}`);
}

/** This login's Casual Leave balance, and - given `from` and `to` - what a leave over them would come to. */
export function getMyLeaveBalance({ from, to, excludeRequestId } = {}) {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (excludeRequestId) params.set("excludeRequestId", String(excludeRequestId));
  const query = params.toString();
  return apiRequest(`${base}/requests/leave-balance${query ? `?${query}` : ""}`);
}

export function createAttendanceRequest(payload) {
  return apiRequest(`${base}/requests`, { method: "POST", body: JSON.stringify(payload) });
}

/**
 * `grantedDays` is how much a **comp-off credit** is granted - 0, 0.5, 1 … up to the days worked.
 * Left out of the body for every other kind of request, and for an approver answering from a screen
 * that does not ask: the server then leaves its column alone, which means "the whole run", as
 * approving has always meant.
 */
export function approveAttendanceRequest(id, remarks, grantedDays) {
  return apiRequest(`${base}/requests/${id}/approve`, {
    method: "POST",
    body: JSON.stringify({ remarks, ...(grantedDays === undefined ? {} : { grantedDays }) }),
  });
}

export function rejectAttendanceRequest(id, remarks) {
  return apiRequest(`${base}/requests/${id}/reject`, { method: "POST", body: JSON.stringify({ remarks }) });
}

/** An approver returning it to the raiser to be fixed. The remark is required: it is the whole point. */
export function sendBackAttendanceRequest(id, remarks) {
  return apiRequest(`${base}/requests/${id}/send-back`, { method: "POST", body: JSON.stringify({ remarks }) });
}

/**
 * The raiser's correction. The same body as raising one, and every answer is cleared on the server:
 * an approval of the old dates is not an approval of the new ones, so all the approvers are asked
 * again. It replaced "Apply again", which left two rows describing one ask.
 */
export function editAttendanceRequest(id, payload) {
  return apiRequest(`${base}/requests/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
}

/** The raiser pulling it out of the queues, to edit or to delete. It replaced Withdraw and Cancel. */
export function revertAttendanceRequest(id) {
  return apiRequest(`${base}/requests/${id}/revert`, { method: "POST" });
}

/** Marks it Deleted. The row stays and the raiser goes on seeing it; nothing is removed. */
export function deleteAttendanceRequest(id) {
  return apiRequest(`${base}/requests/${id}`, { method: "DELETE" });
}
