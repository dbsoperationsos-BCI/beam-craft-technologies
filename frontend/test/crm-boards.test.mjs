import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { CALLS_BOARD, CALLS_BOARD_LABEL, boardOptions, isCallRecord, isUnassignedCall } from "../src/lib/crmBoards.js";
import { verticalOptions, resolveVertical } from "../src/lib/crmOptions.js";

/*
 * What a row on the fourth board is, and what a double click on it does.
 *
 * The CRM is read through four boards. Three are the studio's verticals and they are the lead
 * table; the fourth is Calls, and it is the queue of callers nobody has added yet - one row per
 * call, each under a Call ID of its own, and off the board the moment its caller is given a
 * vertical.
 *
 * Two things have to be exact:
 *
 *   * the rule below decides what a row there may do, and on the Calls board it always says the
 *     same thing: open the Add Lead form on what the call knows, because being read and given a
 *     vertical is the only thing left to do to it. A row that answered otherwise would ask the
 *     server for a lead named by a Call ID, which is nothing at all.
 *   * Calls must not leak into `verticalOptions`, which is the studio's three verticals and is read
 *     as exactly that by the Meetings table and by the lead form's Vertical radio. Offered there,
 *     it becomes a vertical somebody can assign a lead to.
 */

const call = (overrides = {}) => ({ id: "DBS-CLID-000001", name: "Anitha", phone: "9876543210", source: "Callyzer", vertical: "", ...overrides });

test("a call nobody has added is a Callyzer record with no vertical on it", () => {
  assert.equal(isUnassignedCall(call()), true);

  /*
   * And `enquiryId` is emphatically not the test.
   *
   * On a call row that field is the Call ID the Enquiry ID *column* shows - the only kind of code
   * this board ever shows - so reading it here would make every call look as though it had already
   * been added, and double-clicking one would go looking for a lead named `DBS-CLID-000004`.
   */
  assert.equal(isUnassignedCall(call({ enquiryId: "DBS-CLID-000004" })), true);

  // Placed, so it is a lead on its vertical and not a row on this board at all.
  assert.equal(isUnassignedCall(call({ vertical: "Qua Qua" })), false);
  assert.equal(isCallRecord(call({ vertical: "Qua Qua" })), false);

  // Not a call at all. A sheet import or a typed lead with a blank vertical still reads as Dum Dum,
  // exactly as it always has - this rule is about calls, not about every record with an empty
  // column.
  assert.equal(isUnassignedCall(call({ source: "Google Sheet" })), false);
  assert.equal(isUnassignedCall(call({ source: "" })), false);
  assert.equal(isUnassignedCall({ id: "DBS-EID-DD-ERD-000002" }), false);
});

test("a leftover Callyzer lead from before the change still reads as a call to be added", () => {
  // Until `retireCallyzerCallLeads.js` has been run these are still on this board, and they still
  // have to open the Add Lead form rather than a popup for a lead nobody ever gave a vertical.
  const legacy = { id: "DBS-EID-DD-ERD-000009", source: "Callyzer", vertical: "" };
  assert.equal(isUnassignedCall(legacy), true);
  assert.equal(isCallRecord(legacy), true);
});

test("the source is read the way the SQL reads it: trimmed, and case does not matter", () => {
  // `callToRecord` writes "Callyzer"; the lead board's own clause lowercases and trims before
  // comparing, so this has to as well or the two disagree about the same row.
  for (const source of ["Callyzer", "callyzer", "CALLYZER", "  Callyzer  "]) {
    assert.equal(isUnassignedCall(call({ source })), true, `${JSON.stringify(source)} should read as Callyzer`);
  }
  // And a vertical of nothing but whitespace is no vertical.
  assert.equal(isUnassignedCall(call({ vertical: "   " })), true);
});

