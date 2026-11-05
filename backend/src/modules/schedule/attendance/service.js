const prisma = require("../../../config/db");

/*
 * ── Who was working, derived from what the application measured ───────────────────────────────
 *
 * NOT the studio's attendance register. That is `hrm/attendance` - real login and logout with a
 * selfie and a location, leave and permission requests, an approval chain, holidays and shift
 * rules - and it is the record HRM keeps and employees answer to.
 *
 * This is the *calendar's* question, which is a smaller and different one: for a range of days and
 * a set of people, was each of them working, and for how long. The calendar draws a month of a
 * dozen people at a time, so it needs that in a couple of queries rather than per employee, and it
 * needs it for a `user` (a login) rather than for an `employee` record - not every login has one.
 *
 * It lives under `schedule/` because the calendar is its only caller and there is no route on it:
 * an HTTP endpoint here would be a second attendance API beside the real one, which is exactly the
 * confusion this placement avoids. If the two are ever consolidated, this is the side that goes.
 *
 * The studio already knows most of this. `app_usage_session` records when somebody was actually
 * using the application and for how long - the browser beats while the tab is in front of them and
 * they are touching it - and the Work Hours report reads it as a timesheet. So the register does not
 * ask anybody to sign in and out: a day is **derived** from what that person actually did.
 *
 * What derivation cannot know is the rest of attendance. It cannot tell a day of approved leave from
 * a day somebody did not come in; it does not know about a public holiday; it cannot see a shoot
 * that ran until six with no laptop open. That is what `employee_attendance` is for - a row there
 * *overrides* the derived day, and a day with no row is whatever the sessions say.
 *
 * The consequence worth stating plainly: **nothing has to be entered for the ordinary case**. A
 * register that needed a hundred rows written every week would be a register that was right in its
 * first week and wrong ever after.
 *
 * ── One idea of a day ──
 *
 * The studio's day, Asia/Kolkata, the same zone Reports pins its own dates to. A day that meant
 * something different here from what it means on the Work Hours tab would put the same morning on
 * two different dates on two screens.
 */

const ZONE = "Asia/Kolkata";

/** A `Date` as the studio's calendar day, `YYYY-MM-DD`. */
function dayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONE }).format(date);
}

/** Today, in the studio's day. */
function today() {
  return dayKey(new Date());
}

/*
 * The statuses a day can read as.
 *
 * Text rather than an enum for the reason every other status in this application is: the studio adds
 * one, and an enum is a migration to do it. Listed here so the API can refuse a word nobody defined
 * rather than storing it and leaving the register showing something no screen has a colour for.
 */
const STATUSES = ["PRESENT", "ABSENT", "HALF_DAY", "LEAVE", "HOLIDAY", "WEEK_OFF"];

/** Whether a day was worked at all, for counting a month. */
const WORKED_STATUSES = new Set(["PRESENT", "HALF_DAY"]);

function isStatus(value) {
  return STATUSES.includes(String(value || "").trim().toUpperCase());
}

/**
 * What each person actually did, per day, from the measured sessions.
 *
 * Keyed `userId|day`. The same grouping the Work Hours report makes and for the same reasons: by the
 * day a stretch *began*, so the two screens cannot disagree about which day a late evening belongs
 * to, and the `app` context alone - the contexts run concurrently, so summing them would count a
 * minute in the chat panel twice and report a nine-hour day as fourteen.
 *
 * Answers an empty map on any failure. A studio that has not run the application since the heartbeat
 * was added has no rows, and an older database may not have the table at all; either way the
 * register should show the days somebody wrote down rather than fail to open.
 */
