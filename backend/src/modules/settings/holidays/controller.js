const { z } = require("zod");
const prisma = require("../../../config/db");
/*
 * The day helpers come from the attendance rules rather than being written again here.
 *
 * A holiday is a *day* — `attendance_holiday.holiday_date` is a `@db.Date` — and reading one back
 * through a timezone is the fault `calendarDay` exists to stop: `new Date("2026-10-20")` is
 * midnight UTC, which is the 19th for anybody behind Greenwich and would store, show and count the
 * wrong day. Attendance has the only correct implementation of this in the codebase, and a second
 * copy is how the two come to disagree about which day Diwali is on.
 */
const { calendarDay, localIsoDate } = require("../../hrm/attendance/attendanceRules");
// A holiday changes which days are leave and which earn a comp-off: the attendance ledgers follow.
const ledgers = require("../../hrm/attendance/ledgers");
const { scopeOf, holidayScopesOverlap, loadHolidays, scopeLabel } = require("../../../services/holidayCalendar");
const { branchOptionRows } = require("../../../services/branchOptions");
const iamService = require("../../../services/iam.service");

/**
 * The studio's declared holidays, as Settings keeps them.
 *
 * One list, read by two quite different things: the attendance rules, which take a holiday out of
 * every hours target and mark the day `Holiday` rather than an absence, and the studio calendar,
 * which draws it for everybody it applies to. Neither of those lives here — this is only the place
 * the list is written.
 *
 * ── Whose holiday ─────────────────────────────────────────────────────────────────────────────
 *
 * A holiday is the studio's (every branch) or some branches' alone, kept as `branches` links on the
 * row - none meaning every branch, which is what every holiday declared before this was. The
 * calendar and attendance read it per person through `services/holidayCalendar`.
 *
 * Who may declare for which branches follows the rule every branch-aware screen follows: the
 * branches of the roles granting **this** permission (`SETTINGS / Holidays`, at Read / Write for a
 * write). Somebody whose roles reach one branch may declare that branch's holidays and no other's,
 * and may not declare a studio-wide one - that takes reaching every branch, which a Super Admin
 * does by definition. What they are *shown* follows the same reach: their branches' holidays and
 * the studio's, never another branch's alone.
 */

const PERMISSION = { module: "SETTINGS", feature: "Holidays" };

// A written day that the calendar actually has: "2026-02-31" has the shape and no day behind it, and
// `calendarDay` would roll it to March, which is the one failure nobody spots until payroll.
const dayField = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a day for this holiday.")
  .refine((value) => localIsoDate(calendarDay(value)) === value, "That is not a day the calendar has.");
const holidaySchema = z.object({
  // A written day, taken literally. Anything else is refused rather than guessed at, because a
  // holiday silently landing a day out is the one failure nobody would spot until payroll.
  date: dayField,
  name: z.string().trim().min(1, "Name the holiday.").max(150, "That name is too long."),
  /*
   * Where it applies. Absent - a caller from before branches could be chosen - reads as every
   * branch, so nothing that used to work stops. `branchIds` is read only when `allBranches` is
   * false, and must then name at least one branch.
   */
  allBranches: z.boolean().optional(),
  branchIds: z.array(z.number().int().positive()).max(200).optional(),
}).superRefine((data, context) => {
  const all = data.allBranches ?? !(data.branchIds && data.branchIds.length);
  if (!all && !(data.branchIds && data.branchIds.length)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["branchIds"], message: "Choose at least one branch, or make it a holiday for all branches." });
  }
});

/** The scope a request asked for, as `{ allBranches, branchIds }` with the ids de-duplicated. */
function askedScope(data) {
  const branchIds = [...new Set(data.branchIds || [])];
  const allBranches = data.allBranches ?? branchIds.length === 0;
  return { allBranches, branchIds: allBranches ? [] : branchIds };
}

