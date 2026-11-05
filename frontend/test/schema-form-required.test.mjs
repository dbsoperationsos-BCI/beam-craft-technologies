import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import requiredProblems, { isBlank, describeMissing } from "../src/components/schema-form/requiredProblems.js";

/*
 * ── A required field that was not filled in says so, on every form in the app ────────────────
 *
 * Every form declares which of its fields are required and draws an asterisk for each. Acting on
 * that was left to each form, and most did not: the save was refused with one sentence at the top
 * naming the field, and the field itself looked exactly like one that had been answered - often on
 * a part of a long form that was scrolled off screen. The reader was told what was wrong and not
 * where, on a form with a section rail precisely because it is too long to take in at once.
 *
 * It is answered once, in `SchemaFormPanel`, from the schema it is already drawing. That is the
 * whole point: a per-form list of required fields is the thing that goes stale, and a form added
 * next year gets this without anybody remembering to give it to them.
 */

const HERE = import.meta.dirname;
const read = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");
const PANEL = read("components", "schema-form", "SchemaFormPanel.js");
const FIELDS = read("components", "schema-form", "SchemaFormFields.js");

test("blank is what a person would call blank, and zero is not", () => {
  assert.equal(isBlank(undefined), true);
  assert.equal(isBlank(null), true);
  assert.equal(isBlank(""), true);
  assert.equal(isBlank("   "), true, "whitespace counts as an answer");
  assert.equal(isBlank([]), true, "an empty file list counts as an answer");
  /*
   * `false` is blank and `0` is not, and the pair is the whole reason this is written out rather
   * than left to `!value`. A required tick nobody ticked is the thing being asked for; a quantity
   * of zero is an answer somebody typed, and refusing a form over a number that is on screen is
   * the classic way this check goes wrong.
   */
  assert.equal(isBlank(false), true, "an unticked required agreement passes as answered");
  assert.equal(isBlank(0), false, "a zero is refused as though nobody typed it");
  assert.equal(isBlank("x"), false);
  assert.equal(isBlank(["a"]), false);
  assert.equal(isBlank(true), false);
});

test("only what is on screen is asked for", () => {
  /*
   * A field behind a `when` that does not apply is not missing - it is not being asked. Reading the
   * schema flat instead would refuse forms over questions they never put: a shipment address on a
   * status form that is not a shipment, the second half of a branch nobody took.
   */
  const sections = [{
    id: "one",
    title: "One",
    fields: [
      { name: "always", label: "Always", required: true },
      { name: "hidden", label: "Hidden", required: true, when: (values) => values.mode === "full" },
    ],
  }];

  const narrow = requiredProblems(sections, [], { mode: "short" }, {});
  assert.deepEqual(Object.keys(narrow.marks), ["always"], "a field that is not on screen was demanded");

  const wide = requiredProblems(sections, [], { mode: "full" }, {});
  assert.deepEqual(Object.keys(wide.marks).sort(), ["always", "hidden"]);

  // And a whole section can be conditional the same way.
  const conditional = [{ id: "s", title: "S", when: () => false, fields: [{ name: "x", label: "X", required: true }] }];
  assert.equal(requiredProblems(conditional, [], {}, {}).hasProblems, false, "a hidden section was still demanded");
});

test("a custom field is never judged by the panel", () => {
  /*
   * `custom` is whatever the caller renders, and its value need not live under its own name in
   * `values` at all - a renderer can be a heading, a preview, or three inputs writing three other
   * keys. Marking one "Required" because `values[name]` is undefined would refuse a form over a
   * field that is complete, which is worse than the gap this closes.
   */
  const sections = [{ id: "s", title: "S", fields: [{ name: "drawn", label: "Drawn", type: "custom", required: true }] }];
  assert.equal(requiredProblems(sections, [], {}, {}).hasProblems, false, "the panel judged a field it does not draw");
});

test("the first problem is the first one on the way down the form", () => {
  /*
   * Not whichever key an object yielded first. "Scroll to the problem" is only useful if it is the
   * problem the reader would reach first; sending them to the last section of a long form to fix
   * one field, with three unfilled above it, is worse than not scrolling.
   */
  const sections = [
    { id: "first", title: "First", fields: [{ name: "a", label: "A" }] },
    { id: "second", title: "Second", fields: [{ name: "b", label: "B", required: true }] },
    { id: "third", title: "Third", fields: [{ name: "c", label: "C", required: true }] },
  ];
  const problems = requiredProblems(sections, [], {}, {});
  assert.equal(problems.firstSectionId, "second");
  assert.deepEqual(problems.labels, ["B", "C"], "the order on screen is not the order reported");

  // A lead field belongs to no section, and reports none - the panel scrolls to the top for it.
  const withLead = requiredProblems(sections, [{ name: "top", label: "Top", required: true }], {}, {});
  assert.equal(withLead.firstSectionId, null, "a lead field claimed a section it does not sit in");
  assert.equal(withLead.labels[0], "Top");
});

