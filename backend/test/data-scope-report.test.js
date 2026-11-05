const test = require("node:test");
const assert = require("node:assert/strict");
const { branchMatcher, verticalMatcher, employeeMatcher } = require("../src/services/referenceMatchers");

/*
 * The rules the match report proposes, held to what they claim. The report is what the backfill
 * is approved from, so a rule that matched more than it says - a first name onto the wrong person,
 * "Erode" onto Tiruppur - would be approved by mistake and written in production.
 */

const branches = [
  { id: 1, name: "Erode TN" }, { id: 2, name: "Tiruppur TN" }, { id: 3, name: "Coimbatore TN" },
  { id: 4, name: "Bangalore KA" }, { id: 5, name: "Hyderabad TL" }, { id: 6, name: "Visakhapatnam AP" },
];

test("a branch matches on its full name, with or without the state keyword, and nothing looser", () => {
  const match = branchMatcher(branches);
  assert.equal(match("Erode TN").kind, "exact");
  assert.equal(match("erode tn ").target.id, 1);
  // The case the brief warned about: the CRM writes the place, the register writes the state too.
  assert.deepEqual([match("Erode").kind, match("Erode").target.id], ["without-state", 1]);
  assert.equal(match("Visakhapatnam").target.id, 6);
  /*
   * And nothing shorter, which is the whole of the rest of the rule: a shortening is a guess at a
   * branch, and filing records against a guess is what this rule exists to prevent.
   *
   * `Vizag` is deliberately not in this list. It is not a shortening of `Visakhapatnam AP` - it is
   * the studio's own name for that branch - and it is carried as a named alias in `BRANCH_ALIASES`,
   * checked after everything here so it can never overrule the register. `branch-alias-vizag.test.js`
   * holds the shape of that exception; what this test still holds is that it is the *only* one.
   */
  for (const guess of ["viza", "erd", "Tel", "Erod", "Bang"]) {
    assert.equal(match(guess).kind, "unmatched", `${guess} is a guess at a branch, not a way of writing one`);
  }
  assert.deepEqual([match("Vizag").kind, match("Vizag").target.id], ["alias", 6]);
  // A city that is not a branch, and a blank, are each answered honestly.
  assert.equal(match("Chennai").kind, "unmatched");
  assert.equal(match("  ").kind, "blank");
  assert.equal(match(null).kind, "blank");
});

test("the state keyword is dropped as a word, not matched against a list of states", () => {
  // A register that writes its states out in full, or some third way, needs no edit to this rule.
  const match = branchMatcher([{ id: 1, name: "Bangalore Karnataka" }, { id: 2, name: "Erode" }]);
  assert.equal(match("Bangalore").target.id, 1);
  assert.equal(match("Bangalore Karnataka").kind, "exact");
  // A one-word branch name has nothing to drop, and still matches itself.
  assert.equal(match("Erode").kind, "exact");
});

test("a bare name two branches share is ambiguous rather than whichever loaded first", () => {
  /*
   * `Erode TN` and `Erode KA` both answer to `Erode`, and picking one is how a record ends up filed
   * in the wrong state - silently, since nothing on screen would say which was chosen. Both are
   * still reachable by their full names, which are distinct.
   */
  const match = branchMatcher([{ id: 1, name: "Erode TN" }, { id: 2, name: "Erode KA" }]);
  assert.equal(match("Erode").kind, "ambiguous");
  assert.equal(match("Erode").target, undefined);
  assert.equal(match("Erode TN").target.id, 1);
  assert.equal(match("Erode KA").target.id, 2);
});

test("a branch actually called Erode wins Erode from a branch called Erode TN", () => {
  // A full name is the branch's own; the bare form is a convenience read off another branch's name.
  const match = branchMatcher([{ id: 1, name: "Erode TN" }, { id: 2, name: "Erode" }]);
  assert.deepEqual([match("Erode").kind, match("Erode").target.id], ["exact", 2]);
});

