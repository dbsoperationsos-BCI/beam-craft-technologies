const prisma = require("../../../config/db");
const iamService = require("../../../services/iam.service");
const { TYPES } = require("../../../services/notifications");
const { localIsoDate } = require("./attendanceRules");
const clientPush = require("../../../services/clientPush");

/**
 * The bell's side of the requests: a leave, permission or comp-off waiting on somebody's answer.
 *
 * Told to the approvers named **on that request** and nobody else - the same list `canDecide` lets
 * answer it, read off its approval rows rather than the employee record, which HR may have changed
 * since. Each approver is reached through the login linked to their employee record; an approver
 * with no login, or an inactive one, has no bell to ring. The requester is never told about their
 * own request, even if a data-entry slip names them as its approver.
 *
 * The notice goes when it stops being true: an approver's own once they have answered, and every
 * approver's once the request is settled, withdrawn or cancelled - a veto from one of three settles
 * a leave, and the other two must not be left holding a request there is no longer any answering.
 *
 * Never throws. The request is already raised or decided when this runs, and a bell that could not
 * be written is not a reason to tell anybody that failed.
 */

const ENTITY_TYPE = "HRM_ATTENDANCE_REQUEST";
const TYPE_LABELS = {
  LEAVE: "Leave",
  PERMISSION: "Permission",
  ON_DUTY: "On duty / travel",
  CORRECTION: "Checkout correction",
  OUTSIDE_LOCATION: "Outside location",
  COMP_OFF: "Comp-off",
  COMP_OFF_CREDIT: "Comp-off credit",
  // Attendance Regularization (once called Correction) - stored under its first name.
  INCORRECT_LOGIN: "Attendance Regularization",
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `2026-09-20` as `20 Sep 2026`, read off the key so no timezone can shift the day. */
function displayDay(value) {
  const key = value instanceof Date ? localIsoDate(value) : String(value || "").slice(0, 10);
  const [year, month, day] = key.split("-").map(Number);
  return year && MONTHS[month - 1] && day ? `${day} ${MONTHS[month - 1]} ${year}` : "";
}

/** When the request is for: one day, a range, or a day with its hours for a permission. */
function whenOf(request) {
  const from = displayDay(request.fromDate);
  const to = displayDay(request.toDate);
  const day = to && to !== from ? `${from} – ${to}` : from;
  const hours = request.fromTime && request.toTime ? ` · ${request.fromTime}–${request.toTime}` : "";
  return `${day}${hours}`;
}

/**
 * Where the notice opens: the Request section of Employee Attendance for somebody who holds that
 * screen, and HRM → Request for somebody who holds only `HRM / Requests`. Either lands on the
 * requests with "Waiting for me" open, which the page chooses whenever something waits on them.
 */
async function linkFor(userId) {
  const attendance = await iamService.hasPermission(userId, "HRM", "Employee Attendance", "READ").catch(() => false);
  return attendance ? "/hrm/employee-attendance?section=request" : "/hrm/requests";
}

/** The notice for one request, from the request as `service.requestInclude` loads it. */
function waitingNotice(request) {
  const who = request.employee?.employeeName || "An employee";
  const kind = TYPE_LABELS[request.type] || "A";
  return {
    type: TYPES.REQUEST_WAITING,
    title: `${kind} request from ${who}`.slice(0, 200),
    body: [whenOf(request), "Waiting for your approval"].filter(Boolean).join(" · "),
    entityType: ENTITY_TYPE,
    entityId: String(request.id),
  };
}

/** The active logins behind these approver employee ids, bar the requester's own. */
async function approverLogins(request, employeeIds) {
  const ids = [...new Set((employeeIds || []).map(Number).filter((id) => id && id !== Number(request.employeeId)))];
  if (!ids.length) return [];
  return prisma.user.findMany({ where: { linkedEmployeeId: { in: ids }, status: "ACTIVE" }, select: { id: true } });
}

/** Tells each approver still to answer `request` that it is waiting on them. Answers how many were told. */
async function notifyApprovers(request) {
  try {
    const pending = (request.approvals || []).filter((row) => (row.decision ?? "PENDING") === "PENDING");
    const users = await approverLogins(request, pending.map((row) => row.approverEmployeeId));
    if (!users.length) return 0;
    const notice = waitingNotice(request);
    const data = [];
    for (const user of users) data.push({ userId: user.id, ...notice, link: await linkFor(user.id) });
    const { count } = await prisma.notification.createMany({ data });
    for (const row of data) clientPush.pushToStaff([row.userId], row);
    return count;
  } catch (error) {
    console.warn("Unable to tell the approvers about a request:", error?.message || error);
    return 0;
  }
}

/**
 * Takes the request's notice off the bell - of these approvers only, or of everybody when no list
 * is given. Deleted rather than marked read: it pointed at work that no longer exists.
 */
async function clearApproverNotices(requestId, approverEmployeeIds = null) {
  try {
    const where = { type: TYPES.REQUEST_WAITING, entityType: ENTITY_TYPE, entityId: String(requestId) };
    if (approverEmployeeIds) {
      const ids = approverEmployeeIds.map(Number).filter(Boolean);
      if (!ids.length) return;
      const users = await prisma.user.findMany({ where: { linkedEmployeeId: { in: ids } }, select: { id: true } });
      if (!users.length) return;
      where.userId = { in: users.map((user) => user.id) };
    }
    await prisma.notification.deleteMany({ where });
  } catch (error) {
    console.warn("Unable to clear a request's notifications:", error?.message || error);
  }
}

module.exports = { ENTITY_TYPE, TYPE_LABELS, notifyApprovers, clearApproverNotices, waitingNotice, whenOf };
