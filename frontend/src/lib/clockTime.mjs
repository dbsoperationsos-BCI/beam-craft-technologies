/**
 * A clock time, as the CRM writes one: `05:49 pm`.
 *
 * The CRM shows times on a 12-hour clock everywhere — a lead's Added Time is "10:08 am", an
 * activity stamp is "5 Sept 2026, 04:30 pm — every time in the application is read that way, and
 * so is every time anybody in the studio says out loud.
 *
 * The Calls board was the exception, and not on purpose. Callyzer sends `call_time` as "17:49:41",
 * the board trims it to the minute and showed it exactly as it arrived, so the Call Time column
 * read "17:49" while the Enquiry ID beside it belonged to a CRM that says "10:08 am" everywhere
 * else. Nothing was wrong with the value — it was the one column in the application on a different
 * clock from the rest of it.
 *
 * Kept here as a pure function of a string rather than inside the board, because the same column is
 * drawn for the lead boards from a differently-shaped value: leads store the meridiem, calls do not,
 * and the one renderer has to answer for both.
 */

/** `17:49` or `9:05` — a clock time with no meridiem, which is to say a 24-hour one. */
const BARE_CLOCK = /^(\d{1,2}):(\d{2})(?::\d{2})?$/;

/** `09:45 pm`, `9:45pm`, `9:45 p.m.` — already the 12-hour clock, whatever it was typed as. */
const MERIDIEM_CLOCK = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap])\.?m\.?$/i;

/**
 * `17`, `49` -> `05:49 pm`.
 *
 * Two digits for the hour because that is what `Intl` produces for the times the rest of the CRM
 * formats through it, and a column where some rows are five characters wide and others six does not
 * line up down the page.
 */
function clockLabel(hours, minutes) {
  const suffix = hours < 12 ? "am" : "pm";
  const hour = hours % 12 || 12;
  return `${String(hour).padStart(2, "0")}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

/**
 * A stored clock time on the 12-hour clock, or `""` if the value is not a clock time at all.
 *
 * Deliberately arithmetic rather than a `Date` and `Intl`: "17:49" carries no date and no zone, so
 * putting it through a zone-aware formatter would ask what day it was on and shift it by the
 * offset — a call at 17:49 IST would be shown as 12:19 pm, which is the kind of wrong that looks
 * plausible enough to be believed.
 *
 * A value that is already a 12-hour time is normalised rather than rebuilt, so a lead that stored
 * "9:45PM" and one that stored "09:45 pm" read the same in the same column.
 */
export function toTwelveHourClock(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  const withMeridiem = MERIDIEM_CLOCK.exec(text);
  if (withMeridiem) {
    const hours = Number(withMeridiem[1]);
    const minutes = Number(withMeridiem[2]);
    // A 12-hour clock has no hour 0 and no hour 13. "13:00 pm" is not a time somebody meant.
    if (hours < 1 || hours > 12 || minutes > 59) return "";
    return clockLabel(withMeridiem[3].toLowerCase() === "p" ? (hours % 12) + 12 : hours % 12, minutes);
  }

  const bare = BARE_CLOCK.exec(text);
  if (bare) {
    const hours = Number(bare[1]);
    const minutes = Number(bare[2]);
    if (hours > 23 || minutes > 59) return "";
    return clockLabel(hours, minutes);
  }

  return "";
}

export default toTwelveHourClock;