test("the panel refuses, marks, and scrolls - in that order", () => {
  const handler = PANEL.slice(PANEL.indexOf("function handleSubmit(event)"));
  const body = handler.slice(0, handler.indexOf("\n  }\n"));

  assert.match(body, /if \(validateRequired && problems\.hasProblems\) \{/, "the panel no longer checks its own required fields");
  assert.match(body, /event\.preventDefault\(\);/, "a form with a required field empty is submitted anyway");
  assert.match(body, /setAttempted\(true\);/, "nothing turns the marks on");
  assert.match(body, /if \(problems\.firstSectionId\) goToSection\(problems\.firstSectionId\);/, "the first problem is not scrolled to");
  assert.match(body, /else contentRef\.current\?\.scrollTo\(\{ top: 0, behavior: "smooth" \}\)/, "a lead field has nowhere to scroll to");
  // The refusal must come before the caller is reached, or the caller saves what the panel refused.
  assert.ok(body.indexOf("preventDefault") < body.indexOf("onSubmit(event)"), "the caller is called before the check");
});

test("nothing is red on a form somebody has only opened", () => {
  /*
   * The marks are held behind `attempted`. A form that opens with every empty required field
   * already red reads as a form full of mistakes before anybody has typed anything, and it teaches
   * people to ignore the colour - which is the one thing it cannot afford.
   */
  assert.match(PANEL, /const \[attempted, setAttempted\] = useState\(false\);/);
  assert.match(PANEL, /attempted && problems\.hasProblems \? \{ \.\.\.problems\.marks, \.\.\.\(errors \|\| \{\}\) \} : errors/,
    "the marks are shown before a submit, or the caller's own errors no longer win");
});

test("the caller's own message beats the panel's generic one", () => {
  // "Required" is the most the panel can know. A form that looked at the same field and found
  // something better - a date before the joining date - must not have it overwritten.
  const merged = { ...{ dob: "Required", name: "Required" }, ...{ dob: "Must be after the joining date." } };
  assert.equal(merged.dob, "Must be after the joining date.");
  assert.equal(merged.name, "Required");
  // And the notice defers the same way.
  assert.match(PANEL, /attempted && problems\.hasProblems && !notice/, "the panel talks over a caller that is already talking");
});

test("every field type can show a refusal", () => {
  /*
   * The marks are worthless on a field that cannot draw them. Four types took no `error` at all -
   * toggle, checkbox, time and file - so a required agreement, tick, time or proof document was
   * marked by the panel and rendered as though nothing were wrong.
   */
  /*
   * Checked against the component each branch actually returns, not against the `if` line: `select`
   * is a block that resolves its options before returning, so a line-based check would pass it by
   * saying nothing - which is the failure mode this test exists to catch.
   */
  const drawnBy = {
    toggle: "ToggleSwitch", checkbox: "SelectableOption", combobox: "ComboBoxField", select: "Dropdown",
    radio: "RadioGroupField", date: "DateField", phone: "PhoneField", time: "TimeField",
    file: "FileUploadField", image: "ImageUploadField", textarea: "TextAreaField", text: "TextField",
  };
  for (const [type, component] of Object.entries(drawnBy)) {
    const call = FIELDS.split("\n").find((row) => row.includes(`<${component} `));
    assert.ok(call, `the ${type} branch no longer draws ${component}`);
    assert.match(call, /error=\{error\}/, `a ${type} field cannot show that it was refused`);
  }
  // And each of those components has somewhere to put it.
  for (const component of ["ToggleSwitch", "SelectableOption", "TimeField", "FileUploadField"]) {
    const source = read("components", "shared", `${component}.js`);
    assert.match(source, /error = "",?/, `${component} takes no error prop, so the mark is dropped`);
    assert.match(source, /role="alert"/, `${component} shows no message for a refusal`);
  }
});

test("a form may opt out, and opting out does not silence the caller", () => {
  // For a draft meant to be saved half-finished. It turns off the panel's own check only.
  assert.match(PANEL, /validateRequired = true,/, "the check is no longer on by default");
  assert.match(PANEL, /requiredProblems\(validateRequired \? shownSections : \[\], validateRequired \? leadFields : \[\]/,
    "opting out no longer stops the panel computing its own problems");
  assert.match(PANEL, /errors=\{shownErrors\}/, "the fields no longer draw the merged marks");
});

test("the sentence names the fields, and does not run on", () => {
  assert.equal(describeMissing([]), "");
  assert.equal(describeMissing(["A"]), "Complete required fields: A");
  assert.equal(describeMissing(["A", "B", "C"]), "Complete required fields: A, B, C");
  assert.equal(describeMissing(["A", "B", "C", "D"]), "Complete required fields: A, B, C...",
    "a form with twenty empty fields would name all twenty in one line");
});