/** A row as the screen reads it. `canEdit` says whether this caller's reach may change it - the screen hides Edit and Remove otherwise. */
const serialize = (row, canEdit = true) => {
  const scope = scopeOf(row);
  return {
    id: row.id,
    date: localIsoDate(row.holidayDate),
    name: row.name,
    allBranches: scope.allBranches,
    branchIds: scope.branchIds,
    branches: (row.branches || []).map((link) => ({ id: link.branchId, name: link.branch?.name || "" })).filter((branch) => branch.id),
    scopeLabel: scopeLabel(row),
    canEdit,
  };
};

/** Whether the row the caller named is gone — deleted by somebody else while the screen was open. */
const isMissingRow = (error) => error?.code === "P2025";

const taken = (res) => res.status(409).json({ message: "That day already has a holiday for one of these branches. Edit the one that is there." });
const gone = (res) => res.status(404).json({ message: "That holiday no longer exists." });
const outOfReach = (res) => res.status(403).json({ message: "You can only declare holidays for the branches your role reaches." });

/*
 * ── Reach ─────────────────────────────────────────────────────────────────────────────────────
 *
 * `null` is every branch (a Super Admin, who is confined to none); otherwise the Set of branch ids
 * the caller's roles grant this permission in. A role that names no branches contributes none,
 * which is the IAM rule rather than an accident: such a caller sees the studio-wide holidays and
 * can declare nothing.
 */
async function reachOf(userId, level) {
  const ids = await iamService.reachableBranchIds(Number(userId), { ...PERMISSION, level });
  return ids === null ? null : new Set(ids);
}

/** Whether a holiday of `scope` is one this reach may see: the studio's, or a branch's it reaches. */
function visibleTo(scope, reach) {
  if (reach === null || scope.allBranches) return true;
  return scope.branchIds.some((id) => reach.has(id));
}

/**
 * Whether this reach may write a holiday of `scope`: every branch named must be reached, and a
 * studio-wide holiday needs every active branch reached - the one case where "all" is not simply
 * "mine". `activeIds` is the studio's active branches, read once by the caller.
 */
function mayWrite(scope, reach, activeIds) {
  if (reach === null) return true;
  if (scope.allBranches) return activeIds.length > 0 && activeIds.every((id) => reach.has(id));
  return scope.branchIds.length > 0 && scope.branchIds.every((id) => reach.has(id));
}

async function activeBranchIds(client = prisma) {
  return (await client.branch.findMany({ where: { isActive: true }, select: { id: true } })).map((row) => row.id);
}

/*
 * An optional window, for a screen that only draws one year of the list.
 *
 * Both bounds optional and no default: the Settings calendar asks for a year at a time, and
 * anything else asking for the whole list gets the whole list — a studio declares a dozen or two
 * holidays a year, so there is nothing here worth paginating.
 */
const windowSchema = z.object({
  from: dayField.optional(),
  to: dayField.optional(),
});

async function listHolidays(req, res) {
  const parsed = windowSchema.safeParse(req.query || {});
  if (!parsed.success) return res.status(400).json({ message: "That is not a date range." });
  try {
    const [rows, reach, writes, active] = await Promise.all([
      loadHolidays({ from: parsed.data.from, to: parsed.data.to }),
      reachOf(req.user?.id, "READ"),
      reachOf(req.user?.id, "READ_WRITE"),
      activeBranchIds(),
    ]);
    // Narrowed on the server: a branch's holiday is that branch's business, and a reader whose
    // roles reach other branches alone is not shown it. Each row says whether this caller may
    // change it, so the screen never offers an Edit the save would refuse.
    return res.json({ data: rows.filter((row) => visibleTo(scopeOf(row), reach)).map((row) => serialize(row, mayWrite(scopeOf(row), writes, active))) });
  } catch (error) {
    console.error("Unable to load the holidays:", error);
    return res.status(500).json({ message: "Unable to load the holidays." });
  }
}

/**
 * The branches the caller may declare a holiday for, as `{ id, name }` - the picker's list, and
 * the same answer `mayWrite` gives, so the screen never offers a branch the save would refuse.
 * `allBranches` says whether the studio-wide choice is theirs to make.
 */
