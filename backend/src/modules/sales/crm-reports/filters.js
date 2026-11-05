/**
 * The one filter bar every CRM report is read through.
 *
 * Six reports asking the same six questions - which dates, whose calls, which vertical, what kind
 * of call, how long - so the WHERE clause is built once here rather than six times slightly
 * differently. A filter that means one thing on the Summary and another on Call History is the
 * fault this shape exists to prevent: the numbers stop reconciling and nobody can say why.
 *
 * Pure. It builds SQL and the parameters to go with it, and touches no database, so what each
 * filter actually does can be read and tested without one. Every value is a bound parameter -
 * nothing a caller sends is ever concatenated into the statement.
 */

const { studioDayStart, studioDayEnd } = require("../../../services/studioDay");
const { likeLiteral, wordChunks } = require("../../../services/wordChunks");

const CALL_TYPES = ["Incoming", "Outgoing", "Missed", "Rejected"];
const CALL_METHODS = ["PhoneCall", "WhatsAppCall"];
const VERTICALS = ["Dum Dum", "Qua Qua", "Corp"];

/*
 * How long a call has to be to count as one, in seconds.
 *
 * The bands Callyzer's own reports offer, named rather than typed as a pair of numbers: "under a
 * minute" is a question people ask, "between 0 and 59" is the same question written for a machine.
 */
const DURATION_BANDS = {
  connected: { min: 1, max: null, label: "Connected (over 0s)" },
  under1: { min: 1, max: 59, label: "Under 1 minute" },
  "1to5": { min: 60, max: 299, label: "1 to 5 minutes" },
  "5to15": { min: 300, max: 899, label: "5 to 15 minutes" },
  over15: { min: 900, max: null, label: "Over 15 minutes" },
  missed: { min: 0, max: 0, label: "Not connected (0s)" },
};

