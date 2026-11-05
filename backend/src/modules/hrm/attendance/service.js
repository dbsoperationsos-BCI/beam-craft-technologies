const prisma = require("../../../config/db");
const iamService = require("../../../services/iam.service");
const {
  BLOCKING_STATUSES,
  DAY_KINDS,
  attendanceDayStatus,
  isAttendedStatus,
  dayKindFor,
  eachDateInRange,
  formatDurationMinutes,
  leaveDayCount,
  localIsoDate,
  permissionMinutes,
  requestDisplayStatus,
  calendarDay,
  targetMinutesForRange,
  workingDaysInRange,
  workModeLabel,
  workedMinutes,
} = require("./attendanceRules");
const { evaluateLocation, refusesCapture } = require("./geofence");
const { quoteForDate, weekdayOf } = require("./quotes");
const { approvalProgress, approversFor, canDecide: canDecideOn, outcomeOf, requesterMaySeeApprovers } = require("./approvals");
const { reverseGeocode } = require("../../../services/geocoding");
const { subtreeEmployeeIds } = require("../../../services/dataScope.service");

/**
 * Everything the attendance module needs from the database, and nothing about HTTP.
 *
 * The arithmetic lives next door in `attendanceRules.js` and is pure; this file is what feeds it —
 * the settings row, the holiday list, the employee behind a login, and who is allowed to decide
 * somebody else's request.
 */

/** The permission that lets somebody decide requests they were not named on, and edit the rules. */
const APPROVAL_MODULE = "HRM";
const APPROVAL_FEATURE = "Attendance Approval";

/** The singleton's fixed primary key. There is one working-day definition, so there is one row. */
const SETTINGS_ID = 1;

/**
 * The settings row, created on first read.
 *
 * The migration inserts it, but a database restored from an older dump or seeded by hand may not
 * have it, and attendance failing to load because a defaults row is missing would be a poor trade
 * for one upsert on a read that is already cached behind a page load.
 */
async function readSettings(client = prisma) {
  return client.attendanceSettings.upsert({
    where: { id: SETTINGS_ID },
    update: {},
    create: { id: SETTINGS_ID },
  });
}

async function saveSettings(input, userId) {
  return prisma.attendanceSettings.upsert({
    where: { id: SETTINGS_ID },
    update: { ...input, updatedById: userId ?? null },
    create: { id: SETTINGS_ID, ...input, updatedById: userId ?? null },
  });
}

/** The holidays inside a range, as a Set of local `YYYY-MM-DD` — the shape the rules ask for. */
async function holidayDateSet(start, end, client = prisma) {
  const rows = await client.attendanceHoliday.findMany({
    where: { holidayDate: { gte: calendarDay(start), lte: calendarDay(end) } },
    select: { holidayDate: true },
  });
  return new Set(rows.map((row) => localIsoDate(row.holidayDate)));
}

/**
 * The employee behind the signed-in user.
 *
 * Attendance is an employee's record, not a login's: a login with no employee row cannot mark a
 * day or raise a leave, because there is nobody for the record to be about. The caller turns null
 * into the 400 that says so.
 */
/**
 * Which employee this login is linked to, read from the user row rather than from the token.
 *
 * `req.user` is the JWT payload, and the token carries `linkedEmployeeId` as it stood when the
 * session began - for up to seven days. Trusting it meant that somebody HR linked to an employee
 * after they had signed in went on being told their login is not linked to an employee record, and
 * saw an empty list of their own requests, until their token expired, with nothing they could do
 * about it but wait. Every question this module asks about "who is this" comes through here so
 * that none of them can answer it from a stale token. The token value is still the fallback when
 * the row cannot be read, so this costs one query and never fails closed on a working login.
 */
async function linkedEmployeeIdFor(user, client = prisma) {
  const userId = Number(user?.id) || null;
  const linked = userId
    ? await client.user.findUnique({ where: { id: userId }, select: { linkedEmployeeId: true } }).catch(() => null)
    : null;
  return Number(linked?.linkedEmployeeId ?? user?.linkedEmployeeId) || null;
}

async function employeeForUser(user, client = prisma) {
  const id = await linkedEmployeeIdFor(user, client);
  if (!id) return null;
  return client.employee.findFirst({
    where: { id },
    select: {
      id: true,
      employeeId: true,
      employeeName: true,
      dateOfJoining: true,
      department: true,
      designation: true,
      // Which office this person is measured against. Nullable, and NULL for everybody recorded
      // before the column existed - such an employee simply has no geofence, which is the honest
      // state rather than a failing check.
      branchId: true,
      leaveApprover1EmployeeId: true,
      leaveApprover2EmployeeId: true,
      leaveApprover3EmployeeId: true,
      permissionApproverEmployeeId: true,
    },
  });
}

