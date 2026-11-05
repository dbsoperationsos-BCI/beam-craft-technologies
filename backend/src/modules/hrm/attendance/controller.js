const { z } = require("zod");
const prisma = require("../../../config/db");
const { storeImage, discardUploads, storePrivateImage, discardPrivateImage } = require("../../../services/imageStorage");
const { getPrivateObject } = require("../../../services/objectStorage");
const {
  DAY_REQUEST_TYPES,
  REQUEST_TYPES,
  attendanceState,
  dayKindFor,
  WORK_MODES,
  leaveDatesProblem,
  formatClockTime,
  localIsoDate,
  minutesOfDay,
  parseClockTime,
  permissionTimesProblem,
  calendarDay,
} = require("./attendanceRules");
const service = require("./service");

/**
 * Employee Attendance: marking a day, and asking to be away from one.
 *
 * Everything this module records used to live in the browser's localStorage, which meant an
 * attendance record was device-specific, disappeared with the site data, and could be rewritten
 * from the console by the person it judged. It also meant nothing was ever validated: a leave could
 * end before it began, a permission could run backwards, and "Apply again" and "Cancel Leave" only
 * repainted a status in one tab. Every one of those is now a decision the server makes.
 *
 * A request is raised by the employee behind the signed-in login and decided by any one of the
 * three approvers named on their record, or by an Attendance Approval holder. Deciding never
 * overwrites history — approve, reject, cancel and re-apply each append to the request's event log.
 */

const SELFIE_FOLDER = "hrm/attendance/selfie";
/** Room for the compressed data URI the camera field produces, with headroom, before base64 growth. */
const MAX_SELFIE_CHARS = 4_000_000;

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });
const forbidden = (message) => Object.assign(new Error(message), { status: 403 });
const notFound = (message) => Object.assign(new Error(message), { status: 404 });

/**
 * A capture refused by the geofence.
 *
 * 422 rather than 400: the request is perfectly well formed and the server understood it - what
 * failed is a rule about where the person was standing, and the screen needs to tell the two apart
 * so it can offer to raise an outside-location request rather than just reporting a bad request.
 * The distance is carried back because "you are 1.4km away" is the one fact that makes the refusal
 * make sense.
 */
function outsideLocation(verdict) {
  return Object.assign(new Error("You are outside the allowed attendance location."), {
    status: 422,
    code: "OUTSIDE_LOCATION",
    distanceMeters: verdict?.distanceMeters ?? null,
  });
}

function validationError(res, error) {
  return res.status(400).json({ message: "Validation failed", errors: error.flatten() });
}

function handleError(res, error, fallback) {
  if (error.status) {
    return res.status(error.status).json({
      message: error.message,
      ...(error.code === "OUTSIDE_LOCATION" && { code: error.code, distanceMeters: error.distanceMeters }),
    });
  }
  if (error.code === "P2025") return res.status(404).json({ message: "Attendance record not found" });
  console.error("Attendance error:", error);
  return res.status(500).json({ message: fallback, error: error.message });
}

/** The employee behind the login, or the 400 that explains why attendance cannot be marked. */
async function requireEmployee(user) {
  const employee = await service.employeeForUser(user);
  if (!employee) throw badRequest("This login is not linked to an employee record, so attendance cannot be marked against it. Ask HR to link it.");
  return employee;
}

const clockTime = z.string().trim().refine((value) => parseClockTime(value) !== null, "Enter a time as HH:MM");

/**
 * The studio's geofence, kept apart from the shift settings above only so the two read separately
 * on screen. `enforceGeofence` off means an outside capture is recorded and flagged; on means it is
 * refused and the employee raises a request instead.
 */
const geofenceSchema = z.object({
  defaultRadiusMeters: z.coerce.number().int().min(10).max(50000),
  maxGpsAccuracyMeters: z.coerce.number().int().min(10).max(10000),
  enforceGeofence: z.coerce.boolean(),
  halfDayMinMinutes: z.coerce.number().int().min(0).max(24 * 60),
  halfDayMaxMinutes: z.coerce.number().int().min(0).max(24 * 60),
  earlyExitGraceMinutes: z.coerce.number().int().min(0).max(240),
});

const settingsSchema = z.object({
  shiftStart: clockTime,
  shiftEnd: clockTime,
  lateGraceMinutes: z.coerce.number().int().min(0).max(240),
  dailyTargetMinutes: z.coerce.number().int().min(30).max(24 * 60),
  // Every day off would mean no working days at all, and so a target of zero for every range.
  weeklyOffDays: z.array(z.coerce.number().int().min(0).max(6)).max(6),
  maxPermissionMinutes: z.coerce.number().int().min(15).max(12 * 60),
}).merge(geofenceSchema.partial()).refine((value) => parseClockTime(value.shiftEnd) > parseClockTime(value.shiftStart), {
  message: "The shift end must be later than the shift start",
  path: ["shiftEnd"],
}).refine((value) => {
  // Refused rather than quietly read as "no band": a studio that typed 5 and 4 the wrong way round
  // meant something, and silently switching half days off is not it. Only checked when both halves
  // were sent, since the geofence half of this schema is optional.
  if (value.halfDayMinMinutes === undefined || value.halfDayMaxMinutes === undefined) return true;
  return !value.halfDayMinMinutes || value.halfDayMaxMinutes >= value.halfDayMinMinutes;
}, {
  message: "The longest half day cannot be shorter than the shortest one",
  path: ["halfDayMaxMinutes"],
});

const loginSchema = z.object({
  workMode: z.enum(WORK_MODES),
  selfie: z.string().trim().min(1, "Capture a login selfie").max(MAX_SELFIE_CHARS),
  /**
   * Whether a real face detector confirmed a face, reported by the browser rather than asserted by
   * it. The client cannot be trusted to gate on this — it is a record of what was checked, which is
   * why an unverified selfie is stored and flagged rather than refused.
   */
  faceVerified: z.coerce.boolean().optional().default(false),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  accuracy: z.coerce.number().min(0).max(100000).optional().nullable(),
});

