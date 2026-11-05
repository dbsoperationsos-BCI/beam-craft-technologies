const { z } = require("zod");
const prisma = require("../../../config/db");
// `Prisma.sql` / `Prisma.join`, for the one locking read that cannot be expressed as a Prisma query:
// the claim check inside the write, which must see what is committed now rather than the
// transaction's snapshot (`compOffClaimProblem`). Values still go through `?`, never interpolation.
const { Prisma } = require("@prisma/client");
const { holidayCalendar } = require("../../../services/holidayCalendar");
const { storeImage, discardUploads, storePrivateImage, discardPrivateImage } = require("../../../services/imageStorage");
const { getPrivateObject } = require("../../../services/objectStorage");
const {
  DAY_REQUEST_TYPES,
  REQUEST_TYPES,
  RAISABLE_REQUEST_TYPES,
  attendanceState,
  compOffDatesProblem,
  dayKindFor,
  DAY_KINDS,
  eachDateInRange,
  earnsCompOff,
  fullDayWorked,
  compOffExpiresOn,
  WORK_MODES,
  FLEXIBLE_WORK_MODE,
  LEAVE_TYPES,
  CASUAL_LEAVE_ONLY,
  leaveDatesProblem,
  formatClockTime,
  formatDurationMinutes,
  localIsoDate,
  minutesOfDay,
  parseClockTime,
  permissionTimesProblem,
  summariseBreaks,
  calendarDay,
  wallClockInstant,
  workedMinutes,
  CORRECTABLE_STATUSES,
  correctionStatusOf,
  sessionExpired,
  attendanceStartIso,
  SESSION_VALID_HOURS,
  BLOCKING_STATUSES,
} = require("./attendanceRules");
const service = require("./service");
const { studioParts } = require("../../../services/studioTime");
// The ledgers of Casual Leave, permissions and comp-offs, written again after anything that moves them.
const ledgers = require("./ledgers");
// A frozen payroll's pay cycle can't be regularized until that payroll is paid out.
const { regularizationHoldMessage } = require("../payroll-register/freezeHold");
const calculator = require("./calculator");
const reportGroup = require("./reportGroup");
const { isAdministrator } = require("../../../services/administrator");
// Whether an approver may give this answer now - the one place the reversal rule lives.
const { mayAnswer, answerableBy, settlementFields } = require("./approvals");
const { notifyApprovers, clearApproverNotices, ENTITY_TYPE: REQUEST_ENTITY_TYPE } = require("./requestNotifications");
const compOffCredits = require("./compOffCredits");
const { CAPTURE_TOKEN_TTL_SECONDS, CAPTURE_TYPES, issueCaptureToken, verifyCaptureToken } = require("./captureToken");

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
const conflict = (message) => Object.assign(new Error(message), { status: 409 });
/** Said where a login has passed its 18 hours and nothing more can be written to it. */
/**
 * Said to somebody ticked **Exclude From Attendance** who reaches a request verb.
 *
 * They are not in this module: nothing they raised would reach an approver's queue, and nothing of
 * theirs is in anybody's list (`visibilityFilter`). Raising, editing, reverting and deleting all say
 * this rather than appearing to work; deciding and sending back answer `Request not found`, because
 * a request an approver may not see is not there for them.
 */
const NOT_IN_ATTENDANCE = "Your attendance is not tracked in the studio's Attendance module, so there is nothing to raise a request about. Ask HR if that is not right.";

const EXPIRED_LOGIN = `Your login has passed its ${SESSION_VALID_HOURS} hours, so that day is marked Absent. Log in again, and send the time you worked past them to your approver with Log out late.`;

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

/**
 * A request refused for what it carried, said as its first reason - "Your location is too rough to
 * record..." rather than a bare "Validation failed" the person cannot act on. Every field's reasons
 * still go back in `errors`.
 */
function validationError(res, error) {
  return res.status(400).json({ message: error.issues?.[0]?.message || "Validation failed", errors: error.flatten() });
}

/*
 * What every capture - login, logout, Break In, Break Off - says when its evidence will not do, in
 * words the person can act on. Location accuracy is the one met in practice: a laptop or desktop with
 * no GPS or Wi-Fi fix can report a position only to within tens or hundreds of kilometres.
 */
const LOCATION_MISSING = "Capture a live location";
const LOCATION_ROUGH = "Your location is too rough to record (more than 100 km out). Turn on precise location for this site, switch off any VPN, or use your phone, then try again.";
const LOCATION_INVALID = "Your device sent a location that is not a real place. Read the location again.";
const SELFIE_TOO_LARGE = "The selfie is too large to send. Take it again.";
const captureLatitude = z.number({ error: LOCATION_MISSING }).min(-90, LOCATION_INVALID).max(90, LOCATION_INVALID);
const captureLongitude = z.number({ error: LOCATION_MISSING }).min(-180, LOCATION_INVALID).max(180, LOCATION_INVALID);
const captureAccuracy = z.number({ error: LOCATION_MISSING }).min(0, LOCATION_INVALID).max(100000, LOCATION_ROUGH);

function handleError(res, error, fallback) {
  if (error.status) {
    return res.status(error.status).json({
      message: error.message,
      ...(error.code === "OUTSIDE_LOCATION" && { code: error.code, distanceMeters: error.distanceMeters }),
      // Tells the screen to throw the captured selfie away and ask for a new one, rather than
      // offering to resend a capture the server will refuse again.
      ...(error.code === "CAPTURE_EXPIRED" && { code: error.code }),
      // The request already on that day, so the form can name it and offer to delete it first.
      ...(error.code === "REQUEST_CLASH" && { code: error.code, clash: error.clash }),
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
/*
 * Casual Leave (Settings → Employee → Attendance Rules): days credited a month - in half days - whether
 * unused days carry month to month, and the most carried into a new year. Optional, so a save from a
 * form that does not show them leaves them as they are.
 */
const halfDays = (max) => z.coerce.number().min(0).max(max).refine((value) => Number.isInteger(value * 2), "Use whole or half days.");
const CASUAL_LEAVE_PERIODS = ["CALENDAR_MONTH", "PAY_CYCLE"];
const casualLeaveSchema = z.object({
  casualLeavePerMonth: halfDays(31),
  casualLeaveMonthlyCarry: z.boolean(),
  casualLeaveYearCarryMax: halfDays(366),
  // What a month is: the calendar month, or Payroll rules' pay cycle.
  casualLeavePeriod: z.enum(CASUAL_LEAVE_PERIODS),
});

// Permissions: how many a period allows (0: no limit), and what the period is.
const permissionLimitSchema = z.object({
  permissionsPerPeriod: z.coerce.number().int("Use a whole number.").min(0).max(31),
  permissionPeriod: z.enum(CASUAL_LEAVE_PERIODS),
});

// Comp-Off: days a comp-off can be used after the day worked; 0 is no expiry.
const compOffSchema = z.object({
  compOffExpiryDays: z.coerce.number().int("Use whole days.").min(0).max(366),
});

// Irregularity penalty: extra loss-of-pay days for each day still Absent - whole or half days, up to 3.
const penaltySchema = z.object({
  irregularityPenaltyDays: z.coerce.number().min(0, "Use 0 or more.").max(3, "Use 3 days or fewer.")
    .refine((value) => Number.isInteger(value * 2), "Use whole or half days."),
});

const geofenceSchema = z.object({
  defaultRadiusMeters: z.coerce.number().int().min(10).max(50000),
  maxGpsAccuracyMeters: z.coerce.number().int().min(10).max(10000),
  enforceGeofence: z.coerce.boolean(),
  halfDayMinMinutes: z.coerce.number().int().min(0).max(24 * 60),
  earlyExitGraceMinutes: z.coerce.number().int().min(0).max(240),
});

const settingsShape = z.object({
  shiftStart: clockTime,
  shiftEnd: clockTime,
  lateGraceMinutes: z.coerce.number().int().min(0).max(240),
  dailyTargetMinutes: z.coerce.number().int().min(30).max(24 * 60),
  // Every day off would mean no working days at all, and so a target of zero for every range.
  weeklyOffDays: z.array(z.coerce.number().int().min(0).max(6)).max(6),
  maxPermissionMinutes: z.coerce.number().int().min(15).max(12 * 60),
  /*
   * "Attendance starts on": the day the studio's attendance starts being counted, as `YYYY-MM-DD`,
   * or blank for none. Left out of a save, it is left as it is.
   */
  attendanceStartDate: z.preprocess(
    (value) => (value === "" ? null : value),
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date attendance starts on.")
      .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime()) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value, "Choose a real date.")
      .transform((value) => new Date(`${value}T00:00:00.000Z`))
      .nullable()
      .optional(),
  ),
}).merge(geofenceSchema.partial()).merge(casualLeaveSchema.partial()).merge(compOffSchema.partial()).merge(penaltySchema.partial()).merge(permissionLimitSchema.partial());

/** The rules between fields a save has to keep - each checked where both of its fields are there. */
const betweenFields = (schema) => schema.refine((value) => value.shiftStart === undefined || value.shiftEnd === undefined || parseClockTime(value.shiftEnd) > parseClockTime(value.shiftStart), {
  message: "The shift end must be later than the shift start",
  path: ["shiftEnd"],
}).refine((value) => {
  // A half day runs from "Half day from" up to the full day, so it has to start below the full day.
  // Refused rather than quietly read as "no band": silently switching half days off is not what
  // somebody typing those numbers meant. Only checked when it was sent - it is optional.
  if (value.halfDayMinMinutes === undefined || value.dailyTargetMinutes === undefined) return true;
  return !value.halfDayMinMinutes || value.halfDayMinMinutes < value.dailyTargetMinutes;
}, {
  message: "Half day from must be less than the full day",
  path: ["halfDayMinMinutes"],
});

// The rules whole, as a save is finally checked - with the sections not sent read as stored.
const settingsSchema = betweenFields(settingsShape);
// What one section sends, on its own: refused before anything is read where it contradicts itself.
const sectionSchema = betweenFields(settingsShape.partial());

const loginSchema = z.object({
  workMode: z.enum(WORK_MODES),
  selfie: z.string().trim().min(1, "Capture a login selfie").max(MAX_SELFIE_CHARS, SELFIE_TOO_LARGE),
  /**
   * Whether a real face detector confirmed a face, reported by the browser rather than asserted by
   * it. The client cannot be trusted to gate on this — it is a record of what was checked, which is
   * why an unverified selfie is stored and flagged rather than refused.
   */
  faceVerified: z.coerce.boolean().optional().default(false),
  // Real numbers rather than coerced: `null` coerced reads as 0, which would record a missing
  // position as (0, 0) and a missing accuracy as a perfect zero-metre fix.
  latitude: captureLatitude,
  longitude: captureLongitude,
  accuracy: captureAccuracy,
  // From `POST /capture-token`, taken when the camera was opened. See `captureToken.js`.
  captureToken: z.string().trim().min(1, "Retake the selfie to start a new capture").max(2000),
});

/**
 * Marking the end of a day is as much a claim about where somebody was as marking the start of it,
 * so a logout carries exactly the evidence a login does: a live selfie, a live position and a
 * capture token. They used to be optional so a denied camera could not trap somebody in an open
 * day; that day is now closed by a correction request instead, which an approver looks at.
 */
const logoutSchema = z.object({
  // Only a logout past the login's 18 hours asks for one: it goes on the Extra Time request that
  // logout raises, and the approver reads it before deciding.
  reason: z.string().trim().max(2000).optional(),
  selfie: z.string().trim().min(1, "Capture a logout selfie").max(MAX_SELFIE_CHARS, SELFIE_TOO_LARGE),
  faceVerified: z.coerce.boolean().optional().default(false),
  latitude: captureLatitude,
  longitude: captureLongitude,
  accuracy: captureAccuracy,
  captureToken: z.string().trim().min(1, "Retake the selfie to start a new capture").max(2000),
});

const captureTokenSchema = z.object({ type: z.enum(CAPTURE_TYPES) });

/** Break In and Break Off: the same evidence a logout carries - live selfie, live position, capture token. */
const breakSchema = z.object({
  selfie: z.string({ error: "Capture a selfie for the break" }).trim().min(1, "Capture a selfie for the break").max(MAX_SELFIE_CHARS, SELFIE_TOO_LARGE),
  faceVerified: z.coerce.boolean().optional().default(false),
  latitude: captureLatitude,
  longitude: captureLongitude,
  accuracy: captureAccuracy,
  captureToken: z.string().trim().min(1, "Retake the selfie to start a new capture").max(2000),
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
  // What a person may raise: a comp-off credit is attendance's to raise (`compOffCredits.js`).
  type: z.enum(RAISABLE_REQUEST_TYPES),
  fromDate: z.coerce.date(),
  toDate: z.coerce.date(),
  fromTime: clockTime.optional().nullable(),
  toTime: clockTime.optional().nullable(),
  reason: z.string().trim().min(1, "Give a reason").max(2000),
  /** The holiday or weekly off worked, on a comp-off only. The day taken off is `fromDate`. */
  workedDate: z.coerce.date().optional().nullable(),
  /**
   * The second worked day, where the day off is paid for by two half days rather than one whole one.
   * Which days may be spent together is the server's to decide, not the browser's: `compOffProblem`
   * refuses anything that does not add up to exactly one day off.
   */
  workedPairDate: z.coerce.date().optional().nullable(),
  /** A leave's kind: CL (Casual Leave) or LOP (Loss of Pay). A leave sent without one is CL. */
  leaveType: z.enum(LEAVE_TYPES).optional().nullable(),
  /** The rejected request this one re-raises, when it came from "Apply again". */
  supersedesId: z.coerce.number().int().positive().optional().nullable(),
  /**
   * What a Correction asks the day to read as. Its current status is never taken from the browser:
   * the server reads the day itself when the request is raised.
   */
  requestedStatus: z.enum(CORRECTABLE_STATUSES).optional().nullable(),
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
  const checkOutAt = wallClockInstant(day, minutes);
  if (session.loginAt && checkOutAt <= new Date(session.loginAt)) {
    return "The checkout has to be later than the login it closes.";
  }
  return null;
}

/** A proposed checkout as an instant, from the day it belongs to and the time asked for. */
function correctionInstant(request) {
  const minutes = parseClockTime(request.toTime);
  if (minutes === null) return null;
  return wallClockInstant(request.fromDate, minutes);
}

/** The range a list or summary covers. Defaults to the current month rather than all of history. */
function rangeFrom(query, { bounded = true } = {}) {
  const now = new Date();
  // The month start is built in UTC like every other day here, so the default range cannot land a
  // day out from a range the caller named explicitly - and from the studio's today, not the
  // server's, which on a server left on UTC is still yesterday until 5:30 am.
  const today = calendarDay(now);
  const start = calendarDay(query?.from) || new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
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
        attendanceStartDate: attendanceStartIso(settings),
        // Days, as numbers rather than the decimal column's text.
        casualLeavePerMonth: Number(settings.casualLeavePerMonth),
        casualLeaveYearCarryMax: Number(settings.casualLeaveYearCarryMax),
        // The day the next Casual Leave year starts, by either way of counting, for the screen to name.
        casualLeaveYearStarts: await service.casualLeaveYearStarts(),
        /*
         * The day the pay cycle turns over, for the Self Dashboard to count by.
         *
         * It lives in `hrm_settings` with the rest of the payroll rules rather than in the
         * attendance settings this endpoint reads, so it is fetched beside them - the page already
         * asks for this answer, and a second request for one number would be a second thing to keep
         * in step.
         */
        payCycleDay: (await calculator.readPayPeriod()).cycleDay,
        // Whether the rules are editable here: `HRM / Attendance Rules` at Read / Write (`canManageRules`).
        canManage: await service.canManageRules(req.user),
        // Whether the Self Dashboard shows the Login Summary and Break Summary: administrators only (`seesAttendanceLogs`).
        canSeeLogs: await service.seesAttendanceLogs(req.user),
      },
    });
  } catch (error) { return handleError(res, error, "Unable to load the attendance settings"); }
}