/**
 * The employees named as approvers on a person's record, in slot order and without the blanks.
 *
 * A **permission** is decided by the one person named for it: an hour or two out of a single day is
 * settled the same morning it is asked for, and a queue of three is a queue for a decision nobody
 * escalates. Leaves and on-duties keep the three slots, in order.
 *
 * With that slot empty the permission falls to the leave approvers, which is deliberate and is what
 * every record starts as: the field was added long after the people were, and a permission that
 * could be decided by nobody but an Attendance Approval holder would be a queue that stalled for
 * the whole studio the day it shipped.
 */
function approverIdsOf(employee, type = "") {
  const named = String(type).toUpperCase() === "PERMISSION" && employee?.permissionApproverEmployeeId
    ? [employee.permissionApproverEmployeeId]
    : [employee?.leaveApprover1EmployeeId, employee?.leaveApprover2EmployeeId, employee?.leaveApprover3EmployeeId];
  return named.map((id) => Number(id) || null).filter(Boolean);
}

/** Whether this login may decide requests it was never named on, and change the working-day rules. */
const isAttendanceAdmin = (user) => iamService.hasPermission(user?.id, APPROVAL_MODULE, APPROVAL_FEATURE, "READ_WRITE");

/**
 * Who may decide this request.
 *
 * Any one of the three approvers named on the requester's record settles it — the first to answer
 * wins, so nothing stalls because approver 1 is themselves on leave — and an Attendance Approval
 * holder may decide anything. Nobody decides their own request, whatever else they hold: an
 * employee listed as their own approver by a data-entry slip would otherwise self-approve leave.
 */
function canDecideWith(actorEmployeeId, request) {
  /*
   * Only the people who were asked.
   *
   * `HRM / Attendance Approval` used to settle anything as a fallback. It no longer decides: the
   * studio's rule is that the named approvers answer and nobody else, so an administrator who is
   * not on a request's list cannot approve or reject it. They still *see* the queue — oversight is
   * a different question from authority — and they still set the shift, the holidays and the office
   * locations.
   *
   * Read off the request's own approval rows rather than off the employee record, so changing
   * somebody's approvers next month cannot let a new person answer a leave raised last month.
   */
  return canDecideOn(actorEmployeeId, request);
}

/** The same question for one request, reading the link and the permission itself. */
async function canDecide(user, request) {
  return canDecideWith(await linkedEmployeeIdFor(user), request);
}

/**
 * The `where` that narrows a list to the requests this login is entitled to see.
 *
 * `own` is what somebody raised; `team` is what they are named as an approver on; an Attendance
 * Approval holder asking for `team` sees everything, because that is what the permission is for.
 * A login with no employee behind it matches `-1` and so sees nothing, rather than everything.
 */
async function visibilityFilter(user, scope) {
  const employeeId = await linkedEmployeeIdFor(user);
  if (scope !== "team") return { employeeId: employeeId || -1 };
  /*
   * `HRM / Attendance Approval` still *sees* every request. It no longer decides any — only the
   * named approvers do — but oversight and authority are different questions, and somebody has to
   * be able to tell an employee why their leave has sat unanswered for a week.
   */
  if (await isAttendanceAdmin(user)) return {};
  if (!employeeId) return { employeeId: -1 };
  /*
   * The requests this person was actually asked about.
   *
   * Read off the approval rows written when each request was raised, not off the approver slots on
   * the employee record today. Those can differ the moment HR changes somebody's approvers, and the
   * queue has to agree with `canDecide` — which reads the same rows — or a person is handed rows
   * they cannot answer, or worse, answers none they can see.
   *
   * It also collapses what used to be three clauses. Whether a leave goes to three people and a
   * permission to one is settled when the request is raised; by the time it is in a queue there is
   * only one question, which is whether this person is on its list.
   */
  return {
    approvals: { some: { approverEmployeeId: employeeId } },
    // An approver's queue is other people's requests. Their own appear under "own", where they can
    // be withdrawn but not decided.
    NOT: { employeeId },
  };
}

/** Appends to a request's history. Every decision goes through here, so none of them is silent. */
function recordEvent(client, requestId, action, user, remarks) {
  return client.attendanceRequestEvent.create({
    data: {
      requestId,
      action,
      actorUserId: Number(user?.id) || null,
      actorName: user?.name || "Unknown",
      remarks: remarks || null,
    },
  });
}

/**
 * The dates an employee's approved leave and on-duty cover inside a range, plus their approved
 * permissions keyed by date.
 *
 * One query for the range rather than one per day: a month view asks about thirty-one days, and
 * the requests that touch them are a handful of rows.
 */
