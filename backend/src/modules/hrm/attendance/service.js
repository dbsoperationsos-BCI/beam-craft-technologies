const prisma = require("../../../config/db");
const { holidayCalendar, branchForEmployee, branchesForEmployees } = require("../../../services/holidayCalendar");
const iamService = require("../../../services/iam.service");
const { matchesWordChunks } = require("../../../services/wordChunks");
const { isAdministrator } = require("../../../services/administrator");
const {
  BLOCKING_STATUSES,
  DAY_KINDS,
  attendanceDayStatus,
  notInYet,
  isAttendedStatus,
  dayShares,
  dayKindFor,
  eachDateInRange,
  formatDurationMinutes,
  leaveDayCount,
  localIsoDate,
  parseClockTime,
  minutesOfDay,
  NOT_REQUIRED_STATUS,
  permissionMinutes,
  requestDisplayStatus,
  calendarDay,
  targetMinutesForRange,
  workingDaysInRange,
  workModeLabel,
  workedMinutes,
  summariseBreaks,
  correctionStatusOf,
  sessionExpired,
  sessionExpiresAt,
  attendanceStartIso,
  laterIso,
  casualLeaveLedger,
  CASUAL_LEAVE_ONLY,
  SYSTEM_REQUEST_TYPES,
} = require("./attendanceRules");
const { evaluateLocation, refusesCapture } = require("./geofence");
const { approvalProgress, approversFor, canDecide: canDecideOn, decisionOf, needsPermissionApprover, outcomeOf, regularizationApproverOf, requesterMaySeeApprovers } = require("./approvals");
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
    // Comp-Off approval is live from the day the settings are first made: a new database has no
    // comp-off earned under the old rule to keep (`compOffCredits.approvalFromIso`).
    create: { id: SETTINGS_ID, compOffApprovalFrom: calendarDay(localIsoDate(calendarDay(new Date()))) },
  });
}

async function saveSettings(input, userId) {
  return prisma.attendanceSettings.upsert({
    where: { id: SETTINGS_ID },
    update: { ...input, updatedById: userId ?? null },
    create: { id: SETTINGS_ID, ...input, updatedById: userId ?? null },
  });
}

/**
 * Which of these employees attendance is optional for - and so who is left off every attendance
 * list: the register, the dashboard and its totals, the daily WhatsApp report.
 *
 * - Those whose login is a **Super Admin**. Checking in and out is not compulsory for a Super Admin,
 *   so a day they did not mark is not held against them (`attendanceDayStatus`'s `optional`). Both
 *   spellings of Super Admin count - the legacy `role` column, and the active system role an
 *   administrator added through Login Credentials carries while their column still says EMPLOYEE
 *   (see `isSuperAdmin` in the employees controller).
 * - Those ticked **Exclude From Attendance** in Employee Preference, whatever their login - kept out
 *   of the Attendance module altogether, the same way, and with no login needed to be.
 *
 * No list means every employee who is either.
 */
async function attendanceOptionalEmployeeIds(employeeIds = null, client = prisma) {
  if (Array.isArray(employeeIds) && !employeeIds.length) return new Set();
  const [logins, excluded] = await Promise.all([
    client.user.findMany({
      where: {
        linkedEmployeeId: Array.isArray(employeeIds) ? { in: employeeIds } : { not: null },
        OR: [{ role: "SUPER_ADMIN" }, { roles: { some: { role: { name: "SUPER_ADMIN", isActive: true } } } }],
      },
      select: { linkedEmployeeId: true },
    }),
    attendanceExcludedEmployeeIds(employeeIds, client),
  ]);
  return new Set([...logins.map((login) => login.linkedEmployeeId), ...excluded]);
}

/** Which of these employees are ticked Exclude From Attendance (Employee Preference). No list: all of them. */
async function attendanceExcludedEmployeeIds(employeeIds = null, client = prisma) {
  if (Array.isArray(employeeIds) && !employeeIds.length) return new Set();
  const rows = await client.employee.findMany({
    where: { excludeFromAttendance: true, ...(Array.isArray(employeeIds) ? { id: { in: employeeIds } } : {}) },
    select: { id: true },
  });
  return new Set(rows.map((row) => row.id));
}

/** Whether this one employee is ticked Exclude From Attendance. */
async function isExcludedFromAttendance(employeeId, client = prisma) {
  return employeeId ? (await attendanceExcludedEmployeeIds([employeeId], client)).has(employeeId) : false;
}

/**
 * The `where` that keeps excluded employees out of a query over employees (`AND` it in). For the
 * reads that do not go through `attendanceOptionalEmployeeIds` - a request list, a picker.
 */
const NOT_EXCLUDED = { excludeFromAttendance: false };

/** Whether attendance is optional for this one employee. */
async function isAttendanceOptional(employeeId, client = prisma) {
  return employeeId ? (await attendanceOptionalEmployeeIds([employeeId], client)).has(employeeId) : false;
}

/**
 * Whether this one employee is ticked Allow Flexible Shift (Employee Preference): offered the
 * Flexible Shift work mode, and not absent today until today is over (`notInYet`).
 */
async function isFlexibleShiftAllowed(employeeId, client = prisma) {
  if (!employeeId || !client.employee?.findUnique) return false;
  const row = await client.employee.findUnique({ where: { id: Number(employeeId) }, select: { allowFlexibleShift: true } });
  return row?.allowFlexibleShift === true;
}

/**
 * The breaks of these sessions, summarised per session (`summariseBreaks`), keyed by session id.
 * One query for the whole range, for the dashboard's per-day break time and its range total.
 */
async function breakSummariesFor(sessionIds, client = prisma, sessions = []) {
  const ids = (sessionIds || []).filter(Boolean);
  if (!ids.length) return new Map();
  const rows = await client.attendanceBreak.findMany({ where: { sessionId: { in: ids } } });
  const bySession = new Map();
  for (const row of rows) {
    if (!bySession.has(row.sessionId)) bySession.set(row.sessionId, []);
    bySession.get(row.sessionId).push(row);
  }
  // A break left open on a day that has since become an Incorrect login stops where the login did.
  const now = new Date();
  const closedAtBySession = new Map((sessions || []).filter((session) => sessionExpired(session, now)).map((session) => [session.id, sessionExpiresAt(session)]));
  return new Map([...bySession].map(([sessionId, list]) => [sessionId, summariseBreaks(list, now, { closedAt: closedAtBySession.get(sessionId) || null })]));
}

/**
 * The day statuses approved Corrections have set, as a Map of `${employeeId}|${YYYY-MM-DD}` to the
 * status - one query for however many people and days are being read. Every reader that judges a day
 * passes the day's entry to `attendanceDayStatus` (`override`), so the dashboard, the register, the
 * overview and payroll all read a corrected day the same way.
 */
async function statusOverridesFor({ employeeIds, start, end }, client = prisma) {
  const ids = (employeeIds || []).filter(Boolean);
  if (!ids.length) return new Map();
  const rows = await client.attendanceStatusOverride.findMany({
    where: { employeeId: { in: ids }, workDate: { gte: calendarDay(start), lte: calendarDay(end) } },
    select: { employeeId: true, workDate: true, status: true },
  });
  return new Map(rows.map((row) => [`${row.employeeId}|${localIsoDate(row.workDate)}`, row.status]));
}

/**
 * The holidays inside a range, as a Set of local `YYYY-MM-DD` — the shape the rules ask for.
 *
 * For **one branch**: the studio-wide holidays and that branch's own (`services/holidayCalendar`).
 * A holiday declared for another branch is not this person's day off, and `null` - somebody the
 * repository has not placed, or a caller asking about the studio rather than a person - answers with
 * the studio-wide holidays alone. Readers that judge many people at once load `holidayCalendar`
 * once and ask it per employee instead of calling this per person.
 */
async function holidayDateSet(start, end, client = prisma, branchId = null) {
  const calendar = await holidayCalendar(start, end, client);
  return calendar.forBranch(branchId);
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
      regularizationApproverEmployeeId: true,
    },
  });
}

/** Whether this login may decide requests it was never named on, and change the working-day rules. */
const isAttendanceAdmin = (user) => iamService.hasPermission(user?.id, APPROVAL_MODULE, APPROVAL_FEATURE, "READ_WRITE");

/**
 * Whether this login may read the studio's attendance register - everybody's day, and any one day
 * in full. `HRM / Attendance Approval` at **Read**, which is exactly what opens the register screen
 * and lists it in the sidebar (`modulePermissions.js`). It asked for Read / Write, so a role granted
 * Read was shown the screen and then refused by it; changing a record still takes Read / Write.
 */
const canReadRegister = (user) => iamService.hasPermission(user?.id, APPROVAL_MODULE, APPROVAL_FEATURE, "READ");

/*
 * Attendance rights that were "administrators only" in code. Two are permissions of their own, so
 * Role Management can grant them (migration 20260928120000, which gave each to the roles whose
 * members were administrators): Attendance Rules and All Requests. The logs are an administrator's
 * alone again (20260929110000 took `HRM / Attendance Logs` back off Role Management).
 */

/**
 * Whether this login may change the attendance rules - the shift and weekly offs, the office
 * locations. `HRM / Attendance Rules` at Read / Write: its own permission rather
 * than Attendance Approval, which a role full of ordinary employees can hold; the rules decide how
 * every one of them is judged. Everybody may still read the rules.
 */
const RULES_FEATURE = "Attendance Rules";
const canManageRules = (user) => iamService.hasPermission(user?.id, "HRM", RULES_FEATURE, "READ_WRITE");

/**
 * Whether this login is shown the detailed logs on their Self Dashboard - the Login Summary and the
 * Break Summary - and may read the Break Summary's endpoint. Administrators only
 * (`services/administrator`); not a permission, so it is not granted role by role.
 */
const seesAttendanceLogs = (user) => isAdministrator(user?.id);

/**
 * Whether this login reads every request in the studio - the All, Pending, Approved and Rejected
 * tabs over everybody's requests on HRM → Request. `HRM / All Requests` at Read. Seeing is not
 * deciding: that stays with the approvers named on each request.
 */
const ALL_REQUESTS_FEATURE = "All Requests";
const seesAllRequests = (user) => iamService.hasPermission(user?.id, "HRM", ALL_REQUESTS_FEATURE, "READ");

/**
 * Whether this employee is named as somebody's approver - a Leave Approver in any of the three slots,
 * the Permission Approver or the Attendance Regularization Approver - on anyone's record. That is who a "Waiting for me" queue is for: a
 * request goes only to the people named there (`approversFor`), so somebody named on nobody's record
 * has nothing that could ever wait on them. One indexed count, answered once per page load.
 */
async function isNamedApprover(employeeId, client = prisma) {
  if (!employeeId) return false;
  const count = await client.employee.count({
    where: {
      id: { not: employeeId },
      OR: [
        { leaveApprover1EmployeeId: employeeId },
        { leaveApprover2EmployeeId: employeeId },
        { leaveApprover3EmployeeId: employeeId },
        { permissionApproverEmployeeId: employeeId },
        { regularizationApproverEmployeeId: employeeId },
      ],
    },
  });
  return count > 0;
}

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
/** What this login's employee has answered on the request, or null when they are not asked. */
function myDecisionWith(actorEmployeeId, request) {
  return decisionOf(actorEmployeeId, request);
}

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
   * An administrator (`services/administrator`) *sees* every request. They decide none they are not
   * named on — only the named approvers do — but oversight and authority are different questions,
   * and somebody has to be able to tell an employee why their leave has sat unanswered for a week.
   *
   * It was `HRM / Attendance Approval` at Read / Write, which a role full of ordinary employees can
   * be granted - and then every one of them was sent every colleague's leave.
   *
   * Everybody's but their own, though. A holder's own leave landed in their "Waiting for me" as well
   * as under "My requests", reading as though they had sent it to themselves - and it is the one
   * row there nobody may decide. It lives under "own", the same as for a named approver below.
   */
  // Every team view leaves out anybody ticked Exclude From Attendance - they are not in this module.
  if (await seesAllRequests(user)) return employeeId ? { NOT: { employeeId }, employee: NOT_EXCLUDED } : { employee: NOT_EXCLUDED };
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
    /*
     * Everything but what the raiser has taken away.
     *
     * `SENT_BACK`, `REVERTED` and `DELETED` are with the raiser - nobody is waiting on an approver -
     * and a queue holding rows that cannot be answered is a queue people stop reading. Everything
     * else stays, including `APPROVED`: an approver has to be able to see what they approved, and
     * narrowing this to the answerable left them no history of their own answers and had Nebula
     * reply "none" to what they had approved. Which of these is *waiting* on somebody is a different
     * question, asked on the screen (`awaitsMe`) and by `canDecide`.
     */
    status: { notIn: ["SENT_BACK", "REVERTED", "DELETED"] },
    // An approver's queue is other people's requests. Their own appear under "own", where they can
    // be reverted or deleted but not decided.
    NOT: { employeeId },
    employee: NOT_EXCLUDED,
  };
}