/**
 * The rules as stored, in the shape `settingsSchema` reads - for a save that sends one section alone.
 * The geofence and "Attendance starts on" are left out: a save that does not send them leaves them be.
 */
function storedRules(stored) {
  const numberOf = (value) => (value === undefined || value === null ? undefined : Number(value));
  const rules = {
    shiftStart: stored.shiftStart,
    shiftEnd: stored.shiftEnd,
    lateGraceMinutes: stored.lateGraceMinutes,
    dailyTargetMinutes: stored.dailyTargetMinutes,
    weeklyOffDays: stored.weeklyOffDays ? stored.weeklyOffDays.split(",").map(Number).filter(Number.isInteger) : [],
    maxPermissionMinutes: stored.maxPermissionMinutes,
    halfDayMinMinutes: stored.halfDayMinMinutes,
    earlyExitGraceMinutes: stored.earlyExitGraceMinutes,
    casualLeavePerMonth: numberOf(stored.casualLeavePerMonth),
    casualLeaveMonthlyCarry: stored.casualLeaveMonthlyCarry,
    casualLeaveYearCarryMax: numberOf(stored.casualLeaveYearCarryMax),
    casualLeavePeriod: stored.casualLeavePeriod,
    compOffExpiryDays: stored.compOffExpiryDays,
    irregularityPenaltyDays: numberOf(stored.irregularityPenaltyDays),
    permissionsPerPeriod: stored.permissionsPerPeriod,
    permissionPeriod: stored.permissionPeriod,
  };
  return Object.fromEntries(Object.entries(rules).filter(([, value]) => value !== undefined));
}

async function updateSettings(req, res) {
  const sent = sectionSchema.safeParse(req.body || {});
  if (!sent.success) return validationError(res, sent.error);
  try {
    if (!(await service.canManageRules(req.user))) throw forbidden("You do not have permission to change the attendance rules.");
    /*
     * Each section of Attendance Rules saves on its own and sends only its fields; the rest are the
     * rules as stored. So a section is checked against the others as they stand - a shift end against
     * the stored start - and its save never changes what another section shows.
     */
    const parsed = settingsSchema.safeParse({ ...storedRules(await service.readSettings()), ...(req.body || {}) });
    if (!parsed.success) return validationError(res, parsed.error);
    const { weeklyOffDays, ...rest } = parsed.data;
    // Sorted and de-duplicated so the stored string reads the same however the boxes were ticked.
    const saved = await service.saveSettings({ ...rest, weeklyOffDays: [...new Set(weeklyOffDays)].sort().join(",") }, req.user.id);
    // The rules every ledger is worked out by have changed: everybody's are written again.
    ledgers.refreshAllSoon();
    return res.json({ data: { ...saved, attendanceStartDate: attendanceStartIso(saved) } });
  } catch (error) { return handleError(res, error, "Unable to save the attendance settings"); }
}

/**
 * Today as the server sees it: the open or finished session, and the rules the screen judges by.
 * The browser asks rather than remembering, so signing in on a second device shows the same day.
 */
