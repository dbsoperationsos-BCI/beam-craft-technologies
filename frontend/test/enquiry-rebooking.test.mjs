import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", ...parts), "utf8");
const COMBOBOX = read("src", "components", "sales", "EnquiryCombobox.js");

/*
 * Booking the same enquiry again.
 *
 * The picker used to leave out every enquiry that already had a live project, on a
 * one-project-per-enquiry rule - which left the studio no way to book a client a second time, a
 * second wedding or another event on the one enquiry, because an id cannot be typed past a filter
 * that excludes it.
 *
 * Nothing in the database held that rule (`SalesCrmLead.projects` is one-to-many with a plain index),
 * so it was never enforced either: a stale tab or two people booking at once already produced a
 * second project, silently. What replaces it is the count beside the id, so a second booking is a
 * choice somebody makes rather than one they make by accident.
 */

test("an enquiry already booked carries a count beside its id", () => {
  assert.match(COMBOBOX, /\{item\.projectCount > 0 && <span/);
  assert.match(COMBOBOX, /item\.projectCount === 1 \? "1 project" : `\$\{item\.projectCount\} projects`/);
});

test("the note is absent where there is nothing to say", () => {
  /*
   * Nearly every row is an enquiry with no project, and a "0 projects" chip on all of them would be
   * noise on the common case - and would read as a warning about the normal thing.
   */
  assert.match(COMBOBOX, /projectCount > 0/);
  assert.equal(/projectCount === 0|0 projects/.test(COMBOBOX), false);
});

test("it is drawn in the row's own heading, not in place of what the row says", () => {
  // The client's name and number stay where they were: the chip sits beside the id above them, so a
  // row that has been booked still reads as the same row.
  assert.match(COMBOBOX, /\{item\.enquiryId\}\s*\n[\s\S]{0,900}?\{item\.projectCount > 0/);
  assert.match(COMBOBOX, /\[item\.clientName, item\.clientMainNumber, item\.whatsappGroupName\]\.filter\(Boolean\)\.join\(" · "\)/);
});
