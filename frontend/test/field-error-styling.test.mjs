import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * A refused field has to *look* refused.
 *
 * Every form in the application marks a problem the same way: a red border on the control and the
 * message under it. The message half was reliable; the border was not, and the two ways it went
 * missing both left a field that had been refused looking exactly like one that had been answered —
 * on a form where everything around it had reddened, which reads as "this one is fine".
 *
 *   1. `Dropdown` has two triggers. The standard one is a button and takes its classes from
 *      `triggerClassName`, which carries the error colours. A **searchable** one is a wrapper around
 *      a text input, has its own classes, and had the border hard-coded to `border-slate-300`. Every
 *      searchable dropdown was affected: on the employee form that is Designation, Vertical, Reports
 *      To, Referred By and both work locations — the fields HR must answer before an account exists.
 *
 *   2. `SchemaFormFields` did not pass `error` to the combo box or the radio group at all, so those
 *      two showed neither border nor message. The employee panel draws its own fields and had always
 *      passed it; the public onboarding form draws Emergency Contact Relationship through the shared
 *      renderer, and that is where it showed.
 *
 * Read from the source, the way the other form tests here do: there is no DOM in this suite.
 */

const HERE = import.meta.dirname;
const read = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");

const DROPDOWN = read("components", "shared", "Dropdown.js");
const RENDERER = read("components", "schema-form", "SchemaFormFields.js");

test("a searchable dropdown reddens when it is refused", () => {
  const trigger = DROPDOWN.slice(DROPDOWN.indexOf("const searchableTrigger = ("));
  const wrapper = trigger.slice(0, trigger.indexOf("<input"));
  assert.match(wrapper, /\$\{error \? "border-red-400/, "the searchable trigger ignores its error again");
  // The border colour has to be the conditional one, not a hard-coded grey sitting beside it.
  assert.doesNotMatch(wrapper, /border border-slate-300/, "the searchable trigger hard-codes a grey border");
});

test("both of the dropdown's triggers redden the same way", () => {
  // One control, two renderings; a reader cannot tell which one they are looking at, so they must
  // not differ in whether they can show a problem.
  const standard = DROPDOWN.slice(DROPDOWN.indexOf("const triggerClassName ="), DROPDOWN.indexOf("const standardTrigger"));
  assert.match(standard, /border-red-400/, "the standard trigger no longer reddens");
  const searchable = DROPDOWN.slice(DROPDOWN.indexOf("const searchableTrigger = ("));
  assert.match(searchable.slice(0, searchable.indexOf("<input")), /border-red-400/);
});

test("the searchable trigger uses focus-within, since the focus is on the input inside it", () => {
  // `focus:` would never match: the wrapper is a div and the focus lands on the input it holds, so
  // the ring would simply never appear.
  const trigger = DROPDOWN.slice(DROPDOWN.indexOf("const searchableTrigger = ("));
  const wrapper = trigger.slice(0, trigger.indexOf("<input"));
  assert.match(wrapper, /focus-within:border-red-500/);
  assert.doesNotMatch(wrapper, /[^-]focus:border-red/, "the searchable trigger is using focus: where the focus is on its child");
});

test("every renderer that draws a field able to show an error is handed one", () => {
  /*
   * The property, rather than a list: a renderer whose component accepts `error` must pass it. The
   * five that do not appear here take no `error` prop at all — a toggle, a checkbox, a time and a
   * file field have nowhere to put one, and `custom` is drawn by the caller.
   */
  for (const type of ["combobox", "select", "radio", "date", "phone", "image", "textarea"]) {
    const line = new RegExp(`if \\(type === "${type}"\\)[\\s\\S]{0,400}?error=\\{error\\}`);
    assert.match(RENDERER, line, `the "${type}" renderer does not pass its error through`);
  }
  // The fallback at the end is the plain text field, which has always had it.
  assert.match(RENDERER, /return <TextField label=\{label\} required=\{required\} error=\{error\}/);
});

/* ------------------------------------------------- the multi-answer fields, Department among them */

test("Department is required, and is one of the fields the credentials page checks", () => {
  /*
   * It is answered on the Login Credentials page and somebody can belong to two departments, so it
   * is the one required field on that page that takes several answers. Required by carrying `true`
   * in its tuple and by nothing else, which is why it is worth asserting directly: a field that
   * quietly stops being required is invisible in a diff.
   */
  const PANEL = read("components", "employees", "EmployeeFormPanel.js");
  assert.match(PANEL, /\["department", "Department", "multiselectCompact", true, departmentOptions\]/, "Department is no longer a required field");
});

test("an empty multi-select counts as unanswered", () => {
  /*
   * The wrapper stores `next.join(", ")`, so no selection is `""` — which is what makes the shared
   * `hasRequiredValue` refuse it without needing a rule of its own for lists. Storing an array
   * would have worked by accident (`String([])` is also `""`); this is the join that makes it
   * deliberate, and it is what "at least one has to be picked" rests on.
   */
  const PANEL = read("components", "employees", "EmployeeFormPanel.js");
  assert.match(PANEL, /onChange=\{\(next\) => onChange\(field, next\.join\(", "\)\)\}/);
  assert.match(PANEL, /return typeof value === "boolean" \? value : String\(value \?\? ""\)\.trim\(\)\.length > 0;/);
});

test("a refused multi-select reddens and says so", () => {
  // It was enforced but unmarked: the save refused and named Department, while the control itself
  // stayed grey on a page where every other unanswered field had reddened.
  const MULTI = read("components", "shared", "MultiSelectField.js");
  assert.match(MULTI, /\$\{error \? "border-red-400/, "MultiSelectField does not redden when refused");
  assert.match(MULTI, /role="alert" className="mt-1\.5 font-normal text-red-600"/, "MultiSelectField does not say what is wrong");
  // And the two wrappers hand it over — the bug was never in the shared control, it was the thread.
  const PANEL = read("components", "employees", "EmployeeFormPanel.js");
  assert.match(PANEL, /if \(type === "multiselectCompact"\) return <CompactMultiSelectField[^>]*error=\{error\}/);
  assert.match(PANEL, /if \(type === "multiselect"\) return <MultiSelectField[^>]*error=\{error\}/);
});