async function getToday(req, res) {
  try {
    const employee = await requireEmployee(req.user);
    const now = new Date();
    const today = calendarDay(now);
    // The session the header acts on: today's, or yesterday's while that login is inside its 18 hours
    // (`currentSession`). A login past them is an Incorrect login and is nobody's current session.
    const [settings, session] = await Promise.all([
      service.readSettings(),
      service.currentSession(employee.id, now),
    ]);
    // The captures behind the day, so the screen can point an <img> at the guarded selfie endpoint.
    // A link to the picture itself is never sent, which is the whole reason the keys are stored.
    const captures = session
      ? await prisma.attendanceEvent.findMany({ where: { sessionId: session.id }, orderBy: { capturedAt: "asc" }, select: { id: true, type: true, locationAddress: true } })
      : [];
    // The day's first login and its latest logout - with several logins in a day, the ends of it.
    const capture = (type) => (type === "CHECK_OUT"
      ? captures.filter((event) => event.type === type).at(-1)
      : captures.find((event) => event.type === type)) || null;
    const captureId = (type) => capture(type)?.id || null;
    // Where the geofence would put them right now, before they capture anything. The screen shows
    // this so somebody standing outside the circle learns it before taking a selfie rather than
    // after being refused.
    const office = await service.officeLocationFor(employee.branchId);
    // Checked-in days nobody ever checked out of. The screen turns these into "yesterday's
    // attendance needs attention" with a Request Correction button, rather than the module guessing
    // a checkout time nobody chose. None for a Super Admin: checking out is not compulsory for them,
    // so a day left open is not something that needs attention.
    const attendanceOptional = await service.isAttendanceOptional(employee.id);
    const needsAttention = attendanceOptional ? [] : await service.openPastDays(employee.id, now);
    // Whether the Login box offers Flexible Shift - ticked for this person by HR.
    const flexibleShiftAllowed = await service.isFlexibleShiftAllowed(employee.id);

    /*
     * The day's named state, for a caller that is not this screen.
     *
     * The screen has always derived "not checked in / checked in / done" from the session itself and
     * still could, but nothing else consuming this endpoint should have to re-derive it — and two
     * derivations of the same thing eventually disagree. `MISSED_CHECKOUT` never appears here: an
     * open session *today* is somebody still at work. Past ones arrive in `needsAttention` above.
     */
    const { leaveDates } = await service.approvedTimeOff(employee.id, today, today);
    const holidayDates = await service.holidayDateSet(today, today, prisma, employee.branchId ?? null);
    const dayKind = dayKindFor(localIsoDate(today), { settings, holidayDates, leaveDates });
    // A Correction approved for today is today's state too.
    const todayOverride = (await service.statusOverridesFor({ employeeIds: [employee.id], start: today, end: today })).get(`${employee.id}|${localIsoDate(today)}`) || null;
    const state = attendanceState(session, { dayKind, today, now, override: todayOverride });
    return res.json({
      data: {
        date: localIsoDate(today),
        employee: { id: employee.id, code: employee.employeeId, name: employee.employeeName, dateOfJoining: employee.dateOfJoining },
        settings,
        state,
        dayKind,
        needsAttention,
        // Whether checking in and out is optional for this login - true for a Super Admin.
        attendanceOptional,
        flexibleShiftAllowed,
        // Today's breaks and whether one is running - what the header's Break In / Break Off reads.
        breaks: summariseBreaks(session ? await prisma.attendanceBreak.findMany({ where: { sessionId: session.id } }) : []),
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
          // How many times today was logged in, and the minutes logged out in between.
          loginCount: session.loginCount,
          awayMinutes: session.awayMinutes,
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
 * Marks a login - the day's first, or another after a logout.
 *
 * The timestamp is the server's, not the browser's — a clock the person being judged can set is not
 * evidence of when they arrived. The one-per-day unique index is what stops a second *day* being
 * started; a login after a logout re-opens the day instead (`reopenDay`), and one while still logged
 * in is refused.
 *
 * The capture token is checked first: a selfie that was not taken inside the last
 * `CAPTURE_TOKEN_TTL_SECONDS` on this screen is not evidence of anything, however it is dressed.
 */
async function markLogin(req, res) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  const input = parsed.data;
  try {
    verifyCaptureToken(input.captureToken, req.user.id, "CHECK_IN");
    const employee = await requireEmployee(req.user);
    const workDate = calendarDay(new Date());
    // Today's day, or yesterday's login still inside its 18 hours - which is still a login, so a
    // second one is refused until it is logged out of or expires (`currentSession`).
    const existing = await service.currentSession(employee.id);
    if (existing && !existing.logoutAt) throw badRequest("You are already logged in.");
    // Offered only to somebody HR has ticked Allow Flexible Shift for; the button being hidden is not
    // the protection - a login that is never Late is not one anybody can choose for themselves.
    if (input.workMode === FLEXIBLE_WORK_MODE && !existing && !(await service.isFlexibleShiftAllowed(employee.id))) {
      throw forbidden("Flexible Shift is not turned on for you. Ask HR to allow it, or choose another work mode.");
    }

    // Judged before the picture is uploaded, so a capture the geofence will refuse does not leave
    // an orphan object behind in storage.
    const settings = await service.readSettings();
    const position = { latitude: input.latitude, longitude: input.longitude, accuracy: input.accuracy };
    const verdict = await service.evaluateCapture({ employee, position, settings });
    if (verdict.refused) throw outsideLocation(verdict);

    const stored = await storePrivateImage(input.selfie, { folder: SELFIE_FOLDER });
    if (existing) {
      try {
        const reopened = await reopenDay({ session: existing, employee, input, stored, position, verdict, req });
        service.fillEventAddress(reopened.captureId, input.latitude, input.longitude);
        return res.status(201).json({ data: {
          id: reopened.row.id, loginAt: reopened.capturedAt, workMode: reopened.row.workMode, faceVerified: Boolean(input.faceVerified),
          relogin: true, loginCount: reopened.row.loginCount,
          location: { verified: verdict.verified, distanceMeters: verdict.distanceMeters, note: verdict.note },
        } });
      } catch (error) {
        await discardPrivateImage(stored?.key);
        throw error;
      }
    }
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
            lastLoginAt: capturedAt,
            workMode: input.workMode,
            // The link column stays for rows written before private storage, and for a server with
            // no object storage where the compressed data URI is all there is.
            loginSelfieUrl: stored?.key ? null : stored?.data || null,
            loginSelfieKey: stored?.key || null,
            loginFaceVerified: Boolean(input.faceVerified),
            loginLatitude: input.latitude,
            loginLongitude: input.longitude,
            loginAccuracyM: Math.round(input.accuracy),
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
      return res.status(201).json({ data: {
        id: session.created.id, loginAt: session.created.loginAt, workMode: session.created.workMode, faceVerified: session.created.loginFaceVerified,
        location: { verified: verdict.verified, distanceMeters: verdict.distanceMeters, note: verdict.note },
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

/**
 * A login after a logout: the day is re-opened rather than a second one started. The first login's
 * time, photograph and position stay the day's own - lateness is judged on the first arrival - and
 * the gap since the logout is added to `awayMinutes`, which comes off the worked time. The login is
 * its own CHECK_IN event, with its own photograph and position, like every other.
 *
 * Conditioned on the day still being logged out at the time it was read, so two taps a moment apart
 * cannot both re-open it - the second updates no rows and is told it is already logged in.
 */
async function reopenDay({ session, employee, input, stored, position, verdict, req }) {
  return prisma.$transaction(async (tx) => {
    const capturedAt = new Date();
    const away = Math.max(0, Math.round((capturedAt.getTime() - new Date(session.logoutAt).getTime()) / 60000));
    const { count } = await tx.attendanceSession.updateMany({
      where: { id: session.id, logoutAt: session.logoutAt },
      // The 18 hours a login lasts run from this login, not the day's first.
      data: { logoutAt: null, lastLoginAt: capturedAt, awayMinutes: { increment: away }, loginCount: { increment: 1 } },
    });
    if (!count) throw badRequest("You are already logged in.");
    const row = await tx.attendanceSession.findUnique({ where: { id: session.id } });
    const capture = await service.recordCapture(tx, {
      session: row, employeeId: employee.id, type: "CHECK_IN", capturedAt,
      selfie: stored, position, verdict, faceVerified: input.faceVerified, deviceInfo: deviceOf(req),
    });
    return { row, capturedAt, captureId: capture.id };
  });
}

async function markLogout(req, res) {
  const parsed = logoutSchema.safeParse(req.body ?? {});
  if (!parsed.success) return validationError(res, parsed.error);
  const input = parsed.data;
  try {
    verifyCaptureToken(input.captureToken, req.user.id, "CHECK_OUT");
    const employee = await requireEmployee(req.user);
    // Today's login, or yesterday's still inside its 18 hours: a login at 21:30 is logged out of at 02:00.
    const session = await service.currentSession(employee.id);
    if (!session) throw badRequest("There is no login recorded for today.");
    if (session.logoutAt) throw badRequest("You are already logged out. Log in again first.");

    const settings = await service.readSettings();
    const position = { latitude: input.latitude, longitude: input.longitude, accuracy: input.accuracy };
    const verdict = await service.evaluateCapture({ employee, position, settings });
    if (verdict.refused) throw outsideLocation(verdict);

    /*
     * Past its 18 hours: the logout is taken, and sends itself for approval. Who it goes to is read
     * before the write, so somebody with nobody named is logged out and told, rather than the
     * logout failing over a request that could never have been answered.
     */
    const late = sessionExpired(session);
    const reason = String(input.reason || "").trim();
    const approverIds = late ? service.approversFor(employee, "EXTRA_TIME") : [];

    const stored = await storePrivateImage(input.selfie, { folder: SELFIE_FOLDER });
    let updated;
    try {
      updated = await prisma.$transaction(async (tx) => {
        const capturedAt = new Date();
        /*
         * A logout past the login's 18 hours is still a logout - refusing it only lost the hours
         * worked past them. It is written exactly as any other, and the day is then held at Absent
         * until the Extra Time it raises is approved (`raiseExtraTime`).
         */
        if (late && !reason) throw badRequest("Say why you are logging out late.");
        // Conditioned on the logout still being open, so two taps a moment apart cannot both close
        // the day - the second updates no rows and is told the day is already finished.
        const { count } = await tx.attendanceSession.updateMany({
          where: { id: session.id, logoutAt: null },
          data: {
            logoutAt: capturedAt,
            logoutSelfieKey: stored?.key || null,
            logoutFaceVerified: Boolean(input.faceVerified),
            logoutLatitude: input.latitude,
            logoutLongitude: input.longitude,
            logoutAccuracyM: Math.round(input.accuracy),
            logoutBranchId: verdict.branchId,
            logoutDistanceMeters: verdict.distanceMeters,
            logoutLocationVerified: verdict.verified,
          },
        });
        if (!count) throw badRequest("You are already logged out. Log in again first.");
        // A break still running ends with the day, at the same moment, so none is left open.
        await tx.attendanceBreak.updateMany({ where: { sessionId: session.id, endedAt: null }, data: { endedAt: capturedAt } });
        const row = await tx.attendanceSession.findUnique({ where: { id: session.id } });
        const capture = await service.recordCapture(tx, {
          session: row, employeeId: employee.id, type: "CHECK_OUT", capturedAt,
          selfie: stored, position, verdict, faceVerified: input.faceVerified, deviceInfo: deviceOf(req),
        });
        const extraTime = late
          ? await raiseExtraTime(tx, { employee, workDate: calendarDay(session.workDate), at: capturedAt, reason, approverIds, user: req.user })
          : null;
        return { row, captureId: capture.id, extraTime };
      });
      service.fillEventAddress(updated.captureId, input.latitude, input.longitude);
    } catch (error) {
      await discardPrivateImage(stored?.key);
      throw error;
    }
    // What the day was marked as, for the box after the logout. A failure to read it does not undo a
    // logout already recorded - the box then simply says the logout was recorded.
    const day = await service.dayReadingAt(employee.id, updated.row, updated.row.logoutAt).catch((error) => {
      console.error("Unable to read the day a logout closed", error);
      return null;
    });
    // A full day on a weekly off or a holiday earns a comp-off: the record follows the logout.
    ledgers.refreshSoon(employee.id);
    if (updated.extraTime) await notifyApprovers(updated.extraTime);
    return res.json({
      data: {
        id: updated.row.id, loginAt: updated.row.loginAt, logoutAt: updated.row.logoutAt,
        location: { verified: verdict.verified, distanceMeters: verdict.distanceMeters, note: verdict.note },
        day,
        extraTime: late ? { sent: Boolean(updated.extraTime), requestId: updated.extraTime?.id || null } : null,
      },
      ...(late ? { message: updated.extraTime
        ? "Logged out. Your extra time is with your approver: the day stays Absent until they approve it, and then reads Present."
        : "Logged out. No Permission Approver is set on your record, so the extra time could not be sent - ask HR to set one, then raise an attendance regularization for this day." } : {}),
    });
  } catch (error) { return handleError(res, error, "Unable to mark your logout"); }
}

/**
 * What logging out now would mark today as - Absent, Half day, Early exit, Permitted, On time - for
 * the Logout box to warn before the logout rather than after it. Read by the same rules the logout
 * itself is judged by (`dayReadingAt`), for the viewer's own current login and nobody else's.
 */
async function getLogoutPreview(req, res) {
  try {
    const employee = await requireEmployee(req.user);
    const session = await service.currentSession(employee.id);
    if (!session || session.logoutAt) return res.json({ data: null });
    const day = await service.dayReadingAt(employee.id, session, new Date());
    /*
     * Past its 18 hours, the logout is still taken but sends the hours worked past them for
     * approval - so the box asks why before it is pressed, and names who will answer it. Read here
     * rather than guessed at on the screen, which cannot see the employee's approvers.
     */
    if (!sessionExpired(session)) return res.json({ data: { ...day, late: false } });
    const [approver] = service.approversFor(employee, "EXTRA_TIME");
    const named = approver ? await prisma.employee.findUnique({ where: { id: approver }, select: { employeeName: true } }) : null;
    return res.json({ data: { ...day, late: true, approverName: named?.employeeName || "" } });
  } catch (error) { return handleError(res, error, "Unable to read what logging out now would mark the day as"); }
}

/**
 * Starts one check-in or check-out capture: asked for the moment the camera opens, and brought back
 * with the selfie and the position. Only a login with an employee behind it gets one, so an
 * unlinked account is told why here rather than after it has taken a photograph for nothing.
 */
async function startCapture(req, res) {
  const parsed = captureTokenSchema.safeParse(req.body ?? {});
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    await requireEmployee(req.user);
    const { token, expiresAt } = issueCaptureToken(req.user.id, parsed.data.type);
    return res.status(201).json({ data: { captureToken: token, expiresAt, ttlSeconds: CAPTURE_TOKEN_TTL_SECONDS } });
  } catch (error) { return handleError(res, error, "Unable to start the capture"); }
}

/**
 * Today's open session for this login, or the refusal that says why a break cannot be taken: a
 * break is inside a logged-in day, so there has to be a login and no logout yet.
 */
async function openSessionForBreak(employeeId) {
  // The current login - today's, or yesterday's inside its 18 hours - like a logout.
  const session = await service.currentSession(employeeId);
  if (!session) throw badRequest("Log in for the day before taking a break.");
  if (session.logoutAt) throw badRequest("You have already logged out for today.");
  return { id: session.id, logoutAt: session.logoutAt };
}

/**
 * The part Break In and Break Off share: the capture checked and stored the way a logout's is.
 *
 * The token must be one issued for this very step (`BREAK_START` or `BREAK_END`), the selfie goes
 * to private storage, and the position is measured against the branch office. Unlike a login, a
 * break taken outside the office is recorded - flagged as unverified - rather than refused, even
 * where the geofence is enforced: stepping out is what a break often is.
 */
async function takeBreakCapture(req, type) {
  const parsed = breakSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message || "Capture a selfie and a live location for the break.");
  const input = parsed.data;
  verifyCaptureToken(input.captureToken, req.user.id, type);
  const employee = await requireEmployee(req.user);
  const session = await openSessionForBreak(employee.id);
  const settings = await service.readSettings();
  const position = { latitude: input.latitude, longitude: input.longitude, accuracy: input.accuracy };
  const verdict = await service.evaluateCapture({ employee, position, settings });
  const stored = await storePrivateImage(input.selfie, { folder: SELFIE_FOLDER });
  return { input, employee, session, position, verdict, stored };
}

/**
 * Holds the day for the length of a break write, and checks it is still open.
 *
 * The break checks run before the transaction, and a plain read inside it takes no lock, so two
 * quick Break Ins both saw no break running and both opened one, and a Break In could land after a
 * logout that had already closed the day - a break nobody could ever end. Locking the session row
 * makes a second break write, and a logout (which updates the same row), wait for the first; the
 * reads that follow then see what it wrote.
 */
async function lockOpenSession(tx, sessionId) {
  await tx.$queryRaw`SELECT id FROM attendance_session WHERE id = ${sessionId} FOR UPDATE`;
  const current = await tx.attendanceSession.findUnique({ where: { id: sessionId }, select: { loginAt: true, lastLoginAt: true, logoutAt: true } });
  if (!current || current.logoutAt) throw badRequest("You have already logged out for today.");
  if (sessionExpired(current)) throw badRequest(EXPIRED_LOGIN);
}

/** What a break capture's location check came to, for the screen to say. */
const locationOf = (verdict) => ({ verified: verdict.verified, distanceMeters: verdict.distanceMeters, note: verdict.note });

/** Break In: starts a break now, on the server's clock, with a live selfie and position. One at a time. */
async function startBreak(req, res) {
  let stored = null;
  try {
    const capture = await takeBreakCapture(req, "BREAK_START");
    stored = capture.stored;
    const { input, employee, session, position, verdict } = capture;
    const result = await prisma.$transaction(async (tx) => {
      // Asked inside the write, with the day locked, so two quick presses cannot open two breaks.
      await lockOpenSession(tx, session.id);
      const running = await tx.attendanceBreak.findFirst({ where: { sessionId: session.id, endedAt: null }, select: { id: true } });
      if (running) throw badRequest("You are already on a break. Press Break Off to end it.");
      const capturedAt = new Date();
      const event = await service.recordCapture(tx, {
        session, employeeId: employee.id, type: "BREAK_START", capturedAt,
        selfie: stored, position, verdict, faceVerified: input.faceVerified, deviceInfo: deviceOf(req),
      });
      await tx.attendanceBreak.create({ data: { sessionId: session.id, employeeId: employee.id, startedAt: capturedAt, startEventId: event.id } });
      return { eventId: event.id, rows: await tx.attendanceBreak.findMany({ where: { sessionId: session.id } }) };
    });
    service.fillEventAddress(result.eventId, input.latitude, input.longitude);
    return res.status(201).json({ data: { ...summariseBreaks(result.rows), location: locationOf(verdict) } });
  } catch (error) {
    // A photo stored for a break that was never written is taken back down.
    await discardPrivateImage(stored?.key);
    return handleError(res, error, "Unable to start the break");
  }
}

/**
 * Break Off: ends the running break now, with a live selfie and position, and answers with the
 * summary the screen shows - this break's start, end and length, and the day's breaks so far.
 */
async function endBreak(req, res) {
  let stored = null;
  try {
    const capture = await takeBreakCapture(req, "BREAK_END");
    stored = capture.stored;
    const { input, employee, session, position, verdict } = capture;
    const result = await prisma.$transaction(async (tx) => {
      await lockOpenSession(tx, session.id);
      const running = await tx.attendanceBreak.findFirst({ where: { sessionId: session.id, endedAt: null }, select: { id: true } });
      if (!running) throw badRequest("You are not on a break.");
      const endedAt = new Date();
      const event = await service.recordCapture(tx, {
        session, employeeId: employee.id, type: "BREAK_END", capturedAt: endedAt,
        selfie: stored, position, verdict, faceVerified: input.faceVerified, deviceInfo: deviceOf(req),
      });
      // Conditioned on the break still running, so a second press ends nothing twice.
      const { count } = await tx.attendanceBreak.updateMany({ where: { id: running.id, endedAt: null }, data: { endedAt, endEventId: event.id } });
      if (!count) throw badRequest("That break has already ended.");
      return { runningId: running.id, endedAt, eventId: event.id, rows: await tx.attendanceBreak.findMany({ where: { sessionId: session.id } }) };
    });
    service.fillEventAddress(result.eventId, input.latitude, input.longitude);
    const today = summariseBreaks(result.rows, result.endedAt);
    return res.json({ data: { ended: today.breaks.find((entry) => entry.id === result.runningId) || null, today, location: locationOf(verdict) } });
  } catch (error) {
    await discardPrivateImage(stored?.key);
    return handleError(res, error, "Unable to end the break");
  }
}

/**
 * This login's breaks over a range, one row each, for the Self Dashboard's Break Summary - the
 * Login Summary's counterpart. Each carries its day, Break In and Break Off, its length, and what
 * the location check said at each end; the range's count and total come with them.
 */
async function getBreaks(req, res) {
  try {
    // The Break Summary is for administrators only (`seesAttendanceLogs`); the screen does
    // not draw it for anybody else, and this is what stops it being read around the screen.
    if (!(await service.seesAttendanceLogs(req.user))) throw forbidden("You do not have access to the break summary.");
    const employee = await requireEmployee(req.user);
    const { start, end } = rangeFrom(req.query);
    const rows = await prisma.attendanceBreak.findMany({
      where: { employeeId: employee.id, session: { workDate: { gte: start, lte: end } } },
      include: { session: { select: { workDate: true } } },
      orderBy: { startedAt: "desc" },
    });
    const eventIds = rows.flatMap((row) => [row.startEventId, row.endEventId]).filter(Boolean);
    const events = eventIds.length
      ? await prisma.attendanceEvent.findMany({
        where: { id: { in: eventIds } },
        select: { id: true, locationVerified: true, distanceMeters: true, locationAddress: true },
      })
      : [];
    const eventById = new Map(events.map((event) => [event.id, event]));
    const locationAt = (id) => {
      const event = id ? eventById.get(id) : null;
      return event ? { verified: event.locationVerified, distanceMeters: event.distanceMeters, address: event.locationAddress || "" } : null;
    };
    const summary = summariseBreaks(rows);
    const minutesById = new Map(summary.breaks.map((entry) => [entry.id, entry.minutes]));
    return res.json({ data: {
      from: localIsoDate(start),
      to: localIsoDate(end),
      breaks: rows.map((row) => ({
        id: row.id,
        date: localIsoDate(row.session.workDate),
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        minutes: minutesById.get(row.id) ?? 0,
        running: !row.endedAt,
        startLocation: locationAt(row.startEventId),
        endLocation: locationAt(row.endEventId),
        // Ended by the logout rather than by Break Off: captured at Break In, but with no Break Off
        // capture. A break from before captures existed has neither, and is not called either way.
        closedByLogout: Boolean(row.endedAt && row.startEventId && !row.endEventId),
      })),
      totals: { count: summary.count, minutes: summary.totalMinutes, label: summary.totalLabel },
    } });
  } catch (error) { return handleError(res, error, "Unable to load your breaks"); }
}

/** The day rows and the range totals behind the Login Summary table and the dashboard tiles. */
/**
 * Settings → Employee → Payroll rules → Attendance calculator: administrators only (`services/administrator`), as the
 * Settings entry is. Not a permission, so it is not granted role by role: it reads anybody's
 * attendance and salary. `level` is kept for the callers; an administrator may read and change.
 */
async function requireCalculatorAccess(user, level = "READ") {
  if (!(await isAdministrator(user?.id))) {
    throw forbidden(level === "READ" ? "The attendance calculator is available to administrators only." : "Only an administrator can change the pay period.");
  }
}

/**
 * The page's pay period and payback day: read with the calculator's Read, saved with its Read /
 * Write. `{ cycleDay, paybackDay }` - two days of the month, each 1 to 31.
 */
async function getPayPeriod(req, res) {
  try {
    await requireCalculatorAccess(req.user);
    // With the month a change would start from - the payroll month whose cycle is running - which the
    // confirmation names before saving. Required here, not at the top: settingsVersions reaches back
    // into the calculator's module graph.
    const { runningPayrollMonth } = require("../payroll-register/settingsVersions");
    return res.json({ data: { ...await calculator.readPayPeriod(), changesFrom: await runningPayrollMonth() } });
  } catch (error) {
    return handleError(res, error, "Unable to load the pay period");
  }
}

async function savePayPeriod(req, res) {
  try {
    await requireCalculatorAccess(req.user, "READ_WRITE");
    const { cycleDay, paybackDay } = req.body || {};
    return res.json({ data: await calculator.savePayPeriod({ cycleDay, paybackDay }, { userId: req.user?.id || null }) });
  } catch (error) {
    return handleError(res, error, "Unable to save the pay period");
  }
}

/** The employees the calculator can be pointed at. */
async function listCalculatorEmployees(req, res) {
  try {
    await requireCalculatorAccess(req.user);
    return res.json({ data: await calculator.calculatorEmployees() });
  } catch (error) {
    return handleError(res, error, "Unable to load the employees");
  }
}

/** One employee's pay period, as the days payroll brings in (no salary): `?employeeId=12&from=2026-08-25&to=2026-09-25`. */
async function getCalculation(req, res) {
  try {
    await requireCalculatorAccess(req.user);
    return res.json({ data: await calculator.periodCalculation(req.query.employeeId, { from: req.query.from, to: req.query.to }) });
  } catch (error) {
    return handleError(res, error, "Unable to work out that period");
  }
}

/*
 * The Attendance Register's daily WhatsApp report (`reportGroup.js`). An administrator types the
 * group's name and chooses its senders in order, from the employees with Allow WhatsApp ticked;
 * anyone with Allow WhatsApp may connect their own WhatsApp from the Settings page
 * (`reportGroup.isChosenSender`), since any of them may be added to the list - each try is resolved
 * against that person's own WhatsApp
 * groups at send time, not picked upfront. The status is read by any of them, an administrator,
 * whoever can read the register and whoever holds `HRM / Attendance WhatsApp Report`.
 */
const CHAT_OFF_MESSAGE = "WhatsApp chat is switched off for the studio. An administrator has to switch it back on before you can connect.";
const CHAT_BLOCKED_MESSAGE = "Your WhatsApp chat has been switched off by an administrator.";
const whatsappSessions = () => require("../../sales/whatsapp-chat/sessionManager");
const whatsappSwitches = () => require("../../sales/whatsapp-chat/repository");

async function requireChosenSender(user) {
  if (!(await reportGroup.isChosenSender(user?.id))) throw forbidden("Only Priority 1 or another employee with Allow WhatsApp ticked on their Login Credentials can connect their WhatsApp for the attendance report.");
}

async function requireAdministrator(user, message) {
  if (!(await isAdministrator(user?.id))) throw forbidden(message);
}

/** Refuses when either WhatsApp chat switch is off for this person, as every send path does. */
async function requireChatSwitchedOn(userId) {
  const { isChatEnabled, isChatEnabledForUser } = whatsappSwitches();
  if (!(await isChatEnabled())) throw forbidden(CHAT_OFF_MESSAGE);
  if (!(await isChatEnabledForUser(userId))) throw forbidden(CHAT_BLOCKED_MESSAGE);
}

async function getReportGroup(req, res) {
  try {
    const [chosen, administrator] = await Promise.all([reportGroup.isChosenSender(req.user.id), isAdministrator(req.user.id)]);
    if (!chosen && !administrator && !(await reportGroup.maySendReport(req.user.id)) && !(await service.canReadRegister(req.user))) {
      throw forbidden("You do not have access to the attendance register.");
    }
    const status = await reportGroup.reportGroupStatus();
    // canManage: this person gets the button that connects their own WhatsApp for the report.
    return res.json({ data: { ...status, canManage: chosen, canChooseSenders: administrator } });
  } catch (error) { return handleError(res, error, "Unable to read the attendance report's WhatsApp group"); }
}

/** This person's own WhatsApp, for pairing it so their turn as a sender can succeed. */
async function getReportGroupSession(req, res) {
  try {
    await requireChosenSender(req.user);
    const { isChatEnabled, isChatEnabledForUser } = whatsappSwitches();
    const [chatEnabled, userChatEnabled] = await Promise.all([isChatEnabled(), isChatEnabledForUser(req.user.id)]);
    return res.json({ data: { ...whatsappSessions().sessionState(req.user.id), chatEnabled, userChatEnabled } });
  } catch (error) { return handleError(res, error, "Unable to read your WhatsApp session"); }
}

async function connectReportGroupSession(req, res) {
  try {
    await requireChosenSender(req.user);
    await requireChatSwitchedOn(req.user.id);
    return res.json({ data: { ...(await whatsappSessions().startSession(req.user.id)), chatEnabled: true, userChatEnabled: true } });
  } catch (error) { return handleError(res, error, "Unable to start WhatsApp pairing"); }
}

/** Sets or clears the group's name: administrator only, since it is plain text nobody's WhatsApp is checked against upfront. */
async function setReportGroupName(req, res) {
  try {
    await requireAdministrator(req.user, "Only an administrator names the attendance report's WhatsApp group.");
    const status = await reportGroup.setReportGroupName(req.body?.groupName);
    return res.json({ data: { ...status, canManage: await reportGroup.isChosenSender(req.user.id), canChooseSenders: true } });
  } catch (error) { return handleError(res, error, "Unable to save the WhatsApp group's name"); }
}

/** Switches the daily report on or off: `{ enabled: boolean }`. Off keeps every other setting. */
async function setReportEnabled(req, res) {
  try {
    await requireAdministrator(req.user, "Only an administrator switches the attendance report on or off.");
    const status = await reportGroup.setReportEnabled(req.body?.enabled);
    return res.json({ data: { ...status, canManage: await reportGroup.isChosenSender(req.user.id), canChooseSenders: true } });
  } catch (error) { return handleError(res, error, "Unable to switch the report on or off"); }
}

/** Sets when the report goes: `{ sendAt: "HH:MM" }`, or `""`/`null` for the default 10:00 am. */
async function setReportSendAt(req, res) {
  try {
    await requireAdministrator(req.user, "Only an administrator sets when the attendance report is sent.");
    const status = await reportGroup.setReportSendAt(req.body?.sendAt);
    return res.json({ data: { ...status, canManage: await reportGroup.isChosenSender(req.user.id), canChooseSenders: true } });
  } catch (error) { return handleError(res, error, "Unable to save when the report is sent"); }
}

/** The people who can be picked as the sender: active employees with Allow WhatsApp, connected or not. */
async function listReportSenderCandidates(req, res) {
  try {
    await requireAdministrator(req.user, "Only an administrator chooses who sends the attendance report.");
    return res.json({ data: await reportGroup.senderCandidates() });
  } catch (error) { return handleError(res, error, "Unable to read who can send the report"); }
}

/** Sets who sends it: `{ mode, senderUserId, fallbackUserIds, userIds }` (`senderPolicy.setPolicy`). */
async function setReportSenders(req, res) {
  try {
    await requireAdministrator(req.user, "Only an administrator chooses who sends the attendance report.");
    const status = await reportGroup.setReportSenders(req.body || {});
    return res.json({ data: { ...status, canManage: await reportGroup.isChosenSender(req.user.id), canChooseSenders: true } });
  } catch (error) { return handleError(res, error, "Unable to save the senders"); }
}

/** Clears the group's name: no report is sent until one is named again. The chosen senders stay. */
async function unlinkReportGroup(req, res) {
  try {
    await requireAdministrator(req.user, "Only an administrator can clear the attendance report's WhatsApp group.");
    const status = await reportGroup.setReportGroupName(null);
    return res.json({ data: { ...status, canManage: await reportGroup.isChosenSender(req.user.id), canChooseSenders: true } });
  } catch (error) { return handleError(res, error, "Unable to clear the WhatsApp group"); }
}

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

/**
 * Who this login's own requests go to, by kind, for the Raise Request form to show before it is sent.
 *
 * The same `approversFor` that `createRequest` routes a request with, so the names on the form are
 * the people the request will actually reach - a leave and a comp-off to every Leave Approver on the
 * record, a permission to the Permission Approver, an attendance regularization to the Attendance
 * Regularization Approver (or the Permission Approver where none is named). Nothing here is chosen by the person raising it:
 * approvers are set by HR on Login Credentials. An empty list is answered, not refused, so the form
 * can say "ask HR" before anybody fills it in.
 *
 * Only this login's own employee, so it reveals nothing a person could not already read off their
 * own record.
 */
async function listMyApprovers(req, res) {
  try {
    const employee = await requireEmployee(req.user);
    const byType = Object.fromEntries(REQUEST_TYPES.map((type) => [type, service.approversFor(employee, type)]));
    const ids = [...new Set(Object.values(byType).flat())];
    const people = ids.length
      ? await prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, employeeId: true, employeeName: true } })
      : [];
    const byId = new Map(people.map((person) => [person.id, { id: person.id, employeeCode: person.employeeId || "", employeeName: person.employeeName || "" }]));
    return res.json({
      data: {
        ...Object.fromEntries(Object.entries(byType).map(([type, list]) => [type, list.map((id) => byId.get(id)).filter(Boolean)])),
        // Which slot an attendance regularization went to - its own approver, or the Permission
        // Approver standing in for one not yet named - so the form can say whose name it shows.
        regularizationApproverRole: service.regularizationApproverOf(employee)?.role || null,
      },
    });
  } catch (error) { return handleError(res, error, "Unable to read your approvers"); }
}

/**
 * How many requests are waiting on this login's answer, for the badge on the sidebar's Request
 * entry. A count and nothing else, because it is asked once a minute from every open tab.
 *
 * The same rule `canDecide` applies to a single request - named on it, not yet answered, the request
 * still open, and not their own - asked as one count over the approval rows.
 */
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * This login's own Casual Leave: the balance today, the days of leave still waiting for approval, and -
 * given `from` and `to` - what a leave over those dates would come to: how many working days it is
 * and how many of them would be Loss of Pay, counting the pending leave first. `excludeRequestId`
 * leaves out the request being edited. `enabled` is false while the studio gives no Casual Leave.
 */
async function getLeaveBalance(req, res) {
  try {
    const employee = await requireEmployee(req.user);
    const todayIso = localIsoDate(calendarDay(new Date()));
    // Only ever leaves out one of the caller's own requests; anything but a whole id is no request.
    const asked = Number(req.query.excludeRequestId);
    const excludeRequestId = Number.isInteger(asked) && asked > 0 ? asked : null;
    const settings = await service.readSettings();

    // The leave asked about, when its dates are given: its working days, and each day it skips and why.
    const from = typeof req.query.from === "string" ? req.query.from : "";
    const to = typeof req.query.to === "string" ? req.query.to : "";
    let span = null;
    if (from || to) {
      const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && localIsoDate(calendarDay(value)) === value;
      if (!isDay(from) || !isDay(to)) throw badRequest("Choose the leave's From and To dates.");
      const problem = leaveDatesProblem(from, to);
      if (problem) throw badRequest(problem);
      span = await service.leaveSpan(from, to, { settings, branchId: employee.branchId ?? null });
    }

    const now = await service.casualLeaveFor(employee.id, todayIso, { excludeRequestId, settings });
    // With no Casual Leave there is no balance to say - but the leave's days are still said.
    if (!now.enabled) return res.json({ data: { enabled: false, preview: span && { days: span.dates.length, skipped: span.skipped, lossOfPayDays: 0 } } });

    // The working days among `dates` - a holiday or a weekly off takes nothing from the balance.
    const workingDays = async (dates) => {
      if (!dates.length) return [];
      const sorted = [...new Set(dates)].sort();
      const holidayDates = await service.holidayDateSet(calendarDay(sorted[0]), calendarDay(sorted.at(-1)), prisma, employee.branchId ?? null);
      return sorted.filter((iso) => dayKindFor(iso, { settings, holidayDates }) === DAY_KINDS.WORKING);
    };
    // Leave asked for and not yet decided: it will take from the same balance once approved.
    const pendingRequests = await prisma.attendanceRequest.findMany({
      // Casual Leave waiting for approval: a Loss of Pay leave never takes from the balance.
      where: { employeeId: employee.id, type: "LEAVE", status: { in: ["PENDING", "SENT_BACK"] }, ...CASUAL_LEAVE_ONLY, ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}) },
      select: { fromDate: true, toDate: true },
    });
    const pendingDates = await workingDays(pendingRequests.flatMap((request) => eachDateInRange(request.fromDate, request.toDate)));

    let preview = null;
    if (span) {
      const proposed = span.dates.filter((iso) => !pendingDates.includes(iso));
      // Worked out to the latest day in play, with the pending leave and this one taken as approved.
      const through = [to, pendingDates.at(-1) || todayIso, todayIso].sort().at(-1);
      const ledger = await service.casualLeaveFor(employee.id, through, { extraDates: [...pendingDates, ...proposed], excludeRequestId, settings });
      preview = { days: span.dates.length, skipped: span.skipped, lossOfPayDays: proposed.reduce((sum, iso) => sum + (ledger.lossOfPayByDate.get(iso) || 0), 0) };
    }
    const thisMonth = now.months.at(-1) || null;
    // The leave year today's period is in - on the pay cycle, the payroll year.
    const thisYear = thisMonth ? now.months.filter((entry) => entry.month.startsWith(thisMonth.month.slice(0, 4))) : [];
    return res.json({ data: {
      enabled: true,
      perMonth: Number(settings.casualLeavePerMonth),
      balance: now.balance,
      takenThisYear: thisYear.reduce((sum, entry) => sum + entry.taken, 0),
      lossOfPayThisYear: thisYear.reduce((sum, entry) => sum + entry.lossOfPay, 0),
      creditedThisMonth: thisMonth?.credited ?? 0,
      pendingDays: pendingDates.length,
      preview,
    } });
  } catch (error) { return handleError(res, error, "Unable to read your Casual Leave balance"); }
}

/**
 * This login's own permissions in the period `date` falls in, against Attendance Rules' limit - for the
 * Permission form to say "1 of 2 used" before one is raised. `{ limit: 0 }` while there is no limit.
 * `excludeRequestId` leaves out the request being edited.
 */
async function getPermissionUsage(req, res) {
  try {
    const employee = await requireEmployee(req.user);
    const date = typeof req.query.date === "string" ? req.query.date : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || localIsoDate(calendarDay(date)) !== date) throw badRequest("Choose the permission's date.");
    const asked = Number(req.query.excludeRequestId);
    const ignoreId = Number.isInteger(asked) && asked > 0 ? asked : null;
    return res.json({ data: await service.permissionUsage(employee.id, date, { ignoreId }) });
  } catch (error) { return handleError(res, error, "Unable to read how many permissions you have used"); }
}

/**
 * The days off this login may raise a comp-off for, for the Raise Request form to offer as choices
 * rather than leave the person to remember a date and hear afterwards that it does not count.
 *
 * Each choice is **one day off**, and what pays for it: a weekly off or holiday worked a full day
 * that its approvers granted a whole day, or two days they granted half a day each. Nothing that has
 * expired, nothing another comp-off already claims, and nothing still waiting for an approver - the
 * same things `compOffProblem` refuses a request over, so a choice offered here is one that will be
 * accepted. Each day comes with its weekday, the holiday's name, the hours attendance shows were
 * worked and what it earned, and the choice with the last day it can be taken.
 */
async function listMyCompOffOptions(req, res) {
  try {
    const employee = await requireEmployee(req.user);
    const today = calendarDay(new Date());
    const settings = await service.readSettings();
    /*
     * The balance worked out now (`ledgers.compOffBalanceNow`) rather than this reading the sessions
     * for itself. It used to list every weekly off or holiday worked a full day on, cleared by its
     * approvers and not yet claimed - one option per day, each worth a day off. A day can now be
     * granted **half** a day, and half a day off is not a thing anybody can take, so what is offered
     * is no longer a day but a **unit**: one whole day, or two halves that buy a day off together
     * (`compOffCredits.claimableUnits`). Reading the one balance keeps the list, the ledger and the
     * server's refusal from disagreeing about what is available.
     */
    const rows = await ledgers.compOffBalanceNow(employee.id, { settings, today: localIsoDate(today) });
    const { units, pendingHalf } = compOffCredits.claimableUnits(rows, settings);
    const spoken = [...units.flatMap((unit) => unit.dates), ...(pendingHalf ? [pendingHalf.date] : [])];
    if (!spoken.length) return res.json({ data: { options: [], pendingHalf: null } });

    const span = spoken.slice().sort();
    // The employee's own branch's holidays: a day only another branch was shut earned nothing here.
    const calendar = await holidayCalendar(calendarDay(span[0]), calendarDay(span.at(-1)));
    const holidayNames = calendar.namesFor(employee.branchId ?? null);
    const sessions = await prisma.attendanceSession.findMany({
      where: { employeeId: employee.id, workDate: { in: span.map((iso) => calendarDay(iso)) } },
      select: { workDate: true, loginAt: true, logoutAt: true, awayMinutes: true },
    });
    const sessionOf = new Map(sessions.map((session) => [localIsoDate(session.workDate), session]));
    const earnedOf = new Map(rows.map((row) => [localIsoDate(row.workedDate), Number(row.earnedDays ?? 1)]));

    /** One worked day as the picker shows it: when it was, what it was, and the hours behind it. */
    const dayOf = (iso) => {
      const session = sessionOf.get(iso) || null;
      const minutes = session?.logoutAt ? workedMinutes(session) : null;
      return {
        date: iso,
        weekday: WEEKDAY_NAMES[calendarDay(iso).getUTCDay()],
        holidayName: holidayNames.get(iso) || "",
        loginAt: session?.loginAt || null,
        logoutAt: session?.logoutAt || null,
        workedMinutes: minutes,
        workedLabel: minutes === null ? "Not logged out" : formatDurationMinutes(minutes),
        earnedDays: earnedOf.has(iso) ? earnedOf.get(iso) : 1,
      };
    };

    return res.json({ data: {
      options: units.map((unit) => ({
        // What the form sends back: the days this unit spends, in order.
        workedDate: unit.dates[0],
        workedPairDate: unit.dates[1] || null,
        // The last day the day off can be taken - the earlier half's expiry on a pair.
        expiresOn: unit.expiresOn || null,
        days: unit.dates.map(dayOf),
      })),
      // The odd half with nothing to pair with: not claimable, but said rather than left out, so half
      // a day granted never looks to the employee like nothing granted.
      pendingHalf: pendingHalf ? { ...dayOf(pendingHalf.date), expiresOn: pendingHalf.expiresOn || null } : null,
    } });
  } catch (error) { return handleError(res, error, "Unable to read the days you can claim a comp-off for"); }
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
    const [actorEmployeeId, approverNames, seesAll, countLeaveDays] = await Promise.all([
      service.linkedEmployeeIdFor(req.user),
      service.approverNamesFor(requests),
      scope === "team" ? service.seesAllRequests(req.user) : false,
      // A leave's days are its working days: one read of the rules and holidays for the whole page.
      service.leaveDayCounter(requests),
    ]);
    // Whether this login is named as anybody's Leave or Permission Approver - which is who has a
    // "Waiting for me" queue at all. Asked of the team list only.
    const isApprover = scope === "team" ? await service.isNamedApprover(actorEmployeeId) : false;
    // A comp-off credit's day, hours and where its comp-off stands - one read for the whole page.
    const credits = await compOffCredits.creditDetails(requests);
    return res.json({
      // Whether the team list is everybody's (an administrator) rather than only this login's queue,
      // which is what turns HRM → Request's status tabs into the studio's for them.
      seesAll,
      isApprover,
      data: requests.map((request) => ({
        /*
         * `forRequester` is what withholds the approver names on a rejected request — and it is
         * asked per row rather than per page, because the team queue can contain somebody's own
         * request alongside the ones they are approving.
         */
        ...service.serialiseRequest(request, now, {
          forRequester: actorEmployeeId != null && actorEmployeeId === request.employeeId,
          approverNames,
          countLeaveDays,
        }),
        ...(credits.has(request.id) ? { compOffCredit: credits.get(request.id) } : {}),
        // Whether *this* login may decide *this* request, so the screen offers only the actions
        // that would actually succeed. The server checks again on the decision itself.
        canDecide: scope === "team" && service.canDecideWith(actorEmployeeId, request),
        // What this login has already answered on it - so a request they approved can stay in their
        // queue as "You approved" while it waits on the others, instead of offering the buttons again.
        myDecision: scope === "team" ? service.myDecisionWith(actorEmployeeId, request) : null,
      })),
    });
  } catch (error) { return handleError(res, error, "Unable to load the attendance requests"); }
}

