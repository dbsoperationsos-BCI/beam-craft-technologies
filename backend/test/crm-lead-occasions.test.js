const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  BIRTHDAY_DAYS_FROM,
  BIRTHDAY_DAYS_TO,
  BIRTHDAY_AGE,
  NEWBORN_DAYS_BEFORE,
  NEWBORN_DAYS_AFTER,
  OCCASION_ORDER,
  isOccasionVertical,
  occurrenceOn,
  occasionOccurrence,
  occasionContextFor,
  occasionWindowSql,
  occasionYearSql,
  occasionColumnSql,
  anyOccasionWindowSql,
  occasionOverrideSql,
} = require("../src/modules/sales/crm-leads/occasionLeadService");

/*
 * A Qua Qua lead comes round again - twice.
 *
 * A **newborn** window around the estimated delivery date, and a **birthday** window before the
 * child's next birthday. Both are read off the one field that holds either, both put the lead back
 * into Yet to connect, and both keep their status against the occasion rather than against the lead.
 *
 * That turns on one rule stated twice: in SQL, where the board filters and counts, and in
 * JavaScript, where the write path decides which occurrence a status belongs to. If the two ever
 * disagree, a lead is offered in Yet to connect and then refused a status - or given one against an
 * occasion it is not being worked for. These tests pin the rule and the two statements of it
 * against each other. No database: the SQL is checked as text, the way `crm-lead-tabs.test.js`
 * checks the tab clauses.
 */

const TODAY = "2026-09-04";

/* ────────────────────────────────────────────────────────────────────────── newborns ── */

test("a delivery inside its window is the occasion being worked", () => {
  // 30 days before the estimated date to 5 days after it.
  const soon = occasionOccurrence("2026-09-20", TODAY);
  assert.equal(soon.occasion, "NEWBORN");
  assert.equal(soon.on, "2026-09-20");
  assert.equal(soon.days, 16);
  // The occurrence is filed under the year of the delivery: one window per pregnancy.
  assert.equal(soon.year, 2026);
});

test("the newborn window's two ends are the days it was specified as", () => {
  assert.equal(occasionOccurrence("2026-10-04", TODAY).occasion, "NEWBORN", `${NEWBORN_DAYS_BEFORE} days out is in`);
  assert.equal(occasionOccurrence("2026-10-05", TODAY), null, "31 days out is too early to call");
  // And it stays open for a few days after the date, because a baby does not arrive to order.
  assert.equal(occasionOccurrence("2026-08-30", TODAY).occasion, "NEWBORN", `${NEWBORN_DAYS_AFTER} days past is still in`);
  assert.equal(occasionOccurrence("2026-08-29", TODAY), null, "six days past is no longer a newborn call");
});

/* ───────────────────────────────────────────────────────────────────────── birthdays ── */

test("a birthday inside its window is the occasion being worked", () => {
  const occurrence = occasionOccurrence("2025-10-05", TODAY);
  assert.equal(occurrence.occasion, "BIRTHDAY");
  assert.equal(occurrence.year, 2026, "the birthday still to come this year is this year's");
  assert.equal(occurrence.on, "2026-10-05");
  assert.equal(occurrence.days, 31);
});

test("the birthday window's two ends are the days it was specified as", () => {
  // The birthday itself is in - the tab does not empty on the one day it matters most.
  assert.equal(occasionOccurrence("2025-09-04", TODAY).days, BIRTHDAY_DAYS_FROM);
  assert.equal(occasionOccurrence("2025-09-04", TODAY).occasion, "BIRTHDAY");
  // The day after it is not, and not because of the day bound: the birthday has gone, so the next
  // recurrence is a year off and the child turning two at it.
  assert.equal(occasionOccurrence("2025-09-03", TODAY), null, "yesterday's first birthday is over");
  // And 45 days out is in, 46 is not.
  const last = occasionOccurrence("2025-10-19", TODAY);
  assert.equal(last.days, BIRTHDAY_DAYS_TO);
  assert.equal(last.occasion, "BIRTHDAY");
  assert.equal(occasionOccurrence("2025-10-20", TODAY), null);
});