async function measuredDays({ from, to }) {
  try {
    const rows = await prisma.$queryRawUnsafe(
      "SELECT `s`.`user_id` AS `userId`, DATE(`s`.`started_at`) AS `day`,"
      + "       SUM(TIMESTAMPDIFF(SECOND, `s`.`started_at`, `s`.`ended_at`)) AS `seconds`,"
      + "       MIN(`s`.`started_at`) AS `firstAt`, MAX(`s`.`ended_at`) AS `lastAt`"
      + "  FROM `app_usage_session` AS `s`"
      + " WHERE `s`.`context` = 'app' AND `s`.`ended_at` >= `s`.`started_at`"
      + "   AND `s`.`started_at` >= ? AND `s`.`started_at` <= ?"
      // `ended_at` is the indexed column and a stretch never ends before it starts, so this says
      // nothing new and is what MySQL can actually narrow the table by.
      + "   AND `s`.`ended_at` >= ?"
      + " GROUP BY `s`.`user_id`, `day`",
      `${from} 00:00:00`,
      `${to} 23:59:59`,
      `${from} 00:00:00`,
    );
    const byDay = new Map();
    for (const row of rows) {
      const day = dayKey(row.day);
      if (!day) continue;
      byDay.set(`${Number(row.userId)}|${day}`, {
        minutes: Math.round((Number(row.seconds) || 0) / 60),
        firstAt: row.firstAt ? new Date(row.firstAt) : null,
        lastAt: row.lastAt ? new Date(row.lastAt) : null,
      });
    }
    return byDay;
  } catch (error) {
    console.warn("Unable to read measured attendance:", error?.message || error);
    return new Map();
  }
}

/**
 * The days people actually checked in for, from the attendance module.
 *
 * This is the register's real evidence and it did not used to be read here at all: the calendar and
 * the Work Hours register were deriving Present from `app_usage_session` — how long somebody had the
 * application open — so a person who marked their day with a selfie and then went out on a shoot
 * read as Absent, while a person who never marked anything and left a tab open read as Present.
 *
 * Keyed `userId|day`, because this service works in logins while attendance is kept against
 * employees. The join is `User.linkedEmployeeId`, which is a plain column rather than a relation, so
 * it is two queries and a map rather than an include.
 *
 * Wrapped like the two readers below it, and for the same reason: between deploying this and running
 * `migrate deploy` the columns it selects do not exist, and a register that cannot open is worse
 * than one falling back to what it read before.
 */
async function checkedInDays({ ids, from, to }) {
  try {
    const users = await prisma.user.findMany({
      where: { id: { in: ids }, linkedEmployeeId: { not: null } },
      select: { id: true, linkedEmployeeId: true },
    });
    if (!users.length) return new Map();

    const userByEmployee = new Map(users.map((user) => [user.linkedEmployeeId, user.id]));
    const sessions = await prisma.attendanceSession.findMany({
      where: {
        employeeId: { in: [...userByEmployee.keys()] },
        workDate: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) },
      },
      select: { employeeId: true, workDate: true, loginAt: true, logoutAt: true },
    });

    const byDay = new Map();
    for (const session of sessions) {
      const userId = userByEmployee.get(session.employeeId);
      const day = dayKey(session.workDate);
      if (!userId || !day) continue;
      const minutes = session.logoutAt
        ? Math.max(0, Math.round((new Date(session.logoutAt) - new Date(session.loginAt)) / 60000))
        : null;
      byDay.set(`${userId}|${day}`, { firstAt: session.loginAt, lastAt: session.logoutAt, minutes });
    }
    return byDay;
  } catch (error) {
    console.warn("Unable to read checked-in attendance:", error?.message || error);
    return new Map();
  }
}

/**
 * One day, for one person, as the register reads it.
 *
 * `stored` wins where there is one. Where there is not, a day somebody was measured at reads Present
 * with the hours they worked, and a day they were not reads Absent - which is honest rather than
 * kind: the register is a record of who was here, and a day with nothing behind it is a day nobody
 * can say anybody was.
 *
 * `source` says which of the two answered, because the difference matters to whoever is reading it:
 * "measured" is what the application saw, "marked" is what a person decided.
 */