/*
 * A refusal this module can throw from the service rather than only from the controller.
 *
 * The controller has the same two one-liners (`badRequest`, `forbidden`) and they stay there: this
 * is the shape `handleError` already knows how to turn into a status code, and the verbs below are
 * rules rather than plumbing, so the rule and its refusal belong in the same place.
 */
const badRequest = (message) => Object.assign(new Error(message), { status: 400 });
const SYSTEM_REQUEST_REFUSAL = "A comp-off credit is raised by attendance for a weekly off or holiday you worked, and only your approvers decide it - it cannot be edited, reverted or deleted.";

/**
 * Send back: an approver returning a request to the raiser to be fixed.
 *
 * The third answer, for a request that is nearly right - the wrong dates, a reason nobody can act
 * on. Rejecting it would say something harsher and truer of nothing, and the raiser would have to
 * raise it again from nothing.
 *
 * **Every answer is cleared, not only the sender's.** The raiser is about to change the request, and
 * an approval given for 20-22 October is not an approval of 2-3 November. It leaves every queue, so
 * nobody holds a row they cannot act on, and `decidedById` is cleared because nobody has settled it.
 *
 * Not available on an approved request: that would be a rejection by another name, which `mayAnswer`
 * forbids for the reason written there.
 */
async function sendBack(client, { request, user, remarks }) {
  // Nobody raised it, so there is nobody to send it back to: it is approved or rejected.
  if (SYSTEM_REQUEST_TYPES.includes(String(request?.type || ""))) throw badRequest("A comp-off credit is raised by attendance, so it cannot be sent back. Approve or reject it.");
  const reason = String(remarks || "").trim();
  if (!reason) throw badRequest("Say why it is going back: it is the one answer that is useless without a reason.");
  if (!["PENDING", "REJECTED"].includes(String(request?.status || ""))) {
    throw badRequest(`This request has been ${String(request?.status || "").toLowerCase().replace("_", " ")} and can no longer be sent back.`);
  }
  return client.$transaction(async (tx) => {
    /*
     * The same lock the raiser's verbs and `decide` take: a send back sent while the last approval
     * was in flight would otherwise return a request that had just become approved.
     */
    await tx.$queryRaw`SELECT id FROM attendance_request WHERE id = ${request.id} FOR UPDATE`;
    const current = await tx.attendanceRequest.findUnique({ where: { id: request.id } });
    if (!["PENDING", "REJECTED"].includes(String(current?.status ?? request.status ?? ""))) {
      throw badRequest(`This request has been ${String(current?.status || "").toLowerCase().replace("_", " ")} and can no longer be sent back.`);
    }
    await tx.attendanceRequestApproval.updateMany({
      where: { requestId: request.id },
      data: { decision: "PENDING", remarks: null, decidedAt: null },
    });
    await tx.attendanceRequest.update({
      where: { id: request.id },
      data: { status: "SENT_BACK", decidedById: null, decidedAt: null, decisionRemarks: reason },
    });
    await recordEvent(tx, request.id, "SENT_BACK", user, reason);
    return tx.attendanceRequest.findUnique({ where: { id: request.id }, include: requestInclude });
  });
}

/**
 * The two types whose approval **writes onto the day**, which is why they freeze once approved.
 *
 * `CORRECTION` sets the session's `logoutAt` (`applyCorrection`) and `INCORRECT_LOGIN` upserts an
 * `AttendanceStatusOverride` (`applyCorrectionStatus`). Nothing in this codebase deletes either, so
 * editing, reverting or deleting an approved one would leave the day carrying a change whose request
 * no longer says it was approved - a day nobody can explain. Undoing the day is a Correction's job,
 * raised afresh, which is what the message says.
 */
// `EXTRA_TIME` sets it too, through the same `applyCorrection`: the logout it carries.
const WRITES_ONTO_THE_DAY = ["CORRECTION", "INCORRECT_LOGIN", "EXTRA_TIME"];

const frozenByItsOwnApproval = (request) => request?.status === "APPROVED"
  && WRITES_ONTO_THE_DAY.includes(String(request?.type || "").toUpperCase());

/*
 * What the raiser may still do, by status. Two lists, because the two verbs differ in one place: a
 * request already reverted is theirs to delete but there is nothing left to revert it out of.
 * `DELETED` is terminal and `CANCELLED` belongs to the old flow, so neither appears in either.
 */
const MAY_REVERT = ["PENDING", "SENT_BACK", "APPROVED", "REJECTED"];
const MAY_DELETE = ["PENDING", "SENT_BACK", "APPROVED", "REJECTED", "REVERTED"];

/**
 * Revert back: the raiser pulling the request out of every queue, to edit or to drop.
 *
 * It replaces Withdraw, Cancel and Apply again - one way out instead of three, two of which read as
 * the same thing. The request keeps its history and can be edited from here back into the queues.
 */
async function revert(client, { request, raiserEmployeeId, user }) {
  assertRaiserMayAct(request, raiserEmployeeId, MAY_REVERT, "reverted");
  return client.$transaction(async (tx) => {
    await lockedRequest(tx, { request, raiserEmployeeId, allowed: MAY_REVERT, verb: "reverted" });
    await tx.attendanceRequestApproval.updateMany({
      where: { requestId: request.id },
      data: { decision: "PENDING", remarks: null, decidedAt: null },
    });
    await tx.attendanceRequest.update({
      where: { id: request.id },
      data: { status: "REVERTED", decidedById: null, decidedAt: null },
    });
    await recordEvent(tx, request.id, "REVERTED", user, null);
    return tx.attendanceRequest.findUnique({ where: { id: request.id }, include: requestInclude });
  });
}

/**
 * Delete, which deletes nothing: the row stays and says Deleted.
 *
 * The raiser goes on seeing what they did, and it counts for nothing - only `APPROVED` ever counted
 * towards the register, the reports or a leave balance, so no attendance code changes. Terminal: a
 * fresh request is raised rather than this one brought back.
 */
async function remove(client, { request, raiserEmployeeId, user }) {
  assertRaiserMayAct(request, raiserEmployeeId, MAY_DELETE, "deleted");
  return client.$transaction(async (tx) => {
    await lockedRequest(tx, { request, raiserEmployeeId, allowed: MAY_DELETE, verb: "deleted" });
    await tx.attendanceRequest.update({ where: { id: request.id }, data: { status: "DELETED" } });
    await recordEvent(tx, request.id, "DELETED", user, null);
    return tx.attendanceRequest.findUnique({ where: { id: request.id }, include: requestInclude });
  });
}

/** What the raiser may edit from. Everything but `DELETED` and the old `CANCELLED`. */
const RAISER_MAY_EDIT = ["PENDING", "SENT_BACK", "APPROVED", "REJECTED", "REVERTED"];

/*
 * The fields an edit may write, named here rather than taken from the body.
 *
 * `type` is not one of them: the checks a Correction or a comp-off is raised through run in
 * `createRequest`, so a LEAVE edited into a CORRECTION would be a Correction nobody validated.
 * Neither is `employeeId`, `status` or `supersedesId` - whose request it is, what it has come to,
 * and which rejection it re-raises are not the raiser's to type.
 */
const EDITABLE_FIELDS = ["fromDate", "toDate", "fromTime", "toTime", "reason", "workedDate", "workedPairDate", "requestedStatus", "currentStatus"];

const editableFieldsOf = (patch) => Object.fromEntries(
  EDITABLE_FIELDS.filter((field) => patch && Object.prototype.hasOwnProperty.call(patch, field))
    .map((field) => [field, patch[field]]),
);

/**
 * The raiser correcting their own request, from any status but deleted.
 *
 * **Every answer is cleared and the request goes back to `PENDING`**, whatever it was: approvers
 * answered about the dates as they were, and an approval of 20-22 October is not an approval of
 * 2-3 November. Editing an approved leave therefore stops those days reading "On leave" until it is
 * approved again - the raiser can do to attendance what an approver cannot (see `mayAnswer`), and
 * that is the studio's decision, recorded here rather than hidden.
 */
async function edit(client, { request, raiserEmployeeId, user, patch, approverIds, beforeWrite }) {
  assertRaiserMayAct(request, raiserEmployeeId, RAISER_MAY_EDIT, "edited");
  const fields = editableFieldsOf(patch);
  return client.$transaction(async (tx) => {
    await lockedRequest(tx, { request, raiserEmployeeId, allowed: RAISER_MAY_EDIT, verb: "edited" });
    // A check the caller needs run under the same lock as the write - a comp-off's worked day being
    // claimed once, which `createRequest` reads with the attendance row locked.
    if (beforeWrite) await beforeWrite(tx);
    /*
     * Asked again means asked of whoever the approvers are **now**. Clearing the rows written when
     * it was raised sent an edited request back to approvers HR may since have changed - or, where
     * they had been cleared, to nobody at all: a request at Pending that no one could answer, which
     * is the state `createRequest` refuses outright. The caller resolves them (`approversFor`) and
     * refuses an empty list in the same words raising one does.
     */
    if (approverIds) {
      await tx.attendanceRequestApproval.deleteMany({ where: { requestId: request.id } });
      await createApprovals(tx, request.id, approverIds);
    }
    await tx.attendanceRequestApproval.updateMany({
      where: { requestId: request.id },
      data: { decision: "PENDING", remarks: null, decidedAt: null },
    });
    await tx.attendanceRequest.update({
      where: { id: request.id },
      data: { ...fields, status: "PENDING", decidedById: null, decidedAt: null, decisionRemarks: null },
    });
    await recordEvent(tx, request.id, "EDITED", user, null);
    return tx.attendanceRequest.findUnique({ where: { id: request.id }, include: requestInclude });
  });
}

/**
 * Takes the request's row, re-reads it, and asks the gate again - inside the transaction.
 *
 * The checks before a transaction ran against a row loaded moments earlier. An edit, a revert or a
 * delete sent while the last approver's answer was in flight passed on that stale `PENDING` row and
 * then wrote after the approval had committed. For a Correction or an Attendance Regularization that
 * defeated the freeze outright: `decide` had already written the day, and the edit flipped the
 * request back to Pending, leaving the day changed by an approval the request no longer records.
 *
 * `decide` has locked this row since the pre-release review; the raiser's verbs take the same lock,
 * so the two paths serialise against each other rather than each against itself.
 */
async function lockedRequest(tx, { request, raiserEmployeeId, allowed, verb }) {
  await tx.$queryRaw`SELECT id FROM attendance_request WHERE id = ${request.id} FOR UPDATE`;
  const current = await tx.attendanceRequest.findUnique({ where: { id: request.id }, include: { approvals: true } });
  assertRaiserMayAct(current || request, raiserEmployeeId, allowed, verb);
  return current || request;
}

/**
 * The one gate every raiser verb passes through: theirs, and in a status the verb can act on.
 *
 * Ownership is checked here rather than left to each controller - three verbs reach this, and a
 * check in one place cannot be the one somebody forgets. `linkedEmployeeIdFor` is the controller's
 * to resolve, since it needs the request's user; the id is what this compares, and a login with no
 * employee behind it owns nothing rather than matching a request whose `employeeId` is null.
 */
function assertRaiserMayAct(request, raiserEmployeeId, allowed, verb) {
  if (!request) throw Object.assign(new Error("That request could not be found."), { status: 404 });
  if (!raiserEmployeeId || request.employeeId !== raiserEmployeeId) {
    throw Object.assign(new Error("You can only change your own requests."), { status: 403 });
  }
  if (frozenByItsOwnApproval(request)) {
    throw badRequest("This request has already changed that day's attendance, so it can no longer be changed here. Raise a fresh request for the day instead.");
  }
  // Raised by attendance for a day worked, not by the person: theirs to see, the approvers' to decide.
  if (SYSTEM_REQUEST_TYPES.includes(String(request.type || ""))) throw badRequest(SYSTEM_REQUEST_REFUSAL);
  if (!allowed.includes(String(request.status || ""))) {
    throw badRequest(`This request has been ${String(request.status || "").toLowerCase().replace("_", " ")} and cannot be ${verb}.`);
  }
}

/**
 * The request id out of a URL, or a refusal saying so.
 *
 * `Number("abc")` is `NaN`, which Prisma throws on - handled as an unexplained failure, so a typo in
 * a link answered 500. Six routes read an id from the URL now, so the parse belongs in one place.
 */