test("only the first birthday is worked, whatever else is in the window", () => {
  /*
   * Qua Qua calls the family whose child is turning one. A second, third or fifth birthday falls in
   * the same 0-45 day run-up every year and is not a reason to ring, so the age is a bound of the
   * window rather than something the caller is left to notice on the row.
   *
   * Swept across the whole window rather than sampled, because every one of these dates satisfies
   * the day bounds and is kept out by nothing else.
   */
  assert.equal(BIRTHDAY_AGE, 1);
  for (let offset = BIRTHDAY_DAYS_FROM; offset <= BIRTHDAY_DAYS_TO; offset += 1) {
    const on = new Date(Date.parse(`${TODAY}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
    const firstBirthday = `2025${on.slice(4)}`;
    assert.equal(occasionOccurrence(firstBirthday, TODAY)?.occasion, "BIRTHDAY", `${firstBirthday} turns one`);
    for (const bornIn of [2024, 2023, 2020]) {
      const later = `${bornIn}${on.slice(4)}`;
      assert.equal(occasionOccurrence(later, TODAY), null, `${later} is past its first birthday`);
    }
  }
});

test("a birthday window opening in December runs into January", () => {
  // The reason the year is worked out rather than assumed: on 20 December the birthdays worth
  // calling about are mostly next year's, and they are held under next year's key.
  const occurrence = occasionOccurrence("2026-01-10", "2026-12-20");
  assert.equal(occurrence.occasion, "BIRTHDAY");
  assert.equal(occurrence.year, 2027, "a January birthday reached from December is next year's");
  assert.equal(occurrence.on, "2027-01-10");
});

test("the first birthday is counted against the occurrence, not against today's year", () => {
  /*
   * The fortnight either side of new year is the only time the two differ, and they differ by a
   * whole year. On 20 December the birthdays in the window are January's: the child turning one at
   * one of them was born *this* year, and the child born last year is turning two. Reading the
   * birth year off today's would swap them for six weeks a year - calling the wrong families and
   * missing the right ones - which is the whole reason `BIRTHDAY_AGE` is asked of `year`.
   */
  const december = "2026-12-20";
  assert.equal(occasionOccurrence("2026-01-10", december).year, 2027, "born this year, turning one in January");
  assert.equal(occasionOccurrence("2025-01-10", december), null, "born last year, but turning two");
  // Still December's own birthdays that are being read the ordinary way, one year back.
  assert.equal(occasionOccurrence("2025-12-27", december)?.on, "2026-12-27", "born last year, turning one this month");
  assert.equal(occasionOccurrence("2024-12-27", december), null, "turning two this month");
});

test("a leap-year baby has a birthday in a year with no 29 February", () => {
  /*
   * Clamped to the 28th, which is what MySQL's `DATE_ADD(date, INTERVAL n YEAR)` does - and that is
   * the expression the board's SQL uses. Rebuilding the date from its month and day instead would
   * make `STR_TO_DATE('2027-02-29')` NULL and drop the child out of the tab entirely.
   */
  assert.equal(occurrenceOn("2020-02-29", 2027), "2027-02-28");
  assert.equal(occurrenceOn("2020-02-29", 2028), "2028-02-29", "and stays on the 29th in a leap year");
  // A baby born on 29 February turns one in a year that has no such day: 2028's turns one in 2029.
  assert.equal(occasionOccurrence("2028-02-29", "2029-01-20").on, "2029-02-28");
});

/* ─────────────────────────────────────────────────────── the two never claim one lead ── */

test("the two windows cannot both be open on the same lead", () => {
  /*
   * The property that lets a lead have exactly one occasion and the board read one status.
   *
   * A birthday needs the stored date to be in the past, its next recurrence 0-45 days off *and* the
   * child turning one at it; a
   * date inside the newborn window is at most 5 days past, whose next birthday is therefore some
   * 360 days off. Swept here across the whole newborn window rather than argued about, because it is
   * the assumption `occasionOverrideSql` rests on.
   */
  for (let offset = -NEWBORN_DAYS_AFTER; offset <= NEWBORN_DAYS_BEFORE; offset += 1) {
    const date = new Date(Date.parse(`${TODAY}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
    const occurrence = occasionOccurrence(date, TODAY);
    assert.equal(occurrence?.occasion, "NEWBORN", `${date} should be a newborn call, not a birthday`);
  }
});

test("newborn is tested first, so a delivery is never read as a birthday", () => {
  // Stated as an order rather than left to chance, so the two can never both claim a lead even if
  // the windows were later widened into each other.
  assert.deepEqual(OCCASION_ORDER, ["NEWBORN", "BIRTHDAY"]);
});

/* ───────────────────────────────────────────────────────────────── neither, and nobody ── */

test("a date in neither window is no occasion at all", () => {
  // Which is the case for most of the board most of the year, and is why the occurrence lookup is
  // guarded by the windows rather than run for every row.
  assert.equal(occasionOccurrence("2025-03-05", TODAY), null, "a first birthday six months off");
  assert.equal(occasionOccurrence("2027-06-01", TODAY), null, "a delivery nine months off");
  assert.equal(occasionOccurrence("", TODAY), null, "a lead with no date");
  assert.equal(occasionOccurrence("not a date", TODAY), null);
});

test("a slashed date is read day-first, the way the rest of the CRM writes one", () => {
  // Three producers write this column - the date picker, CSV import and Google Sheets - so one day
  // arrives in more than one spelling. `isoDaySql` folds them the same way in SQL.
  assert.equal(occasionOccurrence("05/10/2025", TODAY).on, "2026-10-05");
  assert.equal(occasionOccurrence("20/09/2026", TODAY).occasion, "NEWBORN");
});

test("only Qua Qua works these occasions, however its name is spelled", () => {
  for (const spelling of ["Qua Qua", "quaqua", " QUA QUA ", "Qua  Qua"]) {
    assert.equal(isOccasionVertical(spelling), true, `${spelling} is Qua Qua`);
  }
  for (const other of ["Dum Dum", "Corp", "Corporate", "", null]) {
    assert.equal(isOccasionVertical(other), false, `${other} does not work them`);
  }
});

test("a date of birth on a wedding lead never sends it back to Yet to connect", () => {
  /*
   * The vertical is asked before the date. Dum Dum shoots weddings and does not call a client
   * because their baby is due; a stray date in this column on one of its leads must not put it into
   * Yet to connect months later.
   */
  const lead = { vertical: "Dum Dum", dateOfBirthOrEdod: "2025-10-05" };
  assert.equal(occasionContextFor(lead, {}, TODAY), null);
  assert.ok(occasionContextFor({ ...lead, vertical: "Qua Qua" }, {}, TODAY), "the same lead on Qua Qua has one");
});

/* ───────────────────────────────────────────────── the SQL says the same as the JavaScript ── */

test("each window's SQL is bounded the same way its JavaScript is", () => {
  const newborn = occasionWindowSql("NEWBORN", TODAY);
  assert.match(newborn, new RegExp(`INTERVAL ${NEWBORN_DAYS_AFTER} DAY`));
  assert.match(newborn, new RegExp(`INTERVAL ${NEWBORN_DAYS_BEFORE} DAY`));

  const birthday = occasionWindowSql("BIRTHDAY", TODAY);
  assert.match(birthday, new RegExp(`INTERVAL ${BIRTHDAY_DAYS_FROM} DAY`));
  assert.match(birthday, new RegExp(`INTERVAL ${BIRTHDAY_DAYS_TO} DAY`));
  // The first birthday and no other, counted against the occurrence's year the way `match` does -
  // so the age clause is the tab's `yearSql` less the birth year, not a bare `YEAR(CURDATE()) - 1`.
  assert.match(birthday, new RegExp(`\\(${occasionYearSql("BIRTHDAY", TODAY).replace(/[.*+?^$(){}|[\]\\]/g, "\\$&")} - YEAR\\(\`dob_edod_day\`\\)\\) = ${BIRTHDAY_AGE}`));
  // The bound that keeps a pregnancy out of the birthday tab: only a date already passed is a birth.
  assert.match(birthday, /`dob_edod_day` < STR_TO_DATE\('2026-09-04'/);
  // `DATE_ADD ... INTERVAL n YEAR` is what clamps 29 February; rebuilding the string would not.
  assert.match(birthday, /DATE_ADD\(`dob_edod_day`, INTERVAL \(\d{4} - YEAR\(`dob_edod_day`\)\) YEAR\)/);
});

test("the SQL binds no parameters, because it is written into the SELECT list as well", () => {
  /*
   * `$queryRawUnsafe` binds by position, and these expressions appear in the SELECT list - before
   * every parameter the WHERE clause pushes. One `?` here would renumber all of them, which is the
   * kind of fault that returns plausible rows rather than an error.
   */
  for (const sql of [occasionWindowSql("NEWBORN", TODAY), occasionWindowSql("BIRTHDAY", TODAY), anyOccasionWindowSql(TODAY)]) {
    assert.equal(sql.includes("?"), false, "occasion SQL must be literal, never bound");
  }
  // Safe because the day is validated before it is written in: never the caller's text.
  assert.match(occasionWindowSql("NEWBORN", "'; DROP TABLE x; --"), /STR_TO_DATE\('\d{4}-\d{2}-\d{2}', '%Y-%m-%d'\)/);
});

test("the year in the SQL is the year the JavaScript would store the occurrence under", () => {
  // A newborn is filed under the delivery's own year; a birthday under this year's or next year's,
  // the same either-or `occasionOccurrence` answers.
  assert.equal(occasionYearSql("NEWBORN", TODAY), "YEAR(`dob_edod_day`)");
  assert.match(occasionYearSql("BIRTHDAY", TODAY), /2027, 2026/);
  assert.equal(occasionOccurrence("2026-09-20", TODAY).year, 2026);
  assert.equal(occasionOccurrence("2026-01-10", "2026-12-20").year, 2027);
});

test("no occasion SQL is generated for the boards that do not work them", () => {
  // Dum Dum is the biggest board in the application, and its queries must not grow a per-row
  // subquery for a feature it does not have.
  const pick = (occasion) => `'${occasion}'`;
  assert.equal(occasionOverrideSql("Dum Dum", TODAY, pick, "`status_key`"), "`status_key`");
  assert.equal(occasionOverrideSql("Corp", TODAY, pick, "`status_key`"), "`status_key`");
  const quaQua = occasionOverrideSql("Qua Qua", TODAY, pick, "`status_key`");
  assert.match(quaQua, /^IF\(/);
  // Both occasions are in it, nested in the order they are tested.
  assert.ok(quaQua.includes("'NEWBORN'") && quaQua.includes("'BIRTHDAY'"), "both occasions must be offered");
  assert.ok(quaQua.indexOf("'NEWBORN'") < quaQua.indexOf("'BIRTHDAY'"), "newborn is tested first");
});

/* ─────────────────────────────────────────────────────────────────── and the board agrees ── */

const CRM = path.join(__dirname, "..", "src", "modules", "sales", "crm-leads");
const QUERY_SERVICE = fs.readFileSync(path.join(CRM, "leadQueryService.js"), "utf8");
const BOARD = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", "components", "sales", "CRMPage.js"), "utf8");

test("both tabs and the occasion half of Yet to connect are the same two windows", () => {
  /*
   * Stated once and used by all three, rather than written out again. A tab that listed an occasion
   * the write path would not accept a status for - or the reverse - is the failure this prevents,
   * and it would show up as a row that cannot be worked rather than as an error.
   */
  assert.match(QUERY_SERVICE, /if \(view === "newborns"\) return occasionWindowSql\("NEWBORN", today\)/);
  assert.match(QUERY_SERVICE, /if \(view === "birthdays"\) return occasionWindowSql\("BIRTHDAY", today\)/);

  /*
   * Yet to connect no longer names the windows at all, and still picks occasions up.
   *
   * It used to add them itself - `anyOccasionWindowSql` beside the lead's own arrival day - because
   * the queue expired at the end of that arrival day and an occasion opening months later had to be
   * exempted from the expiry. With the ageing gone there is nothing to exempt: the tab asks whether
   * the status the lead is *being worked at* is empty, and inside a window `statusKeySql` is the
   * occasion's own status. One question, and the occasion answers it.
   *
   * So the guard moves to where the windows now enter the tab. If `statusKeySql` stopped reading the
   * occasion, a birthday nobody had touched would answer with the lead's year-old status and the
   * queue would lose exactly the rows this board exists to work.
   */
  const yetToConnect = QUERY_SERVICE.slice(
    QUERY_SERVICE.indexOf("function yetToConnectSql("),
    QUERY_SERVICE.indexOf("function viewClause("),
  );
  assert.match(yetToConnect, /\$\{statusKey\} = ''/, "Yet to connect is no longer the leads nobody has set a status on");
  const statusKey = QUERY_SERVICE.slice(QUERY_SERVICE.indexOf("function statusKeySql("), QUERY_SERVICE.indexOf("function statusTextSql("));
  assert.match(statusKey, /occasionColumnSql\(occasion, today, "status_key"\)/, "an occasion's own status no longer reaches the tabs");
  // `occasionOverrideSql` is both windows in occasion order, and the plain column off Qua Qua - so
  // Newborns and Birthdays feed the queue together, and only on the board that works them.
  assert.match(statusKey, /occasionOverrideSql\(/, "the occasion windows are named somewhere other than the one place that states them");
  assert.match(QUERY_SERVICE, /function occasionOverrideSql|occasionOverrideSql,/, "occasionOverrideSql is no longer imported, so nothing gates the windows by board");
});

test("the board reads an occasion's status where the API puts it", () => {
  /*
   * The API sends the occurrence beside the lead rather than folded over it, so that a screen which
   * reads a lead and saves it back can never copy an occasion's status onto the lead. That only
   * works while the client actually prefers those fields - otherwise the Status column would show
   * last year's shoot on a row the Yet to connect tab had just listed.
   */
  assert.match(BOARD, /function isOccasionLead/, "the board no longer knows what an occasion lead is");
  const resolve = BOARD.slice(BOARD.indexOf("function resolveLeadStatus"), BOARD.indexOf("function resolveLeadCnaSequence"));
  assert.match(resolve, /isOccasionLead\(lead, details\)/);
  assert.match(resolve, /occasionStatus/);
  assert.match(resolve, /YET_TO_CONNECT_STATUS/, "an occasion nobody has set a status against reads Yet to connect");
});

/*
 * ── An occasion may add a follow-up date; it may not take one away ─────────────────────────────
 *
 * The three overrides in `leadQueryService.js` all read the lead's current occurrence while it is
 * inside a window, and all three have to answer something for a lead that has **no occurrence row
 * at all** - which is most of them, because occurrences are written by `crmLeadService` (Add Lead,
 * the lead popup, a bulk status change) and by nothing else. A lead that arrived by CSV import or
 * by sheet sync has none.
 *
 * The two status overrides answer `''` on purpose: an occasion nobody has worked reads as no status,
 * which is what puts it in Yet to connect as fresh work, and that is the whole point of working an
 * occasion as its own enquiry.
 *
 * `followUpDaySql` had no such fallback, and the difference was not deliberate. It answered the
 * correlated lookup raw, so a Qua Qua lead inside a newborn or birthday window with no occurrence
 * read NULL - and `NULL = '<today>'` is NULL, so the lead dropped out of Today and both dated
 * pending tabs however plainly its Next Followup Date read today, then reappeared in Overall
 * Pending, which takes a NULL follow-up day as work owed on a day the board cannot name. A call
 * booked for today, filed as backlog. On one 32,881-lead Qua Qua board that was 19 leads of 179.
 */
test("a Qua Qua lead inside an occasion window keeps its own follow-up date until the occasion sets one", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "modules", "sales", "crm-leads", "leadQueryService.js"),
    "utf8",
  );
  const body = source.slice(source.indexOf("function followUpDaySql"));
  const declaration = body.slice(0, body.indexOf("\n}") + 2);

  assert.ok(
    declaration.includes('COALESCE(${occasionColumnSql(occasion, today, "follow_up_day")}, \\`follow_up_day\\`)'),
    "an occasion with no follow-up date of its own hides the one the lead carries again",
  );

  // The other half of the same rule: an occurrence that *has* been given a date still wins, which is
  // what makes an occasion its own enquiry rather than a label on the old one.
  const occasionFirst = declaration.indexOf("occasionColumnSql");
  const leadSecond = declaration.indexOf("`follow_up_day`", occasionFirst);
  assert.ok(occasionFirst !== -1 && leadSecond > occasionFirst, "the lead's own column is being read ahead of the occasion's");
});

test("every occasion override answers something for a lead with no occurrence row", () => {
  /*
   * Said against the generated SQL rather than the source, so it holds however the three are
   * written: off Qua Qua each collapses to its plain column, and on Qua Qua none of them may hand
   * the query a bare correlated SELECT whose NULL silently removes the lead from a dated tab.
   */
  const today = "2026-09-16";
  const bare = /^\(SELECT/;

  const followUp = occasionOverrideSql(
    "Qua Qua",
    today,
    (occasion) => `COALESCE((SELECT \`oc\`.\`follow_up_day\` ... '${occasion}'), \`follow_up_day\`)`,
    "`follow_up_day`",
  );
  for (const branch of followUp.split("IF(").slice(1)) {
    const value = branch.slice(branch.indexOf("), ") + 3).trim();
    assert.doesNotMatch(value, bare, "an occasion branch answers a raw lookup, so no occurrence means no day");
  }

  // Off the occasion verticals nothing is generated at all, which is what keeps Dum Dum and Corp
  // paying nothing for a rule that cannot apply to them.
  assert.equal(occasionOverrideSql("Dum Dum", today, () => "never", "`follow_up_day`"), "`follow_up_day`");
  assert.equal(occasionOverrideSql("Corp", today, () => "never", "`follow_up_day`"), "`follow_up_day`");
  assert.ok(isOccasionVertical("Qua Qua"));
});

/*
 * ── An occasion nobody has started reads the lead's own status ─────────────────────────
 *
 * `createCrmLead` says the rule outright: a lead added while one of its windows is open "starts that
 * occasion at the status it was added with", because "without this the row would go straight into
 * Yet to connect on the strength of an empty occurrence, however plainly the person adding it had
 * just spoken to the client". It writes that occurrence, and so escapes its own trap.
 *
 * Nothing else did. Occurrence rows are written by `crmLeadService` alone, so a lead that arrived by
 * CSV import or sheet sync has none, and the two status overrides answered '' for it - the exact
 * case that comment describes, at the scale of a whole import. A lead reading **Followup** in its
 * Status column, with its Next Followup Date set to today, was counted at no status: out of Today
 * Pending and Yesterday Pending, which ask for Followup, and into Yet to connect, the queue for
 * leads nobody has rung. 88 of 96 on one Qua Qua board.
 *
 * Both overrides now fall back to the lead's own column, and they have to do it together: the Status
 * column is drawn from `statusTextSql` and the tabs filter on `statusKeySql`, so one falling back
 * without the other is the screen and the tab disagreeing, which is worse than either being wrong.
 */
test("an occasion nobody has started is worked at the status the lead already carries", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "modules", "sales", "crm-leads", "leadQueryService.js"),
    "utf8",
  );
  const declarationOf = (name) => {
    const body = source.slice(source.indexOf("function " + name));
    return body.slice(0, body.indexOf("\n}") + 2);
  };

  for (const [name, column] of [["statusKeySql", "status_key"], ["statusTextSql", "status"]]) {
    const declaration = declarationOf(name);
    const fallback = 'COALESCE(${occasionColumnSql(occasion, today, "' + column + '")}, \\`' + column + "\\`, '')";
    assert.ok(
      declaration.includes(fallback),
      name + " sends a lead with no occurrence back to Yet to connect whatever its Status column says",
    );
    // '' stays last: a lead with no occurrence *and* no status of its own still reads as unset,
    // which is what `unsetStatusSql` turns into Yet to connect.
    assert.ok(declaration.includes(", '')"), name + " no longer ends at the empty status");
  }
});

test("the Status column and the tabs read the same status", () => {
  /*
   * Said against the generated SQL: however the two are written, the value a Qua Qua branch hands
   * back has to name the lead's own column as well as the occurrence's, or the board filters on
   * something other than what it is showing.
   */
  const today = "2026-09-16";
  for (const column of ["status_key", "status"]) {
    const quoted = "`" + column + "`";
    const sql = occasionOverrideSql(
      "Qua Qua",
      today,
      (occasion) => "COALESCE(" + occasionColumnSql(occasion, today, column) + ", " + quoted + ", '')",
      quoted,
    );
    for (const branch of sql.split("IF(").slice(1)) {
      const value = branch.slice(branch.indexOf("), ") + 3).trim();
      if (!value.startsWith("COALESCE")) continue;
      assert.ok(value.includes(quoted), "an occasion branch for " + column + " never reads the lead's own column");
    }
  }
});
