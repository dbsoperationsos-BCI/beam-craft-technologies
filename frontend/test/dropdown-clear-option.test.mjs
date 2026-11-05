import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { CLEAR_OPTION_VALUE, normalizeOptions, sortOptionsByLabel, withClearOption } from "../src/lib/dropdownOptions.mjs";

/*
 * A dropdown could be answered, and then never unanswered.
 *
 * The menu only ever moved a field from one option to another, so an **optional** field answered by
 * mistake stayed answered. Where it cost something real: Referred By on an employee names who
 * referred them, and the referral register is that answer - so somebody added to it in error could
 * not be taken off, because the field that records the referral could not be emptied and the
 * endpoint only removes the referral when it is sent an empty one.
 *
 * Read from the source, the way the other form tests here do: there is no DOM in this suite.
 */

const HERE = import.meta.dirname;
const read = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");

const DROPDOWN = read("components", "shared", "Dropdown.js");
const EMPLOYEE_FORM = read("components", "employees", "EmployeeFormPanel.js");
const RENDERER = read("components", "schema-form", "SchemaFormFields.js");

test("the clear row carries the empty value every caller already reads as no answer", () => {
  const [first] = withClearOption(normalizeOptions(["Haldi", "Wedding"]));
  assert.equal(first.value, CLEAR_OPTION_VALUE);
  assert.equal(first.label, "None");
});

test("the clear row is first, and stays first however the options sort", () => {
  const options = withClearOption(sortOptionsByLabel(normalizeOptions(["Zoya", "Aarav", "Meera"])));
  assert.deepEqual(options.map((option) => option.label), ["None", "Aarav", "Meera", "Zoya"]);
});

// Two rows that both mean "nothing" is the menu asking a question it has already answered - and the
// second would be unreachable anyway, since both carry the same value.
test("a list that already offers an empty value is left exactly as it was", () => {
  const listed = normalizeOptions([{ label: "Any", value: "" }, { label: "Haldi", value: "Haldi" }]);
  assert.deepEqual(withClearOption(listed), listed);
});

test("a caller may name the row something else", () => {
  assert.equal(withClearOption(normalizeOptions(["Aarav"]), { label: "No employee" })[0].label, "No employee");
});

test("nothing to offer is still an empty list rather than a throw", () => {
  assert.deepEqual(withClearOption(), [{ label: "None", value: "", clear: true }]);
  assert.deepEqual(withClearOption(null), []);
});

// The row is worth nothing on a field nobody has answered - the placeholder says "Select" already -
// and it must not appear on a required field, where the save would refuse the answer it gives.
test("the menu offers the row only when it is asked to and something is selected", () => {
  assert.match(DROPDOWN, /const answered = value !== CLEAR_OPTION_VALUE && value !== null && value !== undefined;/);
  assert.match(DROPDOWN, /clearable && answered \? withClearOption\(ordered/);
  assert.match(DROPDOWN, /^\s*clearable = false,$/m, "clearable defaults on rather than off");
});

test("the row is added after the sorting, so it cannot be filed under N", () => {
  const ordered = DROPDOWN.indexOf("const ordered =");
  const cleared = DROPDOWN.indexOf("withClearOption(ordered");
  assert.ok(ordered !== -1 && cleared > ordered, "the clear row is added before the options are sorted");
});

test("the employee form's optional pickers can be emptied and its required ones cannot", () => {
  const employeeRef = EMPLOYEE_FORM.slice(EMPLOYEE_FORM.indexOf('if (type === "employeeRef")'));
  assert.match(employeeRef.slice(0, employeeRef.indexOf("\n")), /clearable=\{!required\}/, "Referred By cannot be cleared again");
  const select = EMPLOYEE_FORM.slice(EMPLOYEE_FORM.indexOf('if (type === "select") return <SharedDropdown'));
  assert.match(select.slice(0, select.indexOf("\n")), /clearable=\{!required\}/);
});

test("the shared schema-form renderer offers it on the same terms", () => {
  const select = RENDERER.slice(RENDERER.indexOf("if (type === \"select\") {"));
  assert.match(select.slice(0, select.indexOf("\n  }")), /clearable=\{!required\}/);
});

/*
 * The country code is not a question with a blank answer, and a filter switch already offers "All".
 * Both draw this same component, which is why the row is opt-in rather than given to every optional
 * dropdown in the application.
 */
test("the pickers that are not questions are left alone", () => {
  const phone = read("components", "shared", "PhoneField.js");
  assert.doesNotMatch(phone, /clearable/);
});
