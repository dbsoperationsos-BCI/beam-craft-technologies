const test = require("node:test");
const assert = require("node:assert/strict");
const { cleanFilters, buildWhere, buildUsageWhere, dayStart, dayEnd, isoDate, DURATION_BANDS } = require("../src/modules/sales/crm-reports/filters");

/*
 * The one filter bar six reports are read through.
 *
 * Every report applies the same clause, so a filter that means one thing on the Summary and another
 * on Call History is the fault worth guarding: the numbers stop reconciling and nobody traces it
 * back to a WHERE clause. These pin down what each filter does and, just as importantly, that no
 * value a caller sends is ever concatenated into the SQL.
 */

const params = (filters) => buildWhere(filters).params;
const sql = (filters) => buildWhere(filters).sql;

test("no filters still produces a usable clause", () => {
  // Reports append to this, so it can never be the empty string.
  assert.equal(sql({}), "WHERE 1 = 1");
  assert.deepEqual(params({}), []);
});

test("a date range covers both of its end days whole", () => {
  // "to 31 Aug" has to include the 31st. Up to its midnight would silently drop a day's calls.
  assert.deepEqual(params({ from: "2026-08-01", to: "2026-08-31" }), ["2026-08-01 00:00:00", "2026-08-31 23:59:59"]);
});

test("every range in these reports is bounded by the one day rule", () => {
  /*
   * The measured-usage read behind the two Usage columns bounded its own range instead, passing the
   * bare day - and MySQL reads a bare day as the midnight that *starts* it. So a report whose range
   * ended today excluded every stretch recorded today, and since a report opens on today, both
   * Usage columns read 0m however long the application had been in use. One rule, in one place, is
   * what stops that being written a fourth time.
   */
  assert.equal(dayStart("2026-09-02"), "2026-09-02 00:00:00");
  assert.equal(dayEnd("2026-09-02"), "2026-09-02 23:59:59", "the day named is included, not cut at its midnight");
  // No day is no bound at all, rather than a clause matching the empty string.
  assert.equal(dayStart(""), "");
  assert.equal(dayEnd(""), "");
  // The usage reports bound their range the same way the call reports do.
  assert.deepEqual(
    buildUsageWhere({ from: "2026-08-04", to: "2026-09-02" }, { dateColumn: "`a`.`created_at`", nameExpr: "`n`" }).params,
    ["2026-08-04 00:00:00", "2026-09-02 23:59:59"],
  );
});

test("dates the wrong way round are swapped, not refused", () => {
  // A report is a read and this is a date picker: an empty report is a worse answer than the one
  // obviously meant.
  const clean = cleanFilters({ from: "2026-08-31", to: "2026-08-01" });
  assert.equal(clean.from, "2026-08-01");
  assert.equal(clean.to, "2026-08-31");
});

test("anything that is not a date is not treated as one", () => {
  assert.equal(isoDate("2026-08-31"), "2026-08-31");
  assert.equal(isoDate("2026-08-31T17:49:41.000Z"), "2026-08-31", "a timestamp still names a day");
  assert.equal(isoDate("31/08/2026"), "");
  assert.equal(isoDate("yesterday"), "");
  assert.deepEqual(params({ from: "yesterday" }), []);
});

test("an employee matches by number or by name", () => {
  // Callyzer reports both, and an account may have staff whose numbers are not tracked.
  assert.deepEqual(params({ employee: "9876500000" }), ["9876500000", "9876500000"]);
  assert.match(sql({ employee: "Priya S" }), /employee_number.*OR.*employee_name/s);
});

/*
 * The rule the CRM's own Dum Dum tab follows: a lead with no vertical is a Dum Dum lead, because a
 * lead that predates the verticals is a wedding lead. Without it the report and the tab would
 * disagree about how many leads Dum Dum has.
 */
test("Dum Dum takes the leads with no vertical, as the CRM's own tab does", () => {
  const clause = sql({ vertical: "Dum Dum" });
  assert.match(clause, /TRIM\(COALESCE\(`l`\.`vertical`, ''\)\) = ''/);
  assert.match(clause, /NOT IN \('quaqua', 'corp', 'corporate', 'corporation'\)/);
  assert.deepEqual(params({ vertical: "Dum Dum" }), [], "the rule is fixed, so it binds nothing");
});

test("the other verticals match themselves only", () => {
  assert.deepEqual(params({ vertical: "Qua Qua" }), ["quaqua"]);
  assert.deepEqual(params({ vertical: "Corp" }), ["corp"]);
});