async function approvedTimeOff(employeeId, start, end, client = prisma) {
  const requests = await client.attendanceRequest.findMany({
    where: {
      employeeId,
      status: "APPROVED",
      fromDate: { lte: calendarDay(end) },
      toDate: { gte: calendarDay(start) },
    },
    select: { id: true, type: true, fromDate: true, toDate: true, fromTime: true, toTime: true },
  });
  const leaveDates = new Set();
  const permissionsByDate = new Map();
  for (const request of requests) {
    for (const iso of eachDateInRange(request.fromDate, request.toDate)) {
      if (request.type === "LEAVE") leaveDates.add(iso);
      if (request.type === "PERMISSION") {
        if (!permissionsByDate.has(iso)) permissionsByDate.set(iso, []);
        permissionsByDate.get(iso).push({ fromTime: request.fromTime, toTime: request.toTime });
      }
    }
  }
  return { leaveDates, permissionsByDate };
}

/**
 * One row per calendar day in the range: what the day was, what was recorded against it, and how
 * that reads. Days with no session are included — an unexplained absence is a fact about the month
 * that a list of only the days somebody turned up can never show.
 */
async function attendanceDays(employeeId, start, end, client = prisma) {
  const [settings, holidayDates, { leaveDates, permissionsByDate }, sessions] = await Promise.all([
    readSettings(client),
    holidayDateSet(start, end, client),
    approvedTimeOff(employeeId, start, end, client),
    client.attendanceSession.findMany({
      where: { employeeId, workDate: { gte: calendarDay(start), lte: calendarDay(end) } },
      orderBy: { workDate: "desc" },
    }),
  ]);
  const sessionsByDate = new Map(sessions.map((session) => [localIsoDate(session.workDate), session]));
  const days = eachDateInRange(start, end)
    .reverse()
    .map((iso) => {
      const session = sessionsByDate.get(iso) || null;
      const kind = dayKindFor(iso, { settings, holidayDates, leaveDates });
      const { status, tone } = attendanceDayStatus(session, { settings, dayKind: kind, permissions: permissionsByDate.get(iso) || [], today: new Date() });
      const minutes = workedMinutes(session);
      return {
        date: iso,
        dayKind: kind,
        status,
        tone,
        minutes,
        loginAt: session?.loginAt || null,
        logoutAt: session?.logoutAt || null,
        workMode: session?.workMode || null,
        faceVerified: session ? session.loginFaceVerified : null,
        loginLocation: session?.loginLatitude != null
          ? { latitude: Number(session.loginLatitude), longitude: Number(session.loginLongitude), accuracy: session.loginAccuracyM }
          : null,
      };
    });
  // The holidays come back with the days because the caller needs them again to work out the
  // target, and reading them twice for one screen is a query nobody asked for.
  return { settings, holidayDates, days };
}

/** Range totals: what was worked, what the range owed, and how the days broke down. */
async function attendanceSummary(employeeId, start, end, client = prisma) {
  const { settings, holidayDates, days } = await attendanceDays(employeeId, start, end, client);
  const workedTotal = days.reduce((sum, day) => sum + day.minutes, 0);
  const count = (status) => days.filter((day) => day.status === status).length;
  return {
    days,
    settings,
    totals: {
      workedMinutes: workedTotal,
      targetMinutes: targetMinutesForRange(start, end, { settings, holidayDates }),
      // Days attended, not days with a login. Since a day can now be short enough to read as an
      // absence while still having a check-in on it, counting logins would report somebody present
      // on a day the same response calls Absent.
      present: days.filter((day) => isAttendedStatus(day.status)).length,
      completed: days.filter((day) => day.logoutAt).length,
      onTime: count("On time"),
      late: count("Late"),
      permitted: count("Permitted"),
      halfDay: count("Half day"),
      earlyExit: count("Early exit"),
      absent: count("Absent"),
      onLeave: count("On leave"),
      notLoggedOut: count("Not logged out"),
      missedCheckout: count("Missed checkout"),
      // The days the range actually owed, weekends and holidays removed — the denominator every
      // other figure here is read against, and the one the screen had to guess at before.
      workingDays: workingDaysInRange(start, end, { settings, holidayDates }),
    },
  };
}

/** The shape a request is sent to the browser in — decided values included, so nothing is recomputed there. */
/**
 * `forRequester` is set when the person reading this is the one who raised it.
 *
 * They see who has answered and who has not while it is open — that is what stops somebody chasing
 * the wrong colleague — and they stop seeing it once it has been refused. A rejection is the
 * studio's answer rather than one named person's, and naming the refuser turns a decision into a
 * grievance between two people. The reason still reaches them; only the names go.
 *
 * `approverNames` maps employee id to name, so a row can say who rather than which id.
 */
