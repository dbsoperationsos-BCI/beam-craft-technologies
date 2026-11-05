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
 * Marks the day's login. The timestamp is the server's — a clock the person being judged can set
 * is not evidence of when they arrived — so none is sent. `faceVerified` reports whether a real
 * face detector confirmed the selfie, which the server records rather than trusts.
 */
export function markAttendanceLogin(payload) {
  return apiRequest(`${base}/login`, { method: "POST", body: JSON.stringify(payload) });
}

/**
 * Marks the day's logout. Carries a selfie and a position like the login does — ending a day is as
 * much a claim about where somebody was as starting one.
 */
export function markAttendanceLogout(payload = {}) {
  return apiRequest(`${base}/logout`, { method: "POST", body: JSON.stringify(payload) });
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

/** One person's day in full: both captures, where they were taken, and any correction about it. */
export function getAttendanceDay(sessionId) {
  return apiRequest(`${base}/${sessionId}`);
}

/** The lines shown after a check-in, grouped by weekday. `canManage` gates editing them. */
export function getAttendanceQuotes() {
  return apiRequest(`${base}/quotes`);
}

export function addAttendanceQuote(payload) {
  return apiRequest(`${base}/quotes`, { method: "POST", body: JSON.stringify(payload) });
}

export function removeAttendanceQuote(id) {
  return apiRequest(`${base}/quotes/${id}`, { method: "DELETE" });
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
 * Attendance Approval holders, and nothing else — so this is put in an `<img src>` and the server
 * decides, rather than the browser being handed a URL that works for anybody who has it.
 */
export function attendanceSelfieUrl(eventId) {
  if (!eventId) return null;
  return `${process.env.NEXT_PUBLIC_API_URL || ""}${base}/selfie/${eventId}`;
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

export function createAttendanceRequest(payload) {
  return apiRequest(`${base}/requests`, { method: "POST", body: JSON.stringify(payload) });
}

export function approveAttendanceRequest(id, remarks) {
  return apiRequest(`${base}/requests/${id}/approve`, { method: "POST", body: JSON.stringify({ remarks }) });
}

export function rejectAttendanceRequest(id, remarks) {
  return apiRequest(`${base}/requests/${id}/reject`, { method: "POST", body: JSON.stringify({ remarks }) });
}

/** Giving back an approved day. The server refuses one that has already started. */
export function cancelAttendanceRequest(id, remarks) {
  return apiRequest(`${base}/requests/${id}/cancel`, { method: "POST", body: JSON.stringify({ remarks }) });
}

/** Taking back an ask nobody has answered. A decided request is never deleted. */
export function withdrawAttendanceRequest(id) {
  return apiRequest(`${base}/requests/${id}`, { method: "DELETE" });
}
