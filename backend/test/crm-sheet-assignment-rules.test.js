const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildAssignmentMatcher, chooseTarget } = require("../src/modules/sales/crm-leads/leadAssignmentRules");
const { validateRules } = require("../src/modules/sales/google-sheet-links/rulesStore");

/*
 * Whose lead a Google Sheet row is.
 *
 * A spreadsheet says who a lead is and almost never says whose lead it is, so every imported lead
 * arrived with an empty CRM column and somebody assigned them by hand - by reading a column the
 * sheet does carry, the page or the form or the city. These rules are that reading written down:
 * one column holding one value, and the employee whose lead it is when it does.
 *
 * Only the decision is tested here - no database, no Google. The two things that have to be right
 * are the order the rules are asked in and the order the *answers* are trusted in: a rule that can
 * overrule a manager's reassignment undoes it within two minutes, because the poller re-reads every
 * row of every sheet on that interval.
 */

const HEADERS = ["Name", "Phone Number", "Page Name", "City", "CRM"];
const target = (name, over = {}) => ({ employeeId: 7, employeeName: name, percent: 100, assignedCount: 0, position: 0, ...over });
const rule = (over = {}) => ({
  id: "r1",
  priority: 0,
  columnHeader: "Page Name",
  matchValue: "Coimbatore Weddings",
  targets: [target("Divya R")],
  ...over,
});

/* ------------------------------------------------------------------ matching a row */

test("a row whose column holds the rule's value is assigned to that employee", () => {
  const { assign } = buildAssignmentMatcher(HEADERS, [rule()]);
  assert.equal(assign(["Anu", "9876500000", "Coimbatore Weddings", "Erode", ""]).crm, "Divya R");
});

test("a row that matches nothing is assigned to nobody", () => {
  // Not to the first employee, and not to a default - an unassigned lead is visibly unassigned,
  // which is recoverable. A lead on the wrong person's list is not: they do not call it.
  const { assign } = buildAssignmentMatcher(HEADERS, [rule()]);
  assert.equal(assign(["Anu", "9876500000", "Chennai Weddings", "Erode", ""]), null);
});

test("the value is matched past case, spacing and punctuation", () => {
  /*
   * These rules are typed by hand against columns filled in by hand. A rule that fails on a hyphen
   * reads to the studio as a rule that does not work, and the next thing they do is stop using them.
   */
  const { assign } = buildAssignmentMatcher(HEADERS, [rule({ matchValue: "coimbatore-weddings" })]);
  assert.equal(assign(["Anu", "", "  COIMBATORE   WEDDINGS ", "", ""]).crm, "Divya R");
});

test("the column is found by its heading however the sheet spells it", () => {
  const { assign } = buildAssignmentMatcher(["name", "page_name"], [rule()]);
  assert.equal(assign(["Anu", "Coimbatore Weddings"]).crm, "Divya R");
});

/* ------------------------------------------------------------------ exactly, and only */

test("the value is matched whole, not as a fragment", () => {
  /*
   * There are no operators - no "contains", no "is any of", no catch-all. A rule says one column
   * holds one value, so the page "Coimbatore Weddings 2026" is not the page "Coimbatore Weddings",
   * and two values going to the same person is two rules rather than a syntax to learn.
   */
  const { assign } = buildAssignmentMatcher(HEADERS, [rule()]);
  assert.equal(assign(["", "", "Coimbatore Weddings 2026", "", ""]), null);
  assert.equal(assign(["", "", "Weddings", "", ""]), null);
  assert.equal(assign(["", "", "Coimbatore Weddings", "", ""]).crm, "Divya R");
});

test("an empty cell matches nothing, and nor does a rule with an empty value", () => {
  // A blank column is the absence of an answer rather than an answer that happens to be blank, and
  // a rule matching it would claim every row the sheet has not filled in yet.
  assert.equal(buildAssignmentMatcher(HEADERS, [rule()]).assign(["", "", "", "", ""]), null);
  const blank = buildAssignmentMatcher(HEADERS, [rule({ matchValue: "  " })]);
  assert.equal(blank.assign(["", "", "", "", ""]), null);
  assert.equal(blank.activeRules, 0);
});

/* ------------------------------------------------------------------ order and precedence */

test("the first matching rule wins and evaluation stops", () => {
  /*
   * Two rules matching one row is not an error to report - it is a question the studio answers by
   * ordering them, which is why priority is stored and editable rather than inferred.
   */
  const rules = [
    rule({ id: "second", priority: 1, targets: [target("Karthik S")] }),
    rule({ id: "first", priority: 0, targets: [target("Divya R")] }),
  ];
  assert.equal(buildAssignmentMatcher(HEADERS, rules).assign(["", "", "Coimbatore Weddings", "", ""]).crm, "Divya R");
});