function serialiseRequest(request, now = new Date(), { forRequester = false, approverNames = new Map() } = {}) {
  const days = leaveDayCount(request.fromDate, request.toDate);
  const minutes = request.type === "PERMISSION" ? permissionMinutes(request.fromTime, request.toTime) : null;
  return {
    id: request.id,
    type: request.type,
    status: request.status,
    displayStatus: requestDisplayStatus(request, now),
    employeeId: request.employeeId,
    employeeName: request.employee?.employeeName || "",
    employeeCode: request.employee?.employeeId || "",
    fromDate: localIsoDate(request.fromDate),
    toDate: localIsoDate(request.toDate),
    fromTime: request.fromTime || "",
    toTime: request.toTime || "",
    days,
    durationMinutes: minutes,
    durationLabel: minutes === null ? "" : formatDurationMinutes(minutes),
    reason: request.reason,
    supersedesId: request.supersedesId || null,
    decidedByName: request.decidedBy?.employeeName || "",
    decidedAt: request.decidedAt || null,
    decisionRemarks: request.decisionRemarks || "",
    createdAt: request.createdAt,
    /*
     * How many of the people asked have answered. Sent as a count even where the names are
     * withheld, because "refused after two of three had approved" is a fact about the decision
     * rather than about who made it.
     */
    approvalsTotal: (request.approvals || []).length,
    approvalsApproved: (request.approvals || []).filter((row) => row.decision === "APPROVED").length,
    approvers: forRequester && !requesterMaySeeApprovers(request.status)
      ? []
      : approvalProgress(request, approverNames),
    events: (request.events || []).map((event) => ({
      id: event.id,
      action: event.action,
      actorName: event.actorName,
      remarks: event.remarks || "",
      createdAt: event.createdAt,
    })),
  };
}

/** The relations every request read needs to serialise into the shape above. */
const requestInclude = {
  employee: {
    select: {
      id: true,
      employeeId: true,
      employeeName: true,
      leaveApprover1EmployeeId: true,
      leaveApprover2EmployeeId: true,
      leaveApprover3EmployeeId: true,
      permissionApproverEmployeeId: true,
    },
  },
  decidedBy: { select: { id: true, employeeName: true } },
  events: { orderBy: { createdAt: "asc" } },
  // Ordered by id, which is the order the approvers were written down in when the request was
  // raised — slot order on the employee record, so the list reads the way HR filled it in.
  approvals: { orderBy: { id: "asc" } },
};

/**
 * The office a branch is measured from, or null.
 *
 * Only an active one counts: switching a location off is how an office is retired without losing
 * the rows that measured distances to it, and a retired office must not go on judging anybody.
 */
function officeLocationFor(branchId, client = prisma) {
  const id = Number(branchId) || null;
  if (!id) return Promise.resolve(null);
  return client.attendanceOfficeLocation.findFirst({ where: { branchId: id, isActive: true } });
}

/** Every office, active or not, with the branch it belongs to — what the Rules tab lists. */
function listOfficeLocations(client = prisma) {
  return client.attendanceOfficeLocation.findMany({
    orderBy: { name: "asc" },
    include: { branch: { select: { id: true, name: true, code: true } } },
  });
}

/**
 * Records a branch's office. One per branch, so this is an upsert rather than a create: setting the
 * office twice for the same branch is correcting it, not making a second one.
 */
function saveOfficeLocation(branchId, input, userId) {
  const id = Number(branchId);
  return prisma.attendanceOfficeLocation.upsert({
    where: { branchId: id },
    update: { ...input, updatedById: userId ?? null },
    create: { branchId: id, ...input, createdById: userId ?? null, updatedById: userId ?? null },
  });
}

function deleteOfficeLocation(branchId) {
  return prisma.attendanceOfficeLocation.delete({ where: { branchId: Number(branchId) } });
}

/**
 * The geofence verdict for one capture, with the office loaded.
 *
 * Separated from `evaluateLocation` so the arithmetic stays pure and testable while the database
 * read lives here, which is the same split `attendanceRules.js` and this file already keep.
 * Answers the verdict plus `refused`, which is true only where the studio has switched the circle
 * on *and* the position was actually measured and found outside it — never for a branch with no
 * office or a phone that could not get a fix, because those are gaps in the studio's own setup.
 */
async function evaluateCapture({ employee, position, settings, client = prisma }) {
  const branchId = Number(employee?.branchId) || null;
  const office = await officeLocationFor(branchId, client);
  const verdict = evaluateLocation({ office, branchId, position, settings });
  return { ...verdict, refused: refusesCapture(verdict, settings) };
}

/**
 * Appends one capture to the audit trail.
 *
 * Nothing ever updates or deletes these. The session row is the day as it currently reads and a
 * correction will overwrite it; this is what was actually submitted, which is the whole point of
 * keeping both.
 */
function recordCapture(client, { session, employeeId, type, capturedAt, selfie, position, verdict, faceVerified, deviceInfo }) {
  return client.attendanceEvent.create({
    data: {
      sessionId: session.id,
      employeeId,
      type,
      capturedAt,
      selfieKey: selfie?.key || null,
      selfieData: selfie?.data || null,
      faceVerified: Boolean(faceVerified),
      latitude: position?.latitude ?? null,
      longitude: position?.longitude ?? null,
      accuracyM: position?.accuracy == null ? null : Math.round(position.accuracy),
      branchId: verdict?.branchId ?? null,
      distanceMeters: verdict?.distanceMeters ?? null,
      locationVerified: Boolean(verdict?.verified),
      locationNote: verdict?.note || null,
      deviceInfo: deviceInfo ? String(deviceInfo).slice(0, 255) : null,
    },
  });
}

