import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { cashEntryFormSections, cashEntryInitialValues, cashEntryPayload, projectAdvanceFormSections } from "../src/constants/accountsConfig.js";

/*
 * What a payment **received through a mode that carries a remark** is asked for - "Other" out of the
 * box - in the two places one is recorded: Accounts → Cash Entry and Payment Received on the project
 * form, which is one section serving Create Project, Bookings & Converted and Quotations.
 *
 * **Receiver** goes there and only there. A payment that arrived by some arrangement the list does
 * not name has the remark to say what happened, and the person filing it is the person it happened
 * to, so the box repeated what the login already says - on the form that books a project. Every
 * other mode asks exactly as it did, in both directions.
 *
 * **Payment Mode Details** did not go so much as get its real name: it is a remark about the payment
 * mode, which is a different question from the entry's Description - that one is about the payment as
 * a whole, and stays optional.
 */

const received = { ...cashEntryInitialValues, entryType: "Received", paymentMode: "Other" };
const receivedByCash = { ...cashEntryInitialValues, entryType: "Received", paymentMode: "Cash" };
const spent = { ...cashEntryInitialValues, entryType: "Spent", paymentMode: "Other" };
const context = { options: {}, modesWithDetails: ["Other"], modesWithAccount: [], modesWithTransactionId: [] };
/*
 * Which boxes the form actually draws, which is a field's own `when` answered against the values -
 * the same question `visibleFields` asks in `SchemaFormFields`. Asked here rather than imported from
 * there, that module being JSX and this a plain node test.
 */
const shown = (values, sections = cashEntryFormSections) => sections
  .flatMap((section) => section.fields.filter((field) => !field.when || field.when(values, context)))
  .map((field) => field.name);

test("only a received payment whose mode carries a remark is not asked who received it", () => {
  const onOther = shown(received);
  assert.equal(onOther.includes("handler"), false, "the remark says what happened, and the filer is the receiver");
  assert.equal(onOther.includes("handlerOtherName"), false);

  // Every other mode asks as it always did - this is the half that was left alone.
  assert.equal(shown(receivedByCash).includes("handler"), true, "money received by cash still names who took it");
  assert.equal(shown(spent).includes("handler"), true, "and money out always names who paid it");

  // The advance on the project form follows the same rule, being the same section.
  assert.equal(shown(received, projectAdvanceFormSections).includes("handler"), false);
  assert.equal(shown(receivedByCash, projectAdvanceFormSections).includes("handler"), true);
});

test("the mode's box is Remarks, and the entry's Description is a separate question", () => {
  const source = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "constants", "accountsConfig.js"), "utf8");
  // One field renamed, not a new column: every explanation already recorded reads back under it.
  assert.match(source, /name: "paymentModeOther",\s*\n\s*label: "Remarks",\s*\n\s*required: true,/);
  // Shown for the modes the studio marked as asking for one - "Other" out of the box - and for both
  // directions, since a mode says as little about money out as it does about money in.
  const onReceived = shown(received);
  assert.equal(onReceived.includes("paymentModeOther"), true);
  assert.equal(shown(spent).includes("paymentModeOther"), true);
  // Description stays, and stays optional: it is about the payment, not about the mode.
  assert.equal(onReceived.includes("description"), true);
  assert.match(source, /name: "description", label: "Description"/);
  assert.equal(/name: "description"[^}]*required: true/.test(source), false, "the description is not the mandatory note");
});

test("the column that reads a handler back still covers every row it holds", () => {
  /*
   * Narrowing its heading to "Paid By" was wrong about money. Entries filed before the receiver
   * stopped being asked **do** carry one, so a name belonging to whoever took the studio's money in
   * would have been printed under a heading saying they paid it out. The heading has to cover a
   * receiver on an old entry, a payer on money out, and nothing on a received entry filed since.
   */
  const source = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "constants", "accountsConfig.js"), "utf8");
  assert.match(source, /\["handlerName", "Received \/ Paid By"/);
  assert.match(source, /\[\["handlerName", "Received \/ Paid By"\]/);
  /*
   * And where the remark is read back it says what it is a remark *about*: in the table and the info
   * panel it sits beside Description with nothing to tell the two apart, whereas on the form it is
   * directly under Payment Mode, where "Remarks" is unambiguous.
   */
  assert.match(source, /\["paymentModeOther", "Payment Mode Remarks"/);
  assert.match(source, /\["paymentModeOther", "Payment Mode Remarks"\]/);
});

test("nothing is sent where the form did not ask, and everything where it did", () => {
  /*
   * The payload is the last place a receiver could be smuggled onto an entry nobody was asked about:
   * a name left behind by choosing a mode and then changing it. The server stores nothing for those
   * either, but the two must agree, because the browser is what decides whether the entry is savable.
   */
  const payload = cashEntryPayload({ ...received, category: "Advance", amount: "25000", entryDate: "2026-10-06", paymentModeOther: "Cheque number", handler: "7", handlerOtherName: "Ravi" }, {}, context);
  assert.equal(payload.handlerEmployeeId, null);
  assert.equal(payload.handlerName, null);
  assert.equal(payload.handlerIsOther, false);
  assert.equal(payload.paymentModeOther, "Cheque number", "the remark is what the mode's box holds");

  // Money received by any other mode sends it, as it always did.
  const byCash = cashEntryPayload({ ...receivedByCash, category: "Advance", amount: "25000", entryDate: "2026-10-06", handler: "7" }, {}, context);
  assert.equal(byCash.handlerEmployeeId, 7);

  // And so does money out.
  const out = cashEntryPayload({ ...spent, category: "Travel", amount: "500", entryDate: "2026-10-06", paymentModeOther: "Cheque", paidTo: "Ravi", handler: "7" }, { shootId: "sht_1" }, context);
  assert.equal(out.handlerEmployeeId, 7);
  assert.equal(out.handlerIsOther, false);
});

test("the column the remark is stored in keeps reading files saved under its old heading", () => {
  /*
   * Headings are matched by name, so a renamed column stops being found in a spreadsheet the studio
   * saved earlier - and because this one is not required, the import would have succeeded with the
   * remark quietly missing. `aliases` is the fix, and both importers read it: an inspection in the
   * browser that accepts a file the server then ignores would be worse than refusing it.
   */
  const columns = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "constants", "importColumns.js"), "utf8");
  assert.match(columns, /column\("paymentModeOther", "Remarks", false, \["Payment Mode Details"\]\)/);
  const inspector = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "lib", "tableImport.mjs"), "utf8");
  assert.match(inspector, /const headingsOf = \(column\) => \[column\.label, \.\.\.\(column\.aliases \|\| \[\]\)\]/);
});
