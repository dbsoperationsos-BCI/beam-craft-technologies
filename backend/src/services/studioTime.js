/**
 * The studio's clock: the date and the time of day in India, whatever clock the server runs on.
 *
 * A lead's Added Time and Enquiry Date are wall-clock facts about the studio ("added at 06:46 pm on
 * the 24th"). Taken from the machine instead - `new Date().getHours()`, `toISOString().slice(0, 10)`
 * - they come out in whatever zone that machine is set to, and a server or a laptop on UTC writes
 * them 5 hours 30 minutes behind. Everything that stamps one of those facts takes it from here -
 * and so does attendance, which reads every login, logout and "today" on this clock.
 */
const STUDIO_TIME_ZONE = "Asia/Kolkata";

/** `YYYY-MM-DD` in the studio's zone. */
function studioDateKey(when = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: STUDIO_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(when);
}

/** `06:46 pm` in the studio's zone - the shape the Added Time column stores and the board reads. */
function studioClockTime(when = new Date()) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: STUDIO_TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h12" })
    .format(when)
    .toLowerCase();
}

/**
 * The studio's calendar date and time of day for an instant: `{ year, month (1-12), day, hour,
 * minute, weekday (0 Sunday - 6 Saturday) }`.
 *
 * What attendance reads a login and a logout by - Late, Early Exit, the Check In and Check Out a
 * screen shows, which day "today" is. Read with `getHours()` instead, they came out in the server's
 * own zone: right on a laptop set to India, five and a half hours early on a server left on UTC.
 */
const partsFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: STUDIO_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23",
});
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
function studioParts(when = new Date()) {
  const parts = Object.fromEntries(partsFormat.formatToParts(when).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: WEEKDAYS[parts.weekday],
  };
}

/** Minutes since the studio's midnight - 9:38 am is 578 - wherever the server runs. */
function studioMinutesOfDay(when = new Date()) {
  const { hour, minute } = studioParts(when);
  return hour * 60 + minute;
}

/** The studio's calendar date for an instant, as midnight UTC on that date - how a `@db.Date` holds a day. */
function studioCalendarDay(when = new Date()) {
  const { year, month, day } = studioParts(when);
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * The instant the studio's clock reads `minutes` past midnight on a calendar date (`monthIndex` 0-11)
 * - "18:00 on the 26th" as the moment somebody in the studio would call it, not 18:00 UTC.
 *
 * Found from the zone's offset at that moment rather than a fixed +05:30, so it stays right if the
 * zone ever changes; India keeps one offset all year, so the second reading always agrees.
 */
function studioInstant(year, monthIndex, day, minutes) {
  const asIfUtc = Date.UTC(year, monthIndex, day, 0, minutes);
  const offsetAt = (instant) => {
    const parts = studioParts(new Date(instant));
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - Math.floor(instant / 60000) * 60000;
  };
  const first = asIfUtc - offsetAt(asIfUtc);
  return new Date(asIfUtc - offsetAt(first));
}

module.exports = { STUDIO_TIME_ZONE, studioDateKey, studioClockTime, studioParts, studioMinutesOfDay, studioCalendarDay, studioInstant };
