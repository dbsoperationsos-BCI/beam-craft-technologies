import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

/*
 * Schedule Payment's Balance Amount: in the summary under the Updated Total Amount, drawn from the
 * server's `ledger` (GET …/payment-schedule) - never worked out on screen, and never a table column.
 */
const read = (file) => fs.readFileSync(new URL(`../src/components/${file}`, import.meta.url), "utf8");
const SECTION = read("project-management/SchedulePaymentSection.js");

test("the table has no Balance Amount column - the balance is in the summary only", () => {
  assert.doesNotMatch(SECTION, /key: "balance"/);
  assert.doesNotMatch(SECTION, /balanceById|balanceText/);
});

test("Receive records money against a saved, unpaid payment through Accounts' own panel", () => {
  // Under the Balance Amount, for a payment the books know and not yet received in full.
  assert.match(SECTION, /const receivable = \(row\) => Boolean\(onReceive\) && savedIds\.has\(row\.id\) && row\.status !== "Cleared";/);
  // Under the Amount, in a read-only schedule as in an editable one.
  assert.match(SECTION, /const withReceive = \(columns\) => columns\.map\(\(column\) => \(column\.key === "amount"/);
  assert.match(SECTION, /columns=\{withReceive\(lockedAware\(\[/);
  assert.match(SECTION, /\{receivable\(row\) && <Button type="button" variant="plain"/);
  // Only for somebody who may write Accounts' cash - the panel's own routes ask the same.
  const hook = read("project-management/useScheduleReceiver.js");
  assert.match(hook, /useModuleAccess\("ACCOUNTS", "Cash Management"\)/);
  // Nothing unsaved is lost: with changes on screen it asks for Update Project and opens nothing.
  assert.match(hook, /if \(isDirty\(\)\) \{\s*onError\?\.\("Update Project first/);
  for (const form of ["sales/CreateProjectFormPanel.js", "project-management/StartProjectFormPanel.js"]) {
    const source = read(form);
    assert.match(source, /<ScheduledPaymentPanel key=\{receiver\.payment\.id\} \{\.\.\.receiver\.panelProps\} \/>/, `${form}: Accounts' panel`);
    assert.match(source, /receivingId=\{receiver\.openingId\}/, `${form}: wired to the section`);
    // Recorded: the schedule and the books are read again, so Received and the balance move.
    assert.match(source, /setScheduleLedger\(saved\?\.ledger \|\| null\);/);
  }
});

test("the summary's Received, Balance Amount, Refunded and Overpaid are the server's figures", () => {
  // Nothing subtracts on screen: the figures shown are the server's.
  assert.doesNotMatch(SECTION, /updatedTotal\s*-/);
  assert.match(SECTION, /\{formatCurrency\(ledger\.balance\)\}/);
  assert.match(SECTION, /Number\(ledger\.overpaid\) > 0/);
  assert.match(SECTION, /Number\(ledger\.refunded\) > 0/);
});

test("both forms that edit a saved project pass the ledger; Create Project does not", () => {
  const form = read("sales/CreateProjectFormPanel.js");
  assert.match(form, /ledger=\{mode === "edit" \? scheduleLedger : null\}/);
  assert.match(form, /if \(current\) setScheduleLedger\(saved\?\.ledger \|\| null\);/);
  // Publishing a Sale Extra moves the Updated Total Amount, so the books are read again.
  assert.match(form, /\}, \[mode, project\?\.id, publishedNet\]\);/);
  const start = read("project-management/StartProjectFormPanel.js");
  assert.match(start, /setScheduleLedger\(saved\?\.ledger \|\| null\);/);
  assert.match(start, /ledger=\{scheduleLedger\}/);
});

test("Net Extra is in the Updated Total Amount on every form, so it matches the balance", () => {
  // Edit Sale Details' live figure where it has one, the server's Sale Extras total everywhere else.
  assert.match(SECTION, /const netExtra = publishedExtra \? Number\(publishedExtra\.net \|\| 0\) : Number\(ledger\?\.saleExtras \|\| 0\);/);
  assert.match(SECTION, /\{formatSignedRupees\(netExtra\)\}/);
  assert.match(SECTION, /\{formatCurrency\(Number\(signedQuotation \|\| 0\) \+ netExtra \+ extraQuotations\)\}/);
});
