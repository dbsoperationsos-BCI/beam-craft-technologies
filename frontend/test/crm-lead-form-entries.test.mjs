import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { AUTO_FILLED_LEAD_FIELDS, leadFormHasEntries } from "../src/lib/crmLeadForm.mjs";

/*
 * What counts as having typed into Add Lead, which is what decides whether the browser is allowed
 * to take the page down without asking.
 *
 * Closing Add Lead keeps its draft on purpose, so the × needs no question. A reload or a closed tab
 * is the one way that draft really disappears - and the form is never empty, so "has anything been
 * entered" cannot be a comparison against a blank one. It opens carrying today's date, the current
 * time, a vertical, a status and one blank shoot row, and warning on those would put a prompt in
 * front of somebody who opened the form and changed their mind.
 */

/** The form as `emptyLeadForm()` builds it: the auto-filled answers and nothing else. */
const opened = () => ({
  id: "",
  customFields: {},
  name: "",
  addedTime: "09:41 am",
  createdDate: "2026-09-15",
  phone: "",
  vertical: "Dum Dum",
  crm: "",
  leadStatus: "Interested",
  nextFollowUpDate: "2026-09-15",
  nextFollowUpTime: "",
  remarks: "",
  remarkEntries: [],
  attachments: [],
  shoots: [{ shootType: "", venue: "", district: "", date: "", time: "" }],
});

test("a form nobody has touched holds nothing, however much it is carrying", () => {
  assert.equal(leadFormHasEntries(opened()), false);
  // Every one of these is the form answering for itself, so none of them is evidence of typing.
  for (const key of AUTO_FILLED_LEAD_FIELDS) {
    assert.equal(leadFormHasEntries({ ...opened(), [key]: "something else" }), false, `${key} counted as typing`);
  }
});

test("one typed field is enough, wherever it sits", () => {
  assert.equal(leadFormHasEntries({ ...opened(), name: "Gopala Krishnan" }), true);
  assert.equal(leadFormHasEntries({ ...opened(), phone: "8838495720" }), true);
  // A custom field is an answer keyed by field, not a column of its own.
  assert.equal(leadFormHasEntries({ ...opened(), customFields: { budget: "2,00,000" } }), true);
  // And a shoot row is judged by what is in it - the blank one the form opens with is not an entry.
  assert.equal(leadFormHasEntries({ ...opened(), shoots: [{ shootType: "Wedding", venue: "" }] }), true);
  assert.equal(leadFormHasEntries({ ...opened(), remarkEntries: [{ text: "called once" }] }), true);
});

test("whitespace is not an answer", () => {
  // Somebody who tabbed through the form and left a stray space has not written a lead down.
  assert.equal(leadFormHasEntries({ ...opened(), name: "   " }), false);
  assert.equal(leadFormHasEntries({ ...opened(), shoots: [{ venue: "  " }] }), false);
});

test("nothing at all is not an entry either", () => {
  for (const value of [null, undefined, "", 0, []]) assert.equal(leadFormHasEntries(value), false, `${JSON.stringify(value)} read as typed`);
});

test("every way out that somebody chooses asks first, and empties the form after", () => {
  const PAGE = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "sales", "CRMPage.js"), "utf8");
  // The ×, Cancel, Escape and a press on the dim behind the form: all four, or the one that was
  // missed becomes the way people lose a lead.
  assert.match(PAGE, /const requestCloseAddLead = \(\) => guardAddLeadClose\(\(\) => closeAddLead\(\)\);/);
  assert.match(PAGE, /useEscapeKey\(requestCloseAddLead, showAddLead\);/);
  assert.match(PAGE, /onMouseDown=\{requestCloseAddLead\}/);
  assert.match(PAGE, /onClick=\{requestCloseAddLead\} aria-label="Close add lead"/);
  assert.match(PAGE, /onClick=\{requestCloseAddLead\} disabled=\{addingLead\}>Cancel<\/Button>/);
  // Asked about what was typed, not about the answers the form filled in for itself.
  assert.match(PAGE, /useUnsavedGuard\(\s*\(\) => leadFormHasEntries\(addLeadForm\),/);
  // Above the form, or the question is drawn behind it and reads as a Cancel that did nothing.
  assert.match(PAGE, /<ConfirmDialog \{\.\.\.addLeadCloseConfirmProps\} layer="dialogOverPanel" \/>/);
  // And closing really discards now, which is what makes the dialog's offer true.
  assert.match(PAGE, /function closeAddLead\(\) \{[\s\S]{0,200}?setAddLeadForm\(emptyLeadForm\(\)\);/);
  // And no browser prompt on top of it: two questions for one decision - ours, then Chrome's
  // generic "Reload site?" over it - reads as the application asking twice.
  assert.doesNotMatch(PAGE, /useUnloadWarning/, "the browser prompt is back on top of our own dialog");
});

test("saving and opening the duplicate are not asked about", () => {
  const PAGE = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "sales", "CRMPage.js"), "utf8");
  /*
   * Both empty the form deliberately - one because the lead has just been written, the other
   * because what the form held was a second copy of a client the CRM already has - so each calls
   * `closeAddLead` directly. Asking there would be a dialog about a decision already taken.
   */
  assert.match(PAGE, /\/\/ Unguarded on purpose: this lead has just been written[\s\S]{0,200}?closeAddLead\(\);/);
  assert.match(PAGE, /the decision, and what the form held was a second copy of it\.\s*\n\s*closeAddLead\(\);/);
});