async function loadRequestId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw badRequest("That link does not say which request it means.");
  return id;
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
      // An approved comp-off is a day off like a leave: the day taken reads as On leave, not Absent.
      if (request.type === "LEAVE" || request.type === "COMP_OFF") leaveDates.add(iso);
      if (request.type === "PERMISSION") {
        if (!permissionsByDate.has(iso)) permissionsByDate.set(iso, []);
        permissionsByDate.get(iso).push({ fromTime: request.fromTime, toTime: request.toTime });
      }
    }
  }
  return { leaveDates, permissionsByDate };
}

/**
 * One employee's Casual Leave (`casualLeaveLedger`), worked out through `throughIso`'s month: the
 * approved Leave on working days from the later of their joining date and the day attendance starts
 * being counted (the start of the year where neither is set). `extraDates` are days to take as if
 * approved - a request still pending, or one being asked for - for the Leave form's preview.
 * `excludeRequestId` leaves a request out, so an edit is not counted against itself. A leave day the
 * person logged in on anyway takes nothing: it was worked, and is paid as worked. `settings` and
 * `joinedIso` may be passed by a caller that has already read them - the payroll calculator does.
 */
async function casualLeaveFor(employeeId, throughIso, { client = prisma, extraDates = [], excludeRequestId = null, settings: given = null, joinedIso } = {}) {
  const settings = given || await readSettings(client);
  const { periodOf, endOf } = await casualLeavePeriods(settings, client);
  const throughMonth = periodOf(localIsoDate(calendarDay(throughIso)));
  if (!(Number(settings.casualLeavePerMonth) > 0)) return casualLeaveLedger({ settings, throughMonth, periodOf });
  const joined = joinedIso === undefined ? await joinedOn(employeeId, client) : joinedIso;
  const fromIso = laterIso(joined, attendanceStartIso(settings)) || `${throughMonth.slice(0, 4)}-01-01`;
  const monthEnd = calendarDay(endOf(throughMonth));
  const from = calendarDay(fromIso);
  const branchId = await branchForEmployee(employeeId, client);
  const [requests, holidayDates, worked] = await Promise.all([
    client.attendanceRequest.findMany({
      where: {
        employeeId: Number(employeeId), type: "LEAVE", status: "APPROVED",
        fromDate: { lte: monthEnd }, toDate: { gte: from },
        // Casual Leave only: a Loss of Pay leave never takes from the balance.
        ...CASUAL_LEAVE_ONLY,
        ...(excludeRequestId ? { id: { not: Number(excludeRequestId) } } : {}),
      },
      select: { fromDate: true, toDate: true },
    }),
    holidayDateSet(from, monthEnd, client, branchId),
    client.attendanceSession.findMany({
      // Every session is a login - `login_at` is required - so a session on the day is the day worked.
      where: { employeeId: Number(employeeId), workDate: { gte: from, lte: monthEnd } },
      select: { workDate: true },
    }),
  ]);
  // A leave only takes from the balance on a day that was owed - not a holiday or a weekly off - and
  // was not worked after all.
  const workedDates = new Set(worked.map((session) => localIsoDate(session.workDate)));
  const owed = (iso) => dayKindFor(iso, { settings, holidayDates }) === DAY_KINDS.WORKING && !workedDates.has(iso);
  const leaveDates = [...requests.flatMap((request) => eachDateInRange(request.fromDate, request.toDate)), ...extraDates].filter(owed);
  return casualLeaveLedger({ settings, fromIso, leaveDates, throughMonth, periodOf });
}

/**
 * The days a leave over `fromIso`-`toIso` takes: its working days (`dates`), and the days in it that are
 * not - each weekly off and declared holiday, with why (`skipped`: `{ date, reason }`, the reason
 * "Weekly off" or the holiday's name). 10-12 Oct with Sunday the 11th off is two days of leave.
 */
async function leaveSpan(fromIso, toIso, { settings = null, client = prisma, branchId = null } = {}) {
  const rules = settings || await readSettings(client);
  const from = calendarDay(fromIso);
  const to = calendarDay(toIso);
  // The requester's branch's holidays and the studio's - a day another branch is shut is leave here.
  const names = (await holidayCalendar(from, to, client)).namesFor(branchId);
  const holidayDates = new Set(names.keys());
  const dates = [];
  const skipped = [];
  for (const iso of eachDateInRange(from, to)) {
    const kind = dayKindFor(iso, { settings: rules, holidayDates });
    if (kind === DAY_KINDS.WORKING) dates.push(iso);
    else skipped.push({ date: iso, reason: kind === DAY_KINDS.HOLIDAY ? names.get(iso) || "Holiday" : "Weekly off" });
  }
  return { dates, skipped };
}

/**
 * Counts a leave's days as `leaveSpan` does - working days only - for many requests at once: one read
 * of the rules and the holidays across them all. Null where none of them is a leave.
 */
async function leaveDayCounter(requests = [], client = prisma) {
  const leaves = requests.filter((request) => request?.type === "LEAVE" && request.fromDate && request.toDate);
  if (!leaves.length) return null;
  const from = new Date(Math.min(...leaves.map((request) => calendarDay(request.fromDate).getTime())));
  const to = new Date(Math.max(...leaves.map((request) => calendarDay(request.toDate).getTime())));
  const [settings, holidays, branchOf] = await Promise.all([
    readSettings(client),
    holidayCalendar(from, to, client),
    branchesForEmployees(leaves.map((request) => request.employeeId), client),
  ]);
  // Counted against the requester's own holidays: a day only their branch is shut is not a day of leave.
  return (fromDate, toDate, employeeId = null) => eachDateInRange(calendarDay(fromDate), calendarDay(toDate))
    .filter((iso) => dayKindFor(iso, { settings, holidayDates: holidays.forBranch(branchOf.get(Number(employeeId)) ?? null) }) === DAY_KINDS.WORKING).length;
}

/**
 * What a "month" of Casual Leave is, as the settings say (`casualLeavePeriod`): `periodOf(iso)` names
 * the period a day belongs to (`YYYY-MM`) and `endOf(period)` is its last day.
 *
 * - CALENDAR_MONTH: the day's own month, to its last day.
 * - PAY_CYCLE: the payroll month whose pay cycle holds the day - the cycle Payroll rules set, read with
 *   every change to it the way the payroll register reads it (`settingsBook`, `periodFor`). October is
 *   25 Aug to 24 Sep with the cycle on the 25th, so a day belongs to the payroll month one or two after
 *   its own.
 */
/**
 * When the next Casual Leave year starts, either way it can be counted - for the settings screen to
 * name the day rather than leave it to be worked out: `CALENDAR_MONTH` the coming 1 January,
 * `PAY_CYCLE` the first day of the coming January payroll's cycle (25 Nov with the cycle on the 25th),
 * with the payroll year it opens.
 */
async function casualLeaveYearStarts(client = prisma, today = localIsoDate(calendarDay(new Date()))) {
  const year = Number(today.slice(0, 4));
  const { settingsBook, periodFor } = require("../payroll-register/settingsVersions");
  const settingsOf = await settingsBook(client);
  // This year's January payroll cycle may still be ahead (it starts in the November before).
  let payrollYear = year;
  while (periodFor(payrollYear, 1, settingsOf).from <= today) payrollYear += 1;
  return {
    CALENDAR_MONTH: { startsOn: `${year + 1}-01-01`, year: year + 1 },
    PAY_CYCLE: { startsOn: periodFor(payrollYear, 1, settingsOf).from, year: payrollYear },
  };
}

async function casualLeavePeriods(settings, client = prisma) {
  return attendancePeriods(settings?.casualLeavePeriod, client);
}

/**
 * The periods Attendance Rules count by - Casual Leave's months and the Permissions limit - as `kind`
 * says: CALENDAR_MONTH, or PAY_CYCLE (`casualLeavePeriods` above). `startOf(period)` is a period's first
 * day as `endOf` is its last.
 */
async function attendancePeriods(kind, client = prisma) {
  if (kind !== "PAY_CYCLE") {
    return {
      periodOf: (iso) => String(iso).slice(0, 7),
      startOf: (period) => `${period}-01`,
      endOf: (period) => { const [year, month] = period.split("-").map(Number); return localIsoDate(new Date(Date.UTC(year, month, 0))); },
    };
  }
  // Required here: the payroll register reads this module, so loading it at the top would be a circle.
  const { settingsBook, periodFor } = require("../payroll-register/settingsVersions");
  const settingsOf = await settingsBook(client);
  const key = (year, month) => `${year}-${String(month).padStart(2, "0")}`;
  const cycles = new Map();
  const cycleOf = (year, month) => {
    const at = key(year, month);
    if (!cycles.has(at)) cycles.set(at, periodFor(year, month, settingsOf));
    return cycles.get(at);
  };
  return {
    periodOf: (iso) => {
      const [year, month] = String(iso).slice(0, 7).split("-").map(Number);
      for (let ahead = 0; ahead <= 3; ahead += 1) {
        const at = new Date(Date.UTC(year, month - 1 + ahead, 1));
        const cycle = cycleOf(at.getUTCFullYear(), at.getUTCMonth() + 1);
        if (iso >= cycle.from && iso <= cycle.to) return key(at.getUTCFullYear(), at.getUTCMonth() + 1);
      }
      return key(year, month);
    },
    startOf: (period) => { const [year, month] = period.split("-").map(Number); return cycleOf(year, month).from; },
    endOf: (period) => { const [year, month] = period.split("-").map(Number); return cycleOf(year, month).to; },
  };
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * How many of their permissions an employee has used in the period `dateIso` falls in - Attendance
 * Rules' Permissions limit, `permissionsPerPeriod` a `permissionPeriod`. Counted: permissions pending,
 * sent back or approved on a day in that period; a rejected, reverted or deleted one is not.
 * `ignoreId` leaves out the request being edited. Answers `{ limit }` alone while there is no limit
 * (0), else `{ limit, used, label, from, to }` - the period named as the screen says it: "October 2026",
 * or on the pay cycle "October 2026's pay cycle".
 */
async function permissionUsage(employeeId, dateIso, { client = prisma, settings: given = null, ignoreId = null } = {}) {
  const settings = given || await readSettings(client);
  const limit = Number(settings.permissionsPerPeriod) || 0;
  if (limit <= 0) return { limit: 0 };
  const byPayCycle = settings.permissionPeriod === "PAY_CYCLE";
  const { periodOf, startOf, endOf } = await attendancePeriods(settings.permissionPeriod, client);
  const period = periodOf(dateIso);
  const from = startOf(period);
  const to = endOf(period);
  const used = await client.attendanceRequest.count({
    where: {
      employeeId: Number(employeeId), type: "PERMISSION", status: { in: ["PENDING", "SENT_BACK", "APPROVED"] },
      fromDate: { gte: calendarDay(from), lte: calendarDay(to) },
      ...(ignoreId ? { id: { not: Number(ignoreId) } } : {}),
    },
  });
  /*
   * What the screen calls the period.
   *
   * On the pay cycle it is just **"this pay cycle"**. It read "November 2026's pay cycle", where the
   * month was the *payroll* month rather than the month the dates are in - 25 Sep to 24 Oct is
   * November's cycle - so the one part of the name a reader would lean on was the part most likely
   * to mislead them. The dates travel beside it (`from`, `to`), and the only question anybody asks
   * of this figure is how many permissions are left in the period they are in now.
   *
   * By the calendar month it stays the month's own name, which says exactly what it counts.
   */
  const [year, month] = period.split("-").map(Number);
  const label = byPayCycle ? "this pay cycle" : `${MONTH_NAMES[month - 1]} ${year}`;
  return { limit, used, label, from, to };
}

/**
 * The day an employee's attendance is owed from - their joining date, as `YYYY-MM-DD` - or null where
 * none is recorded. Before it there was nobody to be absent: the register, the Dashboard and the
 * salary calculator already start there, and the employee's own page now does too.
 */
async function joinedOn(employeeId, client = prisma) {
  if (!client.employee?.findUnique) return null;
  const row = await client.employee.findUnique({ where: { id: Number(employeeId) }, select: { dateOfJoining: true } });
  return row?.dateOfJoining ? localIsoDate(row.dateOfJoining) : null;
}

/** The employee's past stints' gaps (`EmployeeRejoin`), for `awayBetweenStints`; none where it cannot be read. */
async function rejoinGaps(employeeId, client = prisma) {
  if (!client.employeeRejoin?.findMany) return [];
  return client.employeeRejoin.findMany({ where: { employeeId: Number(employeeId) }, select: { leftOn: true, rejoinedOn: true } });
}

/**
 * When one employee did not work here, for their own day rows and totals - the same two things the
 * register asks of everybody through `leftBefore`: after their last day (`dateOfRelieving`), and
 * between a past stint and their rejoining. `notHere(iso)` answers for a day.
 */
async function stintBounds(employeeId, client = prisma) {
  const [row, gaps] = await Promise.all([
    client.employee?.findUnique ? client.employee.findUnique({ where: { id: Number(employeeId) }, select: { dateOfRelieving: true } }) : null,
    rejoinGaps(employeeId, client),
  ]);
  const employee = { dateOfRelieving: row?.dateOfRelieving || null, rejoins: gaps };
  return { notHere: (iso) => leftBefore(employee, iso) };
}

/** The first day a range owes attendance on: its start, or the joining date where that is later. */
const owedFrom = (start, joined) => (joined && joined > localIsoDate(start) ? calendarDay(joined) : calendarDay(start));

/**
 * What a session's day reads as if it closed at `at` - its logout, or now for one still open - by the
 * same rules the register and the employee's own page use (`attendanceDayStatus`), with the day's
 * approved permissions and any Correction. For the Logout box (what logging out now would mark the
 * day as) and the box after it (what it was marked as). `status` is null for a day before attendance
 * started being counted, which is marked as nothing.
 */
async function dayReadingAt(employeeId, session, at = new Date(), client = prisma) {
  const day = calendarDay(session.workDate);
  const iso = localIsoDate(day);
  const branchId = await branchForEmployee(employeeId, client);
  const [settings, holidayDates, { leaveDates, permissionsByDate }, overrides, optional, flexible] = await Promise.all([
    readSettings(client),
    holidayDateSet(day, day, client, branchId),
    approvedTimeOff(employeeId, day, day, client),
    statusOverridesFor({ employeeIds: [employeeId], start: day, end: day }, client),
    isAttendanceOptional(employeeId, client),
    isFlexibleShiftAllowed(employeeId, client),
  ]);
  const closed = { ...session, logoutAt: session.logoutAt || at };
  const goLive = attendanceStartIso(settings);
  const { status } = attendanceDayStatus(closed, {
    settings,
    dayKind: dayKindFor(iso, { settings, holidayDates, leaveDates }),
    permissions: permissionsByDate.get(iso) || [],
    today: at,
    now: at,
    optional,
    flexible,
    override: overrides.get(`${employeeId}|${iso}`) || null,
  });
  return { date: iso, status: goLive && iso < goLive ? null : status, workedMinutes: workedMinutes(closed) };
}

/**
 * One row per calendar day in the range: what the day was, what was recorded against it, and how
 * that reads. Days with no session are included — an unexplained absence is a fact about the month
 * that a list of only the days somebody turned up can never show.
 *
 * From the joining date only: a day before somebody joined is not an absence, so it is left out -
 * unless something was recorded on it, which stays, as the register keeps it. And from the day
 * attendance starts being counted (`attendanceStartIso`) only: a day before it is left out whatever
 * was recorded on it. `joined` comes back as the later of the two - the day this person is counted from.
 */
async function attendanceDays(employeeId, start, end, client = prisma) {
  const branchId = await branchForEmployee(employeeId, client);
  const [settings, holidayDates, { leaveDates, permissionsByDate }, sessions, optional, overrides, joined, flexible, gaps] = await Promise.all([
    readSettings(client),
    holidayDateSet(start, end, client, branchId),
    approvedTimeOff(employeeId, start, end, client),
    client.attendanceSession.findMany({
      where: { employeeId, workDate: { gte: calendarDay(start), lte: calendarDay(end) } },
      orderBy: { workDate: "desc" },
    }),
    isAttendanceOptional(employeeId, client),
    statusOverridesFor({ employeeIds: [employeeId], start, end }, client),
    joinedOn(employeeId, client),
    isFlexibleShiftAllowed(employeeId, client),
    stintBounds(employeeId, client),
  ]);
  const sessionsByDate = new Map(sessions.map((session) => [localIsoDate(session.workDate), session]));
  const breaksBySession = await breakSummariesFor(sessions.map((session) => session.id), client, sessions);
  const goLive = attendanceStartIso(settings);
  const days = eachDateInRange(start, end)
    // Nor a day they did not work here - after their last day, or between a past stint and their
    // rejoining - unless they did log in that day.
    .filter((iso) => (!goLive || iso >= goLive) && (!joined || iso >= joined || sessionsByDate.has(iso)) && (sessionsByDate.has(iso) || !gaps.notHere(iso)))
    .reverse()
    .map((iso) => {
      const session = sessionsByDate.get(iso) || null;
      const kind = dayKindFor(iso, { settings, holidayDates, leaveDates });
      const { status, tone } = attendanceDayStatus(session, { settings, dayKind: kind, permissions: permissionsByDate.get(iso) || [], today: new Date(), date: iso, optional, flexible, override: overrides.get(`${employeeId}|${iso}`) || null });
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
        // The day's breaks: how many, and how long in all. Reported beside the hours, not taken off them.
        breakCount: session ? breaksBySession.get(session.id)?.count || 0 : 0,
        breakMinutes: session ? breaksBySession.get(session.id)?.totalMinutes || 0 : 0,
        faceVerified: session ? session.loginFaceVerified : null,
        loginLocation: session?.loginLatitude != null
          ? { latitude: Number(session.loginLatitude), longitude: Number(session.loginLongitude), accuracy: session.loginAccuracyM }
          : null,
      };
    });
  // The holidays come back with the days because the caller needs them again to work out the
  // target, and reading them twice for one screen is a query nobody asked for.
  return { settings, holidayDates, days, optional, joined: laterIso(joined, goLive) };
}