/**
 * The line to show after a check-in, for a given day.
 *
 * Never throws and never blocks: a check-in that failed because nobody had written a Thursday quote
 * would be an absurd way to lose an attendance record. Ordered by id so adding a quote does not
 * change which one a past date would have picked.
 */
async function quoteFor(iso, client = prisma) {
  try {
    const dayOfWeek = weekdayOf(iso);
    if (dayOfWeek === null) return null;
    const quotes = await client.attendanceQuote.findMany({
      where: { dayOfWeek, isActive: true },
      orderBy: { id: "asc" },
      select: { id: true, quote: true },
    });
    return quoteForDate(quotes, iso)?.quote || null;
  } catch (error) {
    console.error("Attendance quote lookup failed:", error.message);
    return null;
  }
}

/**
 * The days behind this employee that still need something doing about them.
 *
 * Only checked-in days that were never checked out, and only ones with no correction already
 * pending or approved — a day somebody has already asked about is not still asking. Bounded to a
 * fortnight: this is a nudge on the attendance screen, not a backlog report, and an employee
 * returning from a month away should not be met with twenty of them.
 */
async function openPastDays(employeeId, today, client = prisma) {
  const from = calendarDay(new Date(calendarDay(today).getTime() - 14 * 86400000));
  const sessions = await client.attendanceSession.findMany({
    where: { employeeId, logoutAt: null, workDate: { gte: from, lt: calendarDay(today) } },
    orderBy: { workDate: "desc" },
    select: { id: true, workDate: true, loginAt: true },
  });
  if (!sessions.length) return [];

  const asked = await client.attendanceRequest.findMany({
    where: {
      employeeId,
      type: "CORRECTION",
      status: { in: BLOCKING_STATUSES },
      fromDate: { gte: from },
    },
    select: { fromDate: true },
  });
  const askedDates = new Set(asked.map((request) => localIsoDate(request.fromDate)));
  return sessions
    .filter((session) => !askedDates.has(localIsoDate(session.workDate)))
    .map((session) => ({ sessionId: session.id, date: localIsoDate(session.workDate), loginAt: session.loginAt }));
}

/**
 * Writes an approved correction onto the day it corrects.
 *
 * The session row is updated - it is the day as it currently reads - and an `AttendanceEvent` is
 * appended saying who decided it and what it changed, because the original capture must survive the
 * correction. That pairing is the whole reason the event table exists: without it, approving a
 * correction would be indistinguishable from the employee having checked out at that time.
 */
async function applyCorrection(client, { request, session, checkOutAt, user }) {
  await client.attendanceSession.update({ where: { id: session.id }, data: { logoutAt: checkOutAt } });
  await client.attendanceEvent.create({
    data: {
      sessionId: session.id,
      employeeId: session.employeeId,
      // Its own type, so a corrected checkout is never mistaken for one somebody stood somewhere and
      // captured. There is no selfie and no position, and pretending otherwise would be a lie in the
      // audit trail.
      type: "CHECK_OUT_CORRECTED",
      capturedAt: checkOutAt,
      locationNote: `Correction #${request.id} approved by ${user?.name || "an approver"}.`,
    },
  });
}

/**
 * The studio's attendance for one day, as a roster rather than as a list of sessions.
 *
 * One row per active employee, whether or not they marked anything — which is the whole point. A
 * list of sessions can never answer "who has not checked in today", and that is the first question
 * anybody opens this screen to ask. Somebody with no session gets a row saying what the calendar
 * made of their day: a holiday, their weekly off, approved leave, or an absence nobody explained.
 *
 * Status comes from the same `attendanceDayStatus` the employee's own screen reads, so the two can
 * never disagree about what a day was.
 */