/**
 * Marking the end of a day is as much a claim about where somebody was as marking the start of it,
 * so a logout now carries the same evidence a login does. The selfie is optional only so that a day
 * opened before this shipped can still be closed - a session with a login selfie and no logout one
 * is a real row in the database today.
 */
const logoutSchema = z.object({
  selfie: z.string().trim().min(1).max(MAX_SELFIE_CHARS).optional().nullable(),
  faceVerified: z.coerce.boolean().optional().default(false),
  latitude: z.coerce.number().min(-90).max(90).optional().nullable(),
  longitude: z.coerce.number().min(-180).max(180).optional().nullable(),
  accuracy: z.coerce.number().min(0).max(100000).optional().nullable(),
});

/**
 * An HR correction made directly, rather than asked for.
 *
 * Times only, as `HH:MM` on the day the session already belongs to — the day itself is never moved,
 * because moving one would collide with whatever is recorded on the day it moved to and the unique
 * index would refuse it anyway. A null checkout reopens the day, which is what an approval applied
 * to the wrong person needs.
 */
const adminEditSchema = z.object({
  checkInAt: clockTime.optional(),
  checkOutAt: clockTime.nullable().optional(),
  reason: z.string().trim().min(1, "Say why the record is being changed").max(2000),
}).refine((value) => value.checkInAt !== undefined || value.checkOutAt !== undefined, {
  message: "Change at least one of the two times",
  path: ["checkInAt"],
});

const quoteSchema = z.object({
  dayOfWeek: z.coerce.number().int().min(0).max(6),
  quote: z.string().trim().min(1, "Write the line").max(400),
  isActive: z.coerce.boolean().optional().default(true),
});

const officeLocationSchema = z.object({
  branchId: z.coerce.number().int().positive(),
  name: z.string().trim().min(1, "Name this office").max(150),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  // Null falls back to the studio-wide default, which is how a branch has a circle without anybody
  // having decided on one for it.
  allowedRadiusMeters: z.coerce.number().int().min(10).max(50000).optional().nullable(),
  isActive: z.coerce.boolean().optional().default(true),
});

/** The user agent, for a reviewer looking at a day marked from somewhere unexpected. */
const deviceOf = (req) => String(req.get?.("user-agent") || "").slice(0, 255) || null;

const requestSchema = z.object({
  type: z.enum(REQUEST_TYPES),
  fromDate: z.coerce.date(),
  toDate: z.coerce.date(),
  fromTime: clockTime.optional().nullable(),
  toTime: clockTime.optional().nullable(),
  reason: z.string().trim().min(1, "Give a reason").max(2000),
  /** The rejected request this one re-raises, when it came from "Apply again". */
  supersedesId: z.coerce.number().int().positive().optional().nullable(),
});

const decisionSchema = z.object({ remarks: z.string().trim().max(2000).optional().nullable() });
const rejectionSchema = z.object({ remarks: z.string().trim().min(1, "Say why the request is being rejected").max(2000) });

/**
 * Why a proposed checkout cannot stand, or null.
 *
 * The one rule a column cannot hold: a checkout has to be after the login it closes. Without it an
 * approved correction would write a negative day, and `workedMinutes` floors at zero — so the day
 * would quietly read as nought hours worked rather than as the nonsense it is.
 */
function correctionTimeProblem(toTime, session, day) {
  const minutes = parseClockTime(toTime);
  if (minutes === null) return "Enter the time as HH:MM.";
  const checkOutAt = new Date(calendarDay(day).getTime() + minutes * 60000);
  if (session.loginAt && checkOutAt <= new Date(session.loginAt)) {
    return "The checkout has to be later than the login it closes.";
  }
  return null;
}

/** A proposed checkout as an instant, from the day it belongs to and the time asked for. */
function correctionInstant(request) {
  const minutes = parseClockTime(request.toTime);
  if (minutes === null) return null;
  return new Date(calendarDay(request.fromDate).getTime() + minutes * 60000);
}

/** The range a list or summary covers. Defaults to the current month rather than all of history. */
function rangeFrom(query, { bounded = true } = {}) {
  const now = new Date();
  // The month start is built in UTC like every other day here, so the default range cannot land a
  // day out from a range the caller named explicitly.
  const start = calendarDay(query?.from) || new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
  const end = calendarDay(query?.to) || calendarDay(now);
  if (end < start) throw badRequest("The end of the range cannot be earlier than its start.");
  /*
   * A range is walked one day at a time to build the day rows, so it is bounded. Two years is more
   * than any screen asks for and far less than a request that would build 30,000 rows.
   *
   * `bounded: false` is for the totals-only reading, which builds no rows at all: its work is the
   * days somebody actually turned up, around 250 a year however far back the question goes. That is
   * what lets "lifetime" mean lifetime rather than "two years, and we did not say".
   */
  if (bounded && (end - start) / 86400000 > 732) throw badRequest("Choose a range of two years or less.");
  return { start, end };
}

async function getSettings(req, res) {
  try {
    /*
     * The shift and the weekly offs, and no holidays.
     *
     * The holiday list used to ride along here for the editor that sat on this screen. A
     * company-declared holiday is a studio setting rather than an attendance decision about one
     * person, so it is declared in Settings -> Holidays now, behind ADMIN / System Settings, and
     * this endpoint no longer has an audience for the list. What a holiday *does* is unchanged:
     * `holidayDateSet` reads the same table when a day is judged, and the calendar draws it.
     */
    const settings = await service.readSettings();
    return res.json({
      data: {
        ...settings,
        weeklyOffDays: settings.weeklyOffDays ? settings.weeklyOffDays.split(",").map(Number).filter(Number.isInteger) : [],
        canManage: await service.isAttendanceAdmin(req.user),
      },
    });
  } catch (error) { return handleError(res, error, "Unable to load the attendance settings"); }
}

