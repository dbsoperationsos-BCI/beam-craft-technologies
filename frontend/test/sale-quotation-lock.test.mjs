import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(HERE, "..", "src", "components", "sales", "SaleDetailsSection.js"), "utf8");
const schedule = fs.readFileSync(path.join(HERE, "..", "src", "components", "project-management", "SchedulePaymentSection.js"), "utf8");

/*
 * What a quotation settles about the sale, and what the form may still be asked.
 *
 * A project converts at a quotation: the figure, the number and the branch on it are what the
 * client was actually sent, so a project that disagreed with its own quotation would leave nothing
 * to say which of the two is right. The three fields are therefore filled from the version that is
 * picked and closed to typing - but only where that version answers them, because a quotation
 * raised without a branch cannot settle one and somebody still has to say what it is.
 *
 * Read from the source rather than a render: these are three separate props on three different
 * controls, and the failure worth catching is one of them being wired and the others forgotten.
 */

test("picking a quotation fills the number, the branch and the amount from it", () => {
  const block = source.slice(source.indexOf("function selectQuotation"), source.indexOf("const selectedQuotation"));
  assert.match(block, /initialConvertedValue:/, "the amount is not taken from the quotation");
  assert.match(block, /clientMainNumber: quotation\?\.clientMainNumber \?/, "the client number is not taken from the quotation");
  assert.match(block, /sourceBranch: quotation\?\.sourceBranch &&/, "the source branch is not taken from the quotation");
});

test("a field the quotation does not answer keeps what the form has", () => {
  // Every one of the three falls back to `current`, so a quotation with no branch on it leaves the
  // branch as it was and open to be chosen - the one thing nobody has written down yet is the one
  // thing the form still asks for.
  const block = source.slice(source.indexOf("function selectQuotation"), source.indexOf("const selectedQuotation"));
  for (const field of ["initialConvertedValue", "clientMainNumber", "sourceBranch", "countryCode"]) {
    assert.match(block, new RegExp(`current\\.${field}`), `${field} does not fall back to what the form holds`);
  }
});

test("the number and the branch lock, each on whether the quotation actually set it", () => {
  assert.match(source, /clientMainNumber: Boolean\(selectedQuotation\?\.clientMainNumber\)/);
  assert.match(source, /sourceBranch: Boolean\(selectedQuotation\?\.sourceBranch\)/);
  assert.match(source, /readOnly=\{setByQuotation\.clientMainNumber\}/, "the client number field does not lock");
  assert.match(source, /readOnly=\{setByQuotation\.sourceBranch\}/, "the source branch field does not lock");
});

/*
 * The amount is the one of the three that moved, and it is no longer locked.
 *
 * It used to sit in this section, filled from the quotation and closed to typing on the plain
 * presence of one. It is asked for as **Signed Quotation** in Shedule Payment now - still filled
 * from the quotation by `selectQuotation` above, and editable there, beside the rows that are
 * shares of it. So the project may be booked at a figure that differs from the quotation it names;
 * that is a deliberate loosening, and the two assertions below are what say so out loud.
 */

test("the sale's own fields no longer ask what the project converts at", () => {
  // The control, not the words: the comments here still explain where the figure went, and should.
  assert.equal(/label="Initial Converted Value"/.test(source), false, "the amount field is still in the sale's fields");
  assert.equal(source.includes("AmountField"), false, "the amount field's component is still here");
  assert.equal(/readOnly=\{Boolean\(form\.quotationId\)\}/.test(source), false, "the old locked amount field is still here");
});

test("the schedule takes the figure as an answer where its caller offers one", () => {
  // Create Project passes `onSignedQuotationChange`; Start / Edit Project does not, and there the
  // figure stays a statement of what the sale settled.
  assert.match(schedule, /onSignedQuotationChange/, "the schedule cannot be given an editable figure");
  assert.match(schedule, /onSignedQuotationChange\s*\n?\s*\?/, "the schedule does not choose between an input and a figure");
});

test("moving to another enquiry gives up the quotation that was picked", () => {
  // Otherwise the form names a quotation from the previous enquiry while this one's values are
  // written underneath it, and the amount stays locked to a figure taken from nowhere.
  assert.match(source, /nextEnquiryId === current\.enquiryId \? \{\} : \{ quotationId: "", quotationRowId: "" \}/);
});