async function attendanceRegister(day, { branchId = null, status = null, search = "" } = {}) {
  const date = calendarDay(day);
  const iso = localIsoDate(date);

  const [settings, holidayDates, employees, sessions] = await Promise.all([
    readSettings(),
    holidayDateSet(date, date),
    prisma.employee.findMany({
      where: { archivedAt: null, employmentStatus: "Active", ...(branchId ? { branchId: Number(branchId) } : {}) },
      orderBy: { employeeName: "asc" },
      select: { id: true, employeeId: true, employeeName: true, department: true, designation: true, branchId: true },
    }),
    prisma.attendanceSession.findMany({ where: { workDate: date } }),
  ]);

  const sessionByEmployee = new Map(sessions.map((session) => [session.employeeId, session]));
  const branches = await prisma.branch.findMany({ select: { id: true, name: true } });
  const branchName = new Map(branches.map((branch) => [branch.id, branch.name]));

  // One query for the whole roster rather than one per person: "was anybody away today" is a single
  // range test, and a studio of two hundred would otherwise be two hundred round trips.
  const approved = await prisma.attendanceRequest.findMany({
    where: { status: "APPROVED", type: { in: ["LEAVE", "PERMISSION"] }, fromDate: { lte: date }, toDate: { gte: date } },
    select: { employeeId: true, type: true, fromTime: true, toTime: true },
  });
  const onLeave = new Set(approved.filter((request) => request.type === "LEAVE").map((request) => request.employeeId));
  const permissionsBy = new Map();
  for (const request of approved.filter((entry) => entry.type === "PERMISSION")) {
    if (!permissionsBy.has(request.employeeId)) permissionsBy.set(request.employeeId, []);
    permissionsBy.get(request.employeeId).push({ fromTime: request.fromTime, toTime: request.toTime });
  }

  const now = new Date();
  const rows = employees.map((employee) => {
    const session = sessionByEmployee.get(employee.id) || null;
    const kind = dayKindFor(iso, { settings, holidayDates, leaveDates: onLeave.has(employee.id) ? new Set([iso]) : new Set() });
    const verdict = attendanceDayStatus(session, { settings, dayKind: kind, permissions: permissionsBy.get(employee.id) || [], today: now });
    const minutes = workedMinutes(session);
    return {
      employeeId: employee.id,
      employeeCode: employee.employeeId,
      employeeName: employee.employeeName,
      department: employee.department || null,
      designation: employee.designation || null,
      branchName: branchName.get(employee.branchId) || null,
      sessionId: session?.id || null,
      workMode: session?.workMode || null,
      // Beside the status, never folded into it: where a day was worked and how it went are two
      // facts, and one field holding both would lose the more useful one.
      workModeLabel: workModeLabel(session?.workMode),
      checkInAt: session?.loginAt || null,
      checkOutAt: session?.logoutAt || null,
      workedMinutes: minutes,
      workedLabel: minutes ? formatDurationMinutes(minutes) : "—",
      locationVerified: session ? Boolean(session.loginLocationVerified) : null,
      distanceMeters: session?.loginDistanceMeters ?? null,
      status: verdict.status,
      tone: verdict.tone,
    };
  });

  // Counted before the filters below, so the cards describe the day rather than the current view.
  const countOf = (predicate) => rows.filter(predicate).length;
  const summary = {
    total: rows.length,
    // Through the one predicate rather than a list written here: this one silently omitted Half day
    // and Early exit, so a studio of short days reported nobody present.
    present: countOf((row) => isAttendedStatus(row.status)),
    late: countOf((row) => row.status === "Late"),
    absent: countOf((row) => row.status === "Absent"),
    onLeave: countOf((row) => row.status === "On leave"),
    notCheckedOut: countOf((row) => row.checkInAt && !row.checkOutAt),
    outsideLocation: countOf((row) => row.sessionId && row.locationVerified === false),
  };

  const needle = String(search || "").trim().toLowerCase();
  const filtered = rows.filter((row) => {
    if (status && row.status !== status) return false;
    if (!needle) return true;
    return [row.employeeName, row.employeeCode, row.department, row.designation]
      .some((value) => String(value || "").toLowerCase().includes(needle));
  });

  return { date: iso, summary, rows: filtered };
}

/**
 * One day of one person, with everything a reviewer needs to judge it: both captures, where they
 * were taken and how far from the office, and every correction ever asked about that day.
 *
 * The captures come from the append-only event table rather than from the session, so a day that
 * was corrected still shows what was originally submitted alongside the correction that changed it.
 */
async function attendanceDetail(sessionId) {
  const session = await prisma.attendanceSession.findUnique({
    where: { id: Number(sessionId) || 0 },
    include: { employee: { select: { id: true, employeeId: true, employeeName: true, department: true, designation: true, branchId: true } } },
  });
  if (!session) return null;

  const [events, corrections, settings] = await Promise.all([
    prisma.attendanceEvent.findMany({ where: { sessionId: session.id }, orderBy: { capturedAt: "asc" } }),
    prisma.attendanceRequest.findMany({
      where: { employeeId: session.employeeId, type: { in: ["CORRECTION", "OUTSIDE_LOCATION"] }, fromDate: calendarDay(session.workDate) },
      include: requestInclude,
      orderBy: { createdAt: "desc" },
    }),
    readSettings(),
  ]);

  const minutes = workedMinutes(session);
  return {
    id: session.id,
    date: localIsoDate(session.workDate),
    employee: session.employee,
    workMode: session.workMode,
    workModeLabel: workModeLabel(session.workMode),
    checkInAt: session.loginAt,
    checkOutAt: session.logoutAt,
    workedMinutes: minutes,
    workedLabel: minutes ? formatDurationMinutes(minutes) : "—",
    targetMinutes: settings.dailyTargetMinutes,
    captures: events.map((event) => ({
      id: event.id,
      type: event.type,
      capturedAt: event.capturedAt,
      hasSelfie: Boolean(event.selfieKey || event.selfieData),
      faceVerified: event.faceVerified,
      latitude: event.latitude === null ? null : Number(event.latitude),
      longitude: event.longitude === null ? null : Number(event.longitude),
      accuracyM: event.accuracyM,
      distanceMeters: event.distanceMeters,
      locationVerified: event.locationVerified,
      locationNote: event.locationNote,
      locationAddress: event.locationAddress,
      deviceInfo: event.deviceInfo,
    })),
    corrections: corrections.map((request) => serialiseRequest(request)),
  };
}

