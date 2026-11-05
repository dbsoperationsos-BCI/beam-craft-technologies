const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * A CRM tab is one thing written in four places, and three of them are here.
 *
 * The board lists its tabs (`BRANCH_TABS` in CRMPage.js) and sends the chosen one as `view`. The
 * controller's schema decides whether that word is a word at all - an unlisted one is a 400, and
 * the whole board goes blank rather than the one tab failing. A clause turns it into SQL, and a
 * view with no clause silently returns *everything*, which is worse than an error because it looks
 * like a tab that works. The counts query then has to count it, or the tab wears "(0)" for ever.
 *
 * Two stores answer those questions, because the CRM is read through two. The three verticals are
 * the lead table, and `viewClause` / `crmLeadTabCounts` in leadQueryService.js answer for them. The
 * Calls board is the Callyzer call log, and `callViewClause` / `callBoardTabCounts` in
 * callBoardService.js answer for it. A tab belongs to one of the two and has to be complete in
 * whichever it belongs to; the controller's enum covers both, since one request serves both boards.
 *
 * Adding a tab means touching all four. These tests are the reason a missed one is caught here
 * rather than by somebody clicking it.
 *
 * Read from source rather than a database, the way `raw-sql-table-names.test.js` is, so they run
 * anywhere with no MySQL.
 */

const CRM = path.join(__dirname, "..", "src", "modules", "sales", "crm-leads");
const QUERY_SERVICE = fs.readFileSync(path.join(CRM, "leadQueryService.js"), "utf8");
const CALL_BOARD = fs.readFileSync(path.join(CRM, "callBoardService.js"), "utf8");
const CONTROLLER = fs.readFileSync(path.join(CRM, "controller.js"), "utf8");
// The board itself lives in the other half of the repo. Its tab list is the thing being checked -
// the API's job is to answer for whatever the board offers - so the test reads it where it is.
const BOARD = path.join(__dirname, "..", "..", "frontend", "src", "components", "sales", "CRMPage.js");

/** The `view` values the controller will accept, across both boards. */
function acceptedViews() {
  const match = CONTROLLER.match(/view:\s*z\.enum\(\[([\s\S]*?)\]\)/);
  assert.ok(match, "the page query schema no longer declares `view` as an enum");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
}

/** The verticals' views, which `crmLeadTabCounts` counts in one pass. */
function countedLeadViews() {
  const match = QUERY_SERVICE.match(/for \(const view of \[([^\]]+)\]\)/);
  assert.ok(match, "crmLeadTabCounts no longer counts its views from one list");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
}

/**
 * The Calls board's views.
 *
 * One list on that side rather than two: `CALL_VIEWS` is both the clause for each tab and, through
 * `CALL_VIEW_IDS`, the list `callBoardTabCounts` sums - so a tab there cannot be defined and left
 * uncounted the way it can here. That is why this reads the definitions themselves.
 */
function countedCallViews() {
  const match = CALL_BOARD.match(/const CALL_VIEWS = \{([\s\S]*?)\n\};/);
  assert.ok(match, "callBoardService no longer defines its views in one object");
  assert.match(CALL_BOARD, /const CALL_VIEW_IDS = Object\.keys\(CALL_VIEWS\)/, "the counted list no longer comes from the definitions");
  return [...match[1].matchAll(/^\s{2}(\w+):/gm)].map((entry) => entry[1]);
}

/** Every view either store answers for. */
function countedViews() {
  return [...countedLeadViews(), ...countedCallViews()];
}