function dayEntry({ userId, userName, day, stored, measured, checkedIn }) {
  /*
   * A capture beats everything. Somebody stood somewhere, took a photograph and let the server
   * stamp the time — that is the strongest evidence this application has about a day, and it is
   * what HR corrects when it is wrong (the correction updates the session, so this reads that too).
   * A marked row is the older mechanism and still wins over app usage below.
   */
  if (checkedIn) {
    return {
      userId,
      userName,
      day,
      // No logout yet is still a day they were here. Whether that reads as a fault is the attendance
      // screen's question, not the calendar's.
      status: "PRESENT",
      checkInAt: new Date(checkedIn.firstAt).toISOString(),
      checkOutAt: checkedIn.lastAt ? new Date(checkedIn.lastAt).toISOString() : null,
      workedMinutes: checkedIn.minutes,
      note: stored?.note || "",
      source: "checked-in",
      markedByUserId: null,
    };
  }
  if (stored) {
    return {
      userId,
      userName,
      day,
      status: stored.status,
      checkInAt: stored.checkInAt ? new Date(stored.checkInAt).toISOString() : null,
      checkOutAt: stored.checkOutAt ? new Date(stored.checkOutAt).toISOString() : null,
      workedMinutes: stored.workedMinutes ?? (measured ? measured.minutes : null),
      note: stored.note || "",
      source: "marked",
      markedByUserId: stored.markedByUserId ?? null,
    };
  }
  return {
    userId,
    userName,
    day,
    status: measured ? "PRESENT" : "ABSENT",
    checkInAt: measured?.firstAt ? measured.firstAt.toISOString() : null,
    checkOutAt: measured?.lastAt ? measured.lastAt.toISOString() : null,
    workedMinutes: measured ? measured.minutes : null,
    note: "",
    source: measured ? "measured" : "none",
    markedByUserId: null,
  };
}

/** Every day in a range, inclusive, as `YYYY-MM-DD`. */
function daysBetween(from, to) {
  const days = [];
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return days;
  for (let at = start; at <= end; at.setUTCDate(at.getUTCDate() + 1)) {
    days.push(at.toISOString().slice(0, 10));
  }
  return days;
}

// A month of a studio's register at a time. Wide enough for any view that asks, and a bound that
// stops one request walking a year of every employee's days.
const MAX_DAYS = 92;

/**
 * The days somebody has written down, for these people over this range.
 *
 * Wrapped the way `measuredDays` above is, and for a reason that is not hypothetical: this table is
 * created by a Prisma migration, so between deploying the code and running `migrate deploy` it does
 * not exist. Unguarded, that took the whole register down - and on the calendar, which reads
 * attendance as one of its sources, it produced "The calendar could not load attendance" on every
 * screen while the shoots and meetings beside it were perfectly readable.
 *
 * Degrading to nothing is exactly right here, because attendance is derived by default: with no
 * stored rows every day reads as whatever that person's own activity says, which is the ordinary
 * answer for almost every day anyway. What is lost until the migration runs is corrections -
 * leave, holidays, half days - and *writing* one still fails loudly, which is the honest place for
 * a missing table to be reported.
 */
async function markedDays({ ids, from, to }) {
  try {
    return await prisma.employeeAttendance.findMany({
      where: { userId: { in: ids }, day: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } },
    });
  } catch (error) {
    console.warn("Unable to read marked attendance:", error?.message || error);
    return [];
  }
}

/**
 * The register: everybody's attendance across a range, or one person's.
 *
 * `userIds` narrows it, and it is how the two audiences are served by one function: somebody reading
 * their own attendance passes their own id, and HRM passes nothing. The *decision* about which of
 * those a caller gets is the controller's - a service that decided for itself would be a second
 * place where that rule lived.
 *
 * A day with neither a row nor a measured session is still returned, as Absent. A register that
 * silently omitted the days nobody was here would be a register that could not be counted.
 */