test("rules sharing a priority evaluate the same way on every pass", () => {
  // Otherwise the owner a row gets depends on the order the database happened to return the rules,
  // and the same sheet assigns differently on two consecutive syncs.
  const rules = [
    rule({ id: "bbb", priority: 0, targets: [target("Karthik S")] }),
    rule({ id: "aaa", priority: 0, targets: [target("Divya R")] }),
  ];
  const row = ["", "", "Coimbatore Weddings", "", ""];
  assert.equal(buildAssignmentMatcher(HEADERS, rules).assign(row).crm, "Divya R");
  assert.equal(buildAssignmentMatcher(HEADERS, [...rules].reverse()).assign(row).crm, "Divya R");
});

/* ------------------------------------------------------------------ rules that cannot fire */

test("a rule naming a column the sheet does not have is reported, not silently dropped", () => {
  /*
   * The failure that is invisible without being told: a column renamed in the spreadsheet turns a
   * working rule into leads quietly arriving unassigned, which looks identical to having written no
   * rules at all.
   */
  const matcher = buildAssignmentMatcher(HEADERS, [rule({ columnHeader: "Form Name" })]);
  assert.equal(matcher.assign(["", "", "Coimbatore Weddings", "", ""]), null);
  assert.deepEqual(matcher.missingColumns, [{ id: "r1", columnHeader: "Form Name" }]);
});

test("a share pointing at nobody assigns nobody", () => {
  // An employee deleted since the rule was written. Writing "" would read as a deliberate
  // un-assignment rather than as a rule that has stopped working.
  const matcher = buildAssignmentMatcher(HEADERS, [rule({ targets: [target("")] })]);
  assert.equal(matcher.assign(["", "", "Coimbatore Weddings", "", ""]), null);
  assert.equal(matcher.activeRules, 0);
});

/* ------------------------------------------------------------------ what may be stored */

test("a rule missing any of its three answers is refused rather than saved", () => {
  const one = [{ employeeId: 7, percent: 100 }];
  const cases = [
    [{ columnHeader: "", matchValue: "x", targets: one }, /column/i],
    [{ columnHeader: "Page Name", matchValue: "   ", targets: one }, /value/i],
    [{ columnHeader: "Page Name", matchValue: "x", targets: [] }, /employee/i],
    [{ columnHeader: "Page Name", matchValue: "x", targets: [{ percent: 100 }] }, /employee/i],
  ];
  for (const [payload, expected] of cases) {
    const result = validateRules([payload]);
    assert.equal(result.valid, false, `${JSON.stringify(payload)} was accepted`);
    assert.match(result.issues[0], expected);
  }
});

test("the stored order is the order the rules were sent in", () => {
  const { rules } = validateRules([
    { columnHeader: "City", matchValue: "Chennai", targets: [{ employeeId: 9, percent: 100 }] },
    { columnHeader: "City", matchValue: "Erode", targets: [{ employeeId: 7, percent: 100 }] },
  ]);
  assert.deepEqual(rules.map((entry) => entry.priority), [0, 1]);
});

/* ------------------------------------------------------------------ where the answer is used */

const SERVICE = fs.readFileSync(
  path.join(__dirname, "..", "src", "modules", "sales", "crm-leads", "googleSheetsService.js"),
  "utf8",
);

test("a row that already has an owner does not spend a turn of the split", () => {
  /*
   * The rules never overrule an owner, so for such a row the answer was always going to be thrown
   * away - but asking anyway advanced the balance, and a sheet of a thousand owned leads re-read
   * every two minutes churned it a thousand times a pass. The few genuinely new rows then went to
   * whoever the churn left lowest rather than to whoever was furthest below their share.
   */
  const map = SERVICE.slice(
    SERVICE.indexOf("function mapRowToCrmCandidate("),
    SERVICE.indexOf("function normalizeEmail("),
  );
  assert.ok(map, "mapRowToCrmCandidate has been renamed; this pin no longer reads it");
  assert.match(map, /const alreadyOwned = String\(lead\.crm \|\| existing\?\.lead\?\.crm \|\| ""\)\.trim\(\)/);
  assert.match(map, /!alreadyOwned && link\?\.assignmentMatcher/, "the matcher is asked for rows that already have an owner");
});