async function updateSettings(req, res) {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    if (!(await service.isAttendanceAdmin(req.user))) throw forbidden("You cannot change the attendance rules.");
    const { weeklyOffDays, ...rest } = parsed.data;
    // Sorted and de-duplicated so the stored string reads the same however the boxes were ticked.
    const saved = await service.saveSettings({ ...rest, weeklyOffDays: [...new Set(weeklyOffDays)].sort().join(",") }, req.user.id);
    return res.json({ data: saved });
  } catch (error) { return handleError(res, error, "Unable to save the attendance settings"); }
}

/**
 * Today as the server sees it: the open or finished session, and the rules the screen judges by.
 * The browser asks rather than remembering, so signing in on a second device shows the same day.
 */
async function getToday(req, res) {
  try {
    const employee = await requireEmployee(req.user);
    const today = calendarDay(new Date());
    const [settings, session] = await Promise.all([
      service.readSettings(),
      prisma.attendanceSession.findUnique({ where: { employeeId_workDate: { employeeId: employee.id, workDate: today } } }),
    ]);
    // The captures behind the day, so the screen can point an <img> at the guarded selfie endpoint.
    // A link to the picture itself is never sent, which is the whole reason the keys are stored.
    const captures = session
      ? await prisma.attendanceEvent.findMany({ where: { sessionId: session.id }, orderBy: { capturedAt: "asc" }, select: { id: true, type: true, locationAddress: true } })
      : [];
    const capture = (type) => captures.find((event) => event.type === type) || null;
    const captureId = (type) => capture(type)?.id || null;
    // Where the geofence would put them right now, before they capture anything. The screen shows
    // this so somebody standing outside the circle learns it before taking a selfie rather than
    // after being refused.
    const office = await service.officeLocationFor(employee.branchId);
    // Checked-in days nobody ever checked out of. The screen turns these into "yesterday's
    // attendance needs attention" with a Request Correction button, rather than the module guessing
    // a checkout time nobody chose.
    const needsAttention = await service.openPastDays(employee.id, today);

    /*
     * The day's named state, for a caller that is not this screen.
     *
     * The screen has always derived "not checked in / checked in / done" from the session itself and
     * still could, but nothing else consuming this endpoint should have to re-derive it — and two
     * derivations of the same thing eventually disagree. `MISSED_CHECKOUT` never appears here: an
     * open session *today* is somebody still at work. Past ones arrive in `needsAttention` above.
     */
    const { leaveDates } = await service.approvedTimeOff(employee.id, today, today);
    const holidayDates = await service.holidayDateSet(today, today);
    const dayKind = dayKindFor(localIsoDate(today), { settings, holidayDates, leaveDates });
    const state = attendanceState(session, { dayKind, today });
    return res.json({
      data: {
        date: localIsoDate(today),
        employee: { id: employee.id, code: employee.employeeId, name: employee.employeeName, dateOfJoining: employee.dateOfJoining },
        settings,
        state,
        dayKind,
        needsAttention,
        geofence: {
          // Null where the branch has no office recorded, which is not a failure - it is a geofence
          // that does not exist yet, and the screen says so rather than implying a check happened.
          office: office ? { name: office.name, radiusMeters: office.allowedRadiusMeters || settings.defaultRadiusMeters } : null,
          enforced: Boolean(settings.enforceGeofence),
        },
        session: session && {
          id: session.id,
          loginAt: session.loginAt,
          logoutAt: session.logoutAt,
          workMode: session.workMode,
          selfieUrl: session.loginSelfieUrl,
          faceVerified: session.loginFaceVerified,
          location: session.loginLatitude != null
            ? { latitude: Number(session.loginLatitude), longitude: Number(session.loginLongitude), accuracy: session.loginAccuracyM }
            : null,
          loginSelfieEventId: captureId("CHECK_IN"),
          // Null until the deferred lookup lands, and for every capture taken before addresses were
          // recorded. The screen falls back to the coordinates, which are always there.
          loginAddress: capture("CHECK_IN")?.locationAddress || null,
          logoutAddress: capture("CHECK_OUT")?.locationAddress || null,
          logoutSelfieEventId: captureId("CHECK_OUT"),
          loginLocationVerified: session.loginLocationVerified,
          loginDistanceMeters: session.loginDistanceMeters,
          logoutLocationVerified: session.logoutLocationVerified,
          logoutDistanceMeters: session.logoutDistanceMeters,
        },
      },
    });
  } catch (error) { return handleError(res, error, "Unable to load today's attendance"); }
}

/**
 * Marks the day's login.
 *
 * The timestamp is the server's, not the browser's — a clock the person being judged can set is not
 * evidence of when they arrived. The one-per-day unique index is what actually stops a second
 * login; the read below is only there to give it a sentence rather than a constraint error.
 */