async function listAttendance({ from, to, userIds = null } = {}) {
  /*
   * ── Attendance stops at today ─────────────────────────────────────────────────────────────
   *
   * A day that has not happened has no attendance. Not "absent" - *nothing*: nobody can have failed
   * to turn up on a morning that has not arrived.
   *
   * This was the fault the calendar made obvious. A month view asks for the whole month, so on the
   * 5th it asked for the 1st to the 30th - and every day from the 6th on came back with a row per
   * employee reading Absent. Twenty-five days of red for a month nobody had worked yet, burying the
   * shoots underneath it.
   *
   * Clamped here rather than at each caller because both of them ask for a range they did not think
   * about in these terms: the calendar asks for the month it is drawing, and the register for the
   * range somebody typed. Neither should have to know that the future is not a thing attendance has
   * an opinion about.
   */
  const cutoff = today();
  const days = daysBetween(from, to).filter((day) => day <= cutoff).slice(0, MAX_DAYS);
  if (!days.length) return { days: [], entries: [] };

  const people = await prisma.user.findMany({
    where: {
      ...(userIds ? { id: { in: userIds } } : {}),
      // A login that has been deactivated is not somebody whose attendance is still being taken.
      // Their past days are still in the table and still read by a range that covers them.
      ...(userIds ? {} : { status: "ACTIVE" }),
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  if (!people.length) return { days, entries: [] };

  const ids = people.map((person) => person.id);
  const [stored, measured, checkedIn] = await Promise.all([
    markedDays({ ids, from: days[0], to: days[days.length - 1] }),
    measuredDays({ from: days[0], to: days[days.length - 1] }),
    checkedInDays({ ids, from: days[0], to: days[days.length - 1] }),
  ]);

  const marked = new Map(stored.map((row) => [`${row.userId}|${dayKey(row.day)}`, row]));

  const entries = [];
  for (const person of people) {
    for (const day of days) {
      const key = `${person.id}|${day}`;
      entries.push(dayEntry({
        userId: person.id,
        userName: person.name || "",
        day,
        stored: marked.get(key) || null,
        measured: measured.get(key) || null,
        checkedIn: checkedIn.get(key) || null,
      }));
    }
  }
  return { days, entries };
}

/**
 * Writes one person's day down, or corrects it.
 *
 * An upsert on the day rather than an insert: attendance answers one question per day, so marking a
 * day twice is changing the answer rather than adding a second one. That is the unique key doing the
 * work, and it is why the table has one.
 *
 * `markedByUserId` is who decided, which is not always whose day it is - HRM correcting somebody's
 * absence is the ordinary case - and it is what lets a stored row still be told from a derived one
 * afterwards.
 */
async function markAttendance({ userId, day, status, checkInAt = null, checkOutAt = null, workedMinutes = null, note = "", markedByUserId = null }) {
  const at = new Date(`${day}T00:00:00Z`);
  const data = {
    status: String(status).trim().toUpperCase(),
    checkInAt: checkInAt ? new Date(checkInAt) : null,
    checkOutAt: checkOutAt ? new Date(checkOutAt) : null,
    workedMinutes: Number.isFinite(Number(workedMinutes)) ? Math.max(0, Math.round(Number(workedMinutes))) : null,
    note: String(note || "").trim() || null,
    markedByUserId,
  };
  return prisma.employeeAttendance.upsert({
    where: { userId_day: { userId, day: at } },
    create: { userId, day: at, ...data },
    update: data,
  });
}

/** Takes a correction back, so the day reads as whatever the person's own activity says again. */
async function clearAttendance({ userId, day }) {
  const at = new Date(`${day}T00:00:00Z`);
  return prisma.employeeAttendance.deleteMany({ where: { userId, day: at } });
}

module.exports = {
  STATUSES,
  WORKED_STATUSES,
  isStatus,
  dayKey,
  today,
  daysBetween,
  measuredDays,
  dayEntry,
  listAttendance,
  markAttendance,
  clearAttendance,
  MAX_DAYS,
};
