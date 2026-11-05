const test = require("node:test");
const assert = require("node:assert/strict");
const { PASSWORD_RULES, passwordProblem } = require("../src/services/passwordPolicy");

/*
 * The reset form shows these rules and ticks them off as somebody types, but a browser is not a
 * gate - these are what the server actually refuses on. The mirror of the list lives in
 * `frontend/src/components/auth/ResetPasswordForm.js`; the count below is what notices if one side
 * gains a rule the other does not.
 */
test("the policy is the five rules the reset form shows", () => {
  assert.equal(PASSWORD_RULES.length, 5);
  assert.deepEqual(PASSWORD_RULES.map((rule) => rule.label), [
    "At least 8 characters",
    "One upper case letter",
    "One lower case letter",
    "One number",
    "One special character",
  ]);
});

test("each rule is refused on its own, and names what to fix", () => {
  assert.match(passwordProblem("Sh0rt!"), /at least 8 characters/);
  assert.match(passwordProblem("nouppercase1!"), /upper case/);
  assert.match(passwordProblem("NOLOWERCASE1!"), /lower case/);
  assert.match(passwordProblem("NoNumbers!!"), /number/);
  assert.match(passwordProblem("NoSpecial123"), /special character/);
});

test("a password meeting all five is accepted", () => {
  assert.equal(passwordProblem("NewValid1!"), null);
});

// A missing password must fail the rules rather than reach the hasher as "undefined".
test("nothing at all is refused, not coerced", () => {
  assert.match(passwordProblem(undefined), /at least 8 characters/);
  assert.match(passwordProblem(null), /at least 8 characters/);
  assert.match(passwordProblem(""), /at least 8 characters/);
});
