const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * The header's date range, as the two stores answer it.
 *
 * The client resolves "This Week" into a pair of `YYYY-MM-DD` keys and sends those rather than the
 * word, so the two halves of the application cannot disagree about when a week begins - see
 * frontend/src/lib/crmDateRange.mjs, which is where that rule is tested. What is worth pinning here
 * is the other half: that the range reaches every query the board makes, that it is compared against
 * the same day the Date column shows, and that nothing about it is built from caller text.
 */

const MODULE = path.join(__dirname, "..", "src", "modules", "sales", "crm-leads");
const read = (name) => fs.readFileSync(path.join(MODULE, name), "utf8");
const LEADS = read("leadQueryService.js");
const CALLS = read("callBoardService.js");
const CONTROLLER = read("controller.js");

test("only a day is accepted, and an empty end is no limit rather than a bad request", () => {
  /*
   * The pattern allows the empty string itself rather than leaning on `.optional()`, because a
   * `.default("")` that the inner schema would reject is a 400 that blanks the whole board - and a
   * board that goes blank when a filter is cleared is worse than one that never filtered.
   */
  assert.match(CONTROLLER, /dateFrom: z\.string\(\)\.trim\(\)\.regex\(\/\^\(\\d\{4\}-\\d\{2\}-\\d\{2\}\)\?\$\/\)\.default\(""\)/);
  assert.match(CONTROLLER, /dateTo: z\.string\(\)\.trim\(\)\.regex\(\/\^\(\\d\{4\}-\\d\{2\}-\\d\{2\}\)\?\$\/\)\.default\(""\)/);
});

test("both stores check the shape again before writing it into SQL", () => {
  /*
   * Belt and braces, and worth having: these two functions are reachable from the AI tools and the
   * dashboard as well as from the validated endpoint, and a range is the one filter here that is
   * compared rather than bound as a `LIKE` parameter. Anything not shaped like a day is dropped, so
   * there is no input that becomes SQL.
   */
  for (const [name, source] of [["the lead board", LEADS], ["the Call Box", CALLS]]) {
    assert.match(
      source,
      /const day = \(value\) => \(\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(String\(value \|\| ""\)\.slice\(0, 10\)\) \? String\(value\)\.slice\(0, 10\) : ""\);/,
      `${name} no longer checks the shape of a range end`,
    );
  }
  // And the days themselves are always bound, never interpolated. The column expression beside them
  // is built from the source, not from anything a caller sent.
  assert.match(LEADS, /clauses\.push\(`\$\{enquiryDaySql\(\)\} >= \?`\); params\.push\(from\);/);
  assert.match(LEADS, /clauses\.push\(`\$\{enquiryDaySql\(\)\} <= \?`\); params\.push\(to\);/);
});

