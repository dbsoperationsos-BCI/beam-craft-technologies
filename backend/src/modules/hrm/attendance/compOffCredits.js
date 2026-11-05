const prisma = require("../../../config/db");
const { holidayCalendar, branchForEmployee } = require("../../../services/holidayCalendar");
const {
  attendanceStartIso,
  calendarDay,
  compOffExpiresOn,
  earnsCompOff,
  formatDurationMinutes,
  fullDayWorked,
  localIsoDate,
  workedMinutes,
} = require("./attendanceRules");

/**
 * Comp-Off credits: a weekly off or holiday worked earns a comp-off only once it is approved.
 *
 * Attendance alone used to earn one - a full day logged on a weekly off or declared holiday was a
 * comp-off the moment the ledger was next written. Now that day is put to the employee's Leave
 * Approvers as a COMP_OFF_CREDIT request, raised by attendance itself (`ensureCreditRequests`), and
 * the comp-off exists only once **every** one of them has approved it - the same unanimous decision,
 * the same queue, history and veto a leave goes through (`approvals.js`), not a second approval system.
 *
 * Everything that reads whether a worked day earned a comp-off asks `creditCleared` - the ledger
 * (`ledgers.compOffRows`, which is the balance), the Raise Request picker (`listMyCompOffOptions`)
 * and the server's own refusal (`compOffProblem`) - so the three cannot disagree. A credit is never a
 * row of its own: the ledger is rebuilt from attendance and approved requests, and has one row per
 * employee and day worked (its unique key), so however many times an approval is replayed, a day
 * earns one comp-off.
 *
 * Days worked before `compOffApprovalFrom` (the day the rule went live) keep the rule they were earned
 * under, so nobody loses a comp-off they had already been shown.
 */

const CREDIT_TYPE = "COMP_OFF_CREDIT";
// Approvers are told of a credit for a day worked this recently; an older one - raised late, after a
// Leave Approver was named or a holiday declared afterwards - waits in their queue without a notice each,
// so naming somebody's approver does not send a burst of them.
const NOTIFY_WITHIN_DAYS = 7;
const MS_PER_DAY = 86400000;
// Who the request's history names as having raised it: nobody pressed a button.
const SYSTEM_ACTOR = { id: null, name: "Attendance (automatic)" };

const creditKey = (employeeId, iso) => `${Number(employeeId)}:${iso}`;

/**
 * The day the approval rule went live, `YYYY-MM-DD` - or null where it has not: a settings row from
 * before the rule (a database restored from an older copy) keeps the old rule rather than hiding
 * every comp-off ever earned and putting every holiday ever worked up for approval at once.
 */