/**
 * Whether a new request collides with one the employee already has.
 *
 * Two leaves over the same day, or a leave and a permission on the same day, cannot both stand: a day
 * away has no hours to be excused from, and a permission raised over one would still be spent against
 * the month's limit. Only pending and approved requests block — a rejected one has no claim on the
 * calendar, which is exactly what makes "Apply again" work. The refusal carries the request in the way
 * (`clash`), so the form can say which one and offer to delete it first.
 */
const DAYS_AWAY = ["LEAVE", "COMP_OFF"];
// What each kind collides with: a day away with any day away or a permission, and a permission likewise.
const CLASHES_WITH = { LEAVE: [...DAYS_AWAY, "PERMISSION"], COMP_OFF: [...DAYS_AWAY, "PERMISSION"], PERMISSION: ["PERMISSION", ...DAYS_AWAY] };
const REQUEST_TYPE_WORDS = { LEAVE: "leave", COMP_OFF: "comp-off", PERMISSION: "permission", ON_DUTY: "on duty / travel", INCORRECT_LOGIN: "attendance regularization" };

/**
 * **A day away that the person is already on a shoot for.**
 *
 * Leave approved on a shoot day is how a crew turns up one short on the morning, with nobody having
 * decided that: the leave was answered by an approver who could not see the plan, and the plan was
 * made by a manager who could not see the leave. So the ask is refused at the point it is made, and
 * the refusal says which shoot, on which day, and whose job it is to free them.
 *
 * **It names the Production Manager rather than offering to do it.** Taking somebody off a shoot is
 * re-planning it - the service they held has to go to somebody else, or the shoot goes a person
 * short - and that is the manager's decision, not a side effect of somebody asking for a day off.
 *
 * Three ways to be on a shoot, and all three count: given a **service** on it, on its **production
 * team**, or named as its **Production Coordinator**. Each is somebody the shoot expects to see.
 *
 * Only the days-away types. A **permission** is an hour or two inside a day and often precisely what
 * somebody on a shoot asks for, so it is left alone; `ON_DUTY` is being at work somewhere else, which
 * is the manager's own arrangement.
 */
