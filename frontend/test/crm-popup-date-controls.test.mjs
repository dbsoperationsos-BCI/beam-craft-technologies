import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Every date column the lead popup draws gets a calendar.
 *
 * `lastConvertedDate` did not. It was absent from `POPUP_FIELD_CONTROLS`, so it fell through to the
 * plain text box at the end of the renderer's chain - a free-text box for a date, on the one screen
 * where the value is read back by a board that sorts, filters and reports on it. "last week" was a
 * saveable answer.
 *
 * It is the **second** time that map has silently dropped a field: the comment above
 * `assignedBranch` records the first, where a rename reached the renderer and not the map and a
 * branch became free text. A hand-kept list of which columns are dates, sitting next to a renderer
 * that already knows, is a list that goes stale - so the control is derived from
 * `DATE_FILTER_COLUMNS`, the application's own answer to "which lead columns hold a day", and this
 * test is what keeps the derivation rather than the list.
 *
 * Read from the source: both constants are module-scoped inside a JSX file, which `node --test`
 * cannot import - the same reason the other CRM tests in this suite read the file.
 */

const PAGE = fs.readFileSync(path.join(process.cwd(), "src", "components", "sales", "CRMPage.js"), "utf8");

const listOf = (name) => {
  const block = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`).exec(PAGE);
  assert.ok(block, `${name} was not found`);
  return (block[1].match(/"[a-zA-Z]+"/g) || []).map((one) => one.replaceAll('"', ""));
};

const explicitControls = () => {
  const block = /const POPUP_FIELD_CONTROLS = \{([\s\S]*?)\n\};/.exec(PAGE);
  assert.ok(block, "POPUP_FIELD_CONTROLS was not found");
  return Object.fromEntries([...block[1].matchAll(/^\s*([a-zA-Z]+): "([a-z]+)"/gm)].map((m) => [m[1], m[2]]));
};

/** The keys the popup's own layouts draw, across all three verticals. */
const popupFieldKeys = () => {
  const start = PAGE.indexOf("const POPUP_FIELD_ROWS");
  const from = start === -1 ? PAGE.indexOf("const POPUP_REQUIRED_FIELDS") : start;
  const block = PAGE.slice(from, PAGE.indexOf("const POPUP_FIELD_CONTROLS"));
  return [...new Set((block.match(/"[a-zA-Z]+"\]/g) || []).map((one) => one.replace(/"|\]/g, "")))];
};

const DATE_COLUMNS = listOf("DATE_FILTER_COLUMNS");
const controlFor = (key) => explicitControls()[key] || (DATE_COLUMNS.includes(key) ? "date" : undefined);

test("the control is derived from the date columns, not listed by hand", () => {
  assert.match(PAGE, /const popupControlFor = \(key\) => POPUP_FIELD_CONTROLS\[key\] \|\| \(DATE_FILTER_COLUMNS\.includes\(key\) \? "date" : undefined\);/);
  // And the renderer asks the function rather than the raw map, or the derivation reaches nothing.
  assert.match(PAGE, /const control = popupControlFor\(key\);/);
  assert.equal(PAGE.includes("POPUP_FIELD_CONTROLS[key]") && !PAGE.includes("popupControlFor"), false);
});

test("Last Converted Date opens a calendar rather than a text box", () => {
  // The bug itself, named: it is a date column, the popup draws it, and it must not be free text.
  assert.ok(DATE_COLUMNS.includes("lastConvertedDate"), "lastConvertedDate is no longer known to be a date");
  assert.ok(popupFieldKeys().includes("lastConvertedDate"), "the popup no longer draws lastConvertedDate");
  assert.equal(controlFor("lastConvertedDate"), "date");
});

test("every date column the popup draws gets a calendar, whichever it is", () => {
  /*
   * The general form, so the next date field added to a layout cannot repeat this. A key that is
   * both a known date column and drawn by the popup has exactly one right answer.
   */
  const drawn = popupFieldKeys().filter((key) => DATE_COLUMNS.includes(key));
  assert.ok(drawn.length >= 2, `expected the popup to draw some date columns, saw ${drawn.join(", ")}`);
  for (const key of drawn) assert.equal(controlFor(key), "date", `${key} would be drawn as a text box`);
});

test("the map no longer keeps its own copy of a date column", () => {
  /*
   * `dateOfBirthOrEdod: "date"` was the duplicate that made the omission of `lastConvertedDate` look
   * deliberate - one date field listed, one not, and nothing to say which was the mistake. The map
   * is for columns needing something their type would not give them.
   */
  for (const [key, control] of Object.entries(explicitControls())) {
    assert.equal(control === "date", false, `${key} is a date listed by hand; the derivation already covers it`);
  }
});

test("a field that is not a date is left alone", () => {
  // The derivation must not turn the rest of the popup into calendars.
  for (const key of ["offerType", "location", "estimatedValue", "name"]) {
    assert.notEqual(controlFor(key), "date", `${key} should not be drawn as a date`);
  }
  assert.equal(controlFor("assignedBranch"), "branch");
  assert.equal(controlFor("relationship"), "combo");
});