/**
 * Fills in an event's address, after the fact.
 *
 * Deliberately not awaited by the caller. A check-in is a person standing with their phone out
 * waiting to be told they are logged in; making them wait on a courtesy geocoder — rate limited to
 * one request a second process-wide, so fifty people at half past nine would queue behind each
 * other — would be a poor trade for a line of text. The row is written first, this runs after, and
 * the address appears on the next read.
 *
 * Swallows everything. By the time this runs the attendance record is already safe, and there is no
 * caller left to tell.
 */
function fillEventAddress(eventId, latitude, longitude) {
  reverseGeocode(latitude, longitude)
    .then((address) => (address ? prisma.attendanceEvent.update({ where: { id: eventId }, data: { locationAddress: address } }) : null))
    .catch((error) => console.warn(`[attendance] could not store an address for event ${eventId}: ${error.message}`));
}

/**
 * The totals for a range, without building a row for every day in it.
 *
 * `attendanceSummary` walks the range a day at a time, which is right for a month somebody is
 * reading and impossible for a career: five years is about eighteen hundred rows to build, serialise
 * and send so a screen can print eight numbers off them. That is what the endpoint's two-year
 * ceiling was protecting against, and this is what removes the need for it.
 *
 * The work here is bounded by what actually happened rather than by how long the range is. Sessions
 * are the days somebody turned up — around 250 a year however far back you ask — and the statuses
 * are evaluated over those. Everything else is arithmetic: the working days are counted by walking
 * dates without building anything, and the absences are what is left after the days worked and the
 * days approved off are taken out of them.
 *
 * The same `attendanceDayStatus` the day rows use, so a month read this way and read the other way
 * cannot disagree about what its days were.
 */
async function attendanceTotals(employeeId, start, end, client = prisma) {
  const [settings, holidayDates, { leaveDates, permissionsByDate }, sessions] = await Promise.all([
    readSettings(client),
    holidayDateSet(start, end, client),
    approvedTimeOff(employeeId, start, end, client),
    client.attendanceSession.findMany({
      where: { employeeId, workDate: { gte: calendarDay(start), lte: calendarDay(end) } },
      orderBy: { workDate: "asc" },
    }),
  ]);

  const now = new Date();
  const counts = { onTime: 0, late: 0, permitted: 0, halfDay: 0, earlyExit: 0, notLoggedOut: 0, missedCheckout: 0 };
  const byStatus = {
    "On time": "onTime", Late: "late", Permitted: "permitted", "Half day": "halfDay",
    "Early exit": "earlyExit", "Not logged out": "notLoggedOut", "Missed checkout": "missedCheckout",
  };

  let workedTotal = 0;
  let completed = 0;
  // Sessions too short to earn a half day read as absences, so they are not attendance and must not
  // be counted as it — in either direction. Counted here so the arithmetic below can take them out.
  let uncredited = 0;
  for (const session of sessions) {
    const iso = localIsoDate(session.workDate);
    const kind = dayKindFor(iso, { settings, holidayDates, leaveDates });
    const { status } = attendanceDayStatus(session, { settings, dayKind: kind, permissions: permissionsByDate.get(iso) || [], today: now });
    const key = byStatus[status];
    if (key) counts[key] += 1;
    if (!isAttendedStatus(status)) uncredited += 1;
    workedTotal += workedMinutes(session);
    if (session.logoutAt) completed += 1;
  }

  const workingDays = workingDaysInRange(start, end, { settings, holidayDates });

  /*
   * Leave only counts where it fell on a day that was owed. A week off that covers a Sunday and a
   * public holiday is five days of leave, not seven, and counting the other two would make the
   * absences below come out short by exactly that many.
   */
  const from = localIsoDate(start);
  const to = localIsoDate(end);
  const onLeave = [...leaveDates].filter((iso) => iso >= from && iso <= to
    && dayKindFor(iso, { settings, holidayDates }) === DAY_KINDS.WORKING).length;

  const attended = sessions.length - uncredited;
  // What is left once the days worked and the days agreed off are taken out. Floored at zero: a
  // session on a holiday is a real thing and must not push this negative.
  const absent = Math.max(0, workingDays - attended - onLeave);

  return {
    settings,
    totals: {
      workedMinutes: workedTotal,
      targetMinutes: targetMinutesForRange(start, end, { settings, holidayDates }),
      workingDays,
      present: attended,
      completed,
      ...counts,
      absent,
      onLeave,
      /*
       * The share of owed days that were actually attended, leave counted as attended because it
       * was agreed. Null rather than 0% for a range that owed nothing — a new joiner's first
       * weekend did not have a bad attendance rate, it had no attendance to rate.
       */
      attendanceRate: workingDays ? Math.round(((attended + onLeave) / workingDays) * 100) : null,
    },
  };
}