async function listHolidayBranches(req, res) {
  try {
    const userId = Number(req.user?.id);
    const [rows, viewable, reach, active] = await Promise.all([
      branchOptionRows(prisma, userId, { ...PERMISSION, level: "READ_WRITE" }),
      // The branches whose holidays this caller may *see*, for reading the month as one of them.
      branchOptionRows(prisma, userId, { ...PERMISSION, level: "READ" }),
      reachOf(userId, "READ_WRITE"),
      activeBranchIds(),
    ]);
    return res.json({ data: {
      branches: rows.filter((row) => row.id),
      viewable: viewable.filter((row) => row.id),
      allBranches: mayWrite({ allBranches: true, branchIds: [] }, reach, active),
    } });
  } catch (error) {
    console.error("Unable to load the holiday branches:", error);
    return res.status(500).json({ message: "Unable to load the branches." });
  }
}

/*
 * ── One writer at a time ──────────────────────────────────────────────────────────────────────
 *
 * The day is no longer unique in the table, so two people declaring the same branch's holiday at
 * the same moment must not both get through - and a row lock cannot hold them apart, because the
 * first holiday on a day has no row yet to lock (a gap lock lets both in, and they deadlock on the
 * insert). So every holiday write takes one named lock for the length of its transaction: the
 * second waits, then reads the first's row and is refused with the same 409 a slower second press
 * gets. Holidays are written a dozen times a year; serialising them costs nothing.
 */
const WRITE_LOCK = "attendance_holiday_write";
const LOCK_WAIT_SECONDS = 5;

async function underWriteLock(work) {
  return prisma.$transaction(async (tx) => {
    const [row] = await tx.$queryRawUnsafe("SELECT GET_LOCK(?, ?) AS `got`", WRITE_LOCK, LOCK_WAIT_SECONDS);
    if (Number(row?.got) !== 1) throw Object.assign(new Error("busy"), { code: "HOLIDAY_BUSY" });
    try {
      return await work(tx);
    } finally {
      await tx.$queryRawUnsafe("SELECT RELEASE_LOCK(?)", WRITE_LOCK).catch(() => {});
    }
  });
}

const withBranches = { branches: { select: { branchId: true, branch: { select: { id: true, name: true } } } } };

/**
 * Writes a holiday - new, or the one named - with its scope, refusing a second holiday for the same
 * branch on the same day. `guard(existing)` runs on the row as it stands under the lock, so what is
 * checked is what is changed: a holiday re-scoped by somebody else between the screen's read and
 * this save is judged as it is now, not as it was.
 */
async function writeHoliday({ id = null, day, name, scope, userId, guard = null }) {
  return underWriteLock(async (tx) => {
    if (id) {
      const existing = await tx.attendanceHoliday.findUnique({ where: { id }, include: { branches: { select: { branchId: true } } } });
      if (!existing) throw Object.assign(new Error("gone"), { code: "HOLIDAY_GONE" });
      if (guard && !guard(existing)) throw Object.assign(new Error("reach"), { code: "HOLIDAY_REACH" });
    }
    const sameDay = await loadHolidays({ from: day, to: day, client: tx });
    if (sameDay.some((row) => row.id !== id && holidayScopesOverlap(scopeOf(row), scope))) {
      throw Object.assign(new Error("taken"), { code: "HOLIDAY_TAKEN" });
    }
    const links = scope.branchIds.map((branchId) => ({ branchId }));
    if (id) {
      await tx.attendanceHolidayBranch.deleteMany({ where: { holidayId: id } });
      return tx.attendanceHoliday.update({ where: { id }, data: { holidayDate: day, name, branches: { create: links } }, include: withBranches });
    }
    return tx.attendanceHoliday.create({
      data: { holidayDate: day, name, createdById: Number(userId) || null, branches: { create: links } },
      include: withBranches,
    });
  });
}

/** The answer a refused write gets, by why it was refused; null for an error that is nobody's rule. */
function refusal(res, error) {
  if (error?.code === "HOLIDAY_TAKEN") return taken(res);
  if (error?.code === "HOLIDAY_GONE" || isMissingRow(error)) return gone(res);
  if (error?.code === "HOLIDAY_REACH") return outOfReach(res);
  if (error?.code === "HOLIDAY_BUSY") return res.status(409).json({ message: "Somebody else is saving a holiday right now. Try again in a moment." });
  return null;
}

