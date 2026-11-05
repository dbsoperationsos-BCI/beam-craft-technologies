import test from "node:test";
import assert from "node:assert/strict";

import { emptyRule, emptyTarget, evenShares, ruleIssue, rulesHaveIssues, shareTotal, targetIssue } from "../src/lib/sheetAssignmentRules.mjs";

/*
 * What the panel will let a lead-assignment rule be.
 *
 * A rule is a column, the value to look for in it, and the people who share the leads it matches -
 * each with the percentage they take. Asked here so the studio is told beside the field: linking a
 * new sheet goes through Google's consent screen, so a rule the backend refuses is a refusal that
 * arrives after a sign-in and a redirect, by which point what was wrong with it is off the screen.
 *
 * The backend asks the same questions again in `rulesStore.validateRules` and is the authority.
 */

const one = (over = {}) => ({ employeeId: "7", percent: "100", ...over });
const complete = { columnHeader: "City", matchValue: "Chennai", targets: [one()] };

test("a rule needs a column, a value and somebody to give the leads to", () => {
  assert.equal(ruleIssue(complete), "");
  assert.match(ruleIssue({ ...complete, columnHeader: "" }), /column/i);
  assert.match(ruleIssue({ ...complete, matchValue: "  " }), /value/i);
  assert.match(ruleIssue({ ...complete, targets: [] }), /who/i);
});

test("the column is named before the value, so the first thing missing is the first thing said", () => {
  assert.match(ruleIssue(emptyRule()), /column/i);
});

test("a fresh rule is incomplete, so adding one cannot save an empty rule by accident", () => {
  assert.equal(rulesHaveIssues([emptyRule()]), true);
  assert.equal(rulesHaveIssues([complete]), false);
  assert.equal(rulesHaveIssues([]), false);
});

/* ------------------------------------------------------------------ the shares */

test("the shares must add to 100, and the total is named", () => {
  /*
   * "60 and 30" is not a split that can be honoured - it is either a typo or a claim that 10% of
   * the leads belong to nobody, and guessing which would silently change what somebody typed.
   */
  const short = { ...complete, targets: [one({ percent: "60" }), one({ employeeId: "8", percent: "30" })] };
  assert.match(ruleIssue(short), /90%, not 100%/);

  const exact = { ...complete, targets: [one({ percent: "60" }), one({ employeeId: "8", percent: "40" })] };
  assert.equal(ruleIssue(exact), "");
  assert.equal(shareTotal(exact), 100);
});

test("one person cannot hold two shares of the same rule", () => {
  // Two rows for the same person are one total typed twice, not a split.
  const twice = { ...complete, targets: [one({ percent: "60" }), one({ percent: "40" })] };
  assert.match(ruleIssue(twice), /listed twice/i);
});

test("a share needs an employee and a percentage in range", () => {
  assert.equal(targetIssue(one()), "");
  assert.match(targetIssue(one({ employeeId: "" })), /employee/i);
  assert.match(targetIssue(one({ percent: "0" })), /1 to 100/);
  assert.match(targetIssue(one({ percent: "140" })), /1 to 100/);
  assert.match(targetIssue(one({ percent: "33.5" })), /1 to 100/);
});

test("an unfinished share is reported on the rule too, not only on the box", () => {
  // Otherwise a rule refuses to save with nothing said above the list explaining why.
  const unfinished = { ...complete, targets: [one({ percent: "50" }), one({ employeeId: "", percent: "50" })] };
  assert.match(ruleIssue(unfinished), /shares below/i);
});

test("splitting re-spreads the shares so the total is always reachable", () => {
  /*
   * Adding or removing a person should not leave a rule adding to 66 that refuses to save. The
   * remainder goes to the first few, which is what keeps three people at 34/33/33 rather than
   * 33/33/33 and a percent nobody owns.
   */
  for (const count of [1, 2, 3, 4, 7, 20]) {
    const shares = evenShares(count);
    assert.equal(shares.length, count);
    assert.equal(shares.reduce((sum, n) => sum + n, 0), 100, `${count} people do not add to 100`);
  }
  assert.deepEqual(evenShares(3), [34, 33, 33]);
  assert.deepEqual(evenShares(2), [50, 50]);
});

test("a rule starts as one person at 100%", () => {
  // The common case keeps its one-line row; a split is something you opt into.
  assert.deepEqual(emptyRule().targets, [emptyTarget()]);
  assert.equal(emptyTarget().percent, "100");
});

/* ------------------------------------------------------------------ the panel's own behaviour */

test("a new rule goes on top of the list", () => {
  /*
   * Rules are checked top to bottom and the first match wins, so the rule just written is also the
   * first one tried - which is what somebody adding a more specific rule means by adding it.
   * Appended at the bottom it was both the last thing checked and, on a long list, off screen.
   */
  const existing = [{ columnHeader: "City", matchValue: "Erode", targets: [one({ employeeId: "2" })] }];
  const next = [emptyRule(), ...existing];
  assert.equal(next[0].columnHeader, "");
  assert.equal(next[1].matchValue, "Erode");
});

test("a rule reading 100% is only called good when the whole rule is", () => {
  /*
   * Adding a fourth person spreads the shares to 25/25/25/25, so the total hits 100 before anybody
   * has been picked for the new row. The total and the rule's message must not disagree about
   * whether the rule is ready.
   */
  const unfinished = {
    columnHeader: "City",
    matchValue: "Chennai",
    targets: [one({ employeeId: "1", percent: "25" }), one({ employeeId: "2", percent: "25" }),
      one({ employeeId: "3", percent: "25" }), one({ employeeId: "", percent: "25" })],
  };
  assert.equal(shareTotal(unfinished), 100);
  assert.notEqual(ruleIssue(unfinished), "", "100% with an empty share must still be an unfinished rule");
});

test("a rule with one person needs no percentage at all", () => {
  /*
   * One person takes everything by definition, so the panel shows no percent box for them - a field
   * reading 100 beside a single name is a sum nobody needs. It still validates as 100, which is
   * what keeps a plain rule and a split the same shape underneath.
   */
  const alone = { columnHeader: "City", matchValue: "Chennai", targets: [one({ percent: "100" })] };
  assert.equal(ruleIssue(alone), "");
  assert.equal(shareTotal(alone), 100);
});