/**
 * Whose leave a login may see on a calendar: their own, and everybody reporting to them.
 *
 * The org chart, not a permission. A manager needs to know who on their team is away next week to
 * plan around it, and that is not something anybody should have to be granted separately — it is
 * what having reports means. It follows the chart to any depth, so a head of department sees their
 * leads' teams as well as their leads.
 *
 * **It does not follow upwards.** `subtreeEmployeeIds` walks down from a root and never returns the
 * root, so somebody's manager is never in their own list — an editor cannot see when their
 * department head is on leave. The chart grants sight of the work you are answerable for, and
 * answerability does not run in both directions.
 *
 * Answers `null` for a login that should see everything, which is what the caller checks first, and
 * `[-1]` for a login with no employee behind it: a filter matching nothing, where an empty array
 * would have to be special-cased by every caller and an undefined one would match everybody.
 */
async function leaveVisibleEmployeeIds(user, { everyone = false } = {}) {
  if (everyone) return null;
  const employeeId = await linkedEmployeeIdFor(user);
  if (!employeeId) return [-1];
  try {
    const team = await subtreeEmployeeIds(employeeId);
    return [employeeId, ...team];
  } catch (error) {
    // A recursive query that fails must not widen what somebody sees. Their own leave is the safe
    // answer, and it is the one they are entitled to whatever the chart says.
    console.warn(`Unable to read the reporting chart for employee ${employeeId}: ${error.message}`);
    return [employeeId];
  }
}

/**
 * Writes the approver list onto a request as it is raised.
 *
 * The list is fixed at that moment rather than read from the employee each time it is looked at,
 * which is what makes "who was asked" a fact about the request rather than about today's record.
 */
function createApprovals(client, requestId, approverEmployeeIds) {
  if (!approverEmployeeIds.length) return Promise.resolve({ count: 0 });
  return client.attendanceRequestApproval.createMany({
    data: approverEmployeeIds.map((approverEmployeeId) => ({ requestId, approverEmployeeId })),
  });
}

/**
 * Records one approver's answer and works out what the request now reads as.
 *
 * Both in one transaction, because the two must never disagree: a row saying APPROVED on a request
 * still reading PENDING is a request waiting on somebody who has already answered.
 *
 * Answers the request's new status. `PENDING` where others have still to answer, which is the
 * ordinary case for a leave after the first yes.
 */
async function recordApproverDecision(client, { request, approverEmployeeId, decision, remarks }) {
  await client.attendanceRequestApproval.updateMany({
    where: { requestId: request.id, approverEmployeeId },
    data: { decision, remarks: remarks || null, decidedAt: new Date() },
  });
  const rows = await client.attendanceRequestApproval.findMany({ where: { requestId: request.id } });
  return outcomeOf(rows);
}

/** The names behind a set of approver ids, for a list that should say who rather than which id. */
async function approverNamesFor(requests, client = prisma) {
  const ids = [...new Set((requests || []).flatMap((request) => (request.approvals || []).map((row) => row.approverEmployeeId)))];
  if (!ids.length) return new Map();
  const employees = await client.employee.findMany({ where: { id: { in: ids } }, select: { id: true, employeeName: true } });
  return new Map(employees.map((employee) => [employee.id, employee.employeeName]));
}

module.exports = {
  approverNamesFor,
  approversFor,
  attendanceDetail,
  createApprovals,
  recordApproverDecision,
  attendanceTotals,
  fillEventAddress,
  leaveVisibleEmployeeIds,
  attendanceRegister,
  applyCorrection,
  openPastDays,
  quoteFor,
  deleteOfficeLocation,
  evaluateCapture,
  listOfficeLocations,
  officeLocationFor,
  recordCapture,
  saveOfficeLocation,
  APPROVAL_FEATURE,
  APPROVAL_MODULE,
  DAY_KINDS,
  approverIdsOf,
  approvedTimeOff,
  attendanceDays,
  attendanceSummary,
  canDecide,
  canDecideWith,
  employeeForUser,
  linkedEmployeeIdFor,
  holidayDateSet,
  isAttendanceAdmin,
  readSettings,
  recordEvent,
  requestInclude,
  saveSettings,
  serialiseRequest,
  visibilityFilter,
};
