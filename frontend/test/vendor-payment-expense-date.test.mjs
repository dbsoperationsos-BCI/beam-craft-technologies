import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * A vendor payment's expense date follows the shoot it is for.
 *
 * The two sat next to each other on the line and were typed one after the other off the same row, so
 * picking the shoot now fills the date in. The part worth pinning is what it does **not** do: a date
 * somebody typed is never rewritten. A picker that quietly overwrites an answer teaches people to
 * check it every time, which costs more than the typing it saved.
 */

const root = path.join(import.meta.dirname, "..", "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const LINES = read("frontend/src/components/hrm/PaymentRequestExpenseLines.js");
const PANEL = read("frontend/src/components/hrm/PaymentRequestFormPanel.js");
const HOOK = read("frontend/src/components/shared/useRemoteOptions.js");

test("the date follows the shoot on a vendor payment and on a reimbursement, and nowhere else", () => {
  assert.match(PANEL, /datesFollowShoot=\{type === "VENDOR_PAYMENT" \|\| \(type === "EXPENSE_SUBMISSION" && !isExcess\)\}/);
  /*
   * Not on an advance against expenses, which is dated when the money is **needed** rather than when
   * anything happened. Not on an expense **excess** either: that is unspent advance money being
   * handed back, so there is nothing it was spent on - which is why it is not even asked an expense
   * type.
   */
  assert.doesNotMatch(PANEL, /datesFollowShoot=\{itemises\}/);
  assert.match(LINES, /datesFollowShoot = false/, "off unless a caller asks for it");
  // Which settlement counts as an excess is the studio's answer, as the QR-code field reads it too.
  assert.match(PANEL, /const isExcess = form\.settlement === \(options\.excessSettlement \|\| SETTLEMENT_EXCESS\);/);
});

test("a date somebody typed is never overwritten", () => {
  // Filled when the box is empty, or when it still holds the day of the shoot being replaced - which
  // is to say when the app put it there, not a person.
  assert.match(LINES, /const typed = line\.expenseDate && line\.expenseDate !== was;/);
  assert.match(LINES, /if \(chosen && !typed\) next\.expenseDate = shootDateKey\(chosen\) \|\| line\.expenseDate;/);
  // Nothing happens on any other field, or on a kind that did not ask for this.
  assert.match(LINES, /if \(!datesFollowShoot \|\| field !== "shootId"\) return next;/);
});

test("the shoot's day is cut from the stored key, not read through a local Date", () => {
  /*
   * A shoot's day is kept at midnight, so `new Date(...)` then reading the local date moves it to the
   * day before for anybody west of UTC - the wrong date on a vendor's bill, on the studio's books.
   */
  assert.match(LINES, /const shootDateKey = \(shoot\) => String\(shoot\?\.dateCreated \|\| ""\)\.slice\(0, 10\);/);
  assert.doesNotMatch(LINES, /new Date\(shoot/);
});

test("the chosen shoot is found even when the current search no longer offers it", () => {
  // The line holds an id; the row behind it comes from the hook that keeps every row a search has
  // offered, or the field could not take the day from a shoot searched for earlier.
  assert.match(HOOK, /const rowFor = useCallback\(\(id, opened = \[\]\) => \{/);
  assert.match(HOOK, /return offered\.find\(\(row\) => row\.id === id\) \|\| opened\.find\(\(row\) => row\.id === id\) \|\| seen\[id\] \|\| null;/);
  assert.match(LINES, /const shootRow = \(id\) => shoots\.rowFor\(id, options\.shoots \|\| \[\]\);/);
});

test("the box says where its answer came from while it is the shoot's", () => {
  assert.match(LINES, /Taken from the shoot's own day\. Change it if the bill is dated differently\./);
  // And goes back to its own helper text once somebody changes it.
  assert.match(LINES, /: wording\.dateHelp\}/);
});
