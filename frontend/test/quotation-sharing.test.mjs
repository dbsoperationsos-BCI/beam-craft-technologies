import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Sharing a quotation with colleagues.
 *
 * A quotation is narrowed to the people whose work it is - whoever follows the enquiry up, whoever
 * books the project it became. Share with is how it reaches somebody else: they may read **and**
 * change it, and they get the whole chain, because the register's row is the chain and its versions
 * hang under it.
 *
 * Reads the source, the way the other panel tests here do: there is no DOM in this suite. What the
 * server does with the list is `backend/test/data-scope-quotations.test.js`.
 */

const HERE = import.meta.dirname;
const src = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");
const PANEL = src("components", "sales", "QuotationGeneratorPanel.js");

test("the picker sits on the quotation form, under the brand, and is a multi-select of employees", () => {
  // `MultiSelectField`, not a list typed out here: the control for picking several already exists.
  assert.match(PANEL, /<MultiSelectField\n\s+label="Share with"/);
  assert.match(PANEL, /brandConfigError && <p[\s\S]{0,400}?<MultiSelectField/, "under the Quotation Brand block");
  assert.match(PANEL, /values=\{sharedWith\}/);
  assert.match(PANEL, /options=\{shareOptions\}/);
});

test("somebody whose roles cannot open Quotations is not offered at all", () => {
  /*
   * A share widens which quotations somebody reaches; it cannot put them on the screen, which is
   * still SALES / Quotation Management on the route. They were listed marked "no access to
   * Quotations" and could still be picked - a choice that does nothing - so the server leaves them
   * out and the picker is the people a share would actually reach.
   */
  const controller = fs.readFileSync(path.join(HERE, "..", "..", "backend", "src", "modules", "sales", "projects", "controller.js"), "utf8");
  assert.match(controller, /return res\.json\(\{ data: people\.filter\(\(row\) => readers\.has\(row\.id\)\) \}\);/);
  assert.doesNotMatch(PANEL, /no access to Quotations"\`|canOpenQuotations \?/);
  assert.match(PANEL, /label: person\.employeeName,/);
  // And a studio where nobody else holds it says so, rather than offering an empty list.
  assert.match(PANEL, /"Nobody else holds Quotation Management"/);
});

test("sharing an existing quotation saves itself and raises no version", () => {
  /*
   * A version is the document the client receives - "this replaces what I sent you". Who at the
   * studio can open it is not part of that, so the picker writes straight through its own endpoint
   * instead of riding on Save changes, which would raise a version for it. A quotation being
   * created has no chain to write to yet, so there the list goes with the first save.
   */
  assert.match(PANEL, /const savesShareItself = Boolean\(initialQuotation\?\.id\) && !isDraft;/);
  assert.match(PANEL, /await saveQuotationShares\(initialQuotation\.id, next\.map\(Number\)\.filter\(Boolean\)\)/);
  assert.match(PANEL, /canShare && !savesShareItself \? \{ sharedEmployeeIds/);
  // A list the server refused is put back, so the screen never claims a share that was not made.
  assert.match(PANEL, /setSharedWith\(previous\);/);
  assert.match(src("services", "sales", "projects.service.js"), /\/shares`, \{\n\s+method: "PUT"/);
});

test("the save carries the list, and never clears one it was not given", () => {
  assert.match(PANEL, /sharedEmployeeIds: sharedWith\.map\(Number\)\.filter\(Boolean\)/);
  // An edit opened on something that never carried the shares leaves them alone: the server reads
  // the field's absence as "unchanged", so the form must not send an empty list it invented.
  assert.match(PANEL, /const sharesKnown = !initialQuotation \|\| Array\.isArray\(initialQuotation\.sharedWith\)/);
  assert.match(PANEL, /\.\.\.\(sharesKnown && canShare && !savesShareItself \? \{ sharedEmployeeIds/);
  assert.match(PANEL, /\{sharesKnown && <MultiSelectField/);
});

test("somebody a quotation was shared with reads the list but does not set it", () => {
  // A sharee edits the quotation; who else it reaches stays with the people whose own work it is,
  // so the list is read-only for them and the save carries no list at all.
  assert.match(PANEL, /const canShare = !initialQuotation \|\| initialQuotation\.canShare !== false;/);
  assert.match(PANEL, /readOnly=\{!canShare\}/);
  assert.match(PANEL, /sharesKnown && canShare && !savesShareItself \? \{ sharedEmployeeIds/);
});

test("the form reopens on the people it was shared with", () => {
  assert.match(PANEL, /useState\(\(\) => \(initialQuotation\?\.sharedWith \|\| \[\]\)\.map\(\(person\) => String\(person\.employeeId\)\)\)/);
  // The list is read from the one endpoint that also says who can open Quotations.
  assert.match(PANEL, /getQuotationShareCandidates\(\)/);
  assert.match(src("services", "sales", "projects.service.js"), /apiRequest\("\/api\/sales\/quotations\/share-candidates"\)/);
});