function approvalFromIso(settings) {
  const value = settings?.compOffApprovalFrom;
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/** Whether a day worked on `iso` may count as a comp-off: before the rule went live, or approved. */
function creditCleared(iso, settings, approvedDates) {
  const from = approvalFromIso(settings);
  if (!from || iso < from) return true;
  return approvedDates.has(iso);
}

/** The days an employee's comp-off credits stand at, by day worked: `Map<iso, status>`. */
async function creditStatuses(employeeId, client = prisma) {
  const rows = await client.attendanceRequest.findMany({
    where: { employeeId: Number(employeeId), type: CREDIT_TYPE, workedDate: { not: null } },
    select: { workedDate: true, status: true },
  });
  return new Map(rows.map((row) => [localIsoDate(row.workedDate), row.status]));
}

/** The days whose credit every approver has approved - the only ones `creditCleared` lets through. */
async function approvedCreditDates(employeeId, client = prisma) {
  const statuses = await creditStatuses(employeeId, client);
  return new Set([...statuses].filter(([, status]) => status === "APPROVED").map(([iso]) => iso));
}

/** Why a worked day cannot be used yet because of its approval, or null. Said in the form's words. */
async function creditProblem(employeeId, workedIso, settings, client = prisma) {
  const from = approvalFromIso(settings);
  if (!from || workedIso < from) return null;
  const status = (await creditStatuses(employeeId, client)).get(workedIso);
  if (status === "APPROVED") return null;
  const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${workedIso}T00:00:00.000Z`));
  if (status === "REJECTED") return `Your work on ${day} was not approved as a comp-off, so it cannot be used.`;
  if (status === "PENDING" || status === "SENT_BACK") return `Your work on ${day} is still waiting for your approvers, so it cannot be used as a comp-off yet.`;
  return `Your work on ${day} has not been approved as a comp-off yet.`;
}

/**
 * Raises the COMP_OFF_CREDIT request for every weekly off or holiday this employee worked a full day
 * on, from the day the rule went live, that has none yet - each to every Leave Approver named on
 * their record, who are told as for any request.
 *
 * Called whenever the ledger is written (`ledgers.rebuildEmployee`) - after a logout, a request
 * decided, a holiday or Attendance Rules changed - so a day is put up once it is a full day worked,
 * and a holiday declared afterwards puts up the days worked on it. Idempotent: the database refuses a
 * second request for the same employee and day (`credit_key`), so two writes at once raise one, and a
 * request rejected is never raised again. Somebody with no Leave Approver named gets none - nobody
 * could decide it - and it is raised once one is named. Never throws into the ledger.
 */
async function ensureCreditRequests(employeeId, { client = prisma, settings, notify = null, today = localIsoDate(calendarDay(new Date())) } = {}) {
  const id = Number(employeeId);
  if (!Number.isInteger(id) || id <= 0) return { raised: 0 };
  const service = require("./service");
  const rules = settings || await service.readSettings(client);
  const employee = await client.employee.findUnique({
    where: { id },
    select: { id: true, archivedAt: true, excludeFromAttendance: true, leaveApprover1EmployeeId: true, leaveApprover2EmployeeId: true, leaveApprover3EmployeeId: true, permissionApproverEmployeeId: true, regularizationApproverEmployeeId: true },
  });
  if (!employee || employee.archivedAt || employee.excludeFromAttendance) return { raised: 0 };
  const approverIds = service.approversFor(employee, CREDIT_TYPE);
  if (!approverIds.length) return { raised: 0 };
  // Not live yet (no date): days are earned as they always were, and nothing is put up for approval.
  const liveFrom = approvalFromIso(rules);
  if (!liveFrom) return { raised: 0 };

  // Only days that could still be used: from the rule going live (and attendance being counted), and
  // where comp-offs expire, no further back than the expiry - an older day could never be taken.
  const expiryDays = Number(rules?.compOffExpiryDays);
  const usableFrom = Number.isInteger(expiryDays) && expiryDays > 0 ? localIsoDate(new Date(calendarDay(today).getTime() - expiryDays * MS_PER_DAY)) : null;
  const from = [liveFrom, attendanceStartIso(rules), usableFrom].filter(Boolean).sort().at(-1);
  const sessions = await client.attendanceSession.findMany({
    where: { employeeId: id, logoutAt: { not: null }, ...(from ? { workDate: { gte: calendarDay(from) } } : {}) },
    select: { workDate: true, loginAt: true, logoutAt: true, awayMinutes: true },
    orderBy: { workDate: "asc" },
  });
  if (!sessions.length) return { raised: 0 };
  const [existing, claims] = await Promise.all([
    creditStatuses(id, client),
    // A day a comp-off already claims needs no credit: it was earned under the rule it was claimed
    // under. **Both** of a claim's days, the second half included - a day spent as the other half of
    // somebody's day off is spent, and raising a fresh credit for it would put a day already taken
    // back in front of the approvers.
    client.attendanceRequest.findMany({ where: { employeeId: id, type: "COMP_OFF", status: { in: ["PENDING", "SENT_BACK", "APPROVED"] }, workedDate: { not: null } }, select: { workedDate: true, workedPairDate: true } }),
  ]);
  const claimed = new Set(claims.flatMap((claim) => [claim.workedDate, claim.workedPairDate].filter(Boolean).map((date) => localIsoDate(date))));
  const fresh = sessions.filter((session) => !existing.has(localIsoDate(session.workDate)) && !claimed.has(localIsoDate(session.workDate)));
  if (!fresh.length) return { raised: 0 };
  // The employee's own branch's holidays: a day only another branch was shut earns them nothing.
  const holidayDates = await service.holidayDateSet(calendarDay(fresh[0].workDate), calendarDay(fresh.at(-1).workDate), client, await branchForEmployee(id, client));
  const earned = fresh.filter((session) => earnsCompOff(session.workDate, holidayDates, rules) && fullDayWorked(session, rules));

  let raised = 0;
  for (const session of earned) {
    const iso = localIsoDate(session.workDate);
    let created = null;
    try {
      created = await client.$transaction(async (tx) => {
        const request = await tx.attendanceRequest.create({
          data: {
            employeeId: id,
            type: CREDIT_TYPE,
            status: "PENDING",
            fromDate: calendarDay(iso),
            toDate: calendarDay(iso),
            workedDate: calendarDay(iso),
            creditKey: creditKey(id, iso),
            reason: `Worked a full day (${formatDurationMinutes(workedMinutes(session))}) on a ${holidayDates.has(iso) ? "holiday" : "weekly off"}.`,
          },
        });
        await service.createApprovals(tx, request.id, approverIds);
        await service.recordEvent(tx, request.id, "CREATED", SYSTEM_ACTOR, null);
        return tx.attendanceRequest.findUnique({ where: { id: request.id }, include: service.requestInclude });
      });
    } catch (error) {
      // Raised a moment ago by another write: one request for the day, which is the point.
      if (error?.code === "P2002") continue;
      throw error;
    }
    raised += 1;
    const recent = calendarDay(today).getTime() - calendarDay(iso).getTime() <= NOTIFY_WITHIN_DAYS * MS_PER_DAY;
    if (notify && recent) await Promise.resolve(notify(created)).catch((error) => console.warn(`[comp-off credit] could not notify approvers of request ${created.id}:`, error.message));
  }
  return { raised };
}

/**
 * What an approver needs beside a COMP_OFF_CREDIT to decide it, and what became of it: whether the
 * day was a weekly off or a holiday (and which), the login and logout attendance recorded, the hours
 * worked by Attendance Rules' reading, and - once approved - where the comp-off stands in the ledger
 * (Available, Claimed, Used, Expired) with the leave that claimed it. Keyed by request id.
 */
async function creditDetails(requests, client = prisma) {
  const credits = (requests || []).filter((request) => request?.type === CREDIT_TYPE && request.workedDate);
  if (!credits.length) return new Map();
  const service = require("./service");
  const settings = await service.readSettings(client);
  const employeeIds = [...new Set(credits.map((request) => request.employeeId))];
  const days = credits.map((request) => calendarDay(request.workedDate));
  const [sessions, ledger, employees] = await Promise.all([
    client.attendanceSession.findMany({ where: { employeeId: { in: employeeIds }, workDate: { in: days } }, select: { employeeId: true, workDate: true, loginAt: true, logoutAt: true, awayMinutes: true } }),
    client.compOffLedger.findMany({ where: { employeeId: { in: employeeIds }, workedDate: { in: days } }, select: { employeeId: true, workedDate: true, status: true, requestId: true, expiresOn: true } }),
    client.employee.findMany({ where: { id: { in: employeeIds } }, select: { id: true, branchId: true } }),
  ]);
  const earliest = days.reduce((a, b) => (a < b ? a : b));
  const latest = days.reduce((a, b) => (a > b ? a : b));
  const calendar = await holidayCalendar(earliest, latest);
  const branchOf = new Map(employees.map((employee) => [employee.id, employee.branchId ?? null]));
  const key = (employeeId, date) => `${employeeId}:${localIsoDate(date)}`;
  const sessionOf = new Map(sessions.map((session) => [key(session.employeeId, session.workDate), session]));
  const ledgerOf = new Map(ledger.map((row) => [key(row.employeeId, row.workedDate), row]));
  const LEDGER_LABELS = { AVAILABLE: "Available", CLAIMED: "Claimed", USED: "Used", EXPIRED: "Expired" };
  return new Map(credits.map((request) => {
    const iso = localIsoDate(request.workedDate);
    const session = sessionOf.get(key(request.employeeId, request.workedDate)) || null;
    const holidayName = calendar.namesFor(branchOf.get(request.employeeId) ?? null).get(iso) || "";
    const entry = ledgerOf.get(key(request.employeeId, request.workedDate)) || null;
    const minutes = session?.logoutAt ? workedMinutes(session) : null;
    const creditStatus = request.status === "APPROVED"
      ? LEDGER_LABELS[entry?.status] || "Credited"
      : request.status === "REJECTED" ? "Not credited (rejected)" : "Not credited yet";
    return [request.id, {
      dayKind: holidayName ? `Holiday - ${holidayName}` : "Weekly off",
      loginAt: session?.loginAt || null,
      logoutAt: session?.logoutAt || null,
      workedMinutes: minutes,
      workedLabel: minutes === null ? "Not logged out" : formatDurationMinutes(minutes),
      creditStatus,
      expiresOn: request.status === "APPROVED" ? (entry?.expiresOn ? localIsoDate(entry.expiresOn) : compOffExpiresOn(iso, settings)) : null,
      usedByRequestId: entry?.requestId || null,
    }];
  }));
}

module.exports = { CREDIT_TYPE, SYSTEM_ACTOR, creditKey, approvalFromIso, creditCleared, creditStatuses, approvedCreditDates, creditProblem, ensureCreditRequests, creditDetails };

/**
 * **How much a run of worked days earned**, from what each approver said.
 *
 * Every Leave Approver still has to approve - the unanimous decision a leave goes through - and each
 * one also says how much they would grant. The request takes the **lowest**, so an approver who
 * thinks a run was worth less than the person asking does says so with a number instead of refusing
 * the whole thing; `0` is that refusal, and it reads as "granted nothing" rather than as a rejection
 * nobody can tell apart from a disagreement about the amount.
 *
 * The cap is the days actually worked: nobody can grant two days for one, whatever they type.
 * Anything not a half step is rounded **down** to one, because a grant is a thing somebody picked
 * from a list and a stray 1.3 should not quietly become 1.5 in the employee's favour.
 *
 * `null` where an approver has approved without saying an amount - a credit raised before this
 * shipped, answered after it - which is read as the whole run, the rule those days were earned under.
 */
const HALF = 0.5;

function grantedFrom(answers, workedDays) {
  const amounts = (answers || [])
    .filter((answer) => String(answer?.decision || "").toUpperCase() === "APPROVED")
    .map((answer) => (answer.grantedDays === null || answer.grantedDays === undefined ? workedDays : Number(answer.grantedDays)))
    .filter((amount) => Number.isFinite(amount) && amount >= 0);
  if (!amounts.length) return null;
  const lowest = Math.min(...amounts, Number(workedDays) || 0);
  // Down to the half step: 1.3 is 1, not 1.5.
  return Math.max(0, Math.floor(lowest / HALF) * HALF);
}

/**
 * The days a credit covers, as a count - one for a single day, more for a run. What an approver may
 * grant up to, and what a grant of "the whole run" means.
 */
function workedDaysIn(request) {
  const from = request?.workedDate ? localIsoDate(request.workedDate) : null;
  if (!from) return 0;
  const to = request?.workedToDate ? localIsoDate(request.workedToDate) : from;
  const days = Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / MS_PER_DAY) + 1;
  return days > 0 ? days : 1;
}

/** The amounts an approver may choose for this credit: 0, 0.5, 1 … up to the days worked. */
function grantChoices(request) {
  const days = workedDaysIn(request);
  const choices = [];
  for (let amount = 0; amount <= days + 1e-9; amount += HALF) choices.push(Number(amount.toFixed(1)));
  return choices;
}

module.exports.grantedFrom = grantedFrom;
module.exports.workedDaysIn = workedDaysIn;
module.exports.grantChoices = grantChoices;
module.exports.HALF_DAY = HALF;

/**
 * **How much each approved worked day earned**, by day - `Map<iso, days>`, each 1, 0.5 or 0.
 *
 * The balance used to count rows: a worked day that cleared its approval was one day off, and that
 * was the whole arithmetic. Now a credit carries what it was granted, so this is what the ledger and
 * the balance read instead of counting.
 *
 * A credit covering a run shares its grant out **in half days from the earliest day**, rather than
 * dividing it evenly. Three days granted 1.5 are a day, a half and nothing - not three quarters
 * each. Two reasons, and the first is the one that matters: a day off is bought with one whole day or
 * two halves (`claimableUnits`), so an amount that is not a multiple of a half is an amount nobody
 * can ever spend, and dividing evenly produces exactly that. The second is that the earliest day
 * worked expires soonest, so loading the credit onto it keeps the expiry the strict reading rather
 * than quietly buying the employee more time than the day they worked had.
 *
 * A credit approved before amounts existed has no `grantedDays`; those days earned a whole day each,
 * which is the rule they were earned under.
 */
async function earnedDaysByDate(employeeId, client = prisma) {
  const credits = await client.attendanceRequest.findMany({
    where: { employeeId: Number(employeeId), type: CREDIT_TYPE, status: "APPROVED", workedDate: { not: null } },
    select: { workedDate: true, workedToDate: true, grantedDays: true },
  });
  const earned = new Map();
  for (const credit of credits) {
    const days = workedDaysIn(credit);
    const granted = credit.grantedDays === null || credit.grantedDays === undefined ? days : Number(credit.grantedDays);
    let left = Math.max(0, granted);
    const from = Date.parse(`${localIsoDate(credit.workedDate)}T00:00:00.000Z`);
    for (let at = 0; at < days; at += 1) {
      // A whole day where a whole day is left, then the half, then nothing: never a quarter.
      const share = left >= 1 ? 1 : left >= HALF ? HALF : 0;
      left -= share;
      earned.set(localIsoDate(new Date(from + at * MS_PER_DAY)), share);
    }
  }
  return earned;
}

/**
 * **The days off an employee can actually claim**, built from what their worked days earned.
 *
 * A comp-off is a whole day off - there is no half day off to take - so a worked day granted half a
 * day cannot be claimed on its own. Two halves buy one whole day off together, and this is what
 * pairs them: it walks the available days oldest first, and each whole day becomes a unit of its own
 * while each half waits for the next half to come along.
 *
 * Oldest first, and never reordered, for the employee's sake: the half closest to expiring is always
 * the one spent next, so nothing is lost to an expiry while a later half sits unused.
 *
 * Returns `{ units, pendingHalf }`. A unit is `{ dates, earnedDays: 1, expiresOn }` - one worked day
 * or two - and `expiresOn` is the **earlier** day's expiry, because that is the day whose credit runs
 * out first and the pair cannot outlive the half that paid for it. `pendingHalf` is the odd half left
 * over with nothing to pair with: not claimable, but shown to the employee rather than silently
 * dropped, so half a day granted never looks like nothing granted.
 *
 * `rows` are the employee's comp-off ledger rows; only AVAILABLE ones can be spent, since the rest
 * are already claimed, taken or expired.
 */
function claimableUnits(rows, settings) {
  const available = (rows || [])
    .filter((row) => row.status === "AVAILABLE")
    .map((row) => ({ date: typeof row.workedDate === "string" ? row.workedDate : localIsoDate(row.workedDate), earnedDays: Number(row.earnedDays ?? 1) }))
    .filter((row) => row.earnedDays > 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const units = [];
  let half = null;
  for (const row of available) {
    if (row.earnedDays >= 1) {
      units.push({ dates: [row.date], earnedDays: 1, expiresOn: compOffExpiresOn(row.date, settings) });
      continue;
    }
    if (!half) { half = row; continue; }
    // The earlier day's expiry governs: the pair cannot outlive the half that runs out first.
    units.push({ dates: [half.date, row.date], earnedDays: 1, expiresOn: compOffExpiresOn(half.date, settings) });
    half = null;
  }
  return { units, pendingHalf: half ? { date: half.date, earnedDays: HALF, expiresOn: compOffExpiresOn(half.date, settings) } : null };
}

/** One employee's claimable units, read from their comp-off ledger. */
async function claimableUnitsFor(employeeId, settings, client = prisma) {
  const rows = await client.compOffLedger.findMany({
    where: { employeeId: Number(employeeId) },
    select: { workedDate: true, earnedDays: true, status: true },
  });
  return claimableUnits(rows, settings);
}

/**
 * The unit a claim's worked days make, or null where those days do not make one between them - which
 * is the server's own refusal, not the picker's. `dates` is the one or two days the claim names.
 */
function unitFor(dates, units) {
  const asked = [...new Set((dates || []).filter(Boolean))].sort();
  if (!asked.length) return null;
  return units.find((unit) => unit.dates.length === asked.length && unit.dates.every((date, at) => date === asked[at])) || null;
}

module.exports.earnedDaysByDate = earnedDaysByDate;
module.exports.claimableUnits = claimableUnits;
module.exports.claimableUnitsFor = claimableUnitsFor;
module.exports.unitFor = unitFor;
