const { STUDIO_OFFSET, studioDayKey } = require("../../../services/studioDay");

/**
 * How long somebody was signed in on one studio day, from the sign-in and sign-out lines.
 *
 * Inactive Time Track is the time signed in and not using the application, and "signed in" is
 * read from what the audit log records: a `Login` line opens a session and a `Logout` line closes
 * it. The browser's Sign out only clears its own token and tells the server nothing, so for most
 * web sessions there is no Logout line at all - that session runs to the **end of the studio day**,
 * 23:59:59 in Asia/Kolkata, which is the rule the studio chose. Today's open session runs to now
 * rather than into the evening that has not happened yet.
 *
 * Pure, so the rule can be tested without a database. `events` are that person's Auth lines on
 * that day, `{ action, at }`, in any order.
 *
 *   * A Login while a session is already open does not start a second one.
 *   * A Logout with nothing open is ignored: only a Login opens a session here, so a person still
 *     signed in from an earlier day is not read as signed in since midnight - a day with no Login
 *     line at all falls back to the span of their use instead (see `measuredUsage`).
 *
 * Answers the signed-in seconds, or null when the day has no Login line to read from.
 */
function signedInSeconds({ day, events = [], now = new Date() } = {}) {
  const lines = events
    .map((event) => ({ action: String(event?.action || ""), at: event?.at instanceof Date ? event.at : new Date(event?.at) }))
    .filter((event) => !Number.isNaN(event.at.getTime()) && (event.action === "Login" || event.action === "Logout"))
    .sort((a, b) => a.at - b.at);
  if (!lines.some((event) => event.action === "Login")) return null;

  const dayEnd = new Date(`${day}T23:59:59.999${STUDIO_OFFSET}`);
  const closesAt = Math.min(dayEnd.getTime(), now.getTime());
  let openedAt = null;
  let total = 0;
  for (const { action, at } of lines) {
    if (action === "Login") {
      if (openedAt === null) openedAt = at.getTime();
    } else if (openedAt !== null) {
      total += Math.max(0, at.getTime() - openedAt);
      openedAt = null;
    }
  }
  if (openedAt !== null) total += Math.max(0, closesAt - openedAt);
  return Math.round(total / 1000);
}

/**
 * Auth lines grouped by employee and then by the studio day they fall on:
 * `Map<employee, Map<day, events[]>>`. Two maps rather than a joined key, because a name is free
 * text and could carry whatever a joined key would be split on.
 */
function groupAuthEvents(rows = []) {
  const grouped = new Map();
  for (const row of rows) {
    const at = row.at instanceof Date ? row.at : new Date(row.at);
    const day = studioDayKey(at);
    const employee = String(row.employee || "").trim();
    if (!day || !employee) continue;
    if (!grouped.has(employee)) grouped.set(employee, new Map());
    const days = grouped.get(employee);
    if (!days.has(day)) days.set(day, []);
    days.get(day).push({ action: row.action, at });
  }
  return grouped;
}

/**
 * A person's measured totals over the range, from their days.
 *
 * `dayRows` is one row per login per studio day from `app_usage_session` - `employee`, `day`,
 * `seconds` of use, `sessions` (sittings), `spanSeconds` from the day's first stretch to its last,
 * `lastLoginAt`. `authRows` is every Login and Logout line in the range, `employee`, `action`, `at`.
 *
 * Per day, the time signed in is what the Login and Logout lines say (`signedInSeconds`); a day with
 * no Login line - before the audit log existed, past its retention, or a session carried over from
 * an earlier day - falls back to the span of that day's use, first stretch to last. Inactive is the
 * signed-in time less the time actually used, never below zero, and the days are then added up so a
 * month does not count its nights and weekends.
 *
 * Keyed on the name the reports group people under; two logins with one name are one row, which is
 * the compromise the reports make everywhere else.
 */
function measuredTotals({ dayRows = [], authRows = [], now = new Date() } = {}) {
  const auth = groupAuthEvents(authRows);
  const people = new Map();
  const person = (employee) => {
    if (!people.has(employee)) people.set(employee, { seconds: 0, sessions: 0, inactiveSeconds: 0, lastLoginAt: null, days: new Map() });
    return people.get(employee);
  };
  const seconds = (value) => { const n = Number(value); return Number.isFinite(n) ? n : 0; };

  for (const row of dayRows) {
    const employee = String(row.employee || "").trim();
    const day = studioDayKey(row.day);
    if (!employee || !day) continue;
    const entry = person(employee);
    const current = entry.days.get(day) || { seconds: 0, spanSeconds: 0 };
    // Two logins under one name on one day: their use adds up, and the day runs over both.
    entry.days.set(day, { seconds: current.seconds + seconds(row.seconds), spanSeconds: Math.max(current.spanSeconds, seconds(row.spanSeconds)) });
    entry.seconds += seconds(row.seconds);
    entry.sessions += seconds(row.sessions);
    const lastLoginAt = row.lastLoginAt ? new Date(row.lastLoginAt) : null;
    if (lastLoginAt && !Number.isNaN(lastLoginAt.getTime()) && (!entry.lastLoginAt || lastLoginAt > entry.lastLoginAt)) entry.lastLoginAt = lastLoginAt;
  }
  // A day somebody signed in and never used the application is still a day they were signed in.
  for (const [employee, days] of auth) {
    const entry = person(employee);
    for (const day of days.keys()) if (!entry.days.has(day)) entry.days.set(day, { seconds: 0, spanSeconds: 0 });
  }

  for (const [employee, entry] of people) {
    for (const [day, used] of entry.days) {
      const signedIn = signedInSeconds({ day, events: auth.get(employee)?.get(day) || [], now });
      const span = signedIn === null ? used.spanSeconds : signedIn;
      entry.inactiveSeconds += Math.max(0, span - used.seconds);
    }
    delete entry.days;
  }
  return people;
}

module.exports = { signedInSeconds, groupAuthEvents, measuredTotals };
