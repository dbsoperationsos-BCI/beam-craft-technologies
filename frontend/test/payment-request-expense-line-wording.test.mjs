import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { expenseLineWording } from "../src/constants/paymentRequestConfig.js";

const LINES = fs.readFileSync(new URL("../src/components/hrm/PaymentRequestExpenseLines.js", import.meta.url), "utf8");
const PANEL = fs.readFileSync(new URL("../src/components/hrm/PaymentRequestFormPanel.js", import.meta.url), "utf8");

/*
 * One expense table was asking one set of words of three different things. Every line said "the day
 * the money **was** spent" and "Expense Amount": true of a reimbursement, wrong for an advance
 * wanted before anything is spent, and wrong again for an excess handing unspent money back.
 */

const EXCESS = "Expense Excess";

test("a reimbursement is money already spent, and keeps the wording it had", () => {
  const wording = expenseLineWording({ type: "EXPENSE_SUBMISSION", settlement: "Reimbursement needed", excessSettlement: EXCESS });
  assert.equal(wording.dateLabel, "Expense Date");
  assert.equal(wording.amountLabel, "Expense Amount");
  assert.equal(wording.asksExpenseType, true);
  assert.equal(wording.dateRestriction, "future", "money already spent cannot have been spent tomorrow");
});

test("an advance is money not yet spent: the day it is needed, an estimate, and a future day allowed", () => {
  const wording = expenseLineWording({ type: "ADVANCE_EXPENSE" });
  assert.equal(wording.dateLabel, "Date Needed");
  assert.equal(wording.amountLabel, "Estimated Amount");
  assert.equal(wording.dateRestriction, "none", "the form refused the very day an advance is for");
  assert.equal(wording.asksExpenseType, true, "what it will be spent on is the case for granting it");
  assert.equal(wording.total, "Estimated Advance Total");
});

test("an excess is money coming back, and is never asked what it was spent on", () => {
  const wording = expenseLineWording({ type: "EXPENSE_SUBMISSION", settlement: EXCESS, excessSettlement: EXCESS });
  assert.equal(wording.asksExpenseType, false);
  assert.equal(wording.dateLabel, "Date Returned");
  assert.equal(wording.amountLabel, "Amount Returned");
  assert.equal(wording.total, "Total Being Returned");
  assert.equal(wording.item, "Return");
});

test("which settlement means an excess is the studio's flag, not the words", () => {
  // The studio may rename the option; `excessSettlement` comes down with the options.
  const renamed = expenseLineWording({ type: "EXPENSE_SUBMISSION", settlement: "Money left over", excessSettlement: "Money left over" });
  assert.equal(renamed.asksExpenseType, false, "the renamed option still means the money comes back");
  const stale = expenseLineWording({ type: "EXPENSE_SUBMISSION", settlement: "Money left over", excessSettlement: EXCESS });
  assert.equal(stale.asksExpenseType, true, "and a settlement that is not the excess one still asks");
});

test("a vendor's bill, and no answer at all, fall back to money already spent", () => {
  assert.equal(expenseLineWording({ type: "VENDOR_PAYMENT" }).amountLabel, "Expense Amount");
  assert.equal(expenseLineWording().amountLabel, "Expense Amount", "the table's own default needs no arguments");
});

test("the table reads every word off the wording, and leaves the expense box out rather than disabling it", () => {
  assert.match(LINES, /label=\{wording\.dateLabel\}/);
  assert.match(LINES, /label=\{wording\.amountLabel\}/);
  assert.match(LINES, /restriction=\{wording\.dateRestriction\}/);
  assert.match(LINES, /\{wording\.asksExpenseType && <Dropdown/, "absent, not present and ignored");
  assert.doesNotMatch(LINES, /helperText="The day the money was spent/, "no wording left hard-coded in the table");
  assert.doesNotMatch(LINES, /totalLabel/, "the total is one of the wordings now");
  // Without the type box the grid would leave an empty cell where a question used to be.
  assert.match(LINES, /className=\{wording\.asksExpenseType \? "" : "md:col-span-2"\}/);
});

test("the form neither requires nor sends an expense type it never asked for", () => {
  assert.match(PANEL, /if \(wording\.asksExpenseType && !line\.expenseType\)/);
  assert.match(PANEL, /expenseType: wording\.asksExpenseType \? line\.expenseType : null,/);
});