async function markLogin(req, res) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  const input = parsed.data;
  try {
    const employee = await requireEmployee(req.user);
    const workDate = calendarDay(new Date());
    const existing = await prisma.attendanceSession.findUnique({ where: { employeeId_workDate: { employeeId: employee.id, workDate } } });
    if (existing) throw badRequest(existing.logoutAt ? "Today's attendance is already complete." : "You are already logged in for today.");

    // Judged before the picture is uploaded, so a capture the geofence will refuse does not leave
    // an orphan object behind in storage.
    const settings = await service.readSettings();
    const position = { latitude: input.latitude, longitude: input.longitude, accuracy: input.accuracy };
    const verdict = await service.evaluateCapture({ employee, position, settings });
    if (verdict.refused) throw outsideLocation(verdict);

    const stored = await storePrivateImage(input.selfie, { folder: SELFIE_FOLDER });
    try {
      // The session row and its audit event are one thing to write, not two: a day that exists with
      // no record of how it was captured is exactly what the event table exists to prevent.
      const session = await prisma.$transaction(async (tx) => {
        const capturedAt = new Date();
        const created = await tx.attendanceSession.create({
          data: {
            employeeId: employee.id,
            workDate,
            loginAt: capturedAt,
            workMode: input.workMode,
            // The link column stays for rows written before private storage, and for a server with
            // no object storage where the compressed data URI is all there is.
            loginSelfieUrl: stored?.key ? null : stored?.data || null,
            loginSelfieKey: stored?.key || null,
            loginFaceVerified: Boolean(input.faceVerified),
            loginLatitude: input.latitude,
            loginLongitude: input.longitude,
            loginAccuracyM: input.accuracy == null ? null : Math.round(input.accuracy),
            loginBranchId: verdict.branchId,
            loginDistanceMeters: verdict.distanceMeters,
            loginLocationVerified: verdict.verified,
          },
        });
        const capture = await service.recordCapture(tx, {
          session: created, employeeId: employee.id, type: "CHECK_IN", capturedAt,
          selfie: stored, position, verdict, faceVerified: input.faceVerified, deviceInfo: deviceOf(req),
        });
        return { created, captureId: capture.id };
      });
      // Not awaited: the day is recorded, and nobody should be kept waiting on a courtesy geocoder
      // to be told they are logged in. The address appears on the next read of the day.
      service.fillEventAddress(session.captureId, input.latitude, input.longitude);
      // Read after the day is safely recorded, and never allowed to fail the check-in: the quote is
      // decoration on a card reporting a fact, and losing an attendance record over a missing
      // sentence would be an absurd trade.
      const quote = await service.quoteFor(localIsoDate(workDate));
      return res.status(201).json({ data: {
        id: session.created.id, loginAt: session.created.loginAt, workMode: session.created.workMode, faceVerified: session.created.loginFaceVerified,
        location: { verified: verdict.verified, distanceMeters: verdict.distanceMeters, note: verdict.note },
        quote,
      } });
    } catch (error) {
      // The selfie reached storage before the row did; a failed write must not leave it orphaned.
      await discardPrivateImage(stored?.key);
      // Two devices racing the same first login land here rather than on the read above.
      if (error.code === "P2002") throw badRequest("You are already logged in for today.");
      throw error;
    }
  } catch (error) { return handleError(res, error, "Unable to mark your login"); }
}

async function markLogout(req, res) {
  const parsed = logoutSchema.safeParse(req.body ?? {});
  if (!parsed.success) return validationError(res, parsed.error);
  const input = parsed.data;
  try {
    const employee = await requireEmployee(req.user);
    const workDate = calendarDay(new Date());
    const session = await prisma.attendanceSession.findUnique({ where: { employeeId_workDate: { employeeId: employee.id, workDate } } });
    if (!session) throw badRequest("There is no login recorded for today.");
    if (session.logoutAt) throw badRequest("You have already logged out for today.");

    const settings = await service.readSettings();
    const position = { latitude: input.latitude, longitude: input.longitude, accuracy: input.accuracy };
    const verdict = await service.evaluateCapture({ employee, position, settings });
    if (verdict.refused) throw outsideLocation(verdict);

    const stored = input.selfie ? await storePrivateImage(input.selfie, { folder: SELFIE_FOLDER }) : null;
    let updated;
    try {
      updated = await prisma.$transaction(async (tx) => {
        const capturedAt = new Date();
        // Conditioned on the logout still being open, so two taps a moment apart cannot both close
        // the day - the second updates no rows and is told the day is already finished.
        const { count } = await tx.attendanceSession.updateMany({
          where: { id: session.id, logoutAt: null },
          data: {
            logoutAt: capturedAt,
            logoutSelfieKey: stored?.key || null,
            logoutFaceVerified: Boolean(input.faceVerified),
            logoutLatitude: input.latitude ?? null,
            logoutLongitude: input.longitude ?? null,
            logoutAccuracyM: input.accuracy == null ? null : Math.round(input.accuracy),
            logoutBranchId: verdict.branchId,
            logoutDistanceMeters: verdict.distanceMeters,
            logoutLocationVerified: verdict.verified,
          },
        });
        if (!count) throw badRequest("You have already logged out for today.");
        const row = await tx.attendanceSession.findUnique({ where: { id: session.id } });
        const capture = await service.recordCapture(tx, {
          session: row, employeeId: employee.id, type: "CHECK_OUT", capturedAt,
          selfie: stored, position, verdict, faceVerified: input.faceVerified, deviceInfo: deviceOf(req),
        });
        return { row, captureId: capture.id };
      });
      service.fillEventAddress(updated.captureId, input.latitude, input.longitude);
    } catch (error) {
      await discardPrivateImage(stored?.key);
      throw error;
    }
    return res.json({ data: {
      id: updated.row.id, loginAt: updated.row.loginAt, logoutAt: updated.row.logoutAt,
      location: { verified: verdict.verified, distanceMeters: verdict.distanceMeters, note: verdict.note },
    } });
  } catch (error) { return handleError(res, error, "Unable to mark your logout"); }
}

/** The day rows and the range totals behind the Login Summary table and the dashboard tiles. */
async function getSummary(req, res) {
  try {
    const employee = await requireEmployee(req.user);
    /*
     * `totals=1` asks for the figures without the day rows.
     *
     * The dashboard sends it for anything longer than a couple of months, where a row per day is
     * neither readable nor worth transferring — a year is 365 of them so a screen can print eight
     * numbers. It is also the only way to ask about a range longer than two years.
     */
    const totalsOnly = ["1", "true", "yes"].includes(String(req.query.totals || "").toLowerCase());
    const { start, end } = rangeFrom(req.query, { bounded: !totalsOnly });
    const summary = totalsOnly
      ? await service.attendanceTotals(employee.id, start, end)
      : await service.attendanceSummary(employee.id, start, end);
    return res.json({ data: { from: localIsoDate(start), to: localIsoDate(end), totalsOnly, ...summary } });
  } catch (error) { return handleError(res, error, "Unable to load your attendance summary"); }
}