test("the details win over the lead, the way every other field on this record does", () => {
  // A record arrives in two halves and the details are the fresher of them.
  assert.equal(isUnassignedCall({ source: "Callyzer", vertical: "" }, { vertical: "Corp" }), false);
  assert.equal(isUnassignedCall({ vertical: "" }, { source: "Callyzer" }), true);
});

test("this is deliberately not resolveVertical, which cannot answer the question at all", () => {
  /*
   * `resolveVertical` folds anything it does not recognise onto Dum Dum - documented, and right for
   * the table cell that has to name a vertical. It is exactly why this rule exists separately: run
   * a call through it and the fact the Calls board turns on is gone.
   */
  assert.equal(resolveVertical(""), "Dum Dum");
  assert.equal(resolveVertical("Callyzer"), "Dum Dum");
});

test("the board is spelled the way CRMPage's own maps key it", () => {
  /*
   * `boardTableColumns`, `CRM_TABLES` and `BOARD_TABS` key their Calls entry with the literal
   * word rather than with this constant, so those maps stay plain object literals - the CSV
   * template checks in backend/test read them as text, and a computed key made them silently
   * attribute Calls' columns to Corp. Pinned here so the two spellings cannot drift apart.
   */
  assert.equal(CALLS_BOARD, "Calls");
  const source = fs.readFileSync(
    path.join(import.meta.dirname, "..", "src", "components", "sales", "CRMPage.js"),
    "utf8",
  );
  for (const map of ["const boardTableColumns = {", "const CRM_TABLES = {", "const BOARD_TABS = {"]) {
    const start = source.indexOf(map);
    assert.notEqual(start, -1, `${map} was not found in CRMPage.js`);
    const block = source.slice(start, source.indexOf("\n};", start));
    assert.match(block, /^ {2}Calls: /m, `${map} no longer has a literal Calls key`);
  }
});

test("Calls is offered as a board and never as a vertical", () => {
  const values = boardOptions.map((option) => option.value);
  assert.deepEqual(values, ["Dum Dum", "Qua Qua", "Corp", CALLS_BOARD]);
  // The three verticals are untouched, in the order they have always been offered in.
  assert.deepEqual(boardOptions.slice(0, 3), verticalOptions);
  // And the vertical list itself has not grown a fourth entry: the lead form's Vertical radio and
  // the Meetings table's Verticals filter both read it, and a lead cannot be assigned to "Calls".
  assert.equal(verticalOptions.some((option) => option.value === CALLS_BOARD), false);
});

test("the Calls board is called Call Box on screen, and the value it is keyed by is not", () => {
  /*
   * Two halves of one board and they must not be confused. The **value** is `Calls`: it keys
   * `CRM_TABLES`, `BOARD_TABS` and `boardTableColumns` above, and it is the `board` parameter the
   * page endpoint takes, which the backend compares against its own spelled-out `"Calls"`. Renaming
   * that to change a heading would be renaming a wire format.
   *
   * The **label** is what was actually asked for, and it is the only half a reader ever sees.
   */
  assert.equal(CALLS_BOARD_LABEL, "Call Box");
  assert.equal(boardOptions.at(-1).value, CALLS_BOARD);
  assert.equal(boardOptions.at(-1).label, CALLS_BOARD_LABEL);
});

test("the board switch is drawn in the studio's order rather than alphabetised", () => {
  /*
   * `Dropdown` sorts its options by label unless told not to, which is right for the pickers that
   * are a list of names and wrong here: alphabetised, the switch read Call Box, Corp, Dum Dum, Qua
   * Qua - the queue that feeds the three verticals above all of them, and the vertical most of the
   * studio works every day third. The order in `boardOptions` is the list's meaning, so the control
   * has to be the one case `sorted={false}` exists for.
   */
  const source = fs.readFileSync(
    path.join(import.meta.dirname, "..", "src", "components", "sales", "CRMPage.js"),
    "utf8",
  );
  const start = source.indexOf('ariaLabel="CRM board"');
  assert.notEqual(start, -1, "the board switch is no longer labelled CRM board");
  const control = source.slice(start, source.indexOf("/>", start));
  assert.match(control, /options=\{boardOptions\}/);
  assert.match(control, /sorted=\{false\}/, "the board switch alphabetises itself again");
});