/** A YYYY-MM-DD date, or "" when it is not one. Anything else is not a date and is not guessed at. */
function isoDate(value) {
  const text = String(value ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

/**
 * A named day as the two moments that bound it.
 *
 * "to 31 Aug" means through the end of the 31st, not up to its midnight - so the day named is
 * included at both ends of a range. MySQL reads a bare "2026-08-31" as the midnight that *starts*
 * that day, which is why this is spelled out rather than left to the comparison.
 *
 * Every range in these reports is bounded through here. It was written out at each query instead,
 * and one of them - the measured-usage read behind the two Usage columns - passed the bare day: a
 * report whose range ended today therefore excluded everything recorded today, and since a report
 * opens on today, both Usage columns read 0m however long the application had been in use. One
 * rule, in one place, is what stops that being written a fourth time.
 *
 * The day is the studio's - Asia/Kolkata, midnight to midnight - and the bound is the UTC instant
 * that moment is, because that is what the columns hold. Bounded on the bare day, "23 Sept" ran
 * from 05:30 on the 23rd to 05:29 on the 24th in the studio's clock. See `services/studioDay.js`.
 */
function dayStart(day) {
  return studioDayStart(day);
}

function dayEnd(day) {
  return studioDayEnd(day);
}

function oneOf(value, allowed) {
  const text = String(value ?? "").trim();
  return allowed.includes(text) ? text : "";
}

/**
 * The filters as the reports will actually apply them.
 *
 * Anything unrecognised becomes nothing rather than an error: a report is a read, and a stale
 * bookmark carrying a vertical that has since been renamed should show the unfiltered report, not
 * a 400. What the reports then echo back is this cleaned object, so the screen can show what it is
 * actually looking at rather than what was asked for.
 */
/**
 * The employees a report is filtered to: a list of names, however the query string wrote them.
 *
 * An array (`employee=A&employee=B`), a comma-separated value, or a single name all arrive as the
 * same thing, so one `employee=` on a saved link keeps behaving exactly as it did. Trimmed, emptied
 * of blanks, de-duplicated, each held to the column's width, and capped - a filter is a question
 * about a team, and a URL naming two hundred people is not one anybody asked on purpose.
 */
const MAX_EMPLOYEE_FILTERS = 50;
function employeeList(input) {
  const raw = Array.isArray(input) ? input : String(input ?? "").split(",");
  const names = raw.map((value) => String(value ?? "").trim().slice(0, 191)).filter(Boolean);
  return [...new Set(names)].slice(0, MAX_EMPLOYEE_FILTERS);
}

function cleanFilters(input = {}) {
  const from = isoDate(input.from);
  const to = isoDate(input.to);
  return {
    // Swapped rather than refused when they arrive the wrong way round - it is a date picker, and
    // an empty report is a worse answer than the one obviously meant.
    from: from && to && from > to ? to : from,
    to: from && to && from > to ? from : to,
    /*
     * **Several people, not one.** A studio reads "how did the team do last week" far more often
     * than one person's week, and the filter answered only the second - so the question was asked by
     * running the report once per name and adding the numbers up by hand.
     *
     * A list either way round: a URL carrying one `employee=` is still one name, so every saved link
     * keeps working and the clauses below simply stop being a special case for a list of one.
     */
    employee: employeeList(input.employee),
    vertical: oneOf(input.vertical, VERTICALS),
    callType: oneOf(input.callType, CALL_TYPES),
    callMethod: oneOf(input.callMethod, CALL_METHODS),
    duration: DURATION_BANDS[String(input.duration ?? "").trim()] ? String(input.duration).trim() : "",
    // Free text across the client's name and number, which is what a report's own search box is for.
    search: String(input.search ?? "").trim().slice(0, 120),
  };
}

/**
 * The WHERE clause, against `c` (the call log) and `l` (the lead it belongs to).
 *
 * `l` is a LEFT JOIN, so a call whose lead has since been deleted still appears in the call
 * reports - it happened, and hiding it would make the totals disagree with the call history that
 * lists it.
 */
function buildWhere(filters = {}, scope = null) {
  const clean = cleanFilters(filters);
  const clauses = [];
  const params = [];

  /*
   * Whose leads this report may count. `l` is a LEFT JOIN, so under a narrowed scope a call whose
   * lead is out of reach - or that never became one - simply does not count, which is the rule for
   * a record nobody owns. Under ALL the clause is `1=1` and nothing changes.
   */
  if (scope) {
    const own = scope.sql({ branch: "`l`.`branch_id`", employee: "`l`.`owner_employee_id`", user: "`l`.`created_by_user_id`" });
    if (own.clause !== "1=1") { clauses.push(own.clause); params.push(...own.params); }
  }

  if (clean.from) { clauses.push("`c`.`called_at` >= ?"); params.push(dayStart(clean.from)); }
  // Through the end of the day named, not up to its midnight - "to 31 Aug" includes the 31st.
  if (clean.to) { clauses.push("`c`.`called_at` <= ?"); params.push(dayEnd(clean.to)); }

  if (clean.employee.length) {
    /*
     * By name or by number, and by every number the chosen people are known by.
     *
     * The filter bar sends a name - the Employee Repository's own spelling, which is the list it
     * offers. Callyzer logs a call against the handset and labels it with whatever that handset is
     * called, so matching the repository's spelling alone answers "no calls" for somebody who has
     * made hundreds. `employeeNumbers` is the repository's contact number for that person, added by
     * `resolveEmployeeFilter`, and it is what makes the two lists meet.
     *
     * The bare value is still matched against the number as well, so a number typed into a saved
     * link keeps working.
     */
    const numbers = Array.isArray(filters.employeeNumbers)
      ? [...new Set(filters.employeeNumbers.map((value) => String(value || "").trim()).filter(Boolean))]
      : [];
    /*
     * The ids the chosen names resolve to, which is what a call actually carries.
     *
     * `matched_employee_id` is the answer the webhook worked out when the call was delivered -
     * Callyzer's Employee Code against the repository's code, then the handset's label - so this
     * tests the same thing the reports group by. Without it the filter compared the repository's
     * spelling against the handset's, and a person whose phone is labelled anything else at all
     * answered "no calls" however many they had made.
     *
     * Added by `resolveEmployeeFilter`, under this reader's scope, and stripped from whatever
     * arrived on the query string - a field the server owns is written only by the server.
     */
    const ids = Array.isArray(filters.employeeIds)
      ? [...new Set(filters.employeeIds.map((value) => Number(value)).filter(Number.isInteger))]
      : [];
    const chosen = clean.employee.map(() => "?").join(", ");
    const tests = [];
    if (ids.length) tests.push(`\`c\`.\`matched_employee_id\` IN (${ids.map(() => "?").join(", ")})`);
    /*
     * And the label, still, for the handsets the match could not place: those carry no id, so the
     * name Callyzer gave them is the only thing to filter them by - and it is the name the report
     * shows for them, so the filter agrees with what is on screen either way.
     */
    tests.push(`\`c\`.\`employee_number\` IN (${chosen})`, `\`c\`.\`employee_name\` IN (${chosen})`);
    if (numbers.length) tests.push(`\`c\`.\`employee_number\` IN (${numbers.map(() => "?").join(", ")})`);
    clauses.push(`(${tests.join(" OR ")})`);
    // Bound in the order the tests were pushed, which is the order MySQL reads the placeholders.
    params.push(...ids, ...clean.employee, ...clean.employee, ...numbers);
  }

  if (clean.vertical) {
    /*
     * The same rule the CRM's own Dum Dum tab follows: a lead with no vertical is a Dum Dum lead,
     * because a lead that predates the verticals is a wedding lead. Without this the two screens
     * would disagree about how many leads Dum Dum has, which is the kind of difference nobody ever
     * traces back to a report's WHERE clause.
     */
    if (clean.vertical === "Dum Dum") {
      clauses.push("(TRIM(COALESCE(`l`.`vertical`, '')) = '' OR LOWER(REPLACE(TRIM(`l`.`vertical`), ' ', '')) NOT IN ('quaqua', 'corp', 'corporate', 'corporation'))");
    } else {
      clauses.push("LOWER(REPLACE(TRIM(COALESCE(`l`.`vertical`, '')), ' ', '')) = ?");
      params.push(clean.vertical.toLowerCase().replace(/\s+/g, ""));
    }
  }

  if (clean.callType) { clauses.push("`c`.`call_type` = ?"); params.push(clean.callType); }
  if (clean.callMethod) { clauses.push("`c`.`call_method` = ?"); params.push(clean.callMethod); }

  if (clean.duration) {
    const band = DURATION_BANDS[clean.duration];
    clauses.push("`c`.`duration_seconds` >= ?");
    params.push(band.min);
    if (band.max !== null) { clauses.push("`c`.`duration_seconds` <= ?"); params.push(band.max); }
  }

  // Word Chunk Search: every word typed, any order, each in any of the three columns.
  for (const chunk of wordChunks(clean.search)) {
    clauses.push("(`c`.`client_name` LIKE ? OR `c`.`client_number` LIKE ? OR `l`.`name` LIKE ?)");
    // Bound, not concatenated: the wildcards are part of the value, not part of the statement.
    // `likeLiteral`: a typed `%`, `_` or `\` is matched as itself, never as a wildcard.
    const like = `%${likeLiteral(chunk)}%`;
    params.push(like, like, like);
  }

  return {
    // Always a real clause, so a report can append to it without checking whether it is empty.
    sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "WHERE 1 = 1",
    params,
    filters: clean,
  };
}

/**
 * The clause for the two usage reports, which read tables the call log's does not.
 *
 * WhatsApp messages and CRM activity are keyed on the ERP user who did them, not on the Callyzer
 * employee who made a call, and they have neither a vertical nor a call type nor a duration. So
 * only the two filters that mean anything here are applied - the range, and who - and the rest are
 * deliberately ignored rather than silently returning nothing. The page says as much beneath the
 * bar, because a filter that is set and not applied is worse than one that is not offered.
 *
 * `dateColumn` and `nameExpr` are SQL this module writes, never anything a caller sends; the values
 * are bound as always.
 *
 * `nameParams` is for a `nameExpr` that carries placeholders of its own - the call reports resolve a
 * handset to the employee it belongs to with a `CASE` over the repository's numbers. MySQL binds by
 * position, so they go in ahead of the name being compared against, which is where they appear in
 * the clause.
 */
function buildUsageWhere(filters = {}, { dateColumn, nameExpr, nameParams = [], scope = null, scopeColumns = null }) {
  const clean = cleanFilters(filters);
  const clauses = [];
  const params = [];

  if (clean.from) { clauses.push(`${dateColumn} >= ?`); params.push(dayStart(clean.from)); }
  if (clean.to) { clauses.push(`${dateColumn} <= ?`); params.push(dayEnd(clean.to)); }
  // The employee filter is a name here, which is what the report's own list offers.
  if (clean.employee.length) {
    clauses.push(`${nameExpr} IN (${clean.employee.map(() => "?").join(", ")})`);
    params.push(...nameParams, ...clean.employee);
  }

  /*
   * Whose rows this reader may be shown: their own, their team's, and - for a branch administrator -
   * their branches'. The usage tables carry a login rather than an employee, and the person's branch
   * is on `user` beside it, which is what `scopeColumns` names.
   *
   * Added here rather than by each report, because these are positional parameters: a clause
   * appended by the caller after this function has returned goes into the statement in one order and
   * its values in another, and the report then narrows by the wrong thing entirely. One list of
   * clauses, one list of values, built together.
   */
  if (scope && scopeColumns) {
    const { clause, params: scopeParams } = scope.sql(scopeColumns);
    clauses.push(clause);
    params.push(...scopeParams);
  }

  return {
    sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "WHERE 1 = 1",
    params,
    filters: clean,
    // Which of the bar's filters this report could not honour, so the page can say so.
    ignored: ["vertical", "callType", "callMethod", "duration"].filter((key) => clean[key]),
  };
}

module.exports = { CALL_TYPES, CALL_METHODS, VERTICALS, DURATION_BANDS, isoDate, dayStart, dayEnd, cleanFilters, buildWhere, buildUsageWhere };