test("a rule fills a blank owner and never replaces one", () => {
  /*
   * The order the answers are trusted in, pinned because it is the whole feature and it is one
   * line: the sheet's own CRM column, then the owner the lead already has, then the rules. A rule
   * allowed ahead of `existing` would undo every manual reassignment on the next pass - the poller
   * re-reads every row every two minutes.
   */
  assert.match(SERVICE, /crm: alreadyOwned \|\| assignment\?\.crm \|\| ""/);
});

test("a sync keeps the first few reasons a row did not import, capped", () => {
  /*
   * "6 skipped (6 invalid)" says there is something to fix and nothing about what. The reasons
   * lived only in the run's `actions`, which is thrown away, and in the import preview, which is a
   * second full read of the sheet to find them - so the panel could report a problem it could not
   * explain.
   *
   * Capped because they are stored as JSON on the link rather than as a row per problem: a sheet
   * where all 14,000 rows are invalid must not write a megabyte of identical reasons every two
   * minutes. The counts beside them stay uncapped, which is what lets the panel say "5 of 812".
   */
  const run = SERVICE.slice(
    SERVICE.indexOf("async function runGoogleSheetLinkSync("),
    SERVICE.indexOf("// Wraps the run so a failure is recorded too"),
  );
  assert.ok(run, "runGoogleSheetLinkSync has been renamed; this pin no longer reads it");
  assert.match(run, /rowProblems/, "the sync no longer keeps why a row did not import");
  assert.match(run, /rowProblems\.length >= ROW_PROBLEM_LIMIT/, "the stored reasons are no longer capped");
  /*
   * A row is no longer declined for an unreadable cell - the cell is emptied and the lead is kept -
   * so what has to be named is the **column**: "row 12 - eventPlannedDate: Invalid date value" is
   * what sends somebody to the cell that needs correcting.
   */
  assert.match(run, /noteProblem\(row\.rowNumber, `\$\{issue\.field\}: \$\{issue\.reason\}`\)/, "an emptied cell no longer says which column it was");
  assert.match(run, /noteProblem\(row\.rowNumber, reason\)/, "rows that failed to write no longer say why");
});

test("the rules are read from the link's id inside the import itself", () => {
  /*
   * Three places build a link object out of hand-written SQL - the poller's `listActiveLinks`, the
   * controller's `sync` and its `LINK_SELECT_SQL`. Rules carried on the link would have to be added
   * to all three, and the one that was missed would fail silently as leads arriving unassigned.
   * Read from the id inside `prepareGoogleSheetCrmImport`, every caller gets them for free - which
   * is what makes the two-minute auto-sync assign by the same rules as the first import.
   */
  const prepare = SERVICE.slice(
    SERVICE.indexOf("async function prepareGoogleSheetCrmImport("),
    SERVICE.indexOf("async function runGoogleSheetLinkSync("),
  );
  assert.ok(prepare, "prepareGoogleSheetCrmImport has been renamed; this pin no longer reads it");
  assert.match(prepare, /listRulesForLink\(link\?\.id\)/);
  assert.match(prepare, /buildAssignmentMatcher\(headers, assignmentRules\)/);
});

/* ------------------------------------------------------------------ sharing a rule by percentage */

const split = (...shares) => rule({
  targets: shares.map(([name, percent], position) => target(name, { employeeId: position + 1, percent, position })),
});

test("a run of leads comes out at the percentages configured", () => {
  /*
   * A lead cannot be split 60/40; only a run of them can. Each one goes to whoever is furthest
   * below their share, which lands exactly on the configured proportions rather than drifting.
   */
  const { assign } = buildAssignmentMatcher(HEADERS, [split(["Vijay", 60], ["Abi", 40])]);
  const got = Array.from({ length: 10 }, () => assign(["", "", "Coimbatore Weddings", "", ""]).crm);
  assert.equal(got.filter((name) => name === "Vijay").length, 6);
  assert.equal(got.filter((name) => name === "Abi").length, 4);
});

test("consecutive rows of one batch go to different people", () => {
  // The failure this guards: picking without counting forward hands every row of a pass to whoever
  // is listed first, and a sheet that grows a few rows at a time never splits anything.
  const { assign } = buildAssignmentMatcher(HEADERS, [split(["Vijay", 50], ["Abi", 50])]);
  const first = assign(["", "", "Coimbatore Weddings", "", ""]).crm;
  const second = assign(["", "", "Coimbatore Weddings", "", ""]).crm;
  assert.notEqual(first, second);
});

