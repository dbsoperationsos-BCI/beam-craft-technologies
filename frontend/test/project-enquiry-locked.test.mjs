import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * The Enquiry ID on a project that already exists.
 *
 * Which enquiry a booking is against is settled the moment it is created: every figure on the form,
 * the quotation it was priced from and the client it is for all hang off it. Re-pointing it from an
 * edit screen would move the booking to somebody else's enquiry while the rest of the form stayed
 * exactly where it was - a project quoting one client's money against another client's enquiry, with
 * nothing on screen to say so.
 *
 * So on an edit it is shown rather than offered. On **create** it must stay a picker: that is the
 * one moment the answer is being given.
 */

const HERE = import.meta.dirname;
const read = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");

const COMBOBOX = read("components", "sales", "EnquiryCombobox.js");
const SECTION = read("components", "sales", "SaleDetailsSection.js");
const CREATE = read("components", "sales", "CreateProjectFormPanel.js");
const START = read("components", "project-management", "StartProjectFormPanel.js");

test("the field is called Enquiry ID, not Select Enquiry ID", () => {
  /*
   * "Select" is an instruction, and it was still being given on a form where the field cannot be
   * selected at all. It was also the only label on that screen naming its own control rather than
   * its answer - the fields beside it read "Source Branch", not "Select Source Branch".
   *
   * The W/A Group-Name Generator was already passing this label by hand, so the two now agree
   * without either being told to.
   */
  assert.match(COMBOBOX, /label = "Enquiry ID"/, "the picker instructs rather than names again");
  assert.doesNotMatch(COMBOBOX.replace(/\/\*[\s\S]*?\*\//g, ""), /Select Enquiry ID/);
});

test("an existing project shows its enquiry; a new one is asked for it", () => {
  /*
   * Create Project holds several jobs in one panel, and `project` is whatever it was opened with:
   * a booking being edited, a converted lead, a quotation, or a duplicate. So the lock is asked of
   * the enquiry rather than of the prefill - a form holding one shows it, a form holding none asks.
   *
   * `Boolean(project)` was right for the first three by accident and wrong for the fourth: a
   * duplicate arrives with the enquiry deliberately blank, because the point is to sell the same
   * package to somebody else, and it drew a settled value around an empty string - locking the one
   * field the person had to answer.
   */
  assert.match(CREATE, /enquiryLocked=\{Boolean\(project\?\.enquiryId\)\}/, "editing a project can re-point it at another enquiry");
  assert.doesNotMatch(CREATE, /enquiryLocked=\{Boolean\(project\)\}/, "a duplicate opens with its enquiry locked around nothing");
  /*
   * Start / Edit Project always has a booking behind it, so there is nothing to decide - and it now
   * settles that by not offering the sale's fields at all. It used to render the sales
   * `SaleDetailsSection` behind a `canEditSale` permission and pass `enquiryLocked` to it; the panel
   * plans a project rather than editing the sale it was sold at, so the whole editable half went and
   * the sale is stated as a read-only card of its own. Changing a sale is Sales Manager -> Edit Sale
   * Details. Asserted as the absence of the import, because that is what makes re-pointing
   * impossible here: a locked prop is a control that refuses, and there is no control left to refuse.
   */
  assert.doesNotMatch(START, /from "@\/components\/sales\/SaleDetailsSection"/, "Start Project offers the sale's own fields again - it must state the sale, not edit it");
  assert.doesNotMatch(START, /canEditSale/, "Start Project decides again whether the sale may be edited from it");
  // And the section passes it through rather than deciding for itself - only the panel knows which
  // of its two jobs it is doing.
  assert.match(SECTION, /enquiryLocked = false \}\) \{/);
  assert.match(SECTION, /<EnquiryCombobox required readOnly=\{enquiryLocked\}/);
});

test("locked, it is drawn as a value rather than as a control that refuses", () => {
  /*
   * Not a `combobox` with `aria-expanded`, not `type="search"`, and with none of the handlers: a
   * screen reader announcing a combobox that never opens, and a search box with a clear × that
   * clears nothing, both describe a control this is not.
   */
  const locked = COMBOBOX.slice(COMBOBOX.indexOf("if (readOnly) {"), COMBOBOX.indexOf("return <div ref={rootRef}"));
  assert.ok(locked, "the picker has no read-only branch");
  assert.match(locked, /readOnly\s*\n/, "the locked input is editable");
  assert.doesNotMatch(locked, /role="combobox"/, "the locked field still announces itself as a combobox");
  assert.doesNotMatch(locked, /onFocus|onClick|onChange/, "the locked field still tries to open a list");
  // The same grey fill `ClientPhoneField` uses for a value the quotation settled, so the two read
  // alike on one form - and a line saying why, rather than a box that is simply inert.
  assert.match(locked, /bg-slate-100/);
  assert.match(locked, /cannot be changed here/);
});
