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

/**
 * The studio's declared holidays, as Settings keeps them.
 *
 * One list, read by two quite different things: the attendance rules, which take a holiday out of
 * every hours target and mark the day `Holiday` rather than an absence, and the studio calendar,
 * which draws it for everybody. Neither of those lives here — this is only the place the list is
 * written.
 *
 * It used to be written on the HRM attendance rules screen, behind `HRM / Attendance Approval`.
 * A company-declared holiday is not an attendance decision about one person; it is a studio-wide
 * setting like the branches and the branding, so it answers for `ADMIN / System Settings` and sits
 * with them. See `routes.js`.
 */

const holidaySchema = z.object({
  // A written day, taken literally. Anything else is refused rather than guessed at, because a
  // holiday silently landing a day out is the one failure nobody would spot until payroll.
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a day for this holiday."),
  name: z.string().trim().min(1, "Name the holiday.").max(150, "That name is too long."),
});

const serialize = (row) => ({ id: row.id, date: localIsoDate(row.holidayDate), name: row.name });

/** Whether Prisma refused a write because another holiday already holds that day. */
const isDuplicateDay = (error) => error?.code === "P2002";
/** Whether the row the caller named is gone — deleted by somebody else while the screen was open. */
const isMissingRow = (error) => error?.code === "P2025";

const taken = (res) => res.status(409).json({ message: "That day already has a holiday. Edit the one that is there." });
const gone = (res) => res.status(404).json({ message: "That holiday no longer exists." });

/*
 * An optional window, for a screen that only draws one year of the list.
 *
 * Both bounds optional and no default: the Settings calendar asks for a year at a time, and
 * anything else asking for the whole list gets the whole list — a studio declares a dozen or two
 * holidays a year, so there is nothing here worth paginating.
 */
const windowSchema = z.object({
  from: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

async function listHolidays(req, res) {
  const parsed = windowSchema.safeParse(req.query || {});
  if (!parsed.success) return res.status(400).json({ message: "That is not a date range." });
  try {
    const holidayDate = {};
    if (parsed.data.from) holidayDate.gte = calendarDay(parsed.data.from);
    if (parsed.data.to) holidayDate.lte = calendarDay(parsed.data.to);
    const rows = await prisma.attendanceHoliday.findMany({
      where: Object.keys(holidayDate).length ? { holidayDate } : {},
      orderBy: { holidayDate: "asc" },
    });
    return res.json({ data: rows.map(serialize) });
  } catch (error) {
    console.error("Unable to load the holidays:", error);
    return res.status(500).json({ message: "Unable to load the holidays." });
  }
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
  if (!parsed.success) return res.status(400).json({ message: "A holiday needs a day and a name.", errors: parsed.error.flatten() });
  try {
    const created = await prisma.attendanceHoliday.create({
      data: { holidayDate: calendarDay(parsed.data.date), name: parsed.data.name, createdById: Number(req.user?.id) || null },
    });
    return res.status(201).json({ data: serialize(created) });
  } catch (error) {
    if (isDuplicateDay(error)) return taken(res);
    console.error("Unable to declare the holiday:", error);
    return res.status(500).json({ message: "Unable to save this holiday." });
  }
}

/** Moves a holiday to another day, renames it, or both. */
async function updateHoliday(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "That is not a holiday." });
  const parsed = holidaySchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: "A holiday needs a day and a name.", errors: parsed.error.flatten() });
  try {
    const saved = await prisma.attendanceHoliday.update({
      where: { id },
      data: { holidayDate: calendarDay(parsed.data.date), name: parsed.data.name },
    });
    return res.json({ data: serialize(saved) });
  } catch (error) {
    if (isDuplicateDay(error)) return taken(res);
    if (isMissingRow(error)) return gone(res);
    console.error("Unable to change the holiday:", error);
    return res.status(500).json({ message: "Unable to save this holiday." });
  }
}

async function deleteHoliday(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "That is not a holiday." });
  try {
    await prisma.attendanceHoliday.delete({ where: { id } });
    return res.json({ data: { id } });
  } catch (error) {
    if (isMissingRow(error)) return gone(res);
    console.error("Unable to remove the holiday:", error);
    return res.status(500).json({ message: "Unable to remove this holiday." });
  }
}

module.exports = { listHolidays, createHoliday, updateHoliday, deleteHoliday };