/** Range totals: what was worked, what the range owed, and how the days broke down. */
async function attendanceSummary(employeeId, start, end, client = prisma) {
  const { settings, holidayDates, days, optional, joined } = await attendanceDays(employeeId, start, end, client);
  // What the range owed starts at the joining date: the target and the working days count from there.
  const owedStart = owedFrom(start, joined);
  const workedTotal = days.reduce((sum, day) => sum + day.minutes, 0);
  const count = (status) => days.filter((day) => day.status === status).length;
  return {
    days,
    settings,
    attendanceOptional: optional,
    totals: {
      workedMinutes: workedTotal,
      breakCount: days.reduce((sum, day) => sum + (day.breakCount || 0), 0),
      breakMinutes: days.reduce((sum, day) => sum + (day.breakMinutes || 0), 0),
      targetMinutes: targetMinutesForRange(owedStart, end, { settings, holidayDates }),
      // Days attended, not days with a login. Since a day can now be short enough to read as an
      // absence while still having a check-in on it, counting logins would report somebody present
      // on a day the same response calls Absent.
      // A Half day is half present and half absent (`dayShares`), so both can be x.5.
      present: days.reduce((sum, day) => sum + dayShares(day.status).present, 0),
      completed: days.filter((day) => day.logoutAt).length,
      onTime: count("On time"),
      late: count("Late"),
      permitted: count("Permitted"),
      halfDay: count("Half day"),
      earlyExit: count("Early exit"),
      // A login nobody logged out of within 18 hours reads Absent on an owed day, so it is in here -
      // and half of every Half day.
      absent: days.reduce((sum, day) => sum + dayShares(day.status).absent, 0),
      onLeave: count("On leave"),
      notLoggedOut: count("Not logged out"),
      notRequired: count(NOT_REQUIRED_STATUS),
      // The days the range actually owed, weekends and holidays removed — the denominator every
      // other figure here is read against, and the one the screen had to guess at before.
      workingDays: workingDaysInRange(owedStart, end, { settings, holidayDates }),
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
function serialiseRequest(request, now = new Date(), { forRequester = false, approverNames = new Map(), countLeaveDays = null } = {}) {
  // A leave counts its working days - a weekly off or a declared holiday in it is no day of leave -
  // where the caller read them (`leaveDayCounter`); anything else, and a caller that did not, its span.
  const days = request.type === "LEAVE" && countLeaveDays ? countLeaveDays(request.fromDate, request.toDate, request.employeeId) : leaveDayCount(request.fromDate, request.toDate);
  const minutes = request.type === "PERMISSION" ? permissionMinutes(request.fromTime, request.toTime) : null;
  /*
   * A refusal is the studio's answer to the person who asked, not one named colleague's
   * (`requesterMaySeeApprovers`). The approver list was withheld from them but the refuser's name
   * still rode along as the decider and on the history's approve / reject lines, readable in the
   * response by anybody who looked.
   */
  const anonymous = forRequester && !requesterMaySeeApprovers(request.status);
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
    workedDate: request.workedDate ? localIsoDate(request.workedDate) : "",
    /*
     * The run a comp-off credit covers, and what it was granted - the approver's dialog needs the run
     * to know how far its list of amounts goes (0, 0.5 … up to the days worked), and the requester
     * needs the grant to see that a day worked earned half a day rather than one.
     */
    workedToDate: request.workedToDate ? localIsoDate(request.workedToDate) : "",
    // The second half day a comp-off claim spent, where two halves bought the day off between them.
    workedPairDate: request.workedPairDate ? localIsoDate(request.workedPairDate) : "",
    grantedDays: request.grantedDays === null || request.grantedDays === undefined ? null : Number(request.grantedDays),
    // A leave's kind - CL or LOP (one raised before the choice existed reads CL); "" for anything else.
    leaveType: request.type === "LEAVE" ? request.leaveType || "CL" : "",
    // An Incorrect Login request's day as read when it was raised, and the status asked for.
    currentStatus: request.currentStatus || "",
    requestedStatus: request.requestedStatus || "",
    days,
    durationMinutes: minutes,
    durationLabel: minutes === null ? "" : formatDurationMinutes(minutes),
    reason: request.reason,
    supersedesId: request.supersedesId || null,
    decidedByName: anonymous ? "" : request.decidedBy?.employeeName || "",
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
    approvers: anonymous ? [] : approvalProgress(request, approverNames),
    events: (request.events || []).map((event) => ({
      id: event.id,
      action: event.action,
      actorName: anonymous && ["APPROVED", "REJECTED"].includes(event.action) ? "" : event.actorName,
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
      regularizationApproverEmployeeId: true,
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
 * The days behind this employee that still need something doing about them.
 *
 * Only logins nobody logged out of within 18 hours (`sessionExpired`), which read Absent - with no
 * Correction already pending or approved about them - a day somebody has already asked about is not
 * still asking, and an approved one has been answered. `now` is an instant, so a login
 * still inside its 18 hours is somebody at work rather than a day to fix. Bounded to a fortnight:
 * this is a nudge on the attendance screen, not a backlog report, and an employee returning from a
 * month away should not be met with twenty of them.
 */
async function openPastDays(employeeId, now, client = prisma) {
  const fortnight = calendarDay(new Date(calendarDay(now).getTime() - 14 * 86400000));
  // Nothing before attendance starts being counted is owed a correction.
  const goLive = attendanceStartIso(await readSettings(client));
  const from = goLive && calendarDay(goLive) > fortnight ? calendarDay(goLive) : fortnight;
  const sessions = (await client.attendanceSession.findMany({
    where: { employeeId, logoutAt: null, workDate: { gte: from } },
    orderBy: { workDate: "desc" },
    select: { id: true, workDate: true, loginAt: true, lastLoginAt: true, logoutAt: true },
  })).filter((session) => sessionExpired(session, now));
  if (!sessions.length) return [];

  const asked = await client.attendanceRequest.findMany({
    where: {
      employeeId,
      // An old logout-time correction still pending or approved covers its day as well, and so
      // does an Extra Time - the logout already sent for approval is the day being dealt with.
      type: { in: ["CORRECTION", "INCORRECT_LOGIN", "EXTRA_TIME"] },
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
 * The session a login, a logout or a break acts on right now, or null.
 *
 * Today's, where there is one. Where there is not, yesterday's if it is still a login - open,
 * uncorrected and inside its 18 hours - because a login at 21:30 is logged out of at 02:00 on the
 * next calendar day, and until then it, not a fresh day, is what the header offers Logout for. A
 * login past its 18 hours is an Incorrect login and is nobody's current session: it does not block
 * the next day's login, and nothing further is written to it.
 */
async function currentSession(employeeId, now = new Date(), client = prisma) {
  const today = calendarDay(now);
  const yesterday = calendarDay(new Date(today.getTime() - 86400000));
  const [todays, previous] = await Promise.all([
    client.attendanceSession.findUnique({ where: { employeeId_workDate: { employeeId, workDate: today } } }),
    client.attendanceSession.findUnique({ where: { employeeId_workDate: { employeeId, workDate: yesterday } } }),
  ]);
  if (todays) return todays;
  if (previous && !previous.logoutAt && !sessionExpired(previous, now)) return previous;
  return null;
}

/**
 * Writes an approved Correction onto the day it corrects: the status it asked for, as the day's
 * `attendance_status_override` row - with or without a login behind the day, so correcting an absence
 * to Present never invents a login. The request keeps who approved it and what the day read as.
 *
 * Only while the day still reads as it did when the request was raised (`currentStatus`), read with
 * the same classification the dashboard uses: a day HR edited, a later logout, or another Correction
 * since then answers false and nothing is written, rather than a newer answer being overwritten.
 * Where the day is a login that expired with a break still open, that break is ended where the login
 * expired - no Break Off is recorded, because nobody pressed one - and the correction is logged on
 * the day as a STATUS_CORRECTED event.
 */
async function applyCorrectionStatus(client, { request, user }) {
  const workDate = calendarDay(request.fromDate);
  const { days } = await attendanceDays(request.employeeId, workDate, workDate, client);
  // A request raised while such a day still read "Incorrect Login" is about the same day, which
  // reads Absent now.
  const asked = request.currentStatus === "Incorrect Login" ? "Absent" : request.currentStatus;
  if (!request.requestedStatus || correctionStatusOf(days[0]?.status) !== asked) return false;
  await client.attendanceStatusOverride.upsert({
    where: { employeeId_workDate: { employeeId: request.employeeId, workDate } },
    create: { employeeId: request.employeeId, workDate, status: request.requestedStatus, requestId: request.id },
    update: { status: request.requestedStatus, requestId: request.id },
  });
  const session = await client.attendanceSession.findUnique({ where: { employeeId_workDate: { employeeId: request.employeeId, workDate } } });
  if (session) {
    if (sessionExpired(session)) await closeOpenBreaks(client, session.id, sessionExpiresAt(session));
    await client.attendanceEvent.create({
      data: {
        sessionId: session.id,
        employeeId: session.employeeId,
        // Its own type, like CHECK_OUT_CORRECTED: no selfie and no position, because nobody captured one.
        type: "STATUS_CORRECTED",
        capturedAt: new Date(),
        locationNote: `Attendance Regularization #${request.id}: ${request.currentStatus} to ${request.requestedStatus}, approved by ${user?.name || "an approver"}.`.slice(0, 255),
      },
    });
  }
  return true;
}

/**
 * Writes an approved correction onto the day it corrects.
 *
 * The session row is updated - it is the day as it currently reads - and an `AttendanceEvent` is
 * appended saying who decided it and what it changed, because the original capture must survive the
 * correction. That pairing is the whole reason the event table exists: without it, approving a
 * correction would be indistinguishable from the employee having checked out at that time.
 */
/**
 * Ends every break still running on a day that is being closed at `at`, as a logout does.
 *
 * A logout closes them itself; a day closed any other way - an approved correction, an HR edit -
 * left the break open, and a running break is measured up to now, so its length and the dashboard's
 * break totals went on growing for a day that was long over. A break that began after the time the
 * day is closed at is ended where it began rather than given a negative length.
 */
async function closeOpenBreaks(client, sessionId, at) {
  await client.attendanceBreak.updateMany({ where: { sessionId, endedAt: null, startedAt: { lte: at } }, data: { endedAt: at } });
  const late = await client.attendanceBreak.findMany({ where: { sessionId, endedAt: null }, select: { id: true, startedAt: true } });
  for (const row of late) await client.attendanceBreak.update({ where: { id: row.id }, data: { endedAt: row.startedAt } });
}

async function applyCorrection(client, { request, session, checkOutAt, user }) {
  await client.attendanceSession.update({ where: { id: session.id }, data: { logoutAt: checkOutAt } });
  await closeOpenBreaks(client, session.id, checkOutAt);
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
 * The birthdays and wedding anniversaries that fall on `iso`, among the people working here.
 *
 * Only current employees - active and not archived - since a greeting for somebody who has left is
 * not one anybody wants to read. Matched on the month and day alone and answered with names only:
 * the year somebody was born or married is theirs, and the register has no need of it. A birthday
 * on 29 February is marked on the 28th in a year without one, rather than skipped. Read through
 * `localIsoDate`, so a date stored as midnight UTC and one stored as local midnight both give the
 * day that was typed in.
 */
function celebrationsOn(iso, employees, branchName) {
  const [year, month, day] = iso.split("-").map(Number);
  const monthDay = iso.slice(5);
  const leapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const alsoLeapDay = month === 2 && day === 28 && !leapYear;
  const falls = (value) => {
    if (!value) return false;
    const other = localIsoDate(value).slice(5);
    return other === monthDay || (alsoLeapDay && other === "02-29");
  };
  const working = employees.filter((employee) => !employee.archivedAt && employee.employmentStatus === "Active");
  const person = (employee) => ({ employeeId: employee.id, employeeName: employee.employeeName, branchName: branchName.get(employee.branchId) || null });
  // Whole years since joining - a work anniversary is the 1st onwards, never the joining day itself.
  const yearsSince = (value) => year - Number(localIsoDate(value).slice(0, 4));
  return {
    birthdays: working.filter((employee) => falls(employee.dateOfBirth)).map(person),
    anniversaries: working.filter((employee) => falls(employee.weddingAnniversary)).map(person),
    // Only where the caller read `dateOfJoining` (Settings → Wishes does); empty otherwise.
    workAnniversaries: working.filter((employee) => falls(employee.dateOfJoining) && yearsSince(employee.dateOfJoining) >= 1)
      .map((employee) => ({ ...person(employee), years: yearsSince(employee.dateOfJoining) })),
  };
}

/**
 * The register's **Irregularities**: whoever is Absent - away with no approved leave, comp-off or
 * permission - as the register decides it, so the card and the table can never disagree.
 *
 * Somebody allowed a flexible shift works when they choose, often at night, so their day is only
 * judged once it is over: they never appear for the day being shown, only for the day before it,
 * once that whole day has gone by. Everybody else appears for the day being shown, from the moment
 * the register reads them Absent (after the shift's start with no login).
 *
 * A leave or comp-off asked for and still waiting on its approvers does not excuse the day, but it is
 * said beside it (`pendingRequest`), since that absence is about to be explained.
 *
 * `register` is the day's register where the caller already read it whole; one narrowed by a status
 * or a search would hide absences, so without it the day is read again, narrowed by branch alone.
 */
async function registerIrregularities(day, { branchId = null, register = null } = {}) {
  const date = calendarDay(day);
  const previous = new Date(date.getTime() - 24 * 60 * 60 * 1000);
  const [today, yesterday] = await Promise.all([
    register || attendanceRegister(date, { branchId }),
    attendanceRegister(previous, { branchId }),
  ]);
  const absent = (rows, flexible) => (rows || []).filter((row) => row.status === "Absent" && Boolean(row.flexible) === flexible);
  const found = [
    ...absent(today.rows, false).map((row) => ({ row, date: today.date })),
    ...absent(yesterday.rows, true).map((row) => ({ row, date: yesterday.date })),
  ];
  if (!found.length) return [];

  const pending = await prisma.attendanceRequest.findMany({
    where: {
      status: "PENDING",
      type: { in: ["LEAVE", "COMP_OFF"] },
      employeeId: { in: [...new Set(found.map(({ row }) => row.employeeId))] },
      fromDate: { lte: date },
      toDate: { gte: previous },
    },
    select: { employeeId: true, type: true, fromDate: true, toDate: true },
  });
  const pendingOn = (employeeId, iso) => pending.find((request) => request.employeeId === employeeId
    && localIsoDate(request.fromDate) <= iso && localIsoDate(request.toDate) >= iso)?.type || null;

  return found.map(({ row, date: iso }) => ({
    employeeId: row.employeeId,
    employeeCode: row.employeeCode,
    employeeName: row.employeeName,
    branchName: row.branchName,
    date: iso,
    flexible: Boolean(row.flexible),
    // Logged in but not long enough for a half day, or never logged out, against no login at all.
    loggedIn: Boolean(row.checkInAt),
    workedLabel: row.workedLabel || "",
    pendingRequest: pendingOn(row.employeeId, iso),
  }));
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

  const [settings, holidays, sessions] = await Promise.all([
    readSettings(),
    holidayCalendar(date, date),
    prisma.attendanceSession.findMany({ where: { workDate: date } }),
  ]);
  const sessionByEmployee = new Map(sessions.map((session) => [session.employeeId, session]));

  /*
   * The roster as it stood on that day, not as it stands today. Somebody who worked the day is on
   * it even if they have since left - a past register that loses a day's attendance because the
   * person was relieved later is wrong about that day. And somebody who had not joined yet is not
   * on it at all, where the roster of today used to mark every new joiner Absent on every day
   * before they started.
   */
  const candidates = await prisma.employee.findMany({
    where: {
      OR: [{ archivedAt: null, employmentStatus: "Active" }, { id: { in: [...sessionByEmployee.keys()] } }],
      ...(branchId ? { branchId: Number(branchId) } : {}),
    },
    orderBy: { employeeName: "asc" },
    select: {
      id: true, employeeId: true, employeeName: true, department: true, designation: true, branchId: true, dateOfJoining: true,
      // For the day's birthdays and wedding anniversaries - read for the month and day alone.
      employmentStatus: true, archivedAt: true, dateOfBirth: true, weddingAnniversary: true, dateOfRelieving: true,
      rejoins: REJOIN_GAPS,
      // Not absent today until today is over, for somebody allowed a Flexible Shift.
      allowFlexibleShift: true,
    },
  });
  // Before attendance starts being counted, nobody is on the register at all, whatever was recorded.
  const goLive = attendanceStartIso(settings);
  // And only between their joining day and their last day (`dateOfRelieving`): somebody who has left is
  // not Absent from a studio they no longer work at. A day they did log in is on it whatever the dates.
  const onRoster = goLive && iso < goLive ? [] : candidates.filter((employee) => sessionByEmployee.has(employee.id)
    || ((!employee.dateOfJoining || localIsoDate(employee.dateOfJoining) <= iso) && !leftBefore(employee, iso)));
  /*
   * Super Admins - and anybody ticked Exclude From Attendance - are not on the register at all: not
   * as a row, not in any count, not in the birthdays beside it. Attendance is optional for them, and
   * a register that counts them makes the day's figures about somebody the studio does not track.
   * Their own day, if they mark one, is still on their own Employee Attendance page. One query for
   * the roster.
   */
  const superAdminIds = await attendanceOptionalEmployeeIds(onRoster.map((employee) => employee.id));
  const employees = onRoster.filter((employee) => !superAdminIds.has(employee.id));
  // The check-in photograph for the register's card, by its event id - the only handle the guarded
  // selfie endpoint takes. One query for the day, the earliest check-in per session.
  const checkInEvents = sessions.length ? await prisma.attendanceEvent.findMany({
    where: { sessionId: { in: sessions.map((session) => session.id) }, type: "CHECK_IN", OR: [{ selfieKey: { not: null } }, { selfieData: { not: null } }] },
    orderBy: { capturedAt: "asc" },
    select: { id: true, sessionId: true },
  }) : [];
  const checkInSelfieBySession = new Map();
  for (const event of checkInEvents) if (!checkInSelfieBySession.has(event.sessionId)) checkInSelfieBySession.set(event.sessionId, event.id);
  /*
   * Where the day was logged in from, for the card: the street address the check-in resolved to.
   * The address is filled in a moment after the capture (`fillEventAddress`), so it lives on the
   * event; until it arrives - or where the lookup found nothing - the coordinates stand in for it.
   * The earliest check-in per session, like the photograph. No verdict: without office locations
   * there is nothing to measure against, and "Unverified" on every card said nothing.
   */
  const placeEvents = sessions.length ? await prisma.attendanceEvent.findMany({
    where: { sessionId: { in: sessions.map((session) => session.id) }, type: "CHECK_IN", OR: [{ locationAddress: { not: null } }, { latitude: { not: null } }] },
    orderBy: { capturedAt: "asc" },
    select: { sessionId: true, locationAddress: true, latitude: true, longitude: true },
  }) : [];
  const loginPlaceBySession = new Map();
  for (const event of placeEvents) {
    if (loginPlaceBySession.has(event.sessionId)) continue;
    loginPlaceBySession.set(event.sessionId, placeText(event.locationAddress, event.latitude, event.longitude));
  }
  const branches = await prisma.branch.findMany({ select: { id: true, name: true } });
  const branchName = new Map(branches.map((branch) => [branch.id, branch.name]));

  // One query for the whole roster rather than one per person: "was anybody away today" is a single
  // range test, and a studio of two hundred would otherwise be two hundred round trips.
  const approved = await prisma.attendanceRequest.findMany({
    where: { status: "APPROVED", type: { in: ["LEAVE", "COMP_OFF", "PERMISSION"] }, fromDate: { lte: date }, toDate: { gte: date } },
    select: { employeeId: true, type: true, fromTime: true, toTime: true, workedDate: true, workedPairDate: true },
  });
  const onLeave = new Set(approved.filter((request) => request.type === "LEAVE" || request.type === "COMP_OFF").map((request) => request.employeeId));
  // Which of those days away is a comp-off, and the holiday it was earned on - so the day can be said
  // as a comp-off rather than as leave. The status stays On leave either way.
  // Both days where two half days bought the day off between them: naming only the first would say
  // the day off came from one day worked when it cost two.
  const compOffFor = new Map(approved.filter((request) => request.type === "COMP_OFF")
    .map((request) => [request.employeeId, [request.workedDate, request.workedPairDate].filter(Boolean).map((date) => localIsoDate(date)).join(" and ")]));
  /*
   * A leave or comp-off asked for this day and still waiting on its approvers. It changes nothing
   * about the day - only an approved one makes it On leave - but the daily report says such a person
   * is on leave with approval pending rather than calling them uninformed (`reportText.js`).
   */
  const pending = await prisma.attendanceRequest.findMany({
    where: { status: "PENDING", type: { in: ["LEAVE", "COMP_OFF", "PERMISSION"] }, fromDate: { lte: date }, toDate: { gte: date } },
    select: { employeeId: true, type: true, fromTime: true, toTime: true },
  });
  const leavePendingBy = new Map(pending.filter((request) => request.type !== "PERMISSION").map((request) => [request.employeeId, request.type]));
  /*
   * A permission asked for this day and still waiting on its approvers. Like a pending leave it changes
   * nothing about the day; the daily report lists the person under Permission, said to be pending,
   * rather than as Uninformed Leave while it covers the time of the report (`reportText.js`).
   */
  const pendingPermissionsBy = new Map();
  for (const request of pending.filter((entry) => entry.type === "PERMISSION")) {
    if (!pendingPermissionsBy.has(request.employeeId)) pendingPermissionsBy.set(request.employeeId, []);
    pendingPermissionsBy.get(request.employeeId).push({ fromTime: request.fromTime, toTime: request.toTime });
  }
  const permissionsBy = new Map();
  for (const request of approved.filter((entry) => entry.type === "PERMISSION")) {
    if (!permissionsBy.has(request.employeeId)) permissionsBy.set(request.employeeId, []);
    permissionsBy.get(request.employeeId).push({ fromTime: request.fromTime, toTime: request.toTime });
  }

  const now = new Date();
  /*
   * Who is at work at this moment, for the Available card: logged in today and not logged out, the
   * login still inside its 18 hours, not on a break, and not inside an approved permission's window.
   * A day a Correction has set to something other than attended (On leave, Absent) is not available
   * either, open login or not - the register says what the correction says. Only today has a "now" -
   * a past day's register has nobody available.
   */
  const isToday = iso === localIsoDate(now);
  // The studio's clock, as the permission's times are - not the server's.
  const nowMinutes = minutesOfDay(now);
  const inPermissionNow = (permissions) => permissions.some((permission) => {
    const from = parseClockTime(permission.fromTime);
    const to = parseClockTime(permission.toTime);
    return from !== null && to !== null && from <= nowMinutes && nowMinutes < to;
  });
  const overrides = await statusOverridesFor({ employeeIds: employees.map((employee) => employee.id), start: date, end: date });
  // The day's breaks, per session - for the Break card and column.
  const breaksBySession = await breakSummariesFor(sessions.map((session) => session.id), prisma, sessions);
  const rows = employees.map((employee) => {
    const session = sessionByEmployee.get(employee.id) || null;
    const breaks = session ? breaksBySession.get(session.id) || null : null;
    const kind = dayKindFor(iso, { settings, holidayDates: holidays.forBranch(employee.branchId), leaveDates: onLeave.has(employee.id) ? new Set([iso]) : new Set() });
    const override = overrides.get(`${employee.id}|${iso}`) || null;
    const verdict = attendanceDayStatus(session, { settings, dayKind: kind, permissions: permissionsBy.get(employee.id) || [], today: now, date: iso, flexible: employee.allowFlexibleShift === true, override });
    // Inside one of their approved permissions' windows at this moment - logged in or not.
    const onPermission = isToday && inPermissionNow(permissionsBy.get(employee.id) || []);
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
      // Allowed a flexible shift on their login - whose day is only judged once it is over.
      flexible: employee.allowFlexibleShift === true,
      checkInAt: session?.loginAt || null,
      checkOutAt: session?.logoutAt || null,
      checkInSelfieEventId: session ? checkInSelfieBySession.get(session.id) || null : null,
      loginPlace: session
        ? loginPlaceBySession.get(session.id) || placeText(null, session.loginLatitude, session.loginLongitude)
        : null,
      workedMinutes: minutes,
      workedLabel: minutes ? formatDurationMinutes(minutes) : "—",
      // The login's verdict alone, which is what the Outside location count below is about.
      locationVerified: session ? Boolean(session.loginLocationVerified) : null,
      distanceMeters: session?.loginDistanceMeters ?? null,
      status: verdict.status,
      tone: verdict.tone,
      // Whether the day counts as attended - the one test the Present card counts by
      // (`isAttendedStatus`), sent so the register's boxes sort people by it too. A login is not
      // enough: a day shorter than the half-day floor reads as Absent, login and all.
      attended: isAttendedStatus(verdict.status),
      // The day's approved permissions, `{ fromTime, toTime }` each, and whether it is a comp-off
      // (the worked day, or "" where none was recorded; null for no comp-off). For the Send report.
      permissions: permissionsBy.get(employee.id) || [],
      // The same, for permissions asked for this day and not yet approved.
      pendingPermissions: pendingPermissionsBy.get(employee.id) || [],
      compOffFor: compOffFor.has(employee.id) ? compOffFor.get(employee.id) : null,
      // "LEAVE" or "COMP_OFF" where one is asked for this day and not yet approved, else null.
      leavePending: onLeave.has(employee.id) ? null : leavePendingBy.get(employee.id) || null,
      // The day's breaks: how many, how long in all, and whether one is running now.
      breakCount: breaks?.count || 0,
      breakMinutes: breaks?.totalMinutes || 0,
      breakLabel: breaks?.count ? breaks.totalLabel : "—",
      onBreak: Boolean(breaks?.onBreak),
      onPermission,
      available: Boolean(isToday && session && !session.logoutAt && !sessionExpired(session, now)
        && !breaks?.onBreak && !onPermission
        && (!override || isAttendedStatus(override))),
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
    // Of those on leave, how many are taking a comp-off; and how many have an approved permission.
    compOff: countOf((row) => row.status === "On leave" && row.compOffFor !== null),
    permission: countOf((row) => row.permissions.length > 0),
    // Who is away on a permission at this moment - the Permissions card. The day's count above stays
    // for the Send report; a permission already over, or still to come, is not counted here.
    onPermission: countOf((row) => row.onPermission),
    // Who is on a break at this moment - a break started and not yet ended. Somebody whose breaks are
    // all over is back at work and not counted; their day's break time stays on the row.
    onBreak: countOf((row) => row.onBreak),
    // Who is working at this moment - in, not out, not on a break and not away on a permission.
    available: countOf((row) => row.available),
    notCheckedOut: countOf((row) => row.checkInAt && !row.checkOutAt),
    outsideLocation: countOf((row) => row.sessionId && row.locationVerified === false),
  };

  // Word Chunk Search: every word typed, any order, each in any of these columns.
  const filtered = rows.filter((row) => {
    if (status && row.status !== status) return false;
    return matchesWordChunks([row.employeeName, row.employeeCode, row.department, row.designation].map((value) => String(value || "")).join("\n"), search);
  });

  return { date: iso, summary, rows: filtered, celebrations: celebrationsOn(iso, employees, branchName) };
}

/**
 * One range's tally of the studio's attendance - the figures `attendanceOverview` below reads twice,
 * once for the range asked for and once for the period before it.
 *
 * The register answers "who is in today"; the summary answers "how has my month gone". Neither
 * answers "how has the studio's month gone", which is the one question an administrator has: they
 * do not mark their own day, so their own summary is empty, and reading the register once per date
 * would be a request per day.
 *
 * Every verdict comes from the same `attendanceDayStatus` the register and the summary use, over
 * the same `dayKindFor`, so a figure here and the register's card for a day in the range cannot
 * disagree - which they would the moment a second copy of the rules was written for this screen.
 *
 * A fixed number of queries whatever the range's length - the settings, the holidays, the sessions,
 * the approved time off, the branches, then the roster and which of it attendance is optional for -
 * never one per day. The days are then walked in memory.
 *
 * `branchId` narrows the roster the same way the register's does, and `employeeIds` to the people
 * picked. Attendance-optional logins (Super Admins) are left out of every figure, as they are on the
 * register.
 *
 * **`branchId` is a filter the caller chose, not a reach check**, and it is only safe as one while
 * the endpoint above stays an administrator's. If it is ever opened to a permission, the branches
 * have to come from `reachableBranchIds(user, { module, feature })` and the roster through
 * `dataScope` in the same change - otherwise somebody narrowed to one branch reads every branch by
 * leaving the parameter off.
 */
/** A captured position as `{ latitude, longitude }`, or null where none was captured. */
function coordinatesOf(latitude, longitude) {
  if (latitude === null || latitude === undefined || longitude === null || longitude === undefined) return null;
  const lat = Number(latitude);
  const lng = Number(longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { latitude: lat, longitude: lng } : null;
}

/**
 * Who used which time off in the range, from the approved requests already read - the Dashboard's
 * Casual Leave, Permissions and Comp-offs cards. Only the people on the roster (`employees`, already
 * narrowed by the filters), and only days from their joining and from the day attendance is counted.
 *
 * - **Casual Leave**: approved Leave that is not Loss of Pay, a day for each working day it covers - a
 *   weekly off or a holiday in it is not a day of leave.
 * - **Permissions**: approved permissions, how many and how long in all.
 * - **Comp-offs**: approved comp-off days off taken in the range, working days only.
 *
 * Each list is one row per person - `{ employeeId, employeeCode, employeeName, branchName, days,
 * count, minutes, dates }` - the most first.
 */
/*
 * `holidays` is the range's per-branch calendar (`holidayCalendar`), answered per employee; a caller
 * with one Set of dates for everybody - the function's own tests - may still pass `holidayDates`.
 */
/**
 * Whether `iso` (YYYY-MM-DD) is a day the employee did not work here: after their last day
 * (`dateOfRelieving`), or between a past stint's last day and the day they rejoined
 * (`awayBetweenStints`). Attendance does not count them on such a day: not Absent, not owed a day,
 * not on the roster. A last day itself counts, and so does a rejoining day.
 */
function leftBefore(employee, iso) {
  const last = employee?.dateOfRelieving ? localIsoDate(employee.dateOfRelieving) : null;
  return (Boolean(last) && iso > last) || awayBetweenStints(employee?.rejoins, iso);
}

/**
 * Whether `iso` falls strictly between a stint's last day and the day they came back
 * (`EmployeeRejoin.leftOn` / `rejoinedOn`) - the time they had left the studio. `rejoins` is the
 * employee's rows, `[{ leftOn, rejoinedOn }]`; none means no gap.
 */
function awayBetweenStints(rejoins, iso) {
  return (rejoins || []).some((row) => iso > localIsoDate(row.leftOn) && iso < localIsoDate(row.rejoinedOn));
}

/** What a roster query selects for `leftBefore` to see the gaps between stints. */
const REJOIN_GAPS = { select: { leftOn: true, rejoinedOn: true } };

function timeOffUsed(approved, employees, { branchName, settings, holidays = null, holidayDates = null, goLive, start, end }) {
  const holidaysFor = (employee) => (holidays ? holidays.forBranch(employee.branchId) : holidayDates);
  const roster = new Map(employees.map((employee) => [employee.id, employee]));
  const lists = { casualLeave: new Map(), permissions: new Map(), compOffs: new Map() };
  const rowOf = (list, employee) => {
    if (!list.has(employee.id)) {
      list.set(employee.id, {
        employeeId: employee.id,
        employeeCode: employee.employeeId || "",
        employeeName: employee.employeeName || "",
        branchName: branchName.get(employee.branchId) || null,
        days: 0, count: 0, minutes: 0, dates: [],
      });
    }
    return list.get(employee.id);
  };
  for (const request of approved) {
    const employee = roster.get(request.employeeId);
    // Loss of Pay leave is not Casual Leave used.
    if (!employee || (request.type === "LEAVE" && request.leaveType === "LOP")) continue;
    const joined = employee.dateOfJoining ? localIsoDate(employee.dateOfJoining) : null;
    const spanFrom = request.fromDate > start ? request.fromDate : start;
    const spanTo = request.toDate < end ? request.toDate : end;
    for (const iso of eachDateInRange(spanFrom, spanTo)) {
      if ((goLive && iso < goLive) || (joined && iso < joined) || leftBefore(employee, iso)) continue;
      if (request.type === "PERMISSION") {
        const row = rowOf(lists.permissions, employee);
        row.count += 1;
        row.minutes += permissionMinutes(request.fromTime, request.toTime) || 0;
        row.dates.push(iso);
        continue;
      }
      if (dayKindFor(iso, { settings, holidayDates: holidaysFor(employee) }) !== DAY_KINDS.WORKING) continue;
      // A day is counted once, even under two approved requests that overlap on it.
      rowOf(request.type === "LEAVE" ? lists.casualLeave : lists.compOffs, employee).dates.push(iso);
    }
  }
  const ranked = (list, by) => [...list.values()]
    .map((row) => {
      const dates = [...new Set(row.dates)].sort();
      return { ...row, dates, days: by === "days" ? dates.length : row.days };
    })
    .sort((a, b) => b[by] - a[by] || a.employeeName.localeCompare(b.employeeName));
  return { casualLeave: ranked(lists.casualLeave, "days"), permissions: ranked(lists.permissions, "count"), compOffs: ranked(lists.compOffs, "days") };
}

/**
 * `withPeople` also names, on each day of `byDay`, who was Absent and who was On leave
 * (`absentPeople` / `onLeavePeople`) - what the calendar's Team Attendance layer lists for an
 * administrator. Off by default: the Dashboard reads only the counts.
 */
async function tallyRange(start, end, { branchId = null, employeeIds = null, withTimeOff = true, withPeople = false } = {}) {
  const dates = eachDateInRange(start, end);

  const [settings, holidays, sessions, approved, branches] = await Promise.all([
    readSettings(),
    holidayCalendar(start, end),
    /*
     * Only the columns the verdict and the figures are made of. A session row also carries the
     * selfie key, the coordinates and the resolved address of both captures, and none of that is
     * read here - a year of a large studio would be hundreds of thousands of rows dragged into
     * memory for six numbers.
     */
    prisma.attendanceSession.findMany({
      where: { workDate: { gte: start, lte: end } },
      select: { id: true, employeeId: true, workDate: true, loginAt: true, lastLoginAt: true, logoutAt: true, awayMinutes: true, workMode: true, loginLatitude: true, loginLongitude: true, logoutLatitude: true, logoutLongitude: true },
    }),
    prisma.attendanceRequest.findMany({
      where: { status: "APPROVED", type: { in: ["LEAVE", "COMP_OFF", "PERMISSION"] }, fromDate: { lte: end }, toDate: { gte: start } },
      select: { employeeId: true, type: true, leaveType: true, fromDate: true, toDate: true, fromTime: true, toTime: true },
    }),
    prisma.branch.findMany({ select: { id: true, name: true } }),
  ]);

  /*
   * The roster as it stood across the range, read the way the register reads one day: anybody
   * active now, plus anybody who worked a day in the range even if they have since left. A joiner
   * is counted only from their joining date, which is tested per day below.
   */
  const workedIds = [...new Set(sessions.map((session) => session.employeeId))];
  const candidates = await prisma.employee.findMany({
    where: {
      OR: [{ archivedAt: null, employmentStatus: "Active" }, { id: { in: workedIds } }],
      ...(branchId ? { branchId: Number(branchId) } : {}),
      // The Employee filter: only the people picked, and still only those on the roster above - a
      // person picked who was not employed across the range is not invented onto it.
      ...(employeeIds?.length ? { id: { in: employeeIds } } : {}),
    },
    orderBy: { employeeName: "asc" },
    select: { id: true, employeeId: true, employeeName: true, department: true, designation: true, branchId: true, dateOfJoining: true, dateOfRelieving: true, allowFlexibleShift: true, rejoins: REJOIN_GAPS },
  });
  const [optionalIds, breaksBySession] = await Promise.all([
    attendanceOptionalEmployeeIds(candidates.map((employee) => employee.id)),
    // Every break in the range, summed per session in one query - the Employees table's Break Time.
    breakSummariesFor(sessions.map((session) => session.id), prisma, sessions),
  ]);
  const employees = candidates.filter((employee) => !optionalIds.has(employee.id));

  const branchName = new Map(branches.map((branch) => [branch.id, branch.name]));
  const sessionByKey = new Map(sessions.map((session) => [`${session.employeeId}|${localIsoDate(session.workDate)}`, session]));

  // The approved time off spread over the dates it covers, so a day can be tested without walking
  // the request list again for every employee and every date.
  const leaveByEmployee = new Map();
  const permissionsByKey = new Map();
  for (const request of approved) {
    // Clamped to the range before it is walked rather than after: a request may cover months on
    // either side of what was asked for, and every date outside it would be built only to be
    // dropped.
    const spanFrom = request.fromDate > start ? request.fromDate : start;
    const spanTo = request.toDate < end ? request.toDate : end;
    for (const iso of eachDateInRange(spanFrom, spanTo)) {
      if (request.type === "PERMISSION") {
        const key = `${request.employeeId}|${iso}`;
        if (!permissionsByKey.has(key)) permissionsByKey.set(key, []);
        permissionsByKey.get(key).push({ fromTime: request.fromTime, toTime: request.toTime });
      } else {
        if (!leaveByEmployee.has(request.employeeId)) leaveByEmployee.set(request.employeeId, new Set());
        leaveByEmployee.get(request.employeeId).add(iso);
      }
    }
  }

  const now = new Date();
  const blank = () => ({ present: 0, absent: 0, late: 0, onLeave: 0, halfDay: 0, earlyExit: 0, permission: 0, workedMinutes: 0, marked: 0 });
  // A login nobody logged out of within 18 hours reads Absent on an owed day, so "Absent" counts it.
  const add = (into, verdict, session, permissions) => {
    // A Half day is half of each (`dayShares`).
    const share = dayShares(verdict.status);
    into.present += share.present;
    into.absent += share.absent;
    if (verdict.status === "Late") into.late += 1;
    if (verdict.status === "On leave") into.onLeave += 1;
    if (verdict.status === "Half day") into.halfDay += 1;
    if (verdict.status === "Early exit") into.earlyExit += 1;
    if (permissions.length) into.permission += 1;
    into.workedMinutes += workedMinutes(session);
    if (session) into.marked += 1;
  };

  const totals = blank();
  /*
   * Each day says what kind of day it was for the studio - a holiday and a weekly off are the same
   * for everybody, where leave is one person's - so a row of noughts on a Sunday reads as a day off
   * rather than as a day nobody was recorded.
   */
  /*
   * The range's own figures - a day's kind in the by-day strip, the working days, the target - are
   * read for the branch being asked about, or for the studio (its studio-wide holidays alone) when
   * every branch is. A day one branch is shut is not a holiday in a figure that spans them all; each
   * person's verdict below is still judged on their own branch's holidays.
   */
  const holidayDates = holidays.forBranch(branchId);
  const byDay = new Map(dates.map((iso) => [iso, { date: iso, dayKind: dayKindFor(iso, { settings, holidayDates }), ...blank(), ...(withPeople ? { absentPeople: [], onLeavePeople: [] } : {}) }]));
  const byBranch = new Map();
  const byEmployee = new Map();

  const overrides = await statusOverridesFor({ employeeIds: employees.map((employee) => employee.id), start, end });
  // Days before attendance starts being counted owe nothing and count nothing, for anybody.
  const goLive = attendanceStartIso(settings);
  for (const employee of employees) {
    const joined = employee.dateOfJoining ? localIsoDate(employee.dateOfJoining) : null;
    const leaveDates = leaveByEmployee.get(employee.id) || new Set();
    const person = { employeeId: employee.id, employeeCode: employee.employeeId, employeeName: employee.employeeName, branchName: branchName.get(employee.branchId) || null, department: employee.department || null, ...blank() };
    // The day's times, gathered to be averaged below, and the breaks added up.
    const clock = { checkIns: [], checkOuts: [], breakMinutes: 0 };
    // Where the latest login and logout in the range were captured - the day itself over one day.
    let loginLocation = null;
    let logoutLocation = null;
    // How they worked - Office, Work from home, Field work, Flexible Shift - the latest day in the
    // range that says, the day itself over one day, as the locations are.
    let workMode = null;

    for (const iso of dates) {
      const session = sessionByKey.get(`${employee.id}|${iso}`) || null;
      // Not on the roster before they joined - the register makes the same test, so that a new
      // joiner is not marked absent for every day of a month they had not started.
      if (!session && joined && iso < joined) continue;
      // Nor after their last day: somebody relieved is not Absent from then on (`leftBefore`).
      if (!session && leftBefore(employee, iso)) continue;
      if (goLive && iso < goLive) continue;
      const permissions = permissionsByKey.get(`${employee.id}|${iso}`) || [];
      const kind = dayKindFor(iso, { settings, holidayDates: holidays.forBranch(employee.branchId), leaveDates });
      const verdict = attendanceDayStatus(session, { settings, dayKind: kind, permissions, today: now, date: iso, flexible: employee.allowFlexibleShift === true, override: overrides.get(`${employee.id}|${iso}`) || null });

      add(totals, verdict, session, permissions);
      add(byDay.get(iso), verdict, session, permissions);
      if (withPeople && (verdict.status === "Absent" || verdict.status === "On leave")) {
        byDay.get(iso)[verdict.status === "Absent" ? "absentPeople" : "onLeavePeople"].push({
          employeeId: employee.id, employeeCode: employee.employeeId, employeeName: employee.employeeName,
          branchId: employee.branchId ?? null, branchName: branchName.get(employee.branchId) || null,
          department: employee.department || null, designation: employee.designation || null,
        });
      }
      add(person, verdict, session, permissions);
      if (session) {
        // Read on the studio's clock, as `minutesOfDay` reads a login for Late - so an average here
        // and a day marked late are measured the same way, whatever zone the server runs in.
        const checkIn = minutesOfDay(session.loginAt);
        if (checkIn != null) clock.checkIns.push(checkIn);
        // A day not yet checked out of has no check-out time to average, rather than a zero.
        const checkOut = session.logoutAt ? minutesOfDay(session.logoutAt) : null;
        if (checkOut != null) clock.checkOuts.push(checkOut);
        clock.breakMinutes += breaksBySession.get(session.id)?.totalMinutes || 0;
        loginLocation = coordinatesOf(session.loginLatitude, session.loginLongitude) || loginLocation;
        logoutLocation = coordinatesOf(session.logoutLatitude, session.logoutLongitude) || logoutLocation;
        workMode = workModeLabel(session.workMode) || workMode;
      }

      const key = employee.branchId ?? 0;
      if (!byBranch.has(key)) byBranch.set(key, { branchId: employee.branchId ?? null, branchName: branchName.get(employee.branchId) || "No branch", ...blank() });
      add(byBranch.get(key), verdict, session, permissions);
    }
    const average = (list) => (list.length ? Math.round(list.reduce((sum, value) => sum + value, 0) / list.length) : null);
    /*
     * A range has many check-ins, so the table shows their average - minutes since local midnight,
     * which over a single day is simply that day's time. Null where there were none, so a person who
     * never checked in reads as a dash rather than as midnight.
     */
    person.avgCheckInMinutes = average(clock.checkIns);
    person.avgCheckOutMinutes = average(clock.checkOuts);
    // Break time is reported beside the worked hours, not taken off them - the same as on the
    // employee's own summary (`attendanceDays`).
    person.breakMinutes = clock.breakMinutes;
    person.loginLocation = loginLocation;
    person.logoutLocation = logoutLocation;
    person.workMode = workMode;
    byEmployee.set(employee.id, person);
  }

  // Owed from the day attendance starts being counted, where that falls inside the range.
  const owedNothing = Boolean(goLive && goLive > localIsoDate(end));
  const owedStart = goLive && goLive > localIsoDate(start) ? calendarDay(goLive) : start;
  const workingDays = owedNothing ? 0 : workingDaysInRange(owedStart, end, { settings, holidayDates });
  // Of the days the range actually owed, how many were attended. Read against present + absent
  // rather than against every date, so weekly offs and holidays cannot dilute it.
  const rateOf = (tally) => {
    const owed = tally.present + tally.absent;
    return owed ? Math.round((tally.present / owed) * 100) : null;
  };
  const people = [...byEmployee.values()].map((person) => ({ ...person, attendanceRate: rateOf(person) }));

  return {
    range: { from: dates[0], to: dates[dates.length - 1], days: dates.length, workingDays },
    headcount: employees.length,
    totals: {
      ...totals,
      // Each person's own target, added up: a branch with a holiday of its own owes fewer hours
      // that month than the branch next to it, and the studio's total is the sum of what each owes.
      targetMinutes: owedNothing ? 0 : employees.reduce((sum, employee) => sum + targetMinutesForRange(owedStart, end, { settings, holidayDates: holidays.forBranch(employee.branchId) }), 0),
      attendanceRate: rateOf(totals),
    },
    byDay: dates.map((iso) => byDay.get(iso)),
    byBranch: [...byBranch.values()].sort((a, b) => b.present - a.present),
    // Everybody on the roster with their own figures for the range - the table under the cards,
    // which the cards narrow.
    employees: people,
    // Who the range went worst for.
    mostAbsent: people.filter((person) => person.absent > 0).sort((a, b) => b.absent - a.absent).slice(0, 5),
    mostLate: people.filter((person) => person.late > 0).sort((a, b) => b.late - a.late).slice(0, 5),
    // Who took Casual Leave, permissions and comp-offs in the range - the three cards at the foot.
    // Not worked out for the period a range is compared against, which shows only its totals.
    timeOff: withTimeOff ? timeOffUsed(approved, employees, { branchName, settings, holidays, goLive, start, end }) : null,
  };
}

/** The figures the Dashboard's cards show, and so the ones each carries an arrow for. */
// `permission` with them: approved short time off is a card of its own, because a day somebody was
// out for an hour is not the same as a day they were not here (`AdminAttendanceDashboard.js`).
const OVERVIEW_TREND_KEYS = ["present", "absent", "onLeave", "late", "halfDay", "earlyExit", "permission"];

/**
 * The studio's attendance over a **range** - what the administrator's Dashboard reads - with every
 * card's change against the period of the same length just before it.
 *
 * Each figure answers "how much", and the arrow beside it "is that more or less than usual" - which
 * a count on its own cannot, because thirty days of a studio of twenty is always a large number.
 * The comparison is the same filters over the same number of days ending the day before this range
 * starts: this month's first twenty-nine days against the twenty-nine before them, rather than
 * against all of last month, which would be a longer period and read as a fall every time.
 *
 * Both periods go through `tallyRange`, and so through the same rules - the previous one is not an
 * estimate. Filters narrow both identically, so picking three people compares those three with
 * themselves.
 */
async function attendanceOverview(from, to, { branchId = null, employeeIds = null } = {}) {
  const start = calendarDay(from);
  const end = calendarDay(to);
  const span = eachDateInRange(start, end).length;
  const previousEnd = new Date(start);
  previousEnd.setUTCDate(previousEnd.getUTCDate() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setUTCDate(previousStart.getUTCDate() - (span - 1));

  const [current, previous] = await Promise.all([
    tallyRange(start, end, { branchId, employeeIds }),
    tallyRange(previousStart, previousEnd, { branchId, employeeIds, withTimeOff: false }),
  ]);

  const trend = Object.fromEntries(OVERVIEW_TREND_KEYS.map((key) => [key, {
    before: previous.totals[key],
    delta: current.totals[key] - previous.totals[key],
  }]));

  return { ...current, previousRange: previous.range, trend };
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
 * A captured position as one line: the address where there is one, otherwise the coordinates to
 * five places (about a metre), otherwise null - nothing was captured.
 */
function placeText(address, latitude, longitude) {
  const text = String(address || "").trim();
  if (text) return text;
  if (latitude == null || longitude == null) return null;
  return `${Number(latitude).toFixed(5)}, ${Number(longitude).toFixed(5)}`;
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
  const branchId = await branchForEmployee(employeeId, client);
  const [settings, holidayDates, { leaveDates, permissionsByDate }, sessions, optional, overrides, joined, flexible, gaps] = await Promise.all([
    readSettings(client),
    holidayDateSet(start, end, client, branchId),
    approvedTimeOff(employeeId, start, end, client),
    client.attendanceSession.findMany({
      where: { employeeId, workDate: { gte: calendarDay(start), lte: calendarDay(end) } },
      orderBy: { workDate: "asc" },
    }),
    isAttendanceOptional(employeeId, client),
    statusOverridesFor({ employeeIds: [employeeId], start, end }, client),
    joinedOn(employeeId, client),
    isFlexibleShiftAllowed(employeeId, client),
    stintBounds(employeeId, client),
  ]);
  // Owed from the joining date, as the day rows are: working days, leave and absences start there.
  // Counted from the later of the joining date and the day attendance starts being counted.
  const goLive = attendanceStartIso(settings);
  const owedStart = owedFrom(start, laterIso(joined, goLive));

  const now = new Date();
  const counts = { onTime: 0, late: 0, permitted: 0, halfDay: 0, earlyExit: 0, notLoggedOut: 0, notRequired: 0 };
  const byStatus = {
    "On time": "onTime", Late: "late", Permitted: "permitted", "Half day": "halfDay",
    "Early exit": "earlyExit", "Not logged out": "notLoggedOut",
    [NOT_REQUIRED_STATUS]: "notRequired",
  };

  let workedTotal = 0;
  let completed = 0;
  // Breaks across the range: the same per-session summary, added up.
  const breaksBySession = await breakSummariesFor(sessions.map((session) => session.id), client, sessions);
  const breakCount = [...breaksBySession.values()].reduce((sum, entry) => sum + entry.count, 0);
  const breakMinutes = [...breaksBySession.values()].reduce((sum, entry) => sum + entry.totalMinutes, 0);
  /*
   * Only the days something was recorded against are read: a session, or a Correction's status (which
   * may stand on a day with no login - an absence corrected to Present). Everything else in the range
   * is worked out below from the calendar. A day too short to earn a half day reads as an absence, so
   * attendance is counted by status, not by login - in either direction.
   */
  const sessionByDate = new Map(sessions.map((session) => [localIsoDate(session.workDate), session]));
  const overrideByDate = new Map([...overrides].map(([key, status]) => [key.slice(key.indexOf("|") + 1), status]));
  let attended = 0;
  for (const iso of new Set([...sessionByDate.keys(), ...overrideByDate.keys()])) {
    if (goLive && iso < goLive) continue;
    const session = sessionByDate.get(iso) || null;
    const kind = dayKindFor(iso, { settings, holidayDates, leaveDates });
    const { status } = attendanceDayStatus(session, { settings, dayKind: kind, permissions: permissionsByDate.get(iso) || [], today: now, optional, flexible, override: overrideByDate.get(iso) || null });
    const key = byStatus[status];
    if (key) counts[key] += 1;
    // Half a day for a Half day (`dayShares`), so the other half is left in the absences below.
    attended += dayShares(status).present;
    if (session) {
      workedTotal += workedMinutes(session);
      if (session.logoutAt) completed += 1;
    }
  }

  // Less the working days they did not work here - after their last day, or between a past stint
  // and their rejoining - so those are not owed, and so not absences.
  const awayDays = eachDateInRange(owedStart, end).filter((iso) => gaps.notHere(iso) && !sessionByDate.has(iso) && dayKindFor(iso, { settings, holidayDates }) === DAY_KINDS.WORKING);
  const workingDays = workingDaysInRange(owedStart, end, { settings, holidayDates }) - awayDays.length;

  /*
   * Leave only counts where it fell on a day that was owed. A week off that covers a Sunday and a
   * public holiday is five days of leave, not seven, and counting the other two would make the
   * absences below come out short by exactly that many.
   */
  const from = localIsoDate(owedStart);
  const to = localIsoDate(end);
  // A Correction to On leave is leave on that day; one to anything else is no longer leave.
  const owedDay = (iso) => iso >= from && iso <= to && dayKindFor(iso, { settings, holidayDates }) === DAY_KINDS.WORKING;
  const leaveDays = new Set([...leaveDates].filter((iso) => owedDay(iso) && (!overrideByDate.has(iso) || overrideByDate.get(iso) === "On leave")));
  for (const [iso, status] of overrideByDate) if (status === "On leave" && owedDay(iso)) leaveDays.add(iso);
  const onLeave = leaveDays.size;

  // What is left once the days worked and the days agreed off are taken out. Floored at zero: a
  // session on a holiday is a real thing and must not push this negative. None for somebody
  // attendance is optional for - a day they did not mark was not owed. A login nobody logged out of on an
  // owed day is neither attended nor leave, so it is left in here: it counts as an absence, as it
  // does in `attendanceSummary`.
  // Today, before the shift starts, an owed day with nothing on it yet is not an absence yet - nor,
  // for somebody allowed a Flexible Shift, at any hour of today.
  const todayIso = localIsoDate(now);
  const pendingToday = owedDay(todayIso) && !sessionByDate.has(todayIso) && !overrideByDate.has(todayIso) && !leaveDays.has(todayIso)
    && notInYet(todayIso, now, settings, flexible) ? 1 : 0;
  const absent = optional ? 0 : Math.max(0, workingDays - attended - onLeave - pendingToday);

  return {
    settings,
    attendanceOptional: optional,
    totals: {
      workedMinutes: workedTotal,
      breakCount,
      breakMinutes,
      targetMinutes: targetMinutesForRange(owedStart, end, { settings, holidayDates }) - awayDays.reduce((sum, iso) => sum + targetMinutesForRange(calendarDay(iso), calendarDay(iso), { settings, holidayDates }), 0),
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
      // Null as well where attendance is optional: there is no owed attendance to rate.
      attendanceRate: workingDays && !optional ? Math.round(((attended + onLeave) / workingDays) * 100) : null,
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
async function recordApproverDecision(client, { request, approverEmployeeId, decision, remarks, grantedDays = undefined }) {
  /*
   * This approver's own row, whatever it currently says.
   *
   * It used to take `decision: "PENDING"` as well, so an answer could never be overwritten - which
   * is still the rule, but it is `mayAnswer` that holds it now, in the one place that knows the
   * whole picture. Narrowing by PENDING here would silently drop the one reversal that is allowed
   * (a rejection becoming an approval): `updateMany` matching nothing writes nothing and reports no
   * error, and the request would be recomputed from rows that never changed.
   */
  await client.attendanceRequestApproval.updateMany({
    where: { requestId: request.id, approverEmployeeId },
    data: {
      decision,
      remarks: remarks || null,
      decidedAt: new Date(),
      /*
       * How much **this** approver would grant, on a comp-off credit. Written only when one was sent,
       * so an approver answering any other kind of request leaves the column null rather than
       * stamping a nought on it - and a rejection carries no amount, because refusing is not granting
       * zero: the two read differently in the history.
       */
      ...(grantedDays === undefined || decision !== "APPROVED" ? {} : { grantedDays }),
    },
  });
  const rows = await client.attendanceRequestApproval.findMany({ where: { requestId: request.id } });
  return outcomeOf(rows, request.type);
}

/** The names behind a set of approver ids, for a list that should say who rather than which id. */
async function approverNamesFor(requests, client = prisma) {
  const ids = [...new Set((requests || []).flatMap((request) => (request.approvals || []).map((row) => row.approverEmployeeId)))];
  if (!ids.length) return new Map();
  const employees = await client.employee.findMany({ where: { id: { in: ids } }, select: { id: true, employeeName: true } });
  return new Map(employees.map((employee) => [employee.id, employee.employeeName]));
}

module.exports = {
  awayBetweenStints,
  rejoinGaps,
  stintBounds,
  timeOffUsed,
  dayReadingAt,
  // The studio's attendance settings (shift, weekly offs), for readers outside this module - Nebula's
  // attendance lookup works out "the last five working days" from the same calendar the register uses.
  readSettings,
  applyCorrectionStatus,
  statusOverridesFor,
  currentSession,
  approverNamesFor,
  approversFor,
  needsPermissionApprover,
  regularizationApproverOf,
  attendanceDetail,
  createApprovals,
  recordApproverDecision,
  sendBack,
  revert,
  remove,
  edit,
  loadRequestId,
  RAISER_MAY_EDIT,
  assertRaiserMayAct,
  frozenByItsOwnApproval,
  attendanceTotals,
  fillEventAddress,
  leaveVisibleEmployeeIds,
  attendanceRegister,
  leftBefore,
  registerIrregularities,
  attendanceOverview,
  // The calendar's Team Attendance layer reads its per-day names (`withPeople`).
  tallyRange,
  applyCorrection,
  celebrationsOn,
  closeOpenBreaks,
  openPastDays,
  deleteOfficeLocation,
  evaluateCapture,
  listOfficeLocations,
  officeLocationFor,
  recordCapture,
  saveOfficeLocation,
  APPROVAL_FEATURE,
  APPROVAL_MODULE,
  DAY_KINDS,
  approvedTimeOff,
  attendanceDays,
  attendanceSummary,
  canDecide,
  canDecideWith,
  myDecisionWith,
  employeeForUser,
  linkedEmployeeIdFor,
  holidayDateSet,
  attendanceOptionalEmployeeIds,
  isAttendanceOptional,
  isFlexibleShiftAllowed,
  casualLeaveFor,
  casualLeavePeriods,
  attendancePeriods,
  leaveSpan,
  leaveDayCounter,
  permissionUsage,
  casualLeaveYearStarts,
  attendanceExcludedEmployeeIds,
  isExcludedFromAttendance,
  NOT_EXCLUDED,
  isAttendanceAdmin,
  canReadRegister,
  canManageRules,
  seesAllRequests,
  isNamedApprover,
  seesAttendanceLogs,
  readSettings,
  recordEvent,
  requestInclude,
  saveSettings,
  serialiseRequest,
  visibilityFilter,
};