async function shootClashProblem(employeeId, input) {
  if (!DAYS_AWAY.includes(input.type)) return null;
  const from = calendarDay(input.fromDate);
  const to = calendarDay(input.toDate);
  if (!from || !to) return null;
  /*
   * **Asked wide, then decided in the studio's own days.**
   *
   * `project_shoot.date_created` is the shoot's day held in a `datetime`, and it carries whatever time
   * of day the row was written with - one of these is `2026-12-07 18:30Z`, which in the studio's zone
   * is the 8th. So a range compared in UTC answers for a different day than the one the studio reads
   * on screen: asked for leave on the 7th, the first version of this refused it over a shoot
   * everybody calls the 8th, and would have let the 8th through.
   *
   * A day either side covers every zone the two can differ by; which rows actually clash is then
   * decided on `localIsoDate`, the same function the rest of attendance reads a day with. Comparing
   * the words rather than the instants is what makes the message and the refusal agree.
   */
  const DAY_MS = 24 * 60 * 60 * 1000;
  const fromIso = localIsoDate(from);
  const toIso = localIsoDate(to);
  const onADay = (shoot) => {
    const day = localIsoDate(shoot?.dateCreated);
    return Boolean(day) && day >= fromIso && day <= toIso;
  };

  const found = await prisma.projectProduction.findMany({
    where: {
      shoot: { deletedAt: null, dateCreated: { gte: new Date(from.getTime() - DAY_MS), lt: new Date(to.getTime() + 2 * DAY_MS) }, project: { deletedAt: null } },
      OR: [
        { serviceCrew: { some: { employeeId } } },
        { teamMembers: { some: { employeeId } } },
        { productionCoordinatorEmployeeId: employeeId },
      ],
    },
    orderBy: { shoot: { dateCreated: "asc" } },
    select: {
      productionCoordinatorEmployeeId: true,
      shoot: {
        select: {
          shootId: true, shoot: true, dateCreated: true, shootPlace: true,
          project: { select: { eventId: true, whatsappGroupName: true, productionManagerEmployee: { select: { employeeName: true } } } },
        },
      },
      serviceCrew: { where: { employeeId }, select: { role: true, serviceDefinition: { select: { name: true } } } },
      teamMembers: { where: { employeeId }, select: { id: true } },
    },
  });
  const productions = found.filter((production) => onADay(production.shoot));
  if (!productions.length) return null;

  /* What each clashing shoot is, in the words the studio uses for it - the id and name it is listed
   * under, the day, where it is, and what this person is on it for. */
  const lines = productions.map((production) => {
    const { shoot } = production;
    const service = production.serviceCrew.map((seat) => seat.serviceDefinition?.name).filter(Boolean).join(", ");
    const onIt = service
      || (production.teamMembers.length ? "on the production team" : null)
      || (production.productionCoordinatorEmployeeId === employeeId ? "its Production Coordinator" : "on the crew");
    return [
      `${dayText(localIsoDate(shoot.dateCreated))}: ${[shoot.shootId, shoot.shoot].filter(Boolean).join(" ")}`,
      shoot.project?.whatsappGroupName || shoot.project?.eventId,
      shoot.shootPlace,
      `you are ${onIt}`,
    ].filter(Boolean).join(" · ");
  });

  // Whoever has to free them. One name where every clashing shoot has the same manager, which is the
  // common case; otherwise the person is told to ask each project's.
  const managers = [...new Set(productions.map((production) => production.shoot?.project?.productionManagerEmployee?.employeeName).filter(Boolean))];
  const whoToAsk = managers.length === 1
    ? `Ask ${managers[0]}, this project's Production Manager, to take you off it`
    : "Ask each project's Production Manager to take you off the shoot";

  const word = REQUEST_TYPE_WORDS[input.type] || "leave";
  return badRequest([
    `You cannot apply for ${word} on a day you are on a shoot.`,
    ...lines,
    `${whoToAsk}, then apply again.`,
  ].join("\n"));
}

async function overlapProblem(employeeId, input, ignoreId) {
  const clash = await prisma.attendanceRequest.findFirst({
    where: {
      employeeId,
      id: ignoreId ? { not: ignoreId } : undefined,
      // A Correction already approved has been answered, and the day may be corrected again from what
      // it now reads as; only one still waiting blocks another for the same day.
      status: { in: input.type === "INCORRECT_LOGIN" ? ["PENDING"] : ["PENDING", "APPROVED"] },
      // A leave and a comp-off are both a day away, so each blocks the other: a comp-off on a day
      // already on leave would spend the worked day on nothing.
      type: CLASHES_WITH[input.type] ? { in: CLASHES_WITH[input.type] } : input.type,
      fromDate: { lte: calendarDay(input.toDate) },
      toDate: { gte: calendarDay(input.fromDate) },
    },
    select: { id: true, type: true, fromDate: true, toDate: true, fromTime: true, toTime: true, status: true },
  });
  if (!clash) return null;
  const from = localIsoDate(clash.fromDate);
  const to = localIsoDate(clash.toDate);
  const span = from === to ? dayText(from) : `${dayText(from)} to ${dayText(to)}`;
  const status = clash.status === "APPROVED" ? "approved" : "pending";
  const kind = REQUEST_TYPE_WORDS[clash.type] || "request";
  const message = `You already have ${status === "approved" ? "an" : "a"} ${status} ${kind} on ${span}. Delete that request first to raise this one.`;
  return Object.assign(badRequest(message), {
    status: 409,
    code: "REQUEST_CLASH",
    clash: { id: clash.id, type: clash.type, status: clash.status, fromDate: from, toDate: to, fromTime: clash.fromTime || null, toTime: clash.toTime || null },
  });
}

/**
 * Asked again inside the write, under the lock: **do these worked days still make one whole day off?**
 *
 * The form's refusal (`compOffProblem`) works this out before the transaction, so between the two a
 * credit could have been re-decided, expired, or one of its days claimed by another request. The
 * day-level check beside this one catches a day already claimed; this catches the amount, which is
 * the invariant the whole feature rests on - a day off costs one whole day of credit and no less.
 */
async function assertStillWorthADayOff(tx, employeeId, worked, settings, ignoreId = null) {
  const { units } = await claimableNow(employeeId, settings, tx, ignoreId);
  if (compOffCredits.unitFor(worked.map((day) => localIsoDate(day)), units)) return;
  throw badRequest("Those days no longer add up to one day off. Open the form again to see what you can claim.");
}

/**
 * **What this employee could claim right now**: the units their available credit makes, and what each
 * worked day earned. Read with `client`, so the write can ask the same question again under its lock
 * rather than trusting an answer worked out before the lock was taken.
 *
 * `ignoreId` is the claim being **edited**. Its own days read CLAIMED in the balance, which would
 * otherwise refuse every edit of a comp-off - including one that only moves the day off - so they are
 * put back to AVAILABLE for the question "could this claim be made".
 */
async function claimableNow(employeeId, settings, client, ignoreId = null) {
  const rows = await ledgers.compOffBalanceNow(employeeId, { client, settings });
  const own = ignoreId
    ? await client.attendanceRequest.findUnique({ where: { id: Number(ignoreId) }, select: { workedDate: true, workedPairDate: true } })
    : null;
  const mine = new Set([own?.workedDate, own?.workedPairDate].filter(Boolean).map((date) => localIsoDate(date)));
  const freed = rows.map((row) => (mine.has(localIsoDate(row.workedDate)) ? { ...row, status: "AVAILABLE", requestId: null } : row));
  return {
    units: compOffCredits.claimableUnits(freed, settings).units,
    earned: new Map(freed.map((row) => [localIsoDate(row.workedDate), Number(row.earnedDays ?? 1)])),
  };
}

/**
 * The worked days one comp-off claim spends, oldest first: the day it names, and the second half day
 * where two halves buy the day off between them. Locked and checked as a set, never one of the two.
 */
const compOffWorkedDays = (input) => [input.workedDate, input.workedPairDate]
  .filter(Boolean)
  .map((iso) => calendarDay(iso))
  .sort((a, b) => a - b);

/**
 * A comp-off's two worked-day columns as they are stored: the **earlier** day in `workedDate` and the
 * later in `workedPairDate`, whichever order they arrived in. Everything that reads a claim back -
 * its expiry, the day it was earned on, the ledger - takes `workedDate` as the first day worked, so
 * the order is settled here once rather than guarded at each of those.
 */
function compOffDayColumns(input) {
  if (input.type !== "COMP_OFF") return { workedDate: null, workedPairDate: null };
  const days = compOffWorkedDays(input);
  return { workedDate: days[0] || null, workedPairDate: days[1] || null };
}

/**
 * Why one of these worked days is already claimed, or null. Read with `client`, so it can run inside
 * the write.
 *
 * Both of a pair's days are asked about, and against both columns a claim can hold them in: a day
 * spent as the second half of somebody's day off is spent, and must not be claimable again as the
 * first half of another.
 */
async function compOffClaimProblem(client, employeeId, worked, ignoreId = null, { lock = false } = {}) {
  const days = (Array.isArray(worked) ? worked : [worked]).filter(Boolean);
  if (!days.length) return null;
  /*
   * Inside the write this has to be a **locking** read.
   *
   * A plain `findFirst` inside the transaction answers from the snapshot the transaction opened,
   * which on the edit path is taken before the day locks are held - so a claim committed in between
   * was invisible and the same half day could be spent twice. `FOR UPDATE` reads what is committed
   * now and holds it, which is the whole point of asking again under the lock.
   */
  let claimed = null;
  if (lock) {
    const named = Prisma.join(days);
    const notMine = ignoreId ? Prisma.sql`AND id <> ${Number(ignoreId)}` : Prisma.empty;
    const rows = await client.$queryRaw`
      SELECT status, from_date AS fromDate, worked_date AS workedDate, worked_pair_date AS workedPairDate
      FROM attendance_request
      WHERE employee_id = ${employeeId}
        AND type = 'COMP_OFF'
        AND status IN ('PENDING', 'APPROVED')
        AND (worked_date IN (${named}) OR worked_pair_date IN (${named}))
        ${notMine}
      LIMIT 1
      FOR UPDATE`;
    claimed = rows[0] || null;
  } else {
    claimed = await client.attendanceRequest.findFirst({
      where: {
        employeeId, type: "COMP_OFF", status: { in: ["PENDING", "APPROVED"] },
        OR: [{ workedDate: { in: days } }, { workedPairDate: { in: days } }],
        // An edit of a comp-off is not a second claim on the day it already claims.
        id: ignoreId ? { not: ignoreId } : undefined,
      },
      select: { status: true, fromDate: true, workedDate: true, workedPairDate: true },
    });
  }
  if (!claimed) return null;
  const taken = days.find((day) => [claimed.workedDate, claimed.workedPairDate].some((held) => held && localIsoDate(held) === localIsoDate(day))) || days[0];
  return `${dayText(localIsoDate(taken))} is already claimed by a ${claimed.status.toLowerCase()} comp-off for ${dayText(localIsoDate(claimed.fromDate))}.`;
}

/**
 * Why a comp-off cannot be raised, or null.
 *
 * A comp-off gives back a day for a holiday or weekly off the person actually worked, so each rule
 * is one way it could otherwise be claimed for nothing: the calendar rules in `compOffDatesProblem`,
 * then attendance has to show them there, and the day can be claimed once. The claim is asked again
 * inside the write, under a lock - see `createRequest`.
 */