test("an unrecognised value filters on nothing rather than failing", () => {
  // A stale bookmark naming a vertical that has since been renamed should show the unfiltered
  // report, not a 400.
  assert.equal(sql({ vertical: "Wedding Studio" }), "WHERE 1 = 1");
  assert.equal(sql({ callType: "Telepathy" }), "WHERE 1 = 1");
  assert.equal(sql({ callMethod: "Smoke Signal" }), "WHERE 1 = 1");
  assert.equal(sql({ duration: "ages" }), "WHERE 1 = 1");
});

test("a duration band binds its own bounds", () => {
  assert.deepEqual(params({ duration: "1to5" }), [DURATION_BANDS["1to5"].min, DURATION_BANDS["1to5"].max]);
  // An open-ended band binds only its floor.
  assert.deepEqual(params({ duration: "over15" }), [DURATION_BANDS.over15.min]);
  // Not connected is exactly zero, at both ends.
  assert.deepEqual(params({ duration: "missed" }), [0, 0]);
});

/*
 * The one that matters most. A search box is the obvious way into a report, and the wildcards have
 * to be part of the bound value rather than part of the statement.
 */
test("a search is bound, wildcards and all, never concatenated", () => {
  const built = buildWhere({ search: "O'Brien" });
  assert.deepEqual(built.params, ["%O'Brien%", "%O'Brien%", "%O'Brien%"]);
  assert.ok(!built.sql.includes("O'Brien"), "the value must not appear in the statement");
  assert.equal(built.sql.match(/\?/g).length, 3, "one placeholder per column searched");
});

test("a value that reads as SQL is still only a value", () => {
  const built = buildWhere({ employee: "'; DROP TABLE `sales_crm_lead`; --" });
  assert.ok(!built.sql.includes("DROP"), "nothing a caller sends reaches the statement");
  assert.equal(built.params.length, 2);
});

test("every filter at once composes into one clause", () => {
  const built = buildWhere({
    from: "2026-08-01", to: "2026-08-31", employee: "9876500000", vertical: "Qua Qua",
    callType: "Incoming", callMethod: "WhatsAppCall", duration: "1to5", search: "Priya",
  });
  // Every placeholder has exactly one parameter behind it - the mismatch that makes a raw query
  // bind the wrong value to the wrong column.
  assert.equal(built.sql.match(/\?/g).length, built.params.length);
  // from, to, employee twice, vertical, type, method, both ends of the duration band, and the
  // search across three columns.
  assert.equal(built.params.length, 12);
});

test("the Employee filter takes several people, however the query string wrote them", () => {
  /*
   * A studio reads "how did the team do last week" far more often than one person's week, and the
   * filter answered only the second - so the question was asked by running the report once per name
   * and adding the numbers up by hand.
   */
  const many = buildWhere({ employee: ["Anitha", "Bala"] });
  assert.deepEqual(many.filters.employee, ["Anitha", "Bala"]);
  // Matched by name **or** number, over the whole list rather than one name at a time.
  assert.match(many.sql, /`c`\.`employee_name` IN \(\?, \?\)/);
  assert.ok(many.params.includes("Anitha") && many.params.includes("Bala"));

  /*
   * A single `employee=` on a saved link keeps behaving exactly as it did - the clause simply stops
   * being a special case for a list of one - and a comma-separated value reads the same way, since
   * a query string is written by hand as often as by the screen.
   */
  assert.deepEqual(buildWhere({ employee: "Anitha" }).filters.employee, ["Anitha"]);
  assert.deepEqual(buildWhere({ employee: "Anitha, Bala" }).filters.employee, ["Anitha", "Bala"]);
  // Blanks, repeats and an empty filter all come to nothing rather than to a clause matching "".
  assert.deepEqual(buildWhere({ employee: ["Anitha", " ", "Anitha"] }).filters.employee, ["Anitha"]);
  assert.deepEqual(buildWhere({ employee: [] }).filters.employee, []);
  assert.equal(/employee_name/.test(buildWhere({ employee: [] }).sql), false);
  // Capped: a filter is a question about a team, not a URL naming two hundred people.
  assert.equal(buildWhere({ employee: Array.from({ length: 80 }, (unused, i) => `P${i}`) }).filters.employee.length, 50);
});

test("the cleaned filters are echoed back, so a report can say what it is showing", () => {
  const built = buildWhere({ from: "2026-08-01", vertical: "Corp", callType: "Nonsense", search: "  Anitha  " });
  assert.deepEqual(built.filters, {
    // `employee` is a **list** now: the filter takes several people, so a report answers "how did
    // the team do last week" rather than one name at a time.
    from: "2026-08-01", to: "", employee: [], vertical: "Corp",
    callType: "", callMethod: "", duration: "", search: "Anitha",
  });
});
