import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Two ways Save Project refused without giving anybody a way forward.
 *
 * Both were invisible in the sense that matters: the form looked complete, the button looked live,
 * and pressing it either named a field that could not be answered or said nothing at all.
 */

const HERE = import.meta.dirname;
const read = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");

const PANEL = read("components", "sales", "CreateProjectFormPanel.js");
// Read as source rather than imported: the module it lives in renders JSX, which `node --test`
// cannot parse. The rule is a single line, so reading it is enough to hold the premise below.
const SALE = read("components", "sales", "SaleDetailsSection.js");
const SHELL = read("components", "schema-form", "SchemaFormPanel.js");

test("the Signed Quotation box is offered only where no quotation answered it", () => {
  /*
   * The rule turns on the quotation, not on which job the panel is doing.
   *
   * With one chosen the figure is that document's and what the client was sent, so it is shown and
   * not offered - on Create Project and on Edit Sale Details alike. It was `mode === "edit"`, which
   * let Edit Sale Details retype a quotation's amount: the one place on this screen where the figure
   * could be changed by somebody the Projects permission was never meant to reach.
   *
   * With no quotation nobody has written the number down anywhere, so this is the box it gets
   * written in - New Project from nothing, a CRM lead with no budget, and a duplicate all book that
   * way, and closing the field for them left the money unrecordable.
   */
  assert.match(PANEL, /const quotationLinked = Boolean\(String\(form\.quotationId \|\| ""\)\.trim\(\)\);/);
  // Typing stops it following the lines, clearing hands it back - see project-lines-signed-quotation.test.mjs.
  assert.match(PANEL, /onSignedQuotationChange=\{quotationLinked \? undefined : \(value\) => \{ setSignedFollowsLines\(value === ""\); update\("initialConvertedValue", value\); \}\}/);
  assert.doesNotMatch(PANEL, /onSignedQuotationChange=\{mode === "edit"/, "the box is decided by the job again rather than by the quotation");
});

test("and so does not demand it either", () => {
  /*
   * Not demanded, which is a separate decision from being answerable.
   *
   * It was required while nothing on the screen could answer it, which is what refused a booking at
   * no quotation with "Complete required fields: Signed Quotation" against a box with no way into
   * it. The box is open now wherever no quotation answered it, so requiring it would no longer be a
   * dead end - except for the one case left, a quotation carrying no amount, where the field is
   * read-only and blank. It stays optional until that is decided: the backend takes `min(0)`, and
   * the schedule says every share works out at zero until the figure is set.
   */
  assert.doesNotMatch(SALE, /\["initialConvertedValue", "Signed Quotation"\]/, "a field the booking form cannot answer is required by it");
  assert.match(SALE, /const required = \[\["enquiryId", "Choose the enquiry\."\], \["whatsappGroupName", "Choose or enter the WhatsApp group name\."\], \["sourceBranch", "Choose the source branch\."\]\]/);
  // The number and, for a typed group name, the vertical are checked beside them, each under its box.
  assert.match(SALE, /problems\.clientMainNumber = isPhoneValid\(form\)/);
  assert.match(SALE, /problems\.groupType = /);
});

test("the Projects page is where the amount is answered", () => {
  // Start and Edit Project alike - reached through `PROJECT / Projects` READ_WRITE, as it already was.
  const START = read("components", "project-management", "StartProjectFormPanel.js");
  assert.match(START, /onSignedQuotationChange=\{\(value\) => setForm\(\(current\) => \(\{ \.\.\.current, initialConvertedValue: value \}\)\)\}/);
});

test("pressing the primary button again always lets the same refusal be said again", () => {
  /*
   * The panel remembers a dismissed notice by its message, which is what made a second press do
   * nothing visible: the same refusal set the same string, the string still matched the dismissal,
   * and the notice stayed hidden. The five-second auto-dismiss meant waiting was enough to get
   * there - no click on the × required.
   *
   * Cleared on submit rather than left to each form to clear its error first, so a form that
   * forgets cannot go silent again.
   *
   * Read out of `handleSubmit` rather than off the `onSubmit` attribute: the panel refuses its own
   * required fields before the caller is reached, so the press has two endings now. **Both** have
   * to un-dismiss, and the one that returns early is the easier of the two to leave out - it is the
   * path where the panel itself is the one with something to say.
   */
  const handler = SHELL.slice(SHELL.indexOf("function handleSubmit(event)"));
  const body = handler.slice(0, handler.indexOf("\n  }\n") + 4);
  assert.ok(body.includes("handleSubmit"), "handleSubmit has moved or been renamed");
  assert.match(SHELL, /onSubmit=\{handleSubmit\}/, "the form no longer submits through handleSubmit");
  assert.equal((body.match(/setDismissedError\(""\)/g) || []).length, 2,
    "one of the two ways a press can end no longer un-dismisses, so that refusal can go silent");
  // The dismissal is still by message, so the clearing above is what the fix rests on.
  assert.match(SHELL, /shownNotice && shownNotice\.message !== dismissedError \? shownNotice : null/);
});

test("the refusals a press can raise are all reachable after a dismissal", () => {
  /*
   * Each of these sets an error and returns without clearing it first, which is exactly the shape
   * that went silent. They are safe now because the shell un-dismisses on the press rather than
   * because the panel changed - so this names them, and would notice a fourth being added.
   */
  const submit = PANEL.slice(PANEL.indexOf("async function submit("), PANEL.indexOf("return <SchemaFormPanel"));
  assert.ok(submit, "submit has moved");
  // The sale fields are marked under their own boxes, the banner saying only how many.
  assert.match(submit, /if \(!saleFields\.check\(saleFieldProblems\(form\)\)\) \{/);
  assert.match(submit, /Signed Quotation, under Shedule Payment, must be zero or a positive amount\./);
  assert.match(submit, /Fill in the required fields in Payment Received before creating the project\./);
});

test("a gift's Assigned To dropdown is shown only while that gift is Applicable", () => {
  const START = read("components", "project-management", "StartProjectFormPanel.js");
  assert.match(START, /\{form\.welcomeGift === "Applicable" && <EmployeeDropdown label="Welcome Gift Assigned To" required /);
  assert.match(START, /\{form\.shootCompletedGift === "Applicable" && <EmployeeDropdown label="Shoot Completed Gift Assigned To" required /);
});
