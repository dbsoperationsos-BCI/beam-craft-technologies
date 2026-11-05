const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * What a lead reads as before anybody has touched it.
 *
 * "Yet to connect" is not stored: it is what a lead with no status at all reads as, and it goes on
 * reading it until somebody sets one. That is the whole rule now.
 *
 * It was not always. The label expired at the end of the lead's arrival day and the lead read
 * "Inactive" from the next morning - with exemptions added one at a time as each turned out to hide
 * calls that were still to be made: a Qua Qua lead inside an occasion window, then anything a Google
 * Sheet link had put here, after a studio linked a sheet of last week's Instagram leads and got 28
 * of 32 filed under "nobody needs to ring these". The exemptions were the rule telling on itself. A
 * lead nobody has rung is a lead nobody has rung on day two as much as on day one, so the ageing is
 * gone rather than exempted from a third way.
 *
 * The rule is written in three places and all three have to agree, or a lead is listed by one and
 * hidden by another: the Status column (`unsetStatusSql`), the Yet to connect tab (`yetToConnectSql`
 * through `readsYetToConnectSql`) and the board's own copy in the browser (`resolveLeadStatus`).
 */

const SQL = fs.readFileSync(
  path.join(__dirname, "..", "src", "modules", "sales", "crm-leads", "leadQueryService.js"),
  "utf8",
);
const BOARD = fs.readFileSync(
  path.join(__dirname, "..", "..", "frontend", "src", "components", "sales", "CRMPage.js"),
  "utf8",
);

const unsetSql = () => SQL.slice(SQL.indexOf("function unsetStatusSql("), SQL.indexOf("/**\n * The status as the Status column prints it."));
const resolveJs = () => BOARD.slice(BOARD.indexOf("function resolveLeadStatus("), BOARD.indexOf("function resolveLeadCnaSequence("));

test("the Status column reads Yet to connect for an untouched lead of any age", () => {
  const unset = unsetSql();
  assert.ok(unset, "unsetStatusSql has been renamed; this pin no longer reads it");
  assert.match(unset, /return "'Yet to connect'";/, "the unset case answers something other than Yet to connect");
  // Nothing in it may depend on a day, a source or a board - each of those is an expiry in disguise.
  assert.doesNotMatch(unset, /enquiryDaySql|created_day|todayKey|CURDATE/, "the label expires on a date again");
  assert.doesNotMatch(unset, /spreadsheet_id|SYNCED_FROM_SHEET/, "a source is being exempted from an expiry that should not exist");
});

test("the Yet to connect tab lists exactly what the Status column calls Yet to connect", () => {
  /*
   * The two are one rule asked twice - as a value and as a question - and drift between them is
   * visible as a tab that hides rows whose pill reads Yet to connect.
   */
  const tab = SQL.slice(SQL.indexOf("function yetToConnectSql("), SQL.indexOf("* Tab definitions"));
  assert.match(tab, /return `\$\{statusKey\} = ''`;/, "the derived half of the tab is no longer 'nobody has set a status'");
  assert.doesNotMatch(tab, /enquiryDaySql|SYNCED_FROM_SHEET_SQL/, "the tab is dated or exempted again, and the column is not");
  // Both ways the label arrives. An import whose own Status column said "Yet to connect" stores the
  // words, and `statusDisplaySql` prints stored text untouched - so the tab has to hold those too.
  assert.match(tab, /= 'yettoconnect'/, "a lead that stores the words is no longer recognised");
  assert.match(
    SQL,
    /if \(view === "yetToConnect"\) return `\$\{readsYetToConnectSql\(statusKey\)\} AND NOT \(\$\{UNASSIGNED_SQL\}\)`;/,
    "the tab reads only one of the two ways in",
  );
  /*
   * The one subtraction, and it keeps the promise rather than breaking it: a lead nobody has been
   * given reads **Unassigned** in the Status column now, not Yet to connect, and has a tab of its
   * own. So the rows it no longer lists are exactly the rows that stopped reading its label - which
   * is what this test is about - and All still holds both.
   */
  assert.match(SQL, /WHEN \$\{UNASSIGNED_SQL\} THEN 'Unassigned'/, "the Status column no longer says Unassigned, so the tab must not subtract it");
});

test("a status the lead actually holds still wins, on both sides", () => {
  // The stored status is returned before either expression is reached, which is what makes an empty
  // Status column the only thing these rules ever answer for.
  const resolve = resolveJs();
  assert.match(resolve, /const stored = String\([\s\S]*?\)\.trim\(\);\n  return stored \|\| YET_TO_CONNECT_STATUS;/, "the board no longer prefers a stored status");
  assert.match(SQL, /WHEN \$\{statusKeySql\(board, today\)\} = '' THEN \$\{unsetStatusSql\(\)\}/, "the SQL no longer answers the unset case only");
});

test("the browser's copy of the rule agrees with the SQL", () => {
  const resolve = resolveJs();
  assert.match(resolve, /return stored \|\| YET_TO_CONNECT_STATUS;/, "the board disagrees with the server about an untouched lead");
  assert.doesNotMatch(resolve, /INACTIVE_STATUS/, "the board still ages a lead into Inactive, disagreeing with the server");
  assert.doesNotMatch(resolve, /isSyncedFromSheet|leadArrivalDay/, "the board is exempting or dating leads the server no longer does");
});

test("Inactive is a word a lead can store, and nothing this application decides", () => {
  /*
   * The consequence of the change, pinned so it is a decision rather than a side effect: no
   * expression derives Inactive any more. It is still shown, and still filtered for, when a row
   * genuinely carries it - which is what an import writes when the file's own Status column said so.
   */
  assert.doesNotMatch(unsetSql(), /Inactive/, "something derives Inactive again");
  assert.match(BOARD, /if \(status === "inactive"\) return INACTIVE_STATUS;/, "a stored 'inactive' is no longer folded onto the label");
  /*
   * Still filterable, by a better route: the Status filter used to append this to a written-down
   * list, and now asks the column what it holds - built from the same `columnSql` the board
   * displays with, so a row storing "inactive" offers "Inactive" and a board with none offers none.
   */
  assert.match(BOARD, /if \(status === "inactive"\) return INACTIVE_STATUS;/, "a stored 'inactive' is no longer folded onto the label");
});