async function listRequests(req, res) {
  try {
    const scope = req.query.scope === "team" ? "team" : "own";
    const where = await service.visibilityFilter(req.user, scope);
    if (req.query.type && REQUEST_TYPES.includes(req.query.type)) where.type = req.query.type;
    const requests = await prisma.attendanceRequest.findMany({
      where,
      include: service.requestInclude,
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    const now = new Date();
    // Resolved once for the whole list rather than per row: which employee this login is is a
    // property of the login, and a 500-row queue would otherwise be 500 lookups. Same for the
    // approver names, which are read in one query across every request on the page.
    const [actorEmployeeId, approverNames] = await Promise.all([
      service.linkedEmployeeIdFor(req.user),
      service.approverNamesFor(requests),
    ]);
    return res.json({
      data: requests.map((request) => ({
        /*
         * `forRequester` is what withholds the approver names on a rejected request — and it is
         * asked per row rather than per page, because the team queue can contain somebody's own
         * request alongside the ones they are approving.
         */
        ...service.serialiseRequest(request, now, {
          forRequester: actorEmployeeId != null && actorEmployeeId === request.employeeId,
          approverNames,
        }),
        // Whether *this* login may decide *this* request, so the screen offers only the actions
        // that would actually succeed. The server checks again on the decision itself.
        canDecide: scope === "team" && service.canDecideWith(actorEmployeeId, request),
      })),
    });
  } catch (error) { return handleError(res, error, "Unable to load the attendance requests"); }
}

/**
 * Whether a new request collides with one the employee already has.
 *
 * Two leaves over the same day, or a leave over a day already permitted, is a question for the
 * approver rather than something to be recorded twice. Only pending and approved requests block —
 * a rejected one has no claim on the calendar, which is exactly what makes "Apply again" work.
 */
async function overlapProblem(employeeId, input, ignoreId) {
  const clash = await prisma.attendanceRequest.findFirst({
    where: {
      employeeId,
      id: ignoreId ? { not: ignoreId } : undefined,
      status: { in: ["PENDING", "APPROVED"] },
      type: input.type,
      fromDate: { lte: calendarDay(input.toDate) },
      toDate: { gte: calendarDay(input.fromDate) },
    },
    select: { fromDate: true, toDate: true, status: true },
  });
  if (!clash) return null;
  const span = localIsoDate(clash.fromDate) === localIsoDate(clash.toDate)
    ? localIsoDate(clash.fromDate)
    : `${localIsoDate(clash.fromDate)} to ${localIsoDate(clash.toDate)}`;
  return `You already have a ${clash.status.toLowerCase()} request covering ${span}.`;
}

async function createRequest(req, res) {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  const input = parsed.data;
  try {
    const employee = await requireEmployee(req.user);
    const settings = await service.readSettings();

    // The two validations the browser-only version never had. A leave whose To date fell before its
    // From date was recorded as one day; a permission running backwards showed a duration of "-"
    // and was raised anyway.
    if (DAY_REQUEST_TYPES.includes(input.type)) {
      // Both are about one day already recorded, so both put that day in from and to.
      if (localIsoDate(input.fromDate) !== localIsoDate(input.toDate)) throw badRequest("This request is about a single day.");
      const day = calendarDay(input.fromDate);
      if (day > calendarDay(new Date())) throw badRequest("That day has not happened yet.");

      const session = await prisma.attendanceSession.findUnique({
        where: { employeeId_workDate: { employeeId: employee.id, workDate: day } },
        select: { id: true, loginAt: true, logoutAt: true },
      });
      if (!session) throw badRequest("There is no attendance recorded for that day, so there is nothing to correct.");

      if (input.type === "CORRECTION") {
        // A correction proposes a checkout, and nothing else. Reusing `toTime` rather than adding a
        // column: it is already the "HH:MM inside this day" field, which is exactly what this is.
        if (session.logoutAt) throw badRequest("That day already has a checkout. Ask HR to change it.");
        if (!input.toTime) throw badRequest("Say what time you actually finished.");
        const problem = correctionTimeProblem(input.toTime, session, day);
        if (problem) throw badRequest(problem);
      }
    } else if (input.type === "PERMISSION") {
      const problem = permissionTimesProblem(input.fromTime, input.toTime, settings);
      if (problem) throw badRequest(problem);
      if (localIsoDate(input.fromDate) !== localIsoDate(input.toDate)) throw badRequest("A permission covers one day. Apply for leave to cover more than one.");
    } else {
      const problem = leaveDatesProblem(input.fromDate, input.toDate);
      if (problem) throw badRequest(problem);
    }

    const clash = await overlapProblem(employee.id, input);
    if (clash) throw badRequest(clash);

    if (input.supersedesId) {
      const previous = await prisma.attendanceRequest.findFirst({ where: { id: input.supersedesId, employeeId: employee.id }, select: { id: true, status: true } });
      // Re-applying is for a refusal. Pointing at somebody else's request, or at one still open,
      // would make the chain say something that did not happen.
      if (!previous) throw badRequest("The request being re-applied for could not be found.");
      if (previous.status !== "REJECTED") throw badRequest("Only a rejected request can be applied for again.");
    }

    /*
     * Who this goes to, decided before it is written.
     *
     * A leave goes to every approver named on the record; everything else to the one permission
     * approver. Nobody named at all is refused here rather than recorded: only the people on the
     * list may answer a request now, so one raised against an empty list is a request that could
     * never be decided by anyone — and it would sit in the employee's own queue forever looking
     * like somebody had simply not got to it.
     */
    const approverIds = service.approversFor(employee, input.type);
    if (!approverIds.length) {
      throw badRequest("No approver is set on your employee record, so this request has nobody to answer it. Ask HR to set your approvers.");
    }

    const created = await prisma.$transaction(async (tx) => {
      const request = await tx.attendanceRequest.create({
        data: {
          employeeId: employee.id,
          type: input.type,
          status: "PENDING",
          fromDate: calendarDay(input.fromDate),
          toDate: calendarDay(input.toDate),
          fromTime: input.type === "PERMISSION" ? input.fromTime : null,
          toTime: input.type === "PERMISSION" ? input.toTime : null,
          reason: input.reason,
          supersedesId: input.supersedesId || null,
        },
      });
      await service.createApprovals(tx, request.id, approverIds);
      await service.recordEvent(tx, request.id, input.supersedesId ? "REAPPLIED" : "CREATED", req.user, input.reason);
      return tx.attendanceRequest.findUnique({ where: { id: request.id }, include: service.requestInclude });
    });
    return res.status(201).json({ data: service.serialiseRequest(created) });
  } catch (error) { return handleError(res, error, "Unable to raise this request"); }
}

/** Loads a request with everything the ownership and approver checks need. */
async function loadRequest(id) {
  const request = await prisma.attendanceRequest.findUnique({ where: { id: Number(id) }, include: service.requestInclude });
  if (!request) throw notFound("Request not found");
  return request;
}

/** Approve and reject are the same write with a different word, so they share one path. */
async function decide(req, res, status, remarks) {
  const request = await loadRequest(req.params.id);
  if (!(await service.canDecide(req.user, request))) throw forbidden("You are not an approver for this request.");
  if (request.status !== "PENDING") throw badRequest(`This request has already been ${request.status.toLowerCase()}.`);
  const decidedById = await service.linkedEmployeeIdFor(req.user);
  const updated = await prisma.$transaction(async (tx) => {
    /*
     * This approver's answer first, then what the request as a whole now reads as.
     *
     * A leave needs everybody on its list, so one approval usually leaves it PENDING and the other
     * approvers still see it in their queue. A rejection settles it whatever the others have said,
     * because a refusal is a veto rather than a vote.
     */
    const outcome = await service.recordApproverDecision(tx, {
      request, approverEmployeeId: decidedById, decision: status, remarks,
    });

    await tx.attendanceRequest.update({
      where: { id: request.id },
      data: {
        status: outcome,
        /*
         * Stamped only once the request is actually settled. While a leave is still collecting
         * approvals it has no decider and no decision remark — filling those in on the first yes
         * would make a request that is still open read as though somebody had closed it.
         *
         * The reason on a rejection is the refuser's, which is what the requester is shown; their
         * name is not, and `serialiseRequest` is what withholds it.
         */
        ...(outcome === "PENDING" ? {} : { decidedById, decidedAt: new Date(), decisionRemarks: remarks || null }),
      },
    });
    await service.recordEvent(tx, request.id, status, req.user, remarks);

    /*
     * An approved correction is not just a decision, it changes the day. Done inside the same
     * transaction as the decision so the two cannot disagree, and re-reading the session here rather
     * than trusting the one loaded before the approver was checked: minutes may have passed, and the
     * employee could have checked out themselves in between, in which case there is nothing to fix
     * and overwriting it would replace a real capture with a guess.
     */
    if (outcome === "APPROVED" && request.type === "CORRECTION") {
      const session = await tx.attendanceSession.findUnique({
        where: { employeeId_workDate: { employeeId: request.employeeId, workDate: calendarDay(request.fromDate) } },
      });
      const checkOutAt = correctionInstant(request);
      if (session && !session.logoutAt && checkOutAt) {
        await service.applyCorrection(tx, { request, session, checkOutAt, user: req.user });
      }
    }

    return tx.attendanceRequest.findUnique({ where: { id: request.id }, include: service.requestInclude });
  });
  return res.json({ data: service.serialiseRequest(updated, new Date(), { approverNames: await service.approverNamesFor([updated]) }) });
}

async function approveRequest(req, res) {
  const parsed = decisionSchema.safeParse(req.body ?? {});
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    return await decide(req, res, "APPROVED", parsed.data.remarks);
  } catch (error) { return handleError(res, error, "Unable to approve this request"); }
}

async function rejectRequest(req, res) {
  const parsed = rejectionSchema.safeParse(req.body ?? {});
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    return await decide(req, res, "REJECTED", parsed.data.remarks);
  } catch (error) { return handleError(res, error, "Unable to reject this request"); }
}