/** The branch ids asked for that are not active branches of the studio, if any. */
function unknownBranches(branchIds, activeIds) {
  const active = new Set(activeIds);
  return branchIds.filter((id) => !active.has(id));
}

/**
 * Declares a holiday.
 *
 * A create rather than the upsert this used to be. The upsert was right when delete was the only
 * other verb — there was no way to correct a name except by entering the day again — but with an
 * edit route beside it an upsert means a second person silently overwrites the first's holiday on
 * the same day. Refused with a 409 instead, which the screen turns into "edit the one that is
 * there".
 */
async function createHoliday(req, res) {
  const parsed = holidaySchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: "A holiday needs a day, a name and the branches it is for.", errors: parsed.error.flatten() });
  try {
    const scope = askedScope(parsed.data);
    const [reach, active] = await Promise.all([reachOf(req.user?.id, "READ_WRITE"), activeBranchIds()]);
    if (unknownBranches(scope.branchIds, active).length) return res.status(400).json({ message: "One of those branches does not exist or is no longer active." });
    if (!mayWrite(scope, reach, active)) return outOfReach(res);
    const created = await writeHoliday({ day: calendarDay(parsed.data.date), name: parsed.data.name, scope, userId: req.user?.id });
    ledgers.refreshAllSoon();
    return res.status(201).json({ data: serialize(created) });
  } catch (error) {
    if (refusal(res, error)) return undefined;
    console.error("Unable to declare the holiday:", error);
    return res.status(500).json({ message: "Unable to save this holiday." });
  }
}

/** Moves a holiday to another day, renames it, changes whose it is, or any of those. */
async function updateHoliday(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "That is not a holiday." });
  const parsed = holidaySchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: "A holiday needs a day, a name and the branches it is for.", errors: parsed.error.flatten() });
  try {
    const scope = askedScope(parsed.data);
    const [reach, active] = await Promise.all([reachOf(req.user?.id, "READ_WRITE"), activeBranchIds()]);
    if (unknownBranches(scope.branchIds, active).length) return res.status(400).json({ message: "One of those branches does not exist or is no longer active." });
    if (!mayWrite(scope, reach, active)) return outOfReach(res);
    // Both what it was and what it becomes must be within reach: moving another branch's holiday
    // onto yours is as much a change to theirs as deleting it. What it was is read under the lock.
    const saved = await writeHoliday({
      id, day: calendarDay(parsed.data.date), name: parsed.data.name, scope, userId: req.user?.id,
      guard: (existing) => mayWrite(scopeOf(existing), reach, active),
    });
    ledgers.refreshAllSoon();
    return res.json({ data: serialize(saved) });
  } catch (error) {
    if (refusal(res, error)) return undefined;
    console.error("Unable to change the holiday:", error);
    return res.status(500).json({ message: "Unable to save this holiday." });
  }
}

async function deleteHoliday(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "That is not a holiday." });
  try {
    const [reach, active] = await Promise.all([reachOf(req.user?.id, "READ_WRITE"), activeBranchIds()]);
    // Judged under the same lock the writes take, on the row as it stands. The links go with it
    // (`onDelete: Cascade`); nothing else on the day is touched.
    await underWriteLock(async (tx) => {
      const existing = await tx.attendanceHoliday.findUnique({ where: { id }, include: { branches: { select: { branchId: true } } } });
      if (!existing) throw Object.assign(new Error("gone"), { code: "HOLIDAY_GONE" });
      if (!mayWrite(scopeOf(existing), reach, active)) throw Object.assign(new Error("reach"), { code: "HOLIDAY_REACH" });
      await tx.attendanceHoliday.delete({ where: { id } });
    });
    ledgers.refreshAllSoon();
    return res.json({ data: { id } });
  } catch (error) {
    if (refusal(res, error)) return undefined;
    console.error("Unable to remove the holiday:", error);
    return res.status(500).json({ message: "Unable to remove this holiday." });
  }
}

module.exports = { listHolidays, listHolidayBranches, createHoliday, updateHoliday, deleteHoliday, mayWrite, visibleTo, askedScope };