test("a vertical matches on any of the three spellings the studio prints, and the CRM's own folds", () => {
  const match = verticalMatcher([
    { id: 1, name: "Dum Dum", code: "DUM_DUM", documentCode: "WED", identifierCode: "DD" },
    { id: 2, name: "Qua Qua", code: "QUA_QUA", documentCode: "QQ", identifierCode: "QQ" },
    { id: 3, name: "Corp", code: "CORP", documentCode: "CORP", identifierCode: "CORP" },
    { id: 4, name: "Team 33", code: "TEAM_33", documentCode: null, identifierCode: null },
  ]);
  for (const spelling of ["Dum Dum", "dumdum", "WED", "wed", "DD", "DUM_DUM", "Wedding"]) assert.equal(match(spelling).target?.id, 1, spelling);
  for (const spelling of ["Qua Qua", "QuaQua", "QQ"]) assert.equal(match(spelling).target?.id, 2, spelling);
  for (const spelling of ["Corp", "corporate", "Corporation", "Crop"]) assert.equal(match(spelling).target?.id, 3, spelling);
  assert.equal(match("Team 33").target?.id, 4);
  // Not a vertical at all: the sentinel the employee form writes.
  assert.equal(match("Not Allocated").kind, "unmatched");
  assert.equal(match("").kind, "blank");
});

test("an owner matches on the full name or the employee id, exactly - never on a first name, never when two share a name", () => {
  const match = employeeMatcher([
    { id: 1, employeeId: "DBS001", employeeName: "sabari j" },
    { id: 7, employeeId: "DBS-3", employeeName: "Sabarish J" },
    { id: 8, employeeId: "DBS-8", employeeName: "Priya R" },
    { id: 9, employeeId: "DBS-9", employeeName: "Priya R" },
  ]);
  assert.deepEqual([match("Sabarish J").kind, match("Sabarish J").target.id], ["exact", 7]);
  assert.equal(match("sabarish j").target.id, 7, "case does not make two people");
  assert.equal(match("DBS001").target.id, 1);
  assert.equal(match("dbs-3").target.id, 7);
  // "sabari j" and "Sabarish J" are two employees; neither may be taken for the other.
  assert.equal(match("sabari j").target.id, 1);
  assert.equal(match("Sabari").kind, "unmatched", "a first name alone names nobody");
  assert.equal(match("Priya R").kind, "ambiguous", "two employees with one name is a question, not a match");
  assert.equal(match("admin").kind, "unmatched", "a login's name is not an employee");
});

test("an owner also matches on loginUsername, ahead of a name and behind an employee id", () => {
  /*
   * `loginUsername` is read straight off the employee row - `Employee.loginUsername` mirrors
   * `User.username`, written by the two places that ever set an account's username (see the note
   * on that field in schema.prisma). This is the shape an admin-run sheet sync is expected to
   * write - the CSV's owner column holding the login the studio already gave each Sales employee.
   */
  const employees = [
    { id: 1, employeeId: "DBS001", employeeName: "Dhanush M", loginUsername: "dhanush.m" },
    { id: 7, employeeId: "DBS-3", employeeName: "Sabarish J", loginUsername: "sabarish.j" },
    // Two employees sharing a name, neither with an account - the case the ambiguity rule exists
    // for, unaffected by a username sitting beside it on somebody else's row.
    { id: 8, employeeId: "DBS-8", employeeName: "Priya R", loginUsername: null },
    { id: 9, employeeId: "DBS-9", employeeName: "Priya R", loginUsername: null },
  ];
  const match = employeeMatcher(employees);
  assert.deepEqual([match("dhanush.m").kind, match("dhanush.m").target.id], ["username", 1]);
  assert.equal(match("Dhanush.M").target.id, 1, "a username is not case-sensitive, like a name");
  assert.equal(match("sabarish.j").target.id, 7);
  // The employee id still wins where a value happens to read as one: nothing here does, but the
  // ordering is the point, not the coincidence.
  assert.equal(match("DBS001").kind, "employee-id");
  // An employee with no account is only ever reached by their id or their name.
  assert.equal(match("Priya R").kind, "ambiguous");
});