/**
 * Cancelling an approved leave or permission — the employee saying they no longer need it.
 *
 * Their own request only, and only one that has not already started: a day already taken cannot be
 * given back by changing a status, which is precisely what the browser version let anybody do to
 * any row. An approver who wants an approval undone rejects a fresh request or has HR correct the
 * record; the cancellation is logged either way.
 */
async function cancelRequest(req, res) {
  const parsed = decisionSchema.safeParse(req.body ?? {});
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    const employee = await requireEmployee(req.user);
    const request = await loadRequest(req.params.id);
    if (request.employeeId !== employee.id) throw forbidden("You can only cancel your own request.");
    if (!["PENDING", "APPROVED"].includes(request.status)) throw badRequest(`This request has already been ${request.status.toLowerCase()}.`);
    if (calendarDay(request.fromDate) <= calendarDay(new Date()) && request.status === "APPROVED") {
      throw badRequest("An approved request cannot be cancelled once it has started. Ask HR to correct the record.");
    }
    const updated = await prisma.$transaction(async (tx) => {
      await tx.attendanceRequest.update({ where: { id: request.id }, data: { status: "CANCELLED", decisionRemarks: parsed.data.remarks || null } });
      await service.recordEvent(tx, request.id, "CANCELLED", req.user, parsed.data.remarks);
      return tx.attendanceRequest.findUnique({ where: { id: request.id }, include: service.requestInclude });
    });
    return res.json({ data: service.serialiseRequest(updated) });
  } catch (error) { return handleError(res, error, "Unable to cancel this request"); }
}

/**
 * Withdrawing a request nobody has answered yet. A decided request is never deleted — the decision
 * is a record of what an approver did, and deleting it would erase their answer along with the ask.
 */
