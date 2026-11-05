const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * "My Leads", the board's own switch: on it shows only this reader's leads, off it shows everything
 * they may see.
 *
 * The control is named for what turning it on does, which is how the studio asks the question - and
 * the query underneath is still asked the other way round, as `mine`. `showingAllLeads` is the one
 * place the two meet, which is exactly why the reads are pinned to it below rather than to the
 * switch: two inversions at two call sites is how a board ends up showing the opposite of its own
 * control.
 *
 * ── Why this can be offered to everybody ─────────────────────────────────────────────────────
 *
 * Because it can only ever take rows away. The data scope has already decided what this login may
 * see at all - their own work and their team's, or everything for a Super Admin - and this is ANDed
 * with that answer, never ORed into it. So the worst a fault here can do is show somebody too few
 * of their own leads, which is visible and harmless; it cannot show them somebody else's.
 *
 * That is the property this file is really about, and every test below is a way of checking it is
 * still true: the clause narrows, the ids come from the signed-in account rather than the request,
 * and it reaches every read the board makes rather than some of them.
 */

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", "src", ...parts), "utf8");
const QUERY = read("modules", "sales", "crm-leads", "leadQueryService.js");
const CONTROLLER = read("modules", "sales", "crm-leads", "controller.js");
const SCOPE = read("services", "dataScope.service.js");

/** One top-level declaration, from its opening line to the line that closes it. */
function declaration(source, opening, closing) {
  const start = source.indexOf(opening);
  assert.notEqual(start, -1, `${opening} was not found`);
  const end = source.indexOf(closing, start);
  assert.notEqual(end, -1, `the end of ${opening} was not found`);
  return source.slice(start, end + closing.length);
}

const mineClause = new Function(
  `${declaration(QUERY, "function mineClause(mine)", "\n}")}\nreturn mineClause;`,
)();

test("off, it narrows nothing at all", () => {
  // The switch on is the board as it has always been: the scope's answer, untouched.
  assert.equal(mineClause(null), null);
  assert.equal(mineClause(undefined), null);
});

test("on, it matches the CRM column and nothing else", () => {
  /*
   * It used to be `owner_employee_id` **or** `created_by_user_id` - the login that typed the lead
   * in - and that is the wrong question. Somebody adding a lead on a colleague's behalf, which is
   * most of how leads arrive here, then saw it under My Leads while the person actually working it
   * saw it too: a board meant to answer "what is on me today" answering with other people's work.
   *
   * Whoever is named as CRM owns the lead, and nobody else's My Leads shows it.
   */
  const { clause, params } = mineClause({ employeeId: 7, userId: 42 });
  assert.equal(clause, "`owner_employee_id` = ?", "a lead is mine by its CRM, not by who typed it in");
  assert.deepEqual(params, [7], "the creating login is still being matched on");
});

test("a lead with no CRM is shown to whoever sees the whole studio, and to nobody else", () => {
  /*
   * An unassigned lead is nobody's work. Matching it to no My Leads at all would leave it findable
   * only by turning the switch off and reading the whole board, so it surfaces for the people who
   * hand leads out - work waiting to be given to somebody. A CRM reading their own leads is not
   * shown other people's unassigned work.
   */
  const crm = mineClause({ employeeId: 7, userId: 42 });
  assert.equal(crm.clause, "`owner_employee_id` = ?", "a CRM is being shown unassigned leads that are not theirs");

  const admin = mineClause({ employeeId: 7, userId: 42, seesUnassigned: true });
  assert.equal(admin.clause, "(`owner_employee_id` = ? OR (`owner_employee_id` IS NULL OR `owner_employee_id` = 0))");
  assert.deepEqual(admin.params, [7]);

  // A Super Admin with no employee record of their own: the unassigned half stands on its own,
  // rather than falling back to the empty board.
  const unlinked = mineClause({ employeeId: null, userId: 42, seesUnassigned: true });
  assert.equal(unlinked.clause, "(`owner_employee_id` IS NULL OR `owner_employee_id` = 0)");
  assert.deepEqual(unlinked.params, []);
});