test("a leftover call lead is still on exactly one board", () => {
  /*
   * `CALLS_SQL` no longer decides what this board shows - the call log does - but it has one job
   * left and it is not optional: Dum Dum is defined as everything *except* it. Until
   * `retireCallyzerCallLeads.js` has been run, leads the old webhook created are still in the table
   * with a blank vertical, and a blank vertical reads as Dum Dum. Drop the exclusion and every one
   * of them appears in the wedding board.
   *
   * Read out of the server's own source rather than restated here, because a copy of the clause in
   * this file would go on passing after the clause changed.
   */
  const sql = fs.readFileSync(
    path.join(import.meta.dirname, "..", "..", "backend", "src", "modules", "sales", "crm-leads", "leadQueryService.js"),
    "utf8",
  );
  const calls = sql.match(/const CALLS_SQL = "([^"]+)"/);
  assert.ok(calls, "leadQueryService.js no longer has a CALLS_SQL");
  assert.match(calls[1], /TRIM\(COALESCE\(`vertical`,''\)\) = ''/);
  assert.match(calls[1], /LOWER\(TRIM\(COALESCE\(`source`,''\)\)\) = 'callyzer'/);
  // Nothing else: the assigned branch, the group name and the rest are not part of the question.
  assert.doesNotMatch(calls[1], /assigned_branch|group_name|branch_id/);
  assert.equal([...calls[1].matchAll(/`(\w+)`/g)].map((match) => match[1]).filter((column, index, all) => all.indexOf(column) === index).sort().join(","), "source,vertical", "the Calls test reads two columns and no others");
  assert.match(sql, /"Dum Dum": `\(NOT \$\{CALLS_SQL\}/);
});

test("the board reads its rows from the call log, not from the lead table", () => {
  /*
   * The one structural fact worth pinning from this side. The board sends `board=Calls` to the same
   * endpoint every other board uses and gets the same record shape back - which is what lets the
   * table, the filters, the sorting and the infinite scroll be the ones the verticals use - so
   * nothing on screen says which store answered. This does.
   */
  const service = fs.readFileSync(
    path.join(import.meta.dirname, "..", "..", "backend", "src", "modules", "sales", "crm-leads", "callBoardService.js"),
    "utf8",
  );
  assert.match(service, /FROM \\`sales_crm_call_log\\`/, "the Calls board no longer reads the call log");
  // And every row of it carries the two facts the rule at the top of this file turns on.
  const record = service.slice(service.indexOf("function callToRecord"), service.indexOf("const SELECT_COLUMNS"));
  assert.match(record, /source: "Callyzer"/);
  assert.match(record, /vertical: "",/);

  /*
   * The Enquiry ID column is the Call ID and has nothing to fall back to.
   *
   * A lead's id never appears on this board: a call whose caller has been added is not on it. One
   * format per board, so the code on screen says which board you are reading.
   */
  assert.match(
    service,
    /enquiryId: "COALESCE\(NULLIF\(`c`\.`call_id`, ''\), `c`\.`id`\)"/,
    "the Enquiry ID column on Calls must be the call's own code and nothing else",
  );
  assert.ok(!service.includes("LEFT JOIN `sales_crm_lead`"), "a lead has no part in what this board lists");

  /*
   * And what keeps a row here is that nobody has added its caller.
   *
   * Applied in `buildCallWhere`, which every read of this board goes through - the page, the total,
   * the select-all ids and the tab counts - so a query added later cannot forget it and quietly
   * list back the callers the studio has already dealt with.
   */
  assert.match(service, /const UNPLACED_SQL = `NOT \$\{callerIsALeadSql\}`/);
  assert.match(service, /const clauses = \[UNPLACED_SQL\];/);
});

test("every board's own tabs can actually be selected", () => {
  /*
   * The remembered tab is read back through a list of the ids the page accepts, and `useStickyTab`
   * answers the fallback for anything not on it. That list was `getTabsForBoard("Dum Dum")` - the
   * default board's tabs, and only ever those - so the tabs no other board shares could be clicked,
   * stored, and then handed straight back as "all": Incoming, Outgoing, Connected and Not Connected
   * on Calls, and Newborns and Birthdays on Qua Qua, could not be switched to at all.
   *
   * The rule, checked over `BOARD_TABS` itself rather than over a list restated here: the ids the
   * page accepts come from the board on screen, so every tab a board offers is one it can be put on.
   * A board added with a tab id of its own is covered the moment it is written.
   */
  const source = fs.readFileSync(
    path.join(import.meta.dirname, "..", "src", "components", "sales", "CRMPage.js"),
    "utf8",
  );

  const sticky = source.match(/useStickyTab\("crm",\s*"([^"]+)",\s*([A-Za-z0-9_]+)\)/);
  assert.ok(sticky, "CRMPage no longer takes its remembered CRM tab from useStickyTab");
  const [, fallback, validList] = sticky;

  // The list is a name computed from the board, not a lookup pinned to one board's tabs.
  assert.doesNotMatch(
    source,
    /useStickyTab\("crm",[^)]*getTabsForBoard\(\s*"/,
    "the accepted tab ids are pinned to a named board again, which hides every other board's tabs",
  );
  const derived = new RegExp(`const ${validList} = useMemo\\(\\(\\) => getTabsForBoard\\(board\\)`);
  assert.match(source, derived, `${validList} is no longer derived from the board on screen`);

  // Every tab of every board, read out of BOARD_TABS and the arrays it spreads in.
  const groups = Object.fromEntries(
    [...source.matchAll(/const (OPENING_TABS|FOLLOWUP_TABS|CALL_TABS) = \[([\s\S]*?)\n\];/g)]
      .map(([, name, body]) => [name, [...body.matchAll(/id: "([^"]+)"/g)].map((match) => match[1])]),
  );
  assert.ok(groups.CALL_TABS?.length, "CALL_TABS was not found in CRMPage.js");
  const rejected = source.match(/const REJECTED_TAB = \{ id: "([^"]+)"/);
  assert.ok(rejected, "REJECTED_TAB was not found in CRMPage.js");

  const boardTabs = source.slice(source.indexOf("const BOARD_TABS = {"), source.indexOf("\n};", source.indexOf("const BOARD_TABS = {")));
  const ids = new Set();
  for (const [, name] of boardTabs.matchAll(/\.\.\.(OPENING_TABS|FOLLOWUP_TABS|CALL_TABS)\b/g)) for (const id of groups[name]) ids.add(id);
  for (const [, name, index] of boardTabs.matchAll(/\b(FOLLOWUP_TABS)\[(\d+)\]/g)) ids.add(groups[name][Number(index)]);
  for (const [, id] of boardTabs.matchAll(/id: "([^"]+)"/g)) ids.add(id);
  if (/REJECTED_TAB/.test(boardTabs)) ids.add(rejected[1]);
  if (/Calls: CALL_TABS/.test(boardTabs)) for (const id of groups.CALL_TABS) ids.add(id);

  // The four the bug hid, named outright: they are the reason this test exists.
  for (const id of ["incoming", "outgoing", "connected", "notConnected", "newborns", "birthdays"]) {
    assert.ok(ids.has(id), `${id} is no longer a tab any board offers`);
  }
  // And the fallback is a tab too, or a board with no remembered tab opens on nothing.
  assert.ok(ids.has(fallback), `the fallback tab "${fallback}" is not a tab any board offers`);
});