async function withdrawRequest(req, res) {
  try {
    const employee = await requireEmployee(req.user);
    const request = await loadRequest(req.params.id);
    if (request.employeeId !== employee.id) throw forbidden("You can only withdraw your own request.");
    if (request.status !== "PENDING") throw badRequest(`This request has already been ${request.status.toLowerCase()} and cannot be withdrawn.`);
    await prisma.attendanceRequest.delete({ where: { id: request.id } });
    return res.json({ data: { id: request.id } });
  } catch (error) { return handleError(res, error, "Unable to withdraw this request"); }
}

/**
 * The offices attendance is measured from. Readable by anyone who may open the screen — knowing
 * where the studio's own offices are is not a disclosure — and editable only by an approval holder,
 * checked here because the router guard can only tell a GET from a write.
 */
async function listOfficeLocations(req, res) {
  try {
    const [locations, canManage] = await Promise.all([service.listOfficeLocations(), service.isAttendanceAdmin(req.user)]);
    return res.json({ data: { canManage, locations: locations.map(serialiseOffice) } });
  } catch (error) { return handleError(res, error, "Unable to load the office locations"); }
}

const serialiseOffice = (office) => ({
  id: office.id,
  branchId: office.branchId,
  branchName: office.branch?.name || null,
  name: office.name,
  latitude: Number(office.latitude),
  longitude: Number(office.longitude),
  allowedRadiusMeters: office.allowedRadiusMeters,
  isActive: office.isActive,
});

async function saveOfficeLocation(req, res) {
  const parsed = officeLocationSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    if (!(await service.isAttendanceAdmin(req.user))) throw forbidden("You cannot change the office locations.");
    const { branchId, ...rest } = parsed.data;
    const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { id: true } });
    if (!branch) throw badRequest("That branch no longer exists.");
    const saved = await service.saveOfficeLocation(branchId, rest, req.user.id);
    return res.json({ data: serialiseOffice({ ...saved, branch: null }) });
  } catch (error) { return handleError(res, error, "Unable to save this office location"); }
}

async function deleteOfficeLocation(req, res) {
  try {
    if (!(await service.isAttendanceAdmin(req.user))) throw forbidden("You cannot change the office locations.");
    await service.deleteOfficeLocation(req.params.branchId);
    return res.json({ data: { branchId: Number(req.params.branchId) } });
  } catch (error) { return handleError(res, error, "Unable to remove this office location"); }
}

/**
 * One attendance selfie, streamed to somebody entitled to see it.
 *
 * This endpoint is the whole reason the selfies are stored as keys rather than links. Every other
 * image in this application lives at a public URL; a photograph of a named person at a place at a
 * time does not belong there, so nothing ever hands out a link to one and the only way to the bytes
 * is through this check.
 *
 * Entitled means the employee it is of, or somebody holding Attendance Approval. Not "anyone who
 * may open the attendance screen": that is every employee in the studio, and it would make the
 * whole arrangement pointless. Asked per capture rather than per day, because that is the unit the
 * question is actually about.
 */
async function getSelfie(req, res) {
  try {
    const event = await prisma.attendanceEvent.findUnique({
      where: { id: Number(req.params.eventId) || 0 },
      select: { id: true, employeeId: true, selfieKey: true, selfieData: true },
    });
    if (!event) throw notFound("That attendance photo is not on file.");

    const [ownEmployeeId, isAdmin] = await Promise.all([
      service.linkedEmployeeIdFor(req.user),
      service.isAttendanceAdmin(req.user),
    ]);
    if (!isAdmin && (!ownEmployeeId || ownEmployeeId !== event.employeeId)) {
      throw forbidden("You cannot view somebody else's attendance photo.");
    }

    // A server with no object storage kept the compressed picture on the row itself. Same check,
    // same endpoint, so the browser does not need to know which kind of server it is talking to.
    if (event.selfieData) {
      const match = /^data:([^;,]+);base64,(.+)$/s.exec(event.selfieData);
      if (!match) throw notFound("That attendance photo could not be read.");
      res.setHeader("Content-Type", match[1]);
      res.setHeader("Cache-Control", "private, no-store");
      return res.end(Buffer.from(match[2], "base64"));
    }

    if (!event.selfieKey) throw notFound("No photo was captured for that attendance event.");
    const object = await getPrivateObject(event.selfieKey);
    if (!object) throw notFound("That attendance photo is no longer in storage.");
    res.setHeader("Content-Type", object.contentType);
    if (object.contentLength != null) res.setHeader("Content-Length", object.contentLength);
    // Never cached by a proxy, and never written to disk by the browser: the permission that let
    // this request through is not a permission the cached copy would re-check.
    res.setHeader("Cache-Control", "private, no-store");
    return object.body.pipe(res);
  } catch (error) { return handleError(res, error, "Unable to load that attendance photo"); }
}

/**
 * The quotes, grouped by weekday. Readable by anyone who may open the screen — they are shown to
 * everybody anyway — and editable by an Attendance Approval holder.
 */
async function listQuotes(req, res) {
  try {
    const [quotes, canManage] = await Promise.all([
      prisma.attendanceQuote.findMany({ orderBy: [{ dayOfWeek: "asc" }, { id: "asc" }] }),
      service.isAttendanceAdmin(req.user),
    ]);
    return res.json({ data: { canManage, quotes: quotes.map((row) => ({ id: row.id, dayOfWeek: row.dayOfWeek, quote: row.quote, isActive: row.isActive })) } });
  } catch (error) { return handleError(res, error, "Unable to load the attendance quotes"); }
}

async function createQuote(req, res) {
  const parsed = quoteSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    if (!(await service.isAttendanceAdmin(req.user))) throw forbidden("You cannot change the attendance quotes.");
    const created = await prisma.attendanceQuote.create({ data: { ...parsed.data, createdById: req.user.id } });
    return res.status(201).json({ data: { id: created.id, dayOfWeek: created.dayOfWeek, quote: created.quote, isActive: created.isActive } });
  } catch (error) { return handleError(res, error, "Unable to add this quote"); }
}