test("it is parameterised, never interpolated", () => {
  // The ids come from the database, but the rule is the same one every query here follows: nothing
  // reaches the SQL text but `?`.
  const { clause } = mineClause({ employeeId: 7, userId: 42 });
  assert.doesNotMatch(clause, /\b7\b/, "an id was written into the SQL instead of bound");
});

test("an account with no employee and no studio-wide reach matches nothing, whatever it created", () => {
  /*
   * A login with no employee record cannot be named as anybody's CRM, so no lead is theirs - and
   * the leads it typed in belong to whoever it named. An empty board is the honest answer; the old
   * rule handed such an account every lead it had ever entered on somebody else's behalf.
   *
   * A Super Admin who has created a hundred leads and is named on none of them sees none of them.
   */
  const { clause, params } = mineClause({ employeeId: null, userId: 42 });
  assert.equal(clause, "1=0");
  assert.deepEqual(params, []);
});

test("an account the application can put no id to matches nothing, not everything", () => {
  /*
   * The direction this has to fail in. `1=1` here would quietly turn "show me mine" into "show me
   * every row the scope allows", which for a Super Admin is the whole studio - the exact opposite
   * of what was asked for, and silent.
   */
  for (const empty of [{}, { employeeId: null, userId: null }, { employeeId: 0, userId: 0 }]) {
    assert.equal(mineClause(empty).clause, "1=0", JSON.stringify(empty));
  }
});