/** The tab ids the board offers, across all three verticals. */
function boardTabIds() {
  const source = fs.readFileSync(BOARD, "utf8");
  // Everything between the tab definitions and the function that reads them: FOLLOWUP_TABS,
  // OPENING_TABS, REJECTED_TAB and BOARD_TABS, whichever of them are spread into which.
  const region = source.slice(source.indexOf("const FOLLOWUP_TABS"), source.indexOf("function getTabsForBoard"));
  assert.ok(region.length > 0, "the board's tab definitions have moved");
  return [...new Set([...region.matchAll(/\bid:\s*"([^"]+)"/g)].map((entry) => entry[1]))];
}

test("every tab the board offers is a view the API accepts", () => {
  const accepted = new Set(acceptedViews());
  for (const id of boardTabIds()) {
    assert.ok(accepted.has(id), `the board offers a "${id}" tab, which the page query schema rejects - opening it answers 400 and the board goes blank`);
  }
});

test("every tab the board offers is a view that is counted", () => {
  const counted = new Set(countedViews());
  for (const id of boardTabIds()) {
    assert.ok(counted.has(id), `the "${id}" tab is not counted, so its label would read "(0)" however many leads it holds`);
  }
});

test("every counted view is returned under its own name", () => {
  // The counts are built by one grouped query and then read off by key; a view summed in SQL and
  // forgotten in the object it is read into is a permanent zero.
  const returned = QUERY_SERVICE.slice(QUERY_SERVICE.indexOf("return {", QUERY_SERVICE.indexOf("async function crmLeadTabCounts")));
  for (const view of countedLeadViews()) {
    assert.match(returned, new RegExp(`\\b${view}:\\s*Number\\(row\\?\\.${view}`), `crmLeadTabCounts sums "${view}" but never returns it`);
  }
  // The Calls board reads its own sums back off the same list it summed them from, so there is no
  // second place for a name to be forgotten in - which is the point of doing it that way.
  assert.match(
    CALL_BOARD,
    /return Object\.fromEntries\(CALL_VIEW_IDS\.map\(\(view\) => \[view, Number\(row\?\.\[view\] \|\| 0\)\]\)\)/,
    "callBoardTabCounts no longer returns every view it summed",
  );
});

test("every view the API accepts has a clause of its own, except All", () => {
  /*
   * A view with no clause means "no restriction", which is exactly right for All and exactly wrong
   * for anything else: the tab would list the whole board and look like it works.
   */
  const callViews = new Set(countedCallViews());
  for (const view of acceptedViews()) {
    if (view === "all") continue;
    if (callViews.has(view)) {
      // On the call side a view *is* its clause - the object maps one to the other - so what has to
      // be checked is that the clause is not the null that means "everything".
      assert.match(
        CALL_BOARD,
        new RegExp(`^\\s{2}${view}: (?!null)`, "m"),
        `"${view}" is a Calls tab with no clause, so it would quietly list every call`,
      );
      continue;
    }
    assert.match(QUERY_SERVICE, new RegExp(`if \\(view === "${view}"\\)`), `"${view}" is accepted but has no clause in viewClause, so that tab would quietly list every lead`);
  }
});

/* ------------------------------------------------------------------- the tabs that are a date */

test("Today New Leads is the leads whose Enquiry Date is today", () => {
  /*
   * The Enquiry Date the column shows, not the day the row reached this table.
   *
   * It compared `created_day` - the stored fold of `created_date` falling back to the row's own
   * insert timestamp - which is when the lead was *written*. For anything arriving from a sheet
   * those are different days: `date` carries the enquiry's own date, and a sync run today wrote
   * last month's enquiries with today's `created_date`. So the tab held a month of leads whose
   * Enquiry Date column read something else, and missed the ones whose column read today.
   *
   * The rule is now the column's own expression asked as a question, which is the same thing the
   * filter and the sort on that column already use - three readers of "the enquiry date" that have
   * to answer the same, so a lead cannot be listed by the tab and then contradicted by its own cell.
   */
  // The returned expression rather than the whole block: the prose around it names `created_day`
  // on purpose, to say what this tab stopped comparing.
  const returned = QUERY_SERVICE.match(/if \(view === "new"\)[\s\S]*?\n    return ([^\n]+)\n/);
  assert.ok(returned, "the New tab no longer returns a clause of its own");
  assert.match(returned[1], /\$\{enquiryDaySql\(\)\} = \?/, "the tab no longer compares the day its column shows");
  assert.doesNotMatch(returned[1], /created_day/, "the tab is back on the day the row was written");

  // And that helper really is the displayed column folded to a day, rather than a second spelling
  // of the enquiry date that could drift from the one on screen.
  assert.match(QUERY_SERVICE, /function enquiryDaySql\(\) \{\s*return isoDayOf\(COLUMN_SQL\.enquiryDate\);/);

  // The fallback the tab keeps, and the reason it is a narrowing rather than a swap: a lead nobody
  // gave a date is still new on the day it was entered, because nothing else can date it.
  assert.match(
    QUERY_SERVICE,
    /enquiryDate: "COALESCE\(NULLIF\(`date`,''\), NULLIF\(`created_date`,''\), DATE_FORMAT\(`created_at`, '%Y-%m-%d'\)\)"/,
    "the Enquiry Date column no longer ends at the row's own insert timestamp",
  );

  /*
   * The header's date range is the other reader of an arrival day, and it reads the same expression
   * now. It used to compare the indexed `created_day` because a range is open-ended and could not
   * afford a function per row, and that was only safe while the two were never asked together. The
   * two readings are gone: a range over "This Month" means the enquiries of this month, not the rows
   * written in it, and an import of old enquiries fell inside every range covering today. See
   * `crm-date-range.test.js`, which holds the whole board to the one expression.
   *
   * The list below still matters for a different reason: a range on top of a tab that is already a
   * date is two answers to one question, whichever day both of them read.
   */
  assert.match(QUERY_SERVICE, /const DATED_VIEWS = new Set\(\["new",/, "the date range is now offered on a tab that is already a date");
  assert.match(QUERY_SERVICE, /function dateRangeClauses[\s\S]*?\$\{enquiryDaySql\(\)\} >= \?/);
});

test("the three pending tabs are cut by the Next Followup Date, and Overall carries the backlog", () => {
  /*
   * A "pending followup" is a call that is **owed**, so these three are dated by the lead's Next
   * Followup Date. Today Pending is the calls owed today, Yesterday Pending the calls owed
   * yesterday, and Overall Pending everything owed yesterday or earlier.
   *
   * They were briefly cut by the Enquiry Date instead, so that the date visible in the table was the
   * date the tab was cut by. It reads well and answers the wrong question: a lead that enquired in
   * July with a call booked for yesterday is work owed yesterday, and cutting by the enquiry date
   * filed it under July and left the call in no dated tab at all. A worklist is dated by when the
   * work is due.
   */
  const clauseFor = (view) => {
    const found = QUERY_SERVICE.match(new RegExp(`if \\(view === "${view}"\\)[\\s\\S]*?\\n    return ([\\s\\S]*?);\\n  \\}`));
    assert.ok(found, `"${view}" no longer returns a clause of its own`);
    return found[1];
  };

  // Every one of them asks the same question of the status, off `statusKey` rather than the raw
  // column - so a Qua Qua lead inside an occasion is chased on that occasion's status. All three,
  // Today included: the tab is the follow-up owed today, not the leads nobody has rung.
  for (const view of ["pending", "yesterdayPending", "overallPending"]) {
    assert.match(clauseFor(view), /REPLACE\(\$\{statusKey\},'-',''\) = 'followup'/, `"${view}" no longer reads the status the lead is worked at`);
    assert.match(clauseFor(view), /\$\{followUpDay\}/, `"${view}" is no longer dated by the call that is owed`);
    assert.doesNotMatch(clauseFor(view), /enquiryDaySql/, `"${view}" is back on the day the enquiry came in`);
  }
  /*
   * Today Pending is checked on its own as well, because it is the one dated by the client's own
   * today rather than a day derived from it - and because of what it must *not* be cut by.
   *
   * It read **Yet to connect** for a while, on the reasoning that the tab was the calls still to be
   * made today. That made the three tabs two different questions under one name, and lost the case
   * in between: a lead at Followup with a call booked for today was owed a call today and appeared
   * in none of the three, then surfaced in Yesterday Pending the next morning as though it had been
   * missed. Before that it carried two more ways in - the whole Yet to connect queue, and everything
   * that arrived today - which made "Today Pending Followups (673)" tell a studio it owed 673 calls
   * when most of those leads had no follow-up booked at all. Both of those readings have tabs of
   * their own, so this one is the follow-up owed today and nothing else.
   */
  const pendingBlock = QUERY_SERVICE.slice(QUERY_SERVICE.indexOf('if (view === "pending") {'), QUERY_SERVICE.indexOf('if (view === "yesterdayPending")'));
  assert.match(
    pendingBlock,
    /return `\(\$\{followUpDay\} = \? AND REPLACE\(\$\{statusKey\},'-',''\) = 'followup'\)`/,
    "Today Pending is no longer the follow-up calls owed today",
  );
  assert.doesNotMatch(pendingBlock, /readsYetToConnectSql/, "Today Pending is back on the untouched queue rather than the follow-up owed today");
  assert.doesNotMatch(pendingBlock, /enquiryDaySql/, "Today Pending is counting today's arrivals again");

  /*
   * Both ways the label arrives, or the tab lists half of what its name promises: a lead with no
   * status reads Yet to connect by derivation, and an imported one whose file said so carries the
   * words as stored text. `statusDisplaySql` folds neither onto anything else, so both print the
   * same thing on the row.
   */
  const readsBlock = QUERY_SERVICE.slice(QUERY_SERVICE.indexOf("function readsYetToConnectSql("), QUERY_SERVICE.indexOf("* Tab definitions"));
  assert.match(readsBlock, /yetToConnectSql\(statusKey\)/, "the derived half of Yet to connect is gone");
  assert.match(readsBlock, /= 'yettoconnect'/, "a lead that stores the words 'yet to connect' is no longer recognised");

  // One definition of "nobody has rung", read by both tabs that need it.
  assert.match(QUERY_SERVICE, /function yetToConnectSql\(statusKey\) \{/);

  // Yesterday is one day, derived from the client's today rather than from the server's clock, so
  // the tabs agree about where the boundary falls.
  assert.match(clauseFor("yesterdayPending"), /\$\{followUpDay\} = \?/);
  const yesterday = QUERY_SERVICE.slice(QUERY_SERVICE.indexOf('if (view === "yesterdayPending")'), QUERY_SERVICE.indexOf('if (view === "overallPending")'));
  assert.match(yesterday, /params\.push\(previousDay\(today\)\)/);

  /*
   * Overall is `<=` **today**, and the two halves of that matter separately.
   *
   * `<=` rather than `<`: the tab is everything still owed and today is part of it, so a call owed
   * today is in both Today Pending and Overall, and one owed yesterday in both Yesterday and
   * Overall. The three deliberately overlap and their counts do not add up to the board.
   *
   * Bounded at today rather than yesterday. It was yesterday, on the reading that the tab was the
   * work somebody was behind on and a call booked for today is not yet late; the studio reads it as
   * the total still owed, and leaving today out made the one number meant to answer "how much is
   * outstanding" short by a whole day's work, every day.
   */
  const overall = QUERY_SERVICE.slice(QUERY_SERVICE.indexOf('if (view === "overallPending")'), QUERY_SERVICE.indexOf("Qua Qua's two date-driven tabs"));
  assert.match(overall, /params\.push\(today\)/, "Overall Pending is no longer bounded at today");
  assert.doesNotMatch(overall, /params\.push\(previousDay\(today\)\)/, "Overall Pending is back to leaving today's calls out");
  assert.match(clauseFor("overallPending"), /\$\{followUpDay\} <= \?/, "Overall Pending no longer carries the days before its bound");
  assert.doesNotMatch(clauseFor("overallPending"), /\$\{followUpDay\} < \?/, "Overall Pending excludes its own bound again");

  /*
   * And the half that keeps the tab honest: `follow_up_day` is NULL both when the date was never
   * filled in and when what was typed cannot be read as one. Either way the call is owed on a day
   * the board cannot name, and without this those leads sit in no pending tab and are chased by
   * nobody.
   */
  assert.match(clauseFor("overallPending"), /\$\{followUpDay\} IS NULL/, "a lead with no readable follow-up date falls through every pending tab");
});

test("Newborns and Birthdays are cut by their own calculation, and by nothing else", () => {
  /*
   * These two are not date-of-enquiry tabs and must not be moved onto one. A newborn call is due
   * around the estimated delivery date and a birthday call before the child's first birthday, both
   * read off "Date of Birth (or) EDOD" - so a lead that enquired in June is exactly the lead whose
   * window opens in September. The windows themselves are stated once, in occasionLeadService.js,
   * and `crm-lead-occasions.test.js` holds the SQL and the JavaScript halves against each other.
   */
  assert.match(QUERY_SERVICE, /if \(view === "newborns"\) return occasionWindowSql\("NEWBORN", today\);/);
  assert.match(QUERY_SERVICE, /if \(view === "birthdays"\) return occasionWindowSql\("BIRTHDAY", today\);/);

  const occasions = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "crm-leads", "occasionLeadService.js"), "utf8");
  // Both windows read the one column that holds either date, and neither reads the enquiry date.
  const windows = occasions.split("windowSql:").slice(1).map((block) => block.slice(0, block.indexOf("yearSql:")));
  assert.equal(windows.length, 2, "there are no longer exactly two occasion windows");
  for (const window of windows) {
    assert.match(window, /dob_edod_day/, "an occasion window no longer reads the date of birth / EDOD");
    assert.doesNotMatch(window, /created_date|enquiryDaySql/, "an occasion window has been moved onto the enquiry date");
  }
});

test("one tab, one clause: no view answers twice", () => {
  /*
   * Two unreachable duplicates had accumulated - a second `yetToConnect` and a second `rejected`,
   * each sitting behind the branch above it and stating a different rule. The `rejected` one read
   * the raw status column rather than `statusKey`, so had it ever been reached it would have counted
   * a Qua Qua lead at its own status while the tab beside it counted the occasion's. Two answers to
   * one tab is how they drift apart, and dead code is where the wrong one hides.
   */
  for (const view of ["all", "yetToConnect", "new", "pending", "yesterdayPending", "overallPending", "newborns", "birthdays", "converted", "rejected", "today"]) {
    const found = QUERY_SERVICE.match(new RegExp(`if \\(view === "${view}"\\)`, "g")) || [];
    assert.ok(found.length <= 1, `"${view}" is decided in ${found.length} places`);
  }
});

/* ------------------------------------------------------------ the two ends of a lead's life */

test("Yet to connect is every lead nobody has touched, whatever day it arrived", () => {
  /*
   * It is not a stored status: a lead with nothing against it reads Yet to connect, and goes on
   * reading it until somebody sets one. There is no age in the rule - `statusDisplaySql` says so,
   * `resolveLeadStatus` on the client says the same, and this tab has to ask that same question or
   * it lists a different set of rows from the label beside them.
   *
   * It used to be "nobody has touched it *and* it arrived today", with a sheet lead and an open
   * occasion exempted from the ageing. That emptied the queue overnight while the calls in it went
   * unmade, which is the one thing a worklist may not do.
   */
  const clause = QUERY_SERVICE.slice(QUERY_SERVICE.indexOf("function yetToConnectSql("), QUERY_SERVICE.indexOf("function readsYetToConnectSql("));
  /*
   * The branch calls the pair rather than the derived half alone. Both ways the label arrives, or
   * the tab lists half of what its name promises - and this tab, of all of them, is the one named
   * for the label. Today Pending was moved onto `readsYetToConnectSql` and this was left behind,
   * so an imported lead whose file said "Yet to connect" read that in the Status column, answered a
   * Status filter of Yet to connect, was counted in Today Pending, and was missing from here.
   */
  assert.match(QUERY_SERVICE, /if \(view === "yetToConnect"\) return `\$\{readsYetToConnectSql\(statusKey\)\} AND NOT \(\$\{UNASSIGNED_SQL\}\)`;/);
  /*
   * And not a lead nobody has been given, which reads **Unassigned** in the Status column rather
   * than Yet to connect and has a tab of its own. Same promise as ever - this tab lists exactly what
   * that column says - now that the column has one more thing it can say. The two are a clean split
   * and All still holds both.
   */
  assert.match(QUERY_SERVICE, /if \(view === "unassigned"\) return UNASSIGNED_SQL;/);
  // `statusKey` is the status the lead is *being worked at*: `status_key` on every board, and the
  // birthday's own status on a Qua Qua lead inside its window. Empty means nobody has connected.
  assert.match(clause, /\$\{statusKey\} = ''/, "a lead with any status set has been connected with, whatever the status is");
  // And nothing else. Each of these was a way of saying "and it has not gone stale either".
  assert.doesNotMatch(clause, /enquiryDaySql/, "Yet to connect is dated by the lead's arrival day again");
  assert.doesNotMatch(clause, /created_day/, "Yet to connect is dated by the day the row was written again");
  assert.doesNotMatch(clause, /SYNCED_FROM_SHEET_SQL/, "the sheet exemption is back, which means the ageing it exempted rows from is back");
  assert.doesNotMatch(clause, /anyOccasionWindowSql/, "the occasion exemption is back for the same reason");
  // An occasion needs no exemption now: inside its window `statusKey` *is* the occasion's status,
  // so an occasion nobody has set a status on is empty and the same clause picks it up.
  assert.match(QUERY_SERVICE, /function statusKeySql[\s\S]*?occasionColumnSql\(occasion, today, "status_key"\)/, "statusKeySql no longer reads the occasion's own status");
  // And `statusKey` really is `status_key` off the birthday board - the plain column everywhere
  // else, so this tab has not quietly changed for Dum Dum and Corp.
  assert.match(QUERY_SERVICE, /function statusKeySql[\s\S]*?"`status_key`"/, "statusKeySql no longer falls back to the lead's own status column");
});

test("Rejected matches the one spelling the Status column folds onto that label", () => {
  const clause = QUERY_SERVICE.slice(QUERY_SERVICE.indexOf('if (view === "rejected")'));
  // The same status the Status column is showing - `status_key` on most boards, the birthday's own
  // on a Qua Qua lead being worked for one. A tab filtering on a different status from the one on
  // screen is worse than either being wrong: the label is right there to be typed into the filter.
  assert.match(clause, /\$\{statusKey\} = 'rejected'/);
  // The same fold `statusDisplaySql` applies, so the tab holds exactly the rows reading Rejected.
  assert.match(QUERY_SERVICE, /WHEN 'rejected' THEN 'Rejected'/);
});

test("the three verticals open the same way, and Calls is read by the call", () => {
  const source = fs.readFileSync(BOARD, "utf8");
  const region = source.slice(source.indexOf("const BOARD_TABS"), source.indexOf("function getTabsForBoard"));
  for (const vertical of ['"Dum Dum"', "Corp", '"Qua Qua"']) {
    assert.ok(region.includes(vertical), `BOARD_TABS no longer lists ${vertical}`);
  }
  // The fourth board: every call Callyzer has delivered.
  assert.ok(region.includes("Calls:"), "BOARD_TABS no longer lists the Calls board");
  /*
   * The three verticals spread the same opening list, which is what makes "All, Yet to connect and
   * Today New Leads are on every vertical" true by construction rather than by three copies that
   * can drift apart. If that structure is ever unrolled, this test should be replaced with one that
   * checks each board's list directly.
   */
  assert.equal((region.match(/\.\.\.OPENING_TABS/g) || []).length, 3, "a vertical no longer opens with All / Yet to connect / Today New Leads");
  /*
   * Rejected closes the three verticals and only those. Turning a client down is a decision made
   * about a lead somebody owns, and it is made in the Add Lead form; the lead it writes lands in its
   * own vertical's Rejected tab. A row on the Calls board is a call, and a call cannot be rejected -
   * it already happened.
   */
  assert.equal((region.match(/REJECTED_TAB/g) || []).length, 3, "a vertical no longer ends on Rejected");
  const calls = region.slice(region.indexOf("Calls:"));
  assert.doesNotMatch(calls, /REJECTED_TAB|FOLLOWUP_TABS|OPENING_TABS/, "the Calls board should carry none of the lead tabs");
  /*
   * And Calls carries its own six, which cut the call rather than a lead's state: which way it went,
   * and whether anybody talked.
   */
  assert.match(calls, /Calls:\s*CALL_TABS/, "the Calls board no longer carries the call tabs");
  const tabs = source.slice(source.indexOf("const CALL_TABS = ["), source.indexOf("const BOARD_TABS"));
  for (const [id, label] of [
    ["all", "All"],
    ["incoming", "Incoming"],
    ["outgoing", "Outgoing"],
    ["connected", "Connected"],
    ["notConnected", "Not Connected"],
  ]) {
    assert.ok(tabs.includes(`{ id: "${id}", label: "${label}" }`), `the Calls board no longer offers ${label}`);
  }
  /*
   * And not a sixth. Never Attended was one, and every call in it was already in Incoming and in Not
   * Connected - it was those two read together rather than a cut of its own. It survives as a Status
   * value, which is the place it says something the columns do not, and the tab is gone.
   */
  assert.doesNotMatch(tabs, /neverAttended/, "Never Attended is a tab again");
});

test("the Calls tabs are readings of one list, not boxes it is sorted into", () => {
  /*
   * They overlap on purpose, and this is the one property worth pinning: a missed call is Incoming
   * and Not Connected at once, because both are true of it. Written as a partition instead -
   * Incoming meaning "answered inbound", Not Connected excluding the missed calls - the board would
   * look tidier and a missed call would be in neither, which is the one row nobody can afford to
   * lose.
   */
  const views = CALL_BOARD.slice(CALL_BOARD.indexOf("const CALL_VIEWS = {"), CALL_BOARD.indexOf("const CALL_VIEW_IDS"));
  assert.match(views, /incoming: INBOUND_SQL/);
  assert.match(CALL_BOARD, /const INBOUND_SQL = `\$\{TYPE_SQL\} IN \('incoming', 'missed', 'rejected'\)`/, "Incoming no longer holds every call the client made");
  assert.match(CALL_BOARD, /const CONNECTED_SQL = "`c`\.`duration_seconds` > 0"/);
  /*
   * ── Not Connected is the calls the studio did not answer ──
   *
   * It was `NOT (CONNECTED_SQL)` - every call of zero length, whichever way it went - which put two
   * unrelated things under one tab. A number the studio rang that did not pick up is the client
   * being unavailable; a client who rang and got no answer is the studio failing to take the call,
   * and only the second is work anybody has to do something about. The tab is read for the second,
   * so the first was noise on the list that matters most on this board.
   *
   * `NEVER_ATTENDED_SQL` is inbound by definition - Callyzer's Missed and Rejected are calls the
   * client made - so nothing outbound can reach this tab, and the overlap that matters still holds:
   * a missed call is in Incoming and in Not Connected at once.
   */
  assert.match(views, /notConnected: NEVER_ATTENDED_SQL/, "Not Connected is the length of the call again, so an unanswered outgoing call is back on the studio's queue");
  assert.match(CALL_BOARD, /const NEVER_ATTENDED_SQL = `\$\{TYPE_SQL\} IN \('missed', 'rejected'\)`/);
  // And the Status column still names that outcome, so tab and cell say one thing about a row.
  assert.match(CALL_BOARD, /WHEN \$\{NEVER_ATTENDED_SQL\} THEN 'Never Attended'/);
  assert.doesNotMatch(views, /neverAttended/, "Never Attended is a view again");
});

test("the Status column on Calls reads the same three words as the tabs", () => {
  /*
   * The filter box sits directly under the heading, so what the column prints has to be a value the
   * filter can match - and the three labels are the last three tabs' names, so somebody reading a
   * row already knows which tab it is in.
   */
  const status = CALL_BOARD.slice(CALL_BOARD.indexOf("const CALL_STATUS_SQL"), CALL_BOARD.indexOf("const CALL_DURATION_SQL"));
  for (const label of ["Connected", "Never Attended", "Not Connected"]) {
    assert.ok(status.includes(`'${label}'`), `the Calls Status column no longer prints ${label}`);
  }
  const board = fs.readFileSync(BOARD, "utf8");
  assert.match(
    board,
    /const CALL_STATUS_OPTIONS = \["Connected", "Not Connected", "Never Attended"\]/,
    "the board's Status filter no longer offers exactly what that column can print",
  );
});

test("the lead board no longer answers for Calls at all", () => {
  /*
   * `yetToConnect` used to return no clause for that board, because Calls was a slice of the lead
   * table then and that tab was the whole of it. The board is the call log now, so no request
   * reaches `viewClause` asking for Calls - and a branch no request can take, left standing, reads
   * as a rule that is still in force.
   */
  const clause = QUERY_SERVICE.slice(QUERY_SERVICE.indexOf('if (view === "yetToConnect")'), QUERY_SERVICE.indexOf('if (view === "pending")'));
  assert.doesNotMatch(clause, /if \(board === "Calls"\) return null/, "viewClause still has a Calls case that nothing can reach");
  // And the controller sends that board somewhere else entirely - both the page and "select all".
  assert.match(CONTROLLER, /if \(isCallsBoard\(parsed\.data\.board\)\) \{[\s\S]{0,200}?listCallBoardPage\(/, "the page endpoint no longer reads Calls from the call log");
  assert.match(CONTROLLER, /isCallsBoard\(parsed\.data\.board\)\s*\n\s*\? await listCallBoardIds\(/, "select all on Calls no longer resolves to Call IDs");
});

test("a column filter narrows the tab being read, and the counts beside the other tabs stand", () => {
  /*
   * The fault: the strip is counted in one pass, and the column filters used to sit in that pass's
   * shared WHERE. So typing a name into the Client Name box re-counted every tab against it - All,
   * Converted and Rejected all fell to what that one person holds, and the strip stopped answering
   * the only question a number beside a tab label is asked, which is how big that tab is.
   *
   * The filters go into the open tab's own CASE now, exactly as the date range does, so every other
   * tab is counted as it will be read.
   */
  const counts = QUERY_SERVICE.slice(
    QUERY_SERVICE.indexOf("async function crmLeadTabCounts("),
    QUERY_SERVICE.indexOf("async function crmLeadStatusCounts("),
  );

  // The shared WHERE carries the board and the scope and nothing a tab could differ on.
  assert.match(counts, /const base = buildWhere\(\{ board, view: "all", filters: \{\}, today, scope, mine \}\);/, "the counts put the column filters back in the shared WHERE");
  // ...and the open tab, named by the caller, is the one that takes them.
  assert.match(counts, /if \(view === openView\) columnFilterClauses\(\{ filters, board, today \}, filterClauses, filterParams\);/, "the counts no longer single out the open tab");
  assert.match(counts, /const clauses = \[viewSql, \.\.\.rangeClauses, \.\.\.filterClauses\]\.filter\(Boolean\);/);
  /*
   * Positional `?` in a raw query: the parameters have to be pushed in the order their clauses were
   * joined. Out of order this binds a filter's `%text%` to the tab's own placeholder, which is not
   * an error - it is a wrong number, silently.
   */
  assert.match(counts, /params\.push\(\.\.\.viewParams, \.\.\.rangeParams, \.\.\.filterParams\);/);

  // The tab the reader is on has to reach the counts at all, or every tab counts unfiltered.
  assert.match(QUERY_SERVICE, /async function crmLeadTabCounts\(\{ board = "Dum Dum", view: openView = "all",/, "the counts no longer take the open tab");
  assert.match(CONTROLLER, /crmLeadTabCounts\(\{ \.\.\.parsed\.data, scope, mine \}\)/, "the controller no longer passes `view` through to the counts");

  /*
   * And the half that makes those counts honest.
   *
   * An unfiltered count on a tab is a promise about what pressing it shows. A filter that survived
   * the press would break that promise on every tab at once: Converted reads 800 and opens on the
   * four rows the filter still standing happens to match. The board clears both halves of the
   * filter state as the tab changes - `filters` is what the boxes show, `appliedFilters` is what the
   * query ran with, and clearing only the first leaves the query 400ms behind the strip.
   */
  const board = fs.readFileSync(BOARD, "utf8");
  const tabChange = board.slice(board.indexOf("onTabChange={(tabId) => {"), board.indexOf("tabsAriaLabel=\"CRM lead filters\""));
  assert.match(tabChange, /setFilters\(NO_FILTERS\);/, "the board keeps its column filters across a tab change");
  assert.match(tabChange, /setAppliedFilters\(NO_FILTERS\);/, "the board clears the boxes but leaves the query filtered");
  /*
   * One frozen object rather than a fresh `{}` each time. `appliedFilters` is a dependency of the
   * load effect, so two empty objects are two different values - and clearing would cost a second
   * pass over the board 400ms after the first, when the debounce catches up.
   */
  assert.match(board, /const NO_FILTERS = Object\.freeze\(\{\}\);/, "clearing the filters is back to a fresh object each time");
});

/*
 * ── Unassigned: the leads nobody has been given ───────────────────────────────────────────────
 *
 * `crm` is the person a lead is assigned to, and a lead with nothing in it has been given to
 * nobody. The studio asked for that to read as a status of its own rather than hide behind a label
 * describing work somebody would have to be doing.
 *
 * It is decided in two places that must agree - the SQL here, which prints the Status column, fills
 * the tab and counts it, and `resolveLeadStatus` in the browser, which labels a row the moment it is
 * edited without waiting for the server. The pair is what these hold.
 */
test("a lead nobody has been given reads Unassigned, before anything its own status says", () => {
  // Trimmed: a cell holding a space is not a person, and those arrive from sheets and files alike.
  assert.match(QUERY_SERVICE, /const UNASSIGNED_SQL = "TRIM\(COALESCE\(`crm`, ''\)\) = ''";/);
  /*
   * First in the CASE, which is the whole of "wins over everything": a lead reading Converted with
   * nobody against it is a lead nobody owns, and printing Converted is how it stays that way.
   */
  const display = QUERY_SERVICE.slice(QUERY_SERVICE.indexOf("function statusDisplaySql("), QUERY_SERVICE.indexOf("// Column id -> the SQL"));
  const unassignedAt = display.indexOf("WHEN ${UNASSIGNED_SQL} THEN 'Unassigned'");
  assert.notEqual(unassignedAt, -1, "the Status column no longer prints Unassigned");
  assert.ok(unassignedAt < display.indexOf("${unsetStatusSql()}"), "Yet to connect is answered before Unassigned");
  assert.ok(unassignedAt < display.indexOf("WHEN 'converted' THEN"), "a stored status is answered before Unassigned");
  // Nothing is written by any of it: the status column underneath is untouched, so putting somebody
  // on the lead brings its own status straight back.
  assert.ok(!/UPDATE[\s\S]{0,120}Unassigned/.test(QUERY_SERVICE), "Unassigned is being stored rather than derived");
});

test("the browser labels an unassigned lead the same way the server does", () => {
  const board = fs.readFileSync(BOARD, "utf8");
  assert.match(board, /const isUnassignedLead = \(lead = \{\}, details = \{\}\) => !String\(lead\?\.crm \?\? details\?\.crm \?\? ""\)\.trim\(\);/);
  /*
   * Read before the occasion branch as well as before the stored status. An occasion nobody has been
   * given is no more being worked than an ordinary lead is, and a rule that checked the occasion
   * first would leave a birthday reading its own status on a lead with nobody on it.
   */
  const resolve = board.slice(board.indexOf("function resolveLeadStatus("), board.indexOf("// Attempts counted against this occasion"));
  const unassignedAt = resolve.indexOf("if (isUnassignedLead(lead, details)) return UNASSIGNED_STATUS;");
  assert.notEqual(unassignedAt, -1, "the board no longer labels an unassigned lead");
  assert.ok(unassignedAt < resolve.indexOf("isOccasionLead"), "the occasion's status is answered before Unassigned");
  assert.ok(unassignedAt < resolve.indexOf("YET_TO_CONNECT_STATUS"), "Yet to connect is answered before Unassigned");
  // Not a pill anybody can press: nothing stores the word, so offering it would be offering to set
  // a status that unsets itself the moment the lead is read back.
  const settable = board.slice(board.indexOf("const LEAD_STATUS_OPTIONS = ["), board.indexOf("function leadStatusOptionsForVertical("));
  assert.ok(!settable.includes("Unassigned"), "Unassigned is offered as a status somebody can set");
  /*
   * It is still **filterable**, and by a better route than before: the Status filter used to append
   * this label to a written-down list, and now asks the column what it holds. `crmLeadColumnValues`
   * builds that from the same `columnSql` the board displays with, so a lead reading "Unassigned"
   * offers "Unassigned" - and a board with none offers none, rather than a value no row has.
   */
  assert.match(board, /if \(isUnassignedLead\(lead, details\)\) return UNASSIGNED_STATUS;/);
});