test("every tab and the range read one day: the lead's own Enquiry Date", () => {
  /*
   * The single rule this board is filed by, and the one thing worth pinning about it.
   *
   * There used to be two readings of "when did this lead arrive". `created_day` - a STORED, indexed
   * generated column, `created_date` falling back to the row's own insert timestamp - is the day the
   * *row was written*, and the header's range compared it because only an indexed column can carry
   * an open-ended range cheaply. The Enquiry Date the column shows is a different question: it
   * prefers the enquiry's own `date` when the source supplied one, which for an imported or synced
   * lead is not the day it was written. They were held apart on purpose and never asked together.
   *
   * That is no longer the design. A studio importing a year of old enquiries had every one of them
   * written today, so the whole file landed in Today New Leads, in Yet to connect, and inside any
   * range covering today, whatever the enquiries' own dates said. Every tab, the Status pill's
   * Yet to connect / Inactive derivation and the header's range now read `enquiryDaySql()` - the one
   * expression - so a lead is filed under the date it shows and the board cannot disagree with
   * itself. The cost is a function per row where the range used to hit an index; see the note on
   * `dateRangeClauses`, which names the generated column that would buy it back.
   */
  assert.match(LEADS, /function enquiryDaySql\(\) \{\s*return isoDayOf\(COLUMN_SQL\.enquiryDate\);/);
  assert.match(LEADS, /enquiryDate: "COALESCE\(NULLIF\(`date`,''\), NULLIF\(`created_date`,''\), DATE_FORMAT\(`created_at`, '%Y-%m-%d'\)\)"/);

  // The range.
  assert.match(LEADS, /function dateRangeClauses\(/);
  const range = LEADS.slice(LEADS.indexOf("function dateRangeClauses("), LEADS.indexOf("function buildWhere("));
  assert.match(range, /\$\{enquiryDaySql\(\)\} >= \?/, "the header's range no longer reads the Enquiry Date");
  assert.doesNotMatch(range, /created_day/, "the range is back on the day the row was written");

  // Today New Leads.
  const newTab = LEADS.match(/if \(view === "new"\)[\s\S]*?\n    return ([^\n]+)\n/);
  assert.ok(newTab, "the New tab no longer returns a clause of its own");
  assert.match(newTab[1], /\$\{enquiryDaySql\(\)\} = \?/, "Today New Leads no longer compares the Enquiry Date its column shows");

  /*
   * Yet to connect, which is the Status derivation asked as a question and has to answer the same
   * thing it does - otherwise the tab lists leads whose pill says something else.
   *
   * Neither carries a date any anymore. A lead with no status reads Yet to connect for as long as it
   * has none, so the derivation is a constant and the tab is one comparison on the status the lead
   * is being worked at. This test stays because the *range* still must not reach either of them:
   * the header's dates narrow the tabs that are about a date, and this is no longer one of them.
   */
  const yetToConnect = LEADS.slice(LEADS.indexOf("function yetToConnectSql("), LEADS.indexOf("function viewClause("));
  assert.match(yetToConnect, /\$\{statusKey\} = ''/);
  assert.doesNotMatch(yetToConnect, /enquiryDaySql|created_day/, "Yet to connect is dated by an arrival day again");

  // ...and the derivation itself, which now answers one thing whatever the day.
  const unset = LEADS.slice(LEADS.indexOf("function unsetStatusSql("), LEADS.indexOf("/**\n * The status as the Status column prints it."));
  assert.match(unset, /return "'Yet to connect'";/);
  assert.doesNotMatch(unset, /CURDATE\(\)|todayKey/, "the Status pill is back on a clock");

  // One tab, one rule: a second `yetToConnect` branch once sat unreachable behind the first, stating
  // a different one. Two answers to one tab is how they drift apart.
  assert.equal(LEADS.match(/if \(view === "yetToConnect"\)/g).length, 1, "there is more than one Yet to connect clause again");

  // The range is still not offered on a tab that is already a date - two answers to one question.
  assert.match(LEADS, /const DATED_VIEWS = new Set\(\["new",/, "the range is now offered on a tab that is already a date");
});

test("a tab is counted the way it is read", () => {
  /*
   * The fault this is here for, and it is the one anybody actually meets: the strip above the board
   * is counted in one pass, and the range used to be applied to that whole pass. So with a range
   * chosen on All, the Call Box's Incoming tab read "2" on the strip - and showed 6 rows the moment
   * it was opened, because the tab itself does not carry the range. The number beside a tab's name
   * is a promise about what pressing it will show.
   *
   * The range goes inside each tab's own CASE now, on exactly the tabs that carry it. Which those
   * are is `showsDateRange` on the client, mirrored here so the count and the page agree - the
   * mirroring is what the next test holds together.
   */
  assert.match(LEADS, /const DATED_VIEWS = new Set\(\["new", "pending", "yesterdayPending"\]\);/);
  assert.match(LEADS, /const viewCarriesDateRange = \(view\) => !DATED_VIEWS\.has\(String\(view \|\| ""\)\);/);
  assert.match(CALLS, /const callViewCarriesDateRange = \(view\) => String\(view \|\| ""\) === "all";/);

  // The page drops the range on a tab that does not carry it, so the tab shows what its count said.
  assert.match(LEADS, /if \(viewCarriesDateRange\(view\)\) dateRangeClauses\(\{ dateFrom, dateTo \}, clauses, params\);/);
  assert.match(CALLS, /if \(callViewCarriesDateRange\(view\)\) callDateRangeClauses\(\{ dateFrom, dateTo \}, clauses, params\);/);

  /*
   * And the counts build the range into each CASE rather than into the shared WHERE - which is what
   * makes the two agree tab by tab rather than only on the tab that happens to be open.
   */
  const leadCounts = LEADS.slice(LEADS.indexOf("async function crmLeadTabCounts("), LEADS.indexOf("async function crmLeadStatusCounts("));
  // `filters: {}` rather than `filters` for the same reason the range left: the column filters are
  // the open tab's business alone now, and are built into that one tab's CASE. See crm-lead-tabs.
  assert.match(leadCounts, /const base = buildWhere\(\{ board, view: "all", filters: \{\}, today, scope, mine \}\);/, "the counts put the range back in the shared WHERE");
  assert.match(leadCounts, /if \(viewCarriesDateRange\(view\)\) dateRangeClauses\(\{ dateFrom, dateTo \}, rangeClauses, rangeParams\);/);
  // The parameters follow the order the clauses were joined in, or the query binds them to the
  // wrong placeholders - which is silent, and answers with the wrong rows rather than an error.
  assert.match(leadCounts, /params\.push\(\.\.\.viewParams, \.\.\.rangeParams, \.\.\.filterParams\);/);

  const callCounts = CALLS.slice(CALLS.indexOf("async function callBoardTabCounts("));
  assert.match(callCounts, /const \{ where, params \} = buildCallWhere\(\{ view: "all", filters \}\);/, "the counts put the range back in the shared WHERE");
  assert.match(callCounts, /if \(callViewCarriesDateRange\(view\)\) callDateRangeClauses\(\{ dateFrom, dateTo \}, rangeClauses, countParams\);/);
  // The SELECT's own parameters come first, because the SELECT comes first.
  assert.match(callCounts, /\.\.\.countParams,\s*\n\s*\.\.\.params,/);
});

test("both halves agree about which tabs carry the range", () => {
  /*
   * Two copies of one rule, and they have to stay one rule: the client decides whether to *offer*
   * the switch and the server decides whether to *apply* it, so a tab the client hides it on and the
   * server still narrows is a board filtered by something with no control on screen to clear it -
   * and the reverse is the count-versus-rows fault above, back again.
   */
  const rule = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", "lib", "crmDateRange.mjs"), "utf8");
  assert.match(rule, /const DATED_TABS = new Set\(\["new", "pending", "yesterdayPending"\]\);/, "the client's dated tabs have moved; the server mirrors them");
  assert.match(rule, /const CALLS_RANGE_TAB = "all";/, "the Call Box's one ranged tab has moved; the server mirrors it");
});

test("the range reaches the page, the ids and the counts alike", () => {
  /*
   * Three queries, one range. A count taken over the whole board beside a page taken over a month is
   * a tab label promising rows the tab will not show; an id list resolved without it would hand a
   * bulk action every lead the tab has ever held rather than the ones on screen.
   */
  for (const [name, source, entries] of [
    ["the lead board", LEADS, ["listCrmLeadsPage", "listCrmLeadIds", "crmLeadTabCounts"]],
    ["the Call Box", CALLS, ["listCallBoardPage", "listCallBoardIds", "callBoardTabCounts"]],
  ]) {
    for (const entry of entries) {
      const start = source.indexOf(`function ${entry}(`);
      assert.notEqual(start, -1, `${entry} was not found`);
      const body = source.slice(start, start + 1400);
      assert.match(body, /dateFrom/, `${name}: ${entry} does not take the range`);
      assert.match(body, /dateTo/, `${name}: ${entry} does not take the range`);
    }
  }
  // The client sends them on the ids request too, or "select all" would cover rows it is not showing.
  const page = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", "components", "sales", "CRMPage.js"), "utf8");
  const ids = page.slice(page.indexOf("const resolveSelectedIds"), page.indexOf("/api/sales/crm-leads/ids"));
  assert.match(ids, /\.\.\.\(dateFrom \? \{ dateFrom \} : \{\}\)/, "select all resolves ids without the range the board is read over");
});

test("the Call Box compares the day its own Date column shows", () => {
  /*
   * `call_date` where Callyzer sent one, the delivery timestamp where it did not - the same
   * expression the Call Date column is drawn from, so the range and the column cannot disagree about
   * which day a call belongs to. That is a computed comparison rather than an indexed one, which is
   * affordable here in a way the same thing would not be on the lead table: this board is the queue
   * of calls whose caller nobody has added yet, never the whole history of the phone.
   */
  const clauses = CALLS.slice(CALLS.indexOf("function callDateRangeClauses("), CALLS.indexOf("function buildCallWhere("));
  assert.match(clauses, /\$\{CALL_COLUMN_SQL\.enquiryDate\} >= \?/);
  assert.match(clauses, /\$\{CALL_COLUMN_SQL\.enquiryDate\} <= \?/);
  // And it goes through `buildCallWhere`, which is where the queue clause lives - so no read of this
  // board can apply a range and forget that it is a queue.
  assert.match(CALLS, /const clauses = \[UNPLACED_SQL\];[\s\S]{0,400}?callDateRangeClauses\(\{ dateFrom, dateTo \}, clauses, params\);/);
});
