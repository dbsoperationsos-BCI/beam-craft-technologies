const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const { PASSWORD_HISTORY_LIMIT, PASSWORD_REUSED_MESSAGE, passwordReuseProblem, nextPasswordHistory } = require("../src/services/passwordHistory");

const hash = (password) => bcrypt.hashSync(password, 4);

test("the current password and every remembered one are refused, by name", async () => {
  const current = hash("Current1!");
  const history = [hash("Older1!"), hash("Oldest1!")];
  assert.equal(await passwordReuseProblem("Current1!", current, history), PASSWORD_REUSED_MESSAGE);
  assert.equal(await passwordReuseProblem("Older1!", current, history), PASSWORD_REUSED_MESSAGE);
  assert.equal(await passwordReuseProblem("Oldest1!", current, history), PASSWORD_REUSED_MESSAGE);
  assert.match(PASSWORD_REUSED_MESSAGE, /used on this account before/);
});

test("a password the account has never had is accepted", async () => {
  assert.equal(await passwordReuseProblem("Brand-new1!", hash("Current1!"), [hash("Older1!")]), null);
});

test("an account with no history yet is checked against its current password only", async () => {
  const current = hash("Current1!");
  assert.equal(await passwordReuseProblem("Current1!", current, null), PASSWORD_REUSED_MESSAGE);
  assert.equal(await passwordReuseProblem("Other1!", current, undefined), null);
});

test("the replaced password joins the front of the history and the oldest falls off", () => {
  const history = Array.from({ length: PASSWORD_HISTORY_LIMIT }, (_, index) => `h${index}`);
  const next = nextPasswordHistory("replaced", history);
  assert.equal(next.length, PASSWORD_HISTORY_LIMIT);
  assert.equal(next[0], "replaced");
  assert.equal(next.at(-1), `h${PASSWORD_HISTORY_LIMIT - 2}`);
});

// The column is JSON, so a hand-edited row could hold anything; only hashes count.
test("a malformed history is read as the hashes it does contain", () => {
  assert.deepEqual(nextPasswordHistory("a", "not-an-array"), ["a"]);
  assert.deepEqual(nextPasswordHistory("a", ["b", 3, null, ""]), ["a", "b"]);
});