/**
 * Removing a quote.
 *
 * A hard delete, unlike most things here, and deliberately: a quote holds no history and points at
 * nothing. Switching one off instead is a `PATCH` away for a line somebody wants back later, which
 * is what `isActive` is for.
 */
async function deleteQuote(req, res) {
  try {
    if (!(await service.isAttendanceAdmin(req.user))) throw forbidden("You cannot change the attendance quotes.");
    await prisma.attendanceQuote.delete({ where: { id: Number(req.params.id) || 0 } });
    return res.json({ data: { id: Number(req.params.id) } });
  } catch (error) { return handleError(res, error, "Unable to remove this quote"); }
}

/**
 * The studio's register for one day.
 *
 * Guarded here for `HRM / Attendance Approval`, not by the router: the router's guard is
 * `HRM / Employee Attendance`, which everybody holds because everybody marks their own day. Reading
 * where two hundred colleagues were this morning is a different question, and it gets a different
 * answer.
 */
async function getRegister(req, res) {
  try {
    if (!(await service.isAttendanceAdmin(req.user))) throw forbidden("You cannot read the studio's attendance register.");
    const day = calendarDay(req.query.date) || calendarDay(new Date());
    const register = await service.attendanceRegister(day, {
      branchId: req.query.branchId || null,
      status: req.query.status || null,
      search: req.query.search || "",
    });
    return res.json({ data: register });
  } catch (error) { return handleError(res, error, "Unable to load the attendance register"); }
}

/**
 * One person's day in full. Readable by the person it is about as well as by an approval holder —
 * somebody should be able to see the evidence their own attendance was judged on.
 */
async function getRegisterDetail(req, res) {
  try {
    const detail = await service.attendanceDetail(req.params.sessionId);
    if (!detail) throw notFound("That attendance day is not on file.");
    const [ownEmployeeId, isAdmin] = await Promise.all([
      service.linkedEmployeeIdFor(req.user),
      service.isAttendanceAdmin(req.user),
    ]);
    if (!isAdmin && (!ownEmployeeId || ownEmployeeId !== detail.employee.id)) {
      throw forbidden("You cannot read somebody else's attendance day.");
    }
    return res.json({ data: detail });
  } catch (error) { return handleError(res, error, "Unable to load that attendance day"); }
}

/**
 * HR changing an attendance record directly.
 *
 * Two messages in this module already said "Ask HR to correct the record" — for an approved request
 * that has already started, and for a day that already has a checkout — and until now there was
 * nothing behind either of them. This is it.
 *
 * `HRM / Attendance Approval` only, checked here rather than by the router, which answers to a
 * permission the whole studio holds. Three things make it safe to have at all: the change is
 * refused unless it is coherent (a checkout after the check-in it closes), it must carry a reason,
 * and it appends an `ADMIN_EDIT` row to the event table naming who did it and what moved. The
 * original captures are never touched — that is the whole reason the event table is append-only,
 * and an HR edit is precisely the case it was built to survive.
 */
async function editAttendance(req, res) {
  const parsed = adminEditSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  const input = parsed.data;
  try {
    if (!(await service.isAttendanceAdmin(req.user))) throw forbidden("You cannot change an attendance record.");

    const session = await prisma.attendanceSession.findUnique({ where: { id: Number(req.params.sessionId) || 0 } });
    if (!session) throw notFound("That attendance day is not on file.");

    const day = calendarDay(session.workDate);
    const instant = (time) => new Date(day.getTime() + parseClockTime(time) * 60000);
    const nextIn = input.checkInAt === undefined ? session.loginAt : instant(input.checkInAt);
    const nextOut = input.checkOutAt === undefined ? session.logoutAt : (input.checkOutAt === null ? null : instant(input.checkOutAt));
    // The same rule a correction is held to. Without it `workedMinutes` floors at zero and the day
    // reads quietly as nought hours worked rather than as the nonsense it is.
    if (nextOut && nextIn && nextOut <= nextIn) throw badRequest("The checkout has to be later than the check-in it closes.");

    const changes = [];
    if (input.checkInAt !== undefined) changes.push(`check-in ${formatClockTime(minutesOfDay(session.loginAt))} → ${input.checkInAt}`);
    if (input.checkOutAt !== undefined) {
      changes.push(`check-out ${session.logoutAt ? formatClockTime(minutesOfDay(session.logoutAt)) : "none"} → ${input.checkOutAt || "none"}`);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.attendanceSession.update({
        where: { id: session.id },
        data: { loginAt: nextIn, ...(input.checkOutAt !== undefined && { logoutAt: nextOut }) },
      });
      await tx.attendanceEvent.create({
        data: {
          sessionId: session.id,
          employeeId: session.employeeId,
          // Its own type: an HR edit is not a capture, and there is no selfie and no position behind
          // it. Recording one as a CHECK_IN would put a claim in the audit trail that nobody made.
          type: "ADMIN_EDIT",
          capturedAt: new Date(),
          locationNote: `${changes.join("; ")} by ${req.user?.name || "an approver"} — ${input.reason}`.slice(0, 255),
        },
      });
      return row;
    });

    return res.json({ data: { id: updated.id, checkInAt: updated.loginAt, checkOutAt: updated.logoutAt } });
  } catch (error) { return handleError(res, error, "Unable to change that attendance record"); }
}

module.exports = {
  editAttendance,
  getRegister,
  getRegisterDetail,
  createQuote,
  deleteQuote,
  listQuotes,
  deleteOfficeLocation,
  getSelfie,
  listOfficeLocations,
  saveOfficeLocation,
  approveRequest,
  cancelRequest,
  createRequest,
  getSettings,
  getSummary,
  getToday,
  listRequests,
  markLogin,
  markLogout,
  overlapProblem,
  rejectRequest,
  updateSettings,
  withdrawRequest,
};
