import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * **What is being authorised has to be visible where it is authorised.**
 *
 * A payment request spreads money across shoots, and each line carries a description - which hall,
 * whose transport, what the vendor actually did. The approve dialog asked for a remark and showed
 * none of it: the approver saw a request code in the title and had to go and open the record
 * separately to find out what the figure was made of. Most would not, which makes the remark the
 * only evidence anybody looked.
 *
 * The data was never missing from the API: `include` on the expense lines selects every scalar, so
 * `description` was always in the payload. It was missing from two screens.
 */

const root = path.join(import.meta.dirname, "..", "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const ACTIONS = read("frontend/src/components/accounts/usePaymentRequestActions.js");
const SUMMARY = read("frontend/src/components/hrm/PaymentRequestExpenseSummary.js");
const CONTROLLER = read("backend/src/modules/hrm/payment-requests/controller.js");

test("the breakdown is in the dialog that approves and the one that rejects", () => {
  assert.match(ACTIONS, /\{Boolean\(approving\.expenses\?\.length\) && <PaymentRequestExpenseSummary expenses=\{approving\.expenses\} \/>\}/);
  // A rejection is written *about* these lines - "the bills do not add up to the amount claimed"
  // cannot be checked against a dialog that does not show them.
  assert.match(ACTIONS, /\{Boolean\(rejecting\.expenses\?\.length\) && <PaymentRequestExpenseSummary expenses=\{rejecting\.expenses\} \/>\}/);
  // The same component the payment panel and the record view draw, so the three agree.
  assert.match(ACTIONS, /import PaymentRequestExpenseSummary from "@\/components\/hrm\/PaymentRequestExpenseSummary";/);
  // And nothing is drawn for a kind that itemises nothing - a salary advance is one figure.
  assert.doesNotMatch(ACTIONS, /<PaymentRequestExpenseSummary expenses=\{approving\.expenses\} \/>\s*\n\s*<TextAreaField\s+label="Remarks"/);
});

test("every view of a line shows what the line says", () => {
  // The side panel's compact list used to show the shoot, the expense type and the amount only, so a
  // line whose description was the whole point of it read as a bare figure against a shoot code.
  const compact = SUMMARY.slice(SUMMARY.indexOf("if (compact) {"), SUMMARY.indexOf("// The approval panel introduces the table"));
  assert.match(compact, /line\.description \?/, "the compact list says it too");
  // And the full table, which always did.
  const table = SUMMARY.slice(SUMMARY.indexOf("columns={["));
  assert.match(table, /line\.description \?/);
});

test("the server was never the problem: the lines come back whole", () => {
  /*
   * `include` with no `select` returns every scalar on the line, `description` among them - so this
   * was a reading bug throughout, and a `select` added here later would break all four views at once.
   */
  const include = CONTROLLER.slice(CONTROLLER.indexOf("const include = {"), CONTROLLER.indexOf("async function toRow"));
  assert.match(include, /expenses: \{\n\s*orderBy: \{ id: "asc" \},\n\s*include: \{/);
  assert.doesNotMatch(include.slice(0, include.indexOf("requestedBy")), /select: \{ id: true, amount/, "no narrowed select on the lines");
  // And `toRow` spreads the line rather than naming its fields, so a new one needs no change here.
  assert.match(CONTROLLER, /const expenses = \(request\.expenses \|\| \[\]\)\.map\(\(line\) => \(\{\n\s*\.\.\.line,/);
});