/** A `YYYY-MM-DD` day as a message names it - "8 Oct 2026". */
const dayText = (iso) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00.000Z`));

async function compOffProblem(employeeId, input, settings, branchId = null, ignoreId = null) {
  /*
   * The days worked, **sorted**, and the earliest of them is `worked`. Everything below reads
   * `worked` as the first day worked - the expiry is measured from it, and it is the day whose
   * attendance is checked - so the order the browser sent them in is settled here rather than
   * trusted. Sent the later day as `workedDate` and an earlier one as the pair, this used to measure
   * the expiry from the wrong day and look for the wrong day's holidays.
   */
  const days = compOffWorkedDays(input);
  const worked = days[0];
  // Guarded rather than left to `calendarDay(null)`, which read as "" against go-live - a refusal
  // about a date nobody had chosen - and then threw on a lookup by a null day.
  if (!worked) return "Choose the weekly off or holiday you worked.";
  const off = calendarDay(input.fromDate);
  if (!off) return "Choose the day you want off.";
  // The employee's own holidays, over every day in play - the pair day included, which could fall
  // outside the first day and the day off and so be read as a working day it never was.
  const span = [...days, off].sort((a, b) => a - b);
  const holidayDates = await service.holidayDateSet(span[0], span.at(-1), prisma, branchId);
  const datesProblem = compOffDatesProblem(input, { settings, holidayDates });
  if (datesProblem) return datesProblem;
  // A day worked before attendance starts being counted is not claimable - refused here, not only left off the list.
  const goLive = attendanceStartIso(settings);
  if (goLive && localIsoDate(worked) < goLive) return `Attendance is counted from ${dayText(goLive)}, so a day worked before it cannot be claimed as comp-off.`;

  const session = await prisma.attendanceSession.findUnique({
    where: { employeeId_workDate: { employeeId, workDate: worked } },
    select: { loginAt: true, logoutAt: true, awayMinutes: true },
  });
  if (!session?.loginAt) return `There is no attendance recorded for ${localIsoDate(worked)}, so there is no worked day to claim.`;
  // Only a full day's work earns one: Attendance Rules' Full day, from login to logout.
  const fullDay = formatDurationMinutes(Number(settings.dailyTargetMinutes) || 0);
  if (!session.logoutAt) return `You did not log out on ${dayText(localIsoDate(worked))}, so the hours worked are not known. A comp-off needs a full day (${fullDay}).`;
  if (!fullDayWorked(session, settings)) {
    return `You worked ${formatDurationMinutes(workedMinutes(session))} on ${dayText(localIsoDate(worked))}. A comp-off needs a full day (${fullDay}).`;
  }
  // The work itself has to be approved first: pending or rejected, it is not a day to take back.
  const unapproved = await compOffCredits.creditProblem(employeeId, localIsoDate(worked), settings);
  if (unapproved) return unapproved;
  /*
   * **What the worked days add up to.**
   *
   * A day off costs one whole day of credit, and a worked day no longer always earns one: its
   * approvers grant 1, 0.5 or 0. So a claim is refused unless the days it names make exactly one day
   * between them - one whole day, or two halves - which is what the picker offers and what the ledger
   * will spend. Asked of the balance rather than worked out here, so the list, the ledger and this
   * refusal cannot disagree about what is available.
   */
  if (days.length > 1 && localIsoDate(days[0]) === localIsoDate(days[1])) return "A comp-off cannot be paid for with the same day twice.";
  const dates = days.map((day) => localIsoDate(day));
  const { units, earned } = await claimableNow(employeeId, settings, prisma, ignoreId);
  if (!compOffCredits.unitFor(dates, units)) {
    if (earned.get(dates[0]) === compOffCredits.HALF_DAY && dates.length === 1) {
      // Name the half it can go with, where there is one: "claim it with another half day" leaves
      // the reader to go and find which.
      const other = units.find((unit) => unit.dates.length > 1 && unit.dates.includes(dates[0]));
      const partner = other?.dates.find((date) => date !== dates[0]) || null;
      return partner
        ? `Your work on ${dayText(dates[0])} was granted half a day, and a day off is a whole day. Claim it together with your half day from ${dayText(partner)}.`
        : `Your work on ${dayText(dates[0])} was granted half a day, and a day off is a whole day. It can be claimed once you earn another half day.`;
    }
    if (earned.get(dates[0]) === 0) {
      return `Your work on ${dayText(dates[0])} was approved but granted no day off, so there is nothing to claim.`;
    }
    return "Those days cannot be used together for one day off. Pick one of the choices listed.";
  }
  return compOffClaimProblem(prisma, employeeId, days, ignoreId);
}

/**
 * One day as a Correction reads it: the day's status from the same classification the dashboard and
 * the register use (`attendanceDays`), named the way the request names it (`correctionStatusOf`), and
 * what it may be corrected to - every correctable status but the one it already is. A day there is
 * nothing to correct on - a holiday, a weekly off, a day still logged in - has no current status, and
 * `message` says why.
 */
async function correctionDay(employeeId, day) {
  // Before attendance starts being counted there is nothing to regularize, and it says from when.
  const goLive = attendanceStartIso(await service.readSettings());
  if (goLive && localIsoDate(day) < goLive) {
    return { date: localIsoDate(day), currentStatus: "", message: `Attendance is counted from ${dayText(goLive)}, so days before it cannot be regularized.`, options: [] };
  }
  // A day in a pay cycle whose payroll is frozen holds still until that payroll is paid out.
  const held = await regularizationHoldMessage(employeeId, localIsoDate(day));
  if (held) return { date: localIsoDate(day), currentStatus: "", message: held, options: [] };
  const { days } = await service.attendanceDays(employeeId, day, day);
  const status = days[0]?.status || "";
  const currentStatus = correctionStatusOf(status);
  let message = "";
  if (!currentStatus) {
    if (status === "Not logged out") message = "That day is still logged in. Log out first, then raise the attendance regularization.";
    else if (status === "Not required") message = "Attendance is not required of you, so there is nothing to correct.";
    else message = "That day has no attendance status to correct.";
  }
  /*
   * A day the calendar says was off is raisable - the studio shoots on holidays and Sundays - and it
   * says what is being asked rather than leaving the approver to notice the date. The whole list is
   * offered, because none of the readings equals "Holiday" or "Weekly off": nothing can be
   * regularized *into* a day off, which is the calendar's to decide and not one request's.
   */
  if (currentStatus === "Holiday" || currentStatus === "Weekly off") {
    message = `That day was a ${currentStatus.toLowerCase()}. Regularize it only if you actually worked - your approver will see that the day was off.`;
  }
  return {
    date: localIsoDate(day),
    currentStatus,
    message,
    options: currentStatus ? CORRECTABLE_STATUSES.filter((option) => option !== currentStatus) : [],
  };
}

/** `GET /requests/correction-day?date=` - the Raise Request form's read-only Current Status, and its Change To options. */
async function getCorrectionDay(req, res) {
  try {
    const employee = await requireEmployee(req.user);
    const day = calendarDay(req.query.date);
    if (!day) throw badRequest("Choose the date.");
    if (day > calendarDay(new Date())) throw badRequest("That day has not happened yet.");
    return res.json({ data: await correctionDay(employee.id, day) });
  } catch (error) { return handleError(res, error, "Unable to read that day's attendance"); }
}

/**
 * Why this request cannot stand, thrown rather than returned. The rules a request has to satisfy
 * whether it is being raised or edited.
 *
 * Extracted from `createRequest` when editing arrived: an edit that skipped these would be a way
 * round every one of them - a leave running backwards, a permission outside the studio's hours, a
 * comp-off claiming a day already claimed - reachable by raising a valid request and then changing
 * it. `ignoreId` is the request being edited, which must not be read as clashing with itself.
 *
 * It fills `input.currentStatus` for an Attendance Regularization: the day as the server reads it
 * now, which is the one field here that is an answer rather than a check.
 */
async function assertRequestAllowed(employee, input, settings, ignoreId = null) {
  // The two validations the browser-only version never had. A leave whose To date fell before its
  // From date was recorded as one day; a permission running backwards showed a duration of "-"
  // and was raised anyway.
  if (DAY_REQUEST_TYPES.includes(input.type)) {
    // Both are about one day already recorded, so both put that day in from and to.
    if (localIsoDate(input.fromDate) !== localIsoDate(input.toDate)) throw badRequest("This request is about a single day.");
    const day = calendarDay(input.fromDate);
    if (day > calendarDay(new Date())) throw badRequest("That day has not happened yet.");

    if (input.type === "INCORRECT_LOGIN") {
      /*
       * A Correction: the day as the server reads it now - the same reading the dashboard and the
       * register give (`correctionDay`) - never what the browser says it is. It may stand on a day
       * with no login at all, an absence or a day on leave, so no session is required.
       */
      const { currentStatus, message } = await correctionDay(employee.id, day);
      if (!currentStatus) throw badRequest(message);
      if (!input.requestedStatus) throw badRequest("Choose what the day should read as.");
      if (input.requestedStatus === currentStatus) throw badRequest("Choose a status different from the current one.");
      input.currentStatus = currentStatus;
    } else {
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
    }
  } else if (input.type === "PERMISSION") {
    const problem = permissionTimesProblem(input.fromTime, input.toTime, settings);
    if (problem) throw badRequest(problem);
    if (localIsoDate(input.fromDate) !== localIsoDate(input.toDate)) throw badRequest("A permission covers one day. Apply for leave to cover more than one.");
    // Attendance Rules' Permissions limit: how many a month - or pay cycle - allows.
    const usage = await service.permissionUsage(employee.id, localIsoDate(input.fromDate), { settings, ignoreId });
    if (usage.limit && usage.used >= usage.limit) {
      throw badRequest(`You have already used the ${usage.limit} ${usage.limit === 1 ? "permission" : "permissions"} allowed in ${usage.label} (${dayText(usage.from)} to ${dayText(usage.to)}). Apply for leave instead, or choose a day in another period.`);
    }
  } else if (input.type === "COMP_OFF") {
    // `ignoreId` is the claim being edited: without it the balance reads its own days as already
    // claimed and every edit of a comp-off was refused, even one that only moves the day off.
    const problem = await compOffProblem(employee.id, input, settings, employee.branchId ?? null, ignoreId);
    if (problem) throw badRequest(problem);
  } else {
    const problem = leaveDatesProblem(input.fromDate, input.toDate);
    if (problem) throw badRequest(problem);
    // On duty / travel is marked ahead or on the day, never for a day already gone. A leave may be
    // (somebody off sick yesterday), so this is on-duty's alone.
    if (input.type === "ON_DUTY" && calendarDay(input.fromDate) < calendarDay(new Date())) {
      throw badRequest("On duty / travel cannot start on a day that has already passed.");
    }
  }

  const clash = await overlapProblem(employee.id, input, ignoreId);
  if (clash) throw clash;

  // After the overlap, so "you already have leave that day" is said before "you are on a shoot".
  const onAShoot = await shootClashProblem(employee.id, input);
  if (onAShoot) throw onAShoot;

  if (input.supersedesId) {
    // Same type too: "Apply again" re-raises the refused ask, not a different kind of request.
    const previous = await prisma.attendanceRequest.findFirst({ where: { id: input.supersedesId, employeeId: employee.id, type: input.type }, select: { id: true, status: true } });
    // Re-applying is for a refusal. Pointing at somebody else's request, or at one still open,
    // would make the chain say something that did not happen.
    if (!previous) throw badRequest("The request being re-applied for could not be found.");
    if (previous.status !== "REJECTED") throw badRequest("Only a rejected request can be applied for again.");
  }
}

/**
 * Refuses a request that has nobody to answer it, in the words that say whose job it is to fix that.
 *
 * Raising and editing both ask it: a request against an empty list could never be decided by anyone,
 * and it would sit in the employee's own queue forever looking like somebody had simply not got to
 * it.
 */
function assertApproversExist(approverIds, type) {
  if (approverIds.length) return;
  throw badRequest(type === "INCORRECT_LOGIN"
    ? "No Attendance Regularization Approver is set on your employee record, nor a Permission Approver to stand in. Ask HR to set your Attendance Regularization Approver."
    : service.needsPermissionApprover(type)
    ? "No Permission Approver is set on your employee record, and only they can decide this request. Ask HR to set your Permission Approver."
    : "No approver is set on your employee record, so this request has nobody to answer it. Ask HR to set your approvers.");
}

/**
 * The day is logged out of, and held at **Absent** until the extra time is approved.
 *
 * Both halves matter. The logout is written, so the day reads as what it was - logged in at 00:30,
 * logged out at 20:31 - rather than going on saying nobody logged out. And because a written logout
 * would otherwise finish the day as Present on its own, the day is pinned to Absent by an override
 * until an approver says otherwise; approving the request replaces that override with Present
 * (`applyCorrectionStatus`), which is the same write an approved regularization makes.
 *
 * Returns the request, or null where nobody is named to approve it - the logout still stands, and
 * the caller says so.
 */
async function raiseExtraTime(tx, { employee, workDate, at, reason, approverIds, user }) {
  await tx.attendanceStatusOverride.upsert({
    where: { employeeId_workDate: { employeeId: employee.id, workDate } },
    create: { employeeId: employee.id, workDate, status: "Absent" },
    update: { status: "Absent" },
  });
  if (!approverIds.length) return null;
  const request = await tx.attendanceRequest.create({
    data: {
      employeeId: employee.id,
      type: "EXTRA_TIME",
      status: "PENDING",
      fromDate: workDate,
      toDate: workDate,
      toTime: clockOf(at),
      // What the day reads as now, and what approving it makes it - checked again at the approval,
      // so a day that has changed since is not overwritten.
      currentStatus: "Absent",
      requestedStatus: "Present",
      reason,
    },
  });
  await service.createApprovals(tx, request.id, approverIds);
  await service.recordEvent(tx, request.id, "CREATED", user, reason);
  return tx.attendanceRequest.findUnique({ where: { id: request.id }, include: service.requestInclude });
}

/** "20:17" on the studio's wall clock - the shape `to_time` holds (`VARCHAR(5)`). */
const clockOf = (when) => {
  const { hour, minute } = studioParts(when);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};

const extraTimeSchema = z.object({
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the day you did not log out of."),
  reason: z.string().trim().min(1, "Say why you are logging out late.").max(2000),
});

/**
 * **Extra time**: the logout somebody presses after their login's 18 hours have passed.
 *
 * The 18 hours used to refuse the logout outright, which lost the time: the day read Absent and the
 * hours worked past them were nobody's. The logout is taken now - at the clock time they press it -
 * but it is **not** written onto the session. The day goes on reading Absent, and an `EXTRA_TIME`
 * request carrying that time and their own description goes to their Permission Approver. Approving
 * it writes the logout onto the day (`applyCorrection`, the same write a Correction makes), and the
 * day becomes Present.
 *
 * Only a day that is actually an expired login of theirs, still open and still unanswered - the same
 * days the screen already nudges them about (`openPastDays`), so a day already asked about cannot be
 * asked about twice.
 */
async function markExtraTime(req, res) {
  const parsed = extraTimeSchema.safeParse(req.body ?? {});
  if (!parsed.success) return validationError(res, parsed.error);
  const { date, reason } = parsed.data;
  try {
    const employee = await requireEmployee(req.user);
    if (await service.isExcludedFromAttendance(employee.id)) throw forbidden(NOT_IN_ATTENDANCE);
    const now = new Date();
    const open = await service.openPastDays(employee.id, now);
    const day = open.find((entry) => entry.date === date);
    if (!day) throw badRequest("That day is not a login waiting to be logged out of. Reload the page and try again.");

    const approverIds = service.approversFor(employee, "EXTRA_TIME");
    assertApproversExist(approverIds, "EXTRA_TIME");

    const created = await prisma.$transaction(async (tx) => {
      const workDate = calendarDay(new Date(`${date}T00:00:00.000Z`));
      // The day is locked while this is written, so two taps a moment apart raise one request.
      await tx.$queryRaw`SELECT id FROM attendance_session WHERE employee_id = ${employee.id} AND work_date = ${workDate} FOR UPDATE`;
      const already = await tx.attendanceRequest.findFirst({
        where: { employeeId: employee.id, type: { in: ["CORRECTION", "INCORRECT_LOGIN", "EXTRA_TIME"] }, status: { in: BLOCKING_STATUSES }, fromDate: workDate },
        select: { id: true },
      });
      if (already) throw badRequest("You have already asked about that day. Its request is waiting with your approver.");
      /*
       * The logout is written, as the logout box's own would be - the day reads logged in at 00:30,
       * logged out at 20:31, rather than going on saying nobody logged out. There is no selfie and
       * no position: nobody captured one, and its event says so rather than pretending otherwise.
       */
      const { count } = await tx.attendanceSession.updateMany({ where: { id: day.sessionId, logoutAt: null }, data: { logoutAt: now } });
      if (!count) throw badRequest("That day has already been logged out of. Reload the page.");
      await tx.attendanceBreak.updateMany({ where: { sessionId: day.sessionId, endedAt: null }, data: { endedAt: now } });
      await tx.attendanceEvent.create({
        data: {
          sessionId: day.sessionId,
          employeeId: employee.id,
          type: "CHECK_OUT_CORRECTED",
          capturedAt: now,
          locationNote: "Logged out late from the attendance screen; extra time sent for approval.",
        },
      });
      return raiseExtraTime(tx, { employee, workDate, at: now, reason, approverIds, user: req.user });
    });
    await notifyApprovers(created);
    return res.status(201).json({ data: created, message: "Logged out. Your extra time is with your approver: the day stays Absent until they approve it, and then reads Present." });
  } catch (error) {
    return handleError(res, error, "Unable to send your extra time for approval");
  }
}

async function createRequest(req, res) {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  const input = parsed.data;
  try {
    const employee = await requireEmployee(req.user);
    // Somebody ticked Exclude From Attendance is not in this module, so no approver's queue would
    // show what they raised - it would wait for nobody. Said plainly instead.
    if (await service.isExcludedFromAttendance(employee.id)) throw forbidden(NOT_IN_ATTENDANCE);
    const settings = await service.readSettings();

    await assertRequestAllowed(employee, input, settings);

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
    assertApproversExist(approverIds, input.type);

    const created = await prisma.$transaction(async (tx) => {
      /*
       * A worked day can be claimed once, and two submits a moment apart must not both pass the check
       * made above. Locking the worked day's attendance row - which a comp-off requires to exist -
       * makes the second submit wait here until the first has written, and then see its claim.
       */
      if (input.type === "COMP_OFF") {
        // Every day this claim spends, the second half included - or two claims could each take a day
        // off on the strength of the same half day.
        const worked = compOffWorkedDays(input);
        for (const day of worked) await tx.$queryRaw`SELECT id FROM attendance_session WHERE employee_id = ${employee.id} AND work_date = ${day} FOR UPDATE`;
        const claimed = await compOffClaimProblem(tx, employee.id, worked, null, { lock: true });
        if (claimed) throw badRequest(claimed);
        await assertStillWorthADayOff(tx, employee.id, worked, settings);
      }
      const request = await tx.attendanceRequest.create({
        data: {
          employeeId: employee.id,
          type: input.type,
          status: "PENDING",
          fromDate: calendarDay(input.fromDate),
          toDate: calendarDay(input.toDate),
          fromTime: input.type === "PERMISSION" ? input.fromTime : null,
          // A correction's proposed checkout lives here too: without it an approved correction had
          // no time to apply, and the day stayed open with nought hours.
          toTime: input.type === "PERMISSION" || input.type === "CORRECTION" ? input.toTime : null,
          // The worked days this claim spends, earliest first: `workedPairDate` is the second half
          // day, where the day off is bought with two halves rather than one whole day, and null on a
          // claim a single worked day pays for.
          ...compOffDayColumns(input),
          leaveType: input.type === "LEAVE" ? input.leaveType || "CL" : null,
          // The day as read when this was raised, and what it is asked to become - checked again at
          // the final approval, so a day that has changed since is not overwritten.
          currentStatus: input.type === "INCORRECT_LOGIN" ? input.currentStatus : null,
          requestedStatus: input.type === "INCORRECT_LOGIN" ? input.requestedStatus : null,
          reason: input.reason,
          supersedesId: input.supersedesId || null,
        },
      });
      await service.createApprovals(tx, request.id, approverIds);
      await service.recordEvent(tx, request.id, input.supersedesId ? "REAPPLIED" : "CREATED", req.user, input.reason);
      return tx.attendanceRequest.findUnique({ where: { id: request.id }, include: service.requestInclude });
    });
    // The bell of each approver named on it, and nobody else's. After the write, never inside it:
    // the request is raised whether or not the notice can be.
    await notifyApprovers(created);
    ledgers.refreshSoon(created.employeeId);
    return res.status(201).json({ data: service.serialiseRequest(created, new Date(), { countLeaveDays: await service.leaveDayCounter([created]) }) });
  } catch (error) { return handleError(res, error, "Unable to raise this request"); }
}

/**
 * The raiser editing their own request, from any status but deleted.
 *
 * It replaces "Apply again", which raised a second request and left the first beside it, so two
 * rows described one ask. The same body and the same rules as raising one - `assertRequestAllowed`
 * is the gate both go through, so an edit cannot be a way round a rule a raise would have refused -
 * and then every answer is cleared and it goes back to `PENDING`: an approval of the old dates is
 * not an approval of the new ones.
 */
async function updateRequest(req, res) {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  const input = parsed.data;
  try {
    const employee = await requireEmployee(req.user);
    const request = await loadRequest(req.params.id);
    if (await service.isExcludedFromAttendance(employee.id)) throw forbidden(NOT_IN_ATTENDANCE);
    /*
     * Whose request it is, before anything else answers a question about it. `service.edit` asks
     * again under the row lock - that is what decides the write - but running the kind check and the
     * raise-time gate first told a caller holding somebody else's id what kind of request it was.
     */
    service.assertRaiserMayAct(request, employee.id, service.RAISER_MAY_EDIT, "edited");
    /*
     * Refused rather than quietly ignored - the service writes no `type` either way, and a form that
     * silently kept the old kind would be worse than a sentence saying so.
     */
    if (input.type !== request.type) {
      throw badRequest("A request cannot change kind. Delete this one and raise the kind you need instead.");
    }
    const settings = await service.readSettings();
    // Its own dates are not a clash with itself, which is what `ignoreId` says.
    await assertRequestAllowed(employee, input, settings, request.id);
    /*
     * Who it goes back to: whoever would be asked if it were raised today, not the rows written when
     * it was raised. HR may have changed the employee's approvers since - or cleared them, in which
     * case an edit would send the request back to Pending with nobody able to answer it.
     */
    const approverIds = service.approversFor(employee, input.type);
    assertApproversExist(approverIds, input.type);

    const updated = await service.edit(prisma, {
      request,
      raiserEmployeeId: employee.id,
      user: req.user,
      approverIds,
      // Each field written the way `createRequest` writes it: a permission's hours are a permission's
      // alone, a correction's proposed checkout lives in `toTime`, and the rest are nulled by type.
      patch: {
        fromDate: calendarDay(input.fromDate),
        toDate: calendarDay(input.toDate),
        fromTime: input.type === "PERMISSION" ? input.fromTime : null,
        toTime: input.type === "PERMISSION" || input.type === "CORRECTION" ? input.toTime : null,
        ...compOffDayColumns(input),
        leaveType: input.type === "LEAVE" ? input.leaveType || "CL" : null,
        currentStatus: input.type === "INCORRECT_LOGIN" ? input.currentStatus : null,
        requestedStatus: input.type === "INCORRECT_LOGIN" ? input.requestedStatus : null,
        reason: input.reason,
      },
      beforeWrite: input.type === "COMP_OFF"
        ? async (tx) => {
          const worked = compOffWorkedDays(input);
          for (const day of worked) await tx.$queryRaw`SELECT id FROM attendance_session WHERE employee_id = ${employee.id} AND work_date = ${day} FOR UPDATE`;
          const claimed = await compOffClaimProblem(tx, employee.id, worked, request.id, { lock: true });
          if (claimed) throw badRequest(claimed);
          await assertStillWorthADayOff(tx, employee.id, worked, settings, request.id);
        }
        : null,
    });
    /*
     * Off every bell and then back on: the request is in front of its approvers again, and one of
     * them has already answered the version that no longer exists.
     */
    await clearApproverNotices(request.id, null);
    await notifyApprovers(updated);
    ledgers.refreshSoon(updated.employeeId);
    return res.json({ data: service.serialiseRequest(updated, new Date(), { countLeaveDays: await service.leaveDayCounter([updated]), approverNames: await service.approverNamesFor([updated]) }) });
  } catch (error) { return handleError(res, error, "Unable to change this request"); }
}

/** Loads a request with everything the ownership and approver checks need. */
async function loadRequest(id) {
  const request = await prisma.attendanceRequest.findUnique({ where: { id: await service.loadRequestId(id) }, include: service.requestInclude });
  if (!request) throw notFound("Request not found");
  return request;
}

/** Approve and reject are the same write with a different word, so they share one path. */
/**
 * How much this approver would grant a comp-off credit, from what they sent.
 *
 * Only on a credit, and only on an approval: a rejection grants nothing and must not read as a grant
 * of nought, which is a different answer - an approver who grants 0 has looked at the day and decided
 * it earned nothing, while a rejection says the ask itself was wrong.
 *
 * `undefined` where nothing was sent, which leaves the column alone: a credit approved from a screen
 * that has not been given the picker yet means what approving has always meant - the whole run.
 */
function grantFrom(body, request, status) {
  if (request?.type !== compOffCredits.CREDIT_TYPE || status !== "APPROVED") return undefined;
  const asked = body?.grantedDays;
  if (asked === undefined || asked === null || asked === "") return undefined;
  const amount = Number(asked);
  const choices = compOffCredits.grantChoices(request);
  // From the list or not at all: a figure nobody could have picked is a refusal, not a rounding.
  if (!Number.isFinite(amount) || !choices.includes(Number(amount.toFixed(1)))) {
    throw badRequest(`Grant one of ${choices.join(", ")} days - that is what the ${choices.length > 2 ? "days worked allow" : "day worked allows"}.`);
  }
  return Number(amount.toFixed(1));
}

async function decide(req, res, status, remarks) {
  const request = await loadRequest(req.params.id);
  // Off every queue once its employee is excluded from attendance, so not decided by id either.
  if (await service.isExcludedFromAttendance(request.employeeId)) throw notFound("Request not found");
  const decidedById = await service.linkedEmployeeIdFor(req.user);
  const myRow = (request.approvals || []).find((row) => row.approverEmployeeId === decidedById) || null;
  // Named on it, and not its raiser: `approversFor` does not filter the employee out, so somebody
  // listed as their own approver could otherwise answer their own request.
  if (!answerableBy(request, decidedById)) throw forbidden("You are not an approver for this request.");
  /*
   * Whether this answer may be given at all - `mayAnswer` holds the rule, and the three refusals
   * below say which of its reasons applied. An approver who has already answered is told so rather
   * than that they were never asked, which is what the old `canDecide` guard was careful about.
   */
  if (!mayAnswer(request, myRow, status)) {
    if (myRow?.decision === "APPROVED" && status === "REJECTED") {
      throw badRequest("You have already approved this request. An approval cannot be turned into a rejection - raise a Correction for the day instead.");
    }
    if (!["PENDING", "REJECTED"].includes(request.status)) {
      throw badRequest(`This request has been ${request.status.toLowerCase()} and can no longer be answered.`);
    }
    throw badRequest(`You have already ${String(myRow?.decision || "answered").toLowerCase()} this request.`);
  }
  const updated = await prisma.$transaction(async (tx) => {
    /*
     * One decision at a time on a request. The checks above ran before this transaction, so two
     * approvers pressing at the same moment - or one approver in two tabs - both passed them, each
     * read the other's answer as still pending, and the last write won: every row APPROVED with the
     * request left PENDING, or a rejection overwritten by an approval. Locking the request row first
     * makes the second wait, and everything below is read again after the first has committed.
     */
    await tx.$queryRaw`SELECT id FROM attendance_request WHERE id = ${request.id} FOR UPDATE`;
    const current = await tx.attendanceRequest.findUnique({ where: { id: request.id }, include: { approvals: true } });
    if (!current) throw notFound("Request not found");
    /*
     * Asked again of the rows as they are **after** the lock, not the ones loaded before it. This is
     * what closes the race, and it has to be the same question: checking `status === "PENDING"` here
     * while `mayAnswer` above allows a REJECTED request would refuse every reversal at the last
     * moment, which is a rule enforced in one place and broken in another.
     */
    const mine = current.approvals.find((row) => row.approverEmployeeId === decidedById) || null;
    if (!mayAnswer(current, mine, status)) {
      throw badRequest("This request has changed since you opened it. Open it again to see where it stands.");
    }

    /*
     * This approver's answer first, then what the request as a whole now reads as.
     *
     * A leave needs everybody on its list, so one approval usually leaves it PENDING and the other
     * approvers still see it in their queue. A rejection settles it whatever the others have said,
     * because a refusal is a veto rather than a vote.
     */
    const grantedDays = grantFrom(req.body, current, status);
    const outcome = await service.recordApproverDecision(tx, {
      request, approverEmployeeId: decidedById, decision: status, remarks, grantedDays,
    });

    /*
     * What the **request** was granted, from every approver's number: the lowest of them
     * (`grantedFrom`). Written on each answer rather than only on the last, so a credit part-way
     * through its approvers already shows what it would come to - and recomputed from the rows rather
     * than carried along, so a reversal cannot leave a stale figure behind.
     */
    const credit = current.type === compOffCredits.CREDIT_TYPE;
    const answers = credit ? await tx.attendanceRequestApproval.findMany({ where: { requestId: request.id } }) : [];
    const granted = credit ? compOffCredits.grantedFrom(answers, compOffCredits.workedDaysIn(current)) : null;

    await tx.attendanceRequest.update({
      where: { id: request.id },
      data: {
        status: outcome,
        ...(credit && outcome === "APPROVED" ? { grantedDays: granted } : {}),
        // Refused: nothing was granted, and the column says so rather than keeping a number nobody honoured.
        ...(credit && outcome === "REJECTED" ? { grantedDays: 0 } : {}),
        /*
         * Who settled it, when, and with what reason - `settlementFields` holds the rule, which is
         * that only the answer that *changes* the status stamps them. The reason on a rejection is
         * the refuser's, which is what the requester is shown; their name is not, and
         * `serialiseRequest` is what withholds it.
         */
        ...settlementFields(outcome, current, { decidedById, remarks }),
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

    /*
     * An approved Correction sets the day's status - only once the request as a whole is approved
     * (`outcomeOf`), inside the same transaction as the decision, and only onto the day it was raised
     * about. The day is read again here: if it no longer reads as it did when the request was raised -
     * HR edited it, a logout landed, another Correction came first - the decision is refused and
     * nothing is written, rather than a newer answer being overwritten. A retry after it applied finds
     * the request no longer pending (the row lock above) and never reaches this.
     */
    if (outcome === "APPROVED" && (request.type === "INCORRECT_LOGIN" || request.type === "EXTRA_TIME")) {
      const applied = await service.applyCorrectionStatus(tx, { request, user: req.user });
      if (!applied) throw conflict("This day's attendance has changed since the request was raised, so it can no longer be applied. Reject the request instead.");
    }

    return tx.attendanceRequest.findUnique({ where: { id: request.id }, include: service.requestInclude });
  });
  // This approver has answered, so it is off their bell. Once the request is settled - everybody
  // approved, or anybody refused - it is off every approver's, since nobody is left to answer it.
  await clearApproverNotices(request.id, updated.status === "PENDING" ? [decidedById] : null);
  // An approved credit becomes a comp-off when the ledger is written: written now, and read back so
  // the answer already says it is Available rather than waiting for the next look.
  if (updated.type === compOffCredits.CREDIT_TYPE && updated.status === "APPROVED") await ledgers.rebuildEmployee(updated.employeeId).catch((error) => console.error(`Attendance ledgers could not be written for employee ${updated.employeeId}:`, error.message));
  else ledgers.refreshSoon(updated.employeeId);
  const credit = (await compOffCredits.creditDetails([updated])).get(updated.id);
  return res.json({ data: { ...service.serialiseRequest(updated, new Date(), { countLeaveDays: await service.leaveDayCounter([updated]), approverNames: await service.approverNamesFor([updated]) }), ...(credit ? { compOffCredit: credit } : {}) } });
}

/**
 * Approving takes no remarks - the screen asks for none, and any sent are not kept: a yes needs no
 * explaining. Rejecting takes a reason, required (`rejectionSchema`), which is what the requester is
 * shown.
 */
async function approveRequest(req, res) {
  const parsed = decisionSchema.safeParse(req.body ?? {});
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    return await decide(req, res, "APPROVED", null);
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
 * Sending a request back to whoever raised it, with the reason they are shown.
 *
 * Any approver on its list may, while it is not approved. It takes the same body as a rejection -
 * a required remark - because the reason is the whole point: a request returned without one is a
 * request somebody has to guess about.
 */
async function sendBackRequest(req, res) {
  const parsed = rejectionSchema.safeParse(req.body ?? {});
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    const request = await loadRequest(req.params.id);
    // Off every queue once its employee is excluded from attendance, as `decide` reads it.
    if (await service.isExcludedFromAttendance(request.employeeId)) throw notFound("Request not found");
    const approverEmployeeId = await service.linkedEmployeeIdFor(req.user);
    if (!answerableBy(request, approverEmployeeId)) throw forbidden("You are not an approver for this request.");
    const updated = await service.sendBack(prisma, { request, user: req.user, remarks: parsed.data.remarks });
    // Off every bell, not just the sender's: nobody is being asked about it while it sits with the
    // raiser, and a notification for a row that has left the queue is one nobody can act on.
    await clearApproverNotices(request.id, null);
    ledgers.refreshSoon(updated.employeeId);
    return res.json({ data: service.serialiseRequest(updated, new Date(), { countLeaveDays: await service.leaveDayCounter([updated]), approverNames: await service.approverNamesFor([updated]) }) });
  } catch (error) { return handleError(res, error, "Unable to send this request back"); }
}

/**
 * Revert back: the raiser taking their own request out of every queue.
 *
 * It replaces Cancel and Withdraw both. Cancel left an approved day "cancelled" with no way to say
 * what the day then was; Withdraw deleted the row, and with it the answers approvers had already
 * given. This clears every answer and leaves the request with the raiser, editable, its history
 * intact - and the rule about which statuses it may be used from lives in the service, where all
 * three raiser verbs read it.
 */
async function revertRequest(req, res) {
  try {
    const request = await loadRequest(req.params.id);
    const raiserEmployeeId = await service.linkedEmployeeIdFor(req.user);
    if (await service.isExcludedFromAttendance(raiserEmployeeId)) throw forbidden(NOT_IN_ATTENDANCE);
    const updated = await service.revert(prisma, {
      request,
      raiserEmployeeId,
      user: req.user,
    });
    // It waits on nobody while it is with the raiser.
    await clearApproverNotices(request.id, null);
    ledgers.refreshSoon(updated.employeeId);
    return res.json({ data: service.serialiseRequest(updated, new Date(), { countLeaveDays: await service.leaveDayCounter([updated]), approverNames: await service.approverNamesFor([updated]) }) });
  } catch (error) { return handleError(res, error, "Unable to revert this request"); }
}

/**
 * Delete, which deletes nothing: the row stays and reads Deleted to the raiser.
 *
 * The old Withdraw really did delete, which erased the approvers' answers along with the ask and
 * left the raiser unable to see what they had sent. Nothing but `APPROVED` ever counted towards the
 * register, the reports or a leave balance, so a `DELETED` row costs nothing by staying.
 */
async function deleteRequest(req, res) {
  try {
    const request = await loadRequest(req.params.id);
    const raiserEmployeeId = await service.linkedEmployeeIdFor(req.user);
    if (await service.isExcludedFromAttendance(raiserEmployeeId)) throw forbidden(NOT_IN_ATTENDANCE);
    const updated = await service.remove(prisma, {
      request,
      raiserEmployeeId,
      user: req.user,
    });
    await clearApproverNotices(request.id, null);
    ledgers.refreshSoon(updated.employeeId);
    return res.json({ data: service.serialiseRequest(updated, new Date(), { countLeaveDays: await service.leaveDayCounter([updated]), approverNames: await service.approverNamesFor([updated]) }) });
  } catch (error) { return handleError(res, error, "Unable to delete this request"); }
}

/**
 * One request removed outright - the Super Admin's bulk delete from a selection (`mountBulkDelete`).
 *
 * Unlike `deleteRequest`, which marks one's own request Deleted and keeps it, this takes the row out
 * of the database: its approvals and history go with it (`onDelete: Cascade`), and so does every
 * notification still pointing at it, since there is nothing left for one to open. Any status may go.
 * A Correction's corrected day stays as it is - the override only loses its link to the request
 * (`onDelete: SetNull`) - which is what the studio chose. Who may call it is the route's guard.
 */
async function hardDeleteRequestRecord(id, req) {
  // Whole digits only: `parseInt` would read "12abc" as 12 and "1e3" as 1, and a permanent delete
  // must never land on a row nobody named.
  const text = String(id ?? "").trim();
  const requestId = /^\d+$/.test(text) ? Number(text) : NaN;
  if (!Number.isSafeInteger(requestId) || requestId <= 0) throw notFound("That request could not be found.");
  const existing = await prisma.attendanceRequest.findUnique({ where: { id: requestId }, select: { id: true, employeeId: true } });
  if (!existing) throw notFound("That request could not be found.");
  await prisma.$transaction([
    prisma.notification.deleteMany({ where: { entityType: REQUEST_ENTITY_TYPE, entityId: String(requestId) } }),
    prisma.attendanceRequest.delete({ where: { id: requestId } }),
  ]);
  ledgers.refreshSoon(existing.employeeId);
  // The row and its history are gone, so this line is the only trace of who removed it.
  console.info(`Attendance request ${requestId} permanently deleted by user ${req?.user?.id ?? "unknown"}.`);
}

/**
 * The offices attendance is measured from. Readable by anyone who may open the screen — knowing
 * where the studio's own offices are is not a disclosure — and editable only by an approval holder,
 * checked here because the router guard can only tell a GET from a write.
 */
async function listOfficeLocations(req, res) {
  try {
    const [locations, canManage] = await Promise.all([service.listOfficeLocations(), service.canManageRules(req.user)]);
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
    if (!(await service.canManageRules(req.user))) throw forbidden("You do not have permission to change the office locations.");
    const { branchId, ...rest } = parsed.data;
    const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { id: true } });
    if (!branch) throw badRequest("That branch no longer exists.");
    const saved = await service.saveOfficeLocation(branchId, rest, req.user.id);
    return res.json({ data: serialiseOffice({ ...saved, branch: null }) });
  } catch (error) { return handleError(res, error, "Unable to save this office location"); }
}

async function deleteOfficeLocation(req, res) {
  try {
    if (!(await service.canManageRules(req.user))) throw forbidden("You do not have permission to change the office locations.");
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

    // Whoever may read the register sees the photos it shows; everybody else, only their own.
    const [ownEmployeeId, canReadAll] = await Promise.all([
      service.linkedEmployeeIdFor(req.user),
      service.canReadRegister(req.user),
    ]);
    if (!canReadAll && (!ownEmployeeId || ownEmployeeId !== event.employeeId)) {
      throw forbidden("You cannot view somebody else's attendance photo.");
    }
    // An excluded employee's photo is theirs alone, as their day is (`getRegisterDetail`).
    if (ownEmployeeId !== event.employeeId && await service.isExcludedFromAttendance(event.employeeId)) {
      throw notFound("That attendance photo is not on file.");
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
 * The studio's register for one day.
 *
 * Guarded here for `HRM / Attendance Approval`, not by the router: the router's guard is
 * `HRM / Employee Attendance`, which everybody holds because everybody marks their own day. Reading
 * where two hundred colleagues were this morning is a different question, and it gets a different
 * answer.
 */
async function getRegister(req, res) {
  try {
    // Read, the level that opens the screen; changing a record (`editAttendance`) is Read / Write.
    if (!(await service.canReadRegister(req.user))) throw forbidden("You cannot read the studio's attendance register.");
    const day = calendarDay(req.query.date) || calendarDay(new Date());
    const register = await service.attendanceRegister(day, {
      branchId: req.query.branchId || null,
      status: req.query.status || null,
      search: req.query.search || "",
    });
    // The Irregularities card: today's absences, and yesterday's for whoever works a flexible shift.
    // Reused only when it is the whole day: narrowed by a status or a search, it would hide absences.
    const whole = !req.query.status && !req.query.search;
    const irregularities = await service.registerIrregularities(day, { branchId: req.query.branchId || null, register: whole ? register : null });
    return res.json({ data: { ...register, irregularities } });
  } catch (error) { return handleError(res, error, "Unable to load the attendance register"); }
}

/**
 * The studio's attendance over a range - the administrator's Dashboard.
 *
 * Administrators only (`services/administrator`), like the attendance calculator and the logs
 * beside it, and for the same reason: it reads everybody's attendance at once, which is wider than
 * any single permission a role can be granted. `HRM / Attendance Approval` opens the register - one
 * day, with the names on it - and is held by people who approve a team; this is the studio in
 * aggregate, and the Dashboard that shows it is offered to nobody else.
 *
 * The range defaults to the last thirty days, and is capped at 366 so a mistyped year cannot ask
 * the server to walk a decade.
 */
const OVERVIEW_MAX_DAYS = 366;
const OVERVIEW_MAX_EMPLOYEES = 1000;

/**
 * A day from the query, or null where nothing was asked for. Anything that is not a plain
 * `YYYY-MM-DD` string is refused rather than quietly falling back to the default range - a repeated
 * parameter arrives as an array and an object shape as an object, and both used to read as "no
 * date given", which answered a range nobody asked for.
 */
function overviewDay(value, what) {
  if (value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw badRequest(`${what} must be a date, as YYYY-MM-DD.`);
  const day = calendarDay(value);
  // `calendarDay` rolls an impossible day over rather than refusing it - 31 February reads as
  // 3 March - so the day it made has to come back as the text it was made from.
  if (!day || Number.isNaN(day.getTime()) || localIsoDate(day) !== value) throw badRequest(`${what} is not a real date.`);
  return day;
}

async function getOverview(req, res) {
  try {
    if (!(await isAdministrator(req.user?.id))) throw forbidden("The attendance dashboard is available to administrators only.");
    /*
     * Never past today. A working day that has not happened yet has no session on it, and the day
     * rules read a session-less working day as Absent - so a range running into next week would
     * mark everybody absent for it, and drag the rate and every arrow down with it.
     */
    const today = calendarDay(new Date());
    const askedTo = overviewDay(req.query.to, "The end of the range");
    const to = askedTo && askedTo < today ? askedTo : today;
    // UTC setters: `to` is a calendar day anchored at UTC midnight, and the local ones land a day
    // out either side of a daylight-saving change in a server zone that has one.
    const fallback = new Date(to);
    fallback.setUTCDate(fallback.getUTCDate() - 29);
    const from = overviewDay(req.query.from, "The start of the range") || calendarDay(fallback);
    if (from > to) throw badRequest("The start of the range is after its end.");
    if (Math.round((to - from) / 86400000) + 1 > OVERVIEW_MAX_DAYS) {
      throw badRequest(`A range of more than ${OVERVIEW_MAX_DAYS} days is too long to summarise. Choose a shorter one.`);
    }
    /*
     * Checked here rather than handed to Prisma as `Number(...)`: a repeated or malformed parameter
     * is `NaN`, which Prisma refuses with a validation error naming the model and the column, and
     * that message would be answered to the caller as a 500.
     */
    let branchId = null;
    if (req.query.branchId !== undefined && req.query.branchId !== "") {
      branchId = Number(req.query.branchId);
      if (typeof req.query.branchId !== "string" || !Number.isInteger(branchId) || branchId < 1 || branchId > 2147483647) {
        throw badRequest("Choose a branch from the list.");
      }
    }
    /*
     * The Employee filter, as `employeeIds=3,7,12`. Every entry has to be an id - one that is not is
     * refused rather than dropped, so a filter cannot quietly widen to everybody - and the list is
     * capped at a size no studio's picker produces.
     */
    let employeeIds = null;
    if (req.query.employeeIds !== undefined && req.query.employeeIds !== "") {
      const parts = typeof req.query.employeeIds === "string" ? req.query.employeeIds.split(",").map((part) => part.trim()) : null;
      // Digits only, so `1e3`, `0x10` and `+5` are refused rather than read as ids they happen to equal.
      const ids = parts && parts.every((part) => /^\d+$/.test(part)) ? parts.map(Number) : null;
      if (!ids || !ids.length || ids.length > OVERVIEW_MAX_EMPLOYEES
        || ids.some((id) => !Number.isInteger(id) || id < 1 || id > 2147483647)) {
        throw badRequest("Choose employees from the list.");
      }
      employeeIds = [...new Set(ids)];
    }
    const overview = await service.attendanceOverview(from, to, { branchId, employeeIds });
    return res.json({ data: overview });
  } catch (error) { return handleError(res, error, "Unable to load the attendance dashboard"); }
}

/**
 * One person's day in full. Readable by the person it is about as well as by an approval holder —
 * somebody should be able to see the evidence their own attendance was judged on.
 */
async function getRegisterDetail(req, res) {
  try {
    const detail = await service.attendanceDetail(req.params.sessionId);
    if (!detail) throw notFound("That attendance day is not on file.");
    const [ownEmployeeId, canReadAll] = await Promise.all([
      service.linkedEmployeeIdFor(req.user),
      service.canReadRegister(req.user),
    ]);
    if (!canReadAll && (!ownEmployeeId || ownEmployeeId !== detail.employee.id)) {
      throw forbidden("You cannot read somebody else's attendance day.");
    }
    // Somebody ticked Exclude From Attendance is not in this module: their day is theirs alone to
    // open, and to anybody else it is not on file - not refused, which would say it exists.
    if (ownEmployeeId !== detail.employee.id && await service.isExcludedFromAttendance(detail.employee.id)) {
      throw notFound("That attendance day is not on file.");
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
    // An excluded employee's day is not in this module to be edited either.
    if (!session || await service.isExcludedFromAttendance(session.employeeId)) throw notFound("That attendance day is not on file.");

    const instant = (time) => wallClockInstant(session.workDate, parseClockTime(time));
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
      // A day given a checkout here is closed like any other: no break is left running on it.
      if (nextOut) await service.closeOpenBreaks(tx, session.id, nextOut);
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
  overlapProblem,
  shootClashProblem,
  getLeaveBalance,
  getPermissionUsage,
  hardDeleteRequestRecord,
  getCorrectionDay,
  editAttendance,
  getCalculation,
  getPayPeriod,
  getReportGroup,
  getReportGroupSession,
  connectReportGroupSession,
  setReportEnabled,
  setReportGroupName,
  setReportSendAt,
  unlinkReportGroup,
  listReportSenderCandidates,
  setReportSenders,
  listCalculatorEmployees,
  savePayPeriod,
  getOverview,
  getRegister,
  getRegisterDetail,
  deleteOfficeLocation,
  getSelfie,
  listOfficeLocations,
  saveOfficeLocation,
  approveRequest,
  updateRequest,
  revertRequest,
  createRequest,
  getSettings,
  getSummary,
  getToday,
  listMyApprovers,
  listMyCompOffOptions,
  listRequests,
  markLogin,
  markLogout,
  markExtraTime,
  getLogoutPreview,
  startBreak,
  endBreak,
  getBreaks,
  startCapture,
  overlapProblem,
  rejectRequest,
  sendBackRequest,
  updateSettings,
  deleteRequest,
};