test("a split resumes from what has already been handed out", () => {
  /*
   * The counters are stored, so a pass does not start from zero. Vijay already holds 6 of a 60/40
   * split and Abi 2, so the next several are Abi's until the balance is back.
   */
  const { assign } = buildAssignmentMatcher(HEADERS, [rule({
    targets: [
      target("Vijay", { employeeId: 1, percent: 60, assignedCount: 6, position: 0 }),
      target("Abi", { employeeId: 2, percent: 40, assignedCount: 2, position: 1 }),
    ],
  })]);
  assert.equal(assign(["", "", "Coimbatore Weddings", "", ""]).crm, "Abi");
  assert.equal(assign(["", "", "Coimbatore Weddings", "", ""]).crm, "Abi");
});

test("an uneven split still lands on its proportions", () => {
  const { assign } = buildAssignmentMatcher(HEADERS, [split(["A", 70], ["B", 20], ["C", 10])]);
  const got = Array.from({ length: 100 }, () => assign(["", "", "Coimbatore Weddings", "", ""]).crm);
  assert.equal(got.filter((n) => n === "A").length, 70);
  assert.equal(got.filter((n) => n === "B").length, 20);
  assert.equal(got.filter((n) => n === "C").length, 10);
});

test("the share taken is reported, so a split does not read as an unstable rule", () => {
  const { assign } = buildAssignmentMatcher(HEADERS, [split(["Vijay", 60], ["Abi", 40])]);
  const answer = assign(["", "", "Coimbatore Weddings", "", ""]);
  assert.equal(answer.rule.percent, 60);
  assert.equal(answer.rule.targetEmployeeName, "Vijay");
});

test("a tie goes to whoever is listed first, so two passes agree", () => {
  // Otherwise the owner depends on the order the database returned the shares, and the same sheet
  // assigns differently on two consecutive syncs.
  const targets = [
    target("Abi", { employeeId: 2, percent: 50, position: 1 }),
    target("Vijay", { employeeId: 1, percent: 50, position: 0 }),
  ];
  assert.equal(chooseTarget([...targets].sort((a, b) => a.position - b.position)).crm ?? "Vijay", "Vijay");
  assert.equal(buildAssignmentMatcher(HEADERS, [rule({ targets })]).assign(["", "", "Coimbatore Weddings", "", ""]).crm, "Vijay");
});

test("shares must add to 100, and one person cannot hold two of them", () => {
  const short = validateRules([{ columnHeader: "City", matchValue: "Chennai", targets: [{ employeeId: 1, percent: 60 }, { employeeId: 2, percent: 30 }] }]);
  assert.equal(short.valid, false);
  assert.match(short.issues[0], /90%, not 100%/);

  const twice = validateRules([{ columnHeader: "City", matchValue: "Chennai", targets: [{ employeeId: 1, percent: 60 }, { employeeId: 1, percent: 40 }] }]);
  assert.equal(twice.valid, false);
  assert.match(twice.issues[0], /listed twice/i);

  const good = validateRules([{ columnHeader: "City", matchValue: "Chennai", targets: [{ employeeId: 1, percent: 60 }, { employeeId: 2, percent: 40 }] }]);
  assert.equal(good.valid, true);
  assert.deepEqual(good.rules[0].targets.map((t) => t.percent), [60, 40]);
});

test("the counters are written from the rows actually created, never from a preview", () => {
  /*
   * The allocator runs inside `prepareGoogleSheetCrmImport`, which also backs the dry-run import
   * preview. Writing as it picked would let a preview spend somebody's share without a lead being
   * imported, and would count rows that then failed to write.
   */
  const run = SERVICE.slice(
    SERVICE.indexOf("async function runGoogleSheetLinkSync("),
    SERVICE.indexOf("// Wraps the run so a failure is recorded too"),
  );
  assert.match(run, /recordAssignedCounts\(splitCounts\)/, "the split counters are no longer written after a sync");
  /*
   * A created lead is now the only written row, so it is the only one that can spend a share.
   *
   * It used to be `CREATED || UPDATED`, because a sync could give an owner to a lead that arrived
   * without one, and leaving that out let a back-fill take shares the stored balance never learned
   * about. A sync no longer touches a lead already in the CRM at all - see `sheet-sync-add-only` -
   * so that second case cannot arise, and counting it would now count a row nothing was done to.
   */
  assert.match(run, /action\.action === "CREATED"/, "the counters no longer follow the rows the rules actually assigned");
  assert.doesNotMatch(run, /action\.action === "UPDATED"/, "a sync writes no updates, so an UPDATED row cannot spend a share");
});
