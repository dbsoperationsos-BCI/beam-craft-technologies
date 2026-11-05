const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { branchMatcher, BRANCH_ALIASES } = require("../src/services/referenceMatchers");

/*
 * `Vizag` is the studio's name for `Visakhapatnam AP`.
 *
 * The branch rule is that a branch is matched by its full name, with or without the state keyword
 * the register ends it with, and by nothing shorter - `viza` and `erd` are guesses at a branch, and
 * filing records against a guess is the fault that rule exists to prevent.
 *
 * `Vizag` is not that. It is not a shortening of `Visakhapatnam AP`, which is why the "without the
 * state" rule cannot reach it; it is what the people using the application call that branch, out
 * loud and in every file they export. The alias was here, was removed on the principle that the
 * matcher should read the register and nothing else, and is back by an explicit decision of the
 * studio's - because a rule that refuses the name everybody says leaves thousands of leads filed
 * against no branch at all.
 *
 * What this file holds is the shape of that exception: that it resolves *through* the register, that
 * it cannot overrule it, and that it stays one entry rather than becoming a list of guesses.
 */

const REGISTER = [
  { id: 1, name: "Erode TN" },
  { id: 2, name: "Visakhapatnam AP" },
  { id: 3, name: "Bangalore KA" },
];

const match = branchMatcher(REGISTER);

test("Vizag is Visakhapatnam AP, however it is typed", () => {
  for (const typed of ["Vizag", "vizag", "VIZAG", " Vizag ", "  vIzAg"]) {
    const answer = match(typed);
    assert.equal(answer.kind, "alias", typed);
    assert.equal(answer.target.name, "Visakhapatnam AP", typed);
    assert.equal(answer.target.id, 2, typed);
  }
});

test("the register still answers for itself, and the two spellings it already knew", () => {
  assert.equal(match("Visakhapatnam AP").kind, "exact");
  assert.equal(match("Visakhapatnam").kind, "without-state");
  assert.equal(match("Erode").target.name, "Erode TN");
});

test("a guess at a branch is still not a branch", () => {
  /*
   * The alias is one name, not a licence to match anything near it. `viza` is the spelling the old
   * rule was tightened to refuse and it stays refused; `vizagg` and `vizag ap` are typos, not the
   * studio's name for anything.
   */
  for (const guess of ["viza", "vizagg", "vizag ap", "vzg", "erd", "Tel", "Dsa"]) {
    assert.equal(match(guess).kind, "unmatched", guess);
  }
});

test("the alias cannot overrule the register", () => {
  /*
   * Checked last, on purpose. A studio that later creates a branch genuinely called `Vizag` - or one
   * called `Vizag AP`, whose bare name is `Vizag` - must get that branch, not the one a line in the
   * matcher points at. Otherwise a single alias written months ago silently redirects a branch
   * somebody has just set up, and nothing on any screen says why.
   */
  const withOwnBranch = branchMatcher([...REGISTER, { id: 4, name: "Vizag" }]);
  assert.equal(withOwnBranch("Vizag").kind, "exact");
  assert.equal(withOwnBranch("Vizag").target.id, 4);

  const withBareName = branchMatcher([...REGISTER, { id: 5, name: "Vizag AP" }]);
  assert.equal(withBareName("Vizag").kind, "without-state");
  assert.equal(withBareName("Vizag").target.id, 5);
});

test("an alias naming a branch the studio does not have matches nothing", () => {
  // It resolves through the register rather than past it, so removing or renaming the branch leaves
  // an alias that matches nothing - never one pointing at a branch that is no longer there.
  const withoutVizag = branchMatcher([{ id: 1, name: "Erode TN" }]);
  assert.equal(withoutVizag("Vizag").kind, "unmatched");
});

test("the list stays short, and every entry names a branch by its full name", () => {
  /*
   * A second nickname should be a decision somebody makes on purpose - and the moment there are a
   * few, they belong on the branch row rather than in this file. This is the tripwire for that.
   */
  assert.equal(BRANCH_ALIASES.size, 1, "the aliases have grown - consider a column on the branch instead");
  for (const [from, to] of BRANCH_ALIASES) {
    assert.equal(from, from.trim().toLowerCase(), `${from} is not in the normalised form the lookup uses`);
    assert.equal(to, to.trim().toLowerCase(), `${to} is not in the normalised form the lookup uses`);
    // The value must be a branch's *full* name, which is what makes it resolvable against the
    // register. A value that were itself an alias, or a bare name, would not be.
    assert.ok(to.includes(" "), `${to} does not look like a register name`);
  }
});

/*
 * The leads written while the alias was gone carry `Vizag` with no `branch_id` - so they are in no
 * branch's scoped reads and show an empty Assigned Branch. The migration files them, and takes the
 * text from the branch it just pointed them at, because the board's Assigned Branch filter reads
 * that text: half the leads reading `Vizag` and half `Visakhapatnam AP` would split one branch's
 * leads across two filter values.
 */
test("the repair migration is narrow, joined to the register, and repeatable", () => {
  const combined = fs.readFileSync(
    path.join(__dirname, "..", "prisma", "migrations", "20260917120000_hrm_tasks_branch_text_and_admin_fixes", "migration.sql"),
    "utf8",
  );
  /*
   * This migration was combined with five others from the same session before push, so the file on
   * disk carries more than the Vizag repair - the section heading is what marks where it starts, and
   * there is nothing after it, so the slice to the end of the file is exactly that one migration's
   * original content.
   */
  const marker = "-- 6. Vizag is Visakhapatnam AP again";
  const start = combined.indexOf(marker);
  assert.notEqual(start, -1, "the Vizag section of the combined migration was not found");
  const sql = combined.slice(start);

  // Only leads that are filed under nothing: a lead somebody has since corrected by hand is left.
  assert.match(sql, /WHERE `lead`\.`branch_id` IS NULL/);
  // And only text that is exactly the nickname, so `viza` and `Vizag office` still say so.
  assert.match(sql, /LOWER\(TRIM\(`lead`\.`assigned_branch`\)\) = 'vizag'/);
  // Joined to the branch table rather than assuming an id, so a studio without that branch updates
  // nothing instead of pointing leads at a row that is not there.
  assert.match(sql, /JOIN `branch` ON LOWER\(TRIM\(`branch`\.`name`\)\) = 'visakhapatnam ap'/);
  // Both halves, from the same branch row - the id for the scoped reads, the name for the filter.
  assert.match(sql, /SET `lead`\.`branch_id` = `branch`\.`id`,\s*\n\s*`lead`\.`assigned_branch` = `branch`\.`name`/);
  // One table: it is the only one whose branch arrives as free text rather than from a picker.
  assert.equal(sql.match(/^UPDATE /gm)?.length, 1, "the repair has grown beyond the leads it was written for");
});