test("null ids cannot match a lead that has none", () => {
  // `=` rather than `IN`, so an unowned lead is not swept in: `NULL = 1` is null, and not true.
  const { clause } = mineClause({ employeeId: 7, userId: 42 });
  assert.doesNotMatch(clause, /IS NULL|IN \(/);
});

/*
 * ── It has to reach every read, or the board contradicts itself ──────────────────────────────
 *
 * The rows, the tab counts, a column filter's own menu and the ids a "select all" resolves to are
 * four separate queries. Narrow some and not others and the board says 96 on a tab that opens 12,
 * or - the one that matters - a bulk action runs against the whole team's leads from a board that
 * is showing one person's.
 */
test("every read the board makes is narrowed by it", () => {
  // Whole lines, not a brace-matched slice: several of these calls carry `filters: {}`, and a
  // `[^}]*` would stop at that inner brace and read only part of the call.
  const calls = QUERY.split("\n").filter((line) => line.includes("buildWhere({") && !line.startsWith("function buildWhere"));
  assert.ok(calls.length >= 5, `expected the board's reads, found ${calls.length}`);
  for (const call of calls) {
    assert.match(call, /\bmine\b/, `a read is not narrowed by the switch: ${call}`);
    // Beside the scope, always - the two answer the same question and must travel together.
    assert.match(call, /\bscope\b/, `a read carries the switch without the scope: ${call}`);
  }
});

test("the select-all resolver is narrowed too", () => {
  // The dangerous one: this turns "everything matching" into concrete ids for a bulk action.
  const ids = declaration(CONTROLLER, "async function ids(req, res)", "\n}");
  assert.match(ids, /mine: await leadMine\(req, parsed\.data\.mine === "true"\)/);
});

/*
 * ── Whose ids, and where they come from ──────────────────────────────────────────────────────
 */
test("the ids are the signed-in account's, never the request's", () => {
  /*
   * The one thing this must not be able to do is name somebody else. If the ids came off the query
   * string, "only mine" would become "only theirs" and a reader could read a colleague's queue -
   * still inside their scope, but not their business.
   */
  const helper = declaration(CONTROLLER, "const leadMine = async (req, wanted)", "\n};");
  assert.match(helper, /dataScope\.selfIds\(Number\(req\.user\.id\)\)/);
  // The same for the reach that decides whether unassigned leads are shown: asked of the signed-in
  // account, never of anything the caller sent.
  assert.match(helper, /dataScope\.seesEverything\(Number\(req\.user\.id\)/);
  assert.doesNotMatch(helper, /req\.query|req\.body|parsed\.data\.(employee|user)/);
});

test("selfIds stops at the person and never walks the org chart", () => {
  /*
   * `identityFor` beside it deliberately includes the team below, which is what makes a manager's
   * board their team's work as well as their own. This is the narrower question, so it must not
   * reuse that - a `subtreeEmployeeIds` call here would make "only mine" mean "mine and my team's",
   * which is the state the switch is meant to turn off.
   */
  const body = declaration(SCOPE, "async function selfIds(userId)", "\n}");
  assert.doesNotMatch(body, /subtreeEmployeeIds|identityFor/);
  assert.match(body, /linkedEmployeeId/);
  // And an unusable id answers with nothing rather than throwing into the board's load.
  assert.match(body, /if \(!Number\.isInteger\(id\) \|\| id <= 0\) return \{ employeeId: null, userId: null \};/);
});

test("the flag is read as a word, not coerced", () => {
  /*
   * These are GET endpoints, so every value arrives as a string, and `z.coerce.boolean()` reads the
   * string "false" as **true** - which would pin the board to "only mine" for everybody the moment
   * the client sent the off state explicitly. The enum cannot be got wrong that way, and it is what
   * `extra-quotations` already does with its own `mine`.
   */
  assert.doesNotMatch(CONTROLLER, /mine: z\.coerce\.boolean\(\)/);
  assert.equal((CONTROLLER.match(/mine: z\.enum\(\["true", "false"\]\)\.default\("false"\)/g) || []).length, 2);
  // Default off: the board opens on everything the reader may see, as it always has.
  assert.doesNotMatch(CONTROLLER, /mine: z\.enum\(\["true", "false"\]\)\.default\("true"\)/);
});

/*
 * ── Offered only to the people it means something to ─────────────────────────────────────────
 *
 * Somebody with nobody under them is named on their own leads and on nobody else's, so "everything
 * I may see" and "only mine" are the same board. A switch that changes nothing is worse than no
 * switch: it invites somebody to flip it, see no difference, and conclude the board is broken.
 */
test("somebody who sees every lead is offered it too", () => {
  /*
   * A Super Admin, and anybody reaching every branch, has no team in the org-chart sense and was
   * refused the switch outright - while seeing every lead in the studio, which makes "only mine"
   * more use to them than to anyone else. `seesEverything` is the same question `resolve` asks
   * before it returns `unlimited()`, so the two cannot drift.
   */
  const body = declaration(CONTROLLER, "async function readerManagesAnyone(req)", "\n}");
  // Asked about the board's own permission - a finer guard stacked after it overwrites `req.permission`.
  assert.match(body, /dataScope\.seesEverything\(Number\(req\.user\.id\), CRM_LEADS_PERMISSION\)/);
  // Asked first, so the org-chart walk is skipped entirely for them.
  assert.ok(body.indexOf("seesEverything") < body.indexOf("subtreeEmployeeIds"));
});

test("the switch is offered on the org chart, not on a claim", () => {
  const body = declaration(CONTROLLER, "async function readerManagesAnyone(req)", "\n}");
  // The whole subtree, matching what the scope actually widens by - a manager two levels up still
  // sees those leads, so they still have something to narrow.
  assert.match(body, /dataScope\.subtreeEmployeeIds\(employeeId\)/);
  assert.match(body, /\.length > 0/);
  // An account with no employee behind it manages nobody, whatever else is true of it.
  assert.match(body, /if \(!employeeId\) return false;/);
  // Read from the signed-in account, never from the request.
  assert.doesNotMatch(body, /req\.query|req\.body|parsed\.data/);
});

test("it is answered on a real read and not on every scroll append", () => {
  const page = declaration(CONTROLLER, "    const [scope, mine] = await Promise.all", "\n  }");
  // The org-chart walk is a recursive query; an append is the same board the reader is already on.
  assert.match(page, /appending \? Promise\.resolve\(false\) : readerManagesAnyone\(req\)/);
  assert.match(page, /\.\.\.\(appending \? \{\} : \{ total, counts, managesAnyone, \.\.\.\(values \? \{ values \} : \{\}\) \}\)/);
});

test("hiding the switch can never widen a board", () => {
  /*
   * The direction this has to fail in. `managesAnyone` decides whether the control is *drawn*; the
   * rows are decided by `mine`, which the server builds from the signed-in account either way. So a
   * wrong answer here can hide a switch somebody wanted - visible, and complained about - but can
   * never show them a lead the scope had not already allowed.
   */
  const body = declaration(CONTROLLER, "async function readerManagesAnyone(req)", "\n}");
  // Checked against the code rather than the prose - the comment above it explains why somebody
  // the *scope* does not confine is offered the switch, and matching that word caught the note
  // instead of a call. These are the things that actually decide which rows come back.
  const code = body.split("\n").filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line)).join("\n");
  assert.doesNotMatch(code, /leadScope\(|buildWhere\(|mineClause\(|listCrmLeadsPage\(|listCrmLeadIds\(/, "the offer is deciding what the rows are");
});

test("the board ignores a stored answer once the switch is not theirs", () => {
  /*
   * The preference outlives somebody's place in the org chart. Turned off while they had a team and
   * read back after they no longer do, it would leave the board narrowed by a control no longer on
   * screen to turn back - showing less than it should, with nothing saying why.
   */
  const BOARD = fs.readFileSync(
    path.join(__dirname, "..", "..", "frontend", "src", "components", "sales", "CRMPage.js"),
    "utf8",
  );
  /*
   * Three states. `managesAnyone` is `null` until the first page answers, and unknown has to mean
   * "use what they chose": started at `false`, a manager whose stored answer was "only mine" had
   * the whole team's leads fetched and drawn first, then refetched narrowed - a visible flash of
   * other people's leads and a doubled page-and-counts query on every load. Only a definite `false`
   * widens the board.
   */
  assert.match(BOARD, /const \[managesAnyone, setManagesAnyone\] = useState\(null\);/);
  assert.match(BOARD, /const showingAllLeads = managesAnyone === false \? true : !mineOnly;/);
  /*
   * The switch is the reader's own queue, and the control says so: `checked` is `mineOnly`, so on
   * means only theirs. Pinned because it is the half a rename can silently leave behind - a control
   * labelled My Leads still wired to the old sense would show the whole team when it is switched on,
   * which no test of the query below would catch.
   */
  assert.match(BOARD, /label="My Leads"/);
  assert.match(BOARD, /checked=\{mineOnly\}/);
  /*
   * And it is remembered under a key of its own rather than the old one read backwards.
   *
   * `crm:all-leads` stored `true` for "showing everything", which is what nearly every reader has in
   * their browser. Keeping that key and inverting its meaning would read every one of those as
   * "My Leads on", so the first person to open the board after the rename would find their team's
   * leads gone with nothing to say why. The default is `false` - the same board they had yesterday.
   */
  assert.match(BOARD, /usePreference\("crm:my-leads", false\)/);
  assert.doesNotMatch(BOARD, /usePreference\("crm:all-leads"/, "the old key is being read with its meaning reversed");
  // And the switch is not drawn on the Call Box, which is answered from the call log and takes no
  // `mine` at all - a control there would change nothing.
  assert.match(BOARD, /\{managesAnyone && board !== CALLS_BOARD && <ToggleSwitch/);
  // And every read asks that question rather than the raw switch.
  assert.equal((BOARD.match(/mine: showingAllLeads \? "false" : "true"/g) || []).length, 3);
  assert.doesNotMatch(BOARD, /mine: mineOnly \? "true" : "false"/, "a read still asks the raw switch");
  // The control itself is drawn only for the people it is for - asserted with the Call Box gate
  // in the block above, which is the whole condition.

});
