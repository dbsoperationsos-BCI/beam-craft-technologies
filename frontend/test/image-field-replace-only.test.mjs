import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/*
 * An employee's photographs are replaced, never removed.
 *
 * Remove photo sat under every picture because it is the obvious partner to Choose, and on an
 * employee record it could do only one thing: empty a field the record cannot be saved without,
 * leaving HR to answer it again. It was on the Add Employee form and on the Onboarding Pending
 * submission HR reviews - the same panel - under the profile photograph, the Aadhaar card and the
 * PAN card alike. Replace photo is the whole of what those fields need.
 *
 * The button is still right where a picture is genuinely optional and taking it down is a real
 * decision, which is why this is a prop on the field rather than the button being deleted.
 *
 * Read from the source, the way the other form tests here do: there is no DOM in this suite.
 */

const HERE = import.meta.dirname;
const read = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");

const FIELD = read("components", "shared", "ImageUploadField.js");
const EMPLOYEE_FORM = read("components", "employees", "EmployeeFormPanel.js");

test("the shared field only draws Remove when it is allowed to", () => {
  assert.match(FIELD, /\{value && removable && \(/, "Remove photo is drawn for every picture again");
  assert.match(FIELD, /^\s*removable = true,$/m, "removable has to default on: most pictures are optional");
});

test("replacing is offered whatever removing is, and is the same one click", () => {
  // The picker's own label - what the button reads once a picture is held - is not conditional on
  // anything, so a field that cannot be emptied can still be answered again.
  assert.match(FIELD, /\{value \? "Replace photo" : "Choose photo"\}/);
});

test("the employee panel's pictures cannot be removed, only replaced", () => {
  const from = EMPLOYEE_FORM.indexOf("function ImageField(");
  assert.notEqual(from, -1, "the panel no longer draws its pictures through ImageField");
  const body = EMPLOYEE_FORM.slice(from, EMPLOYEE_FORM.indexOf("\n}", from));
  assert.match(body, /removable=\{false\}/);
});

// Profile Photo, Aadhar Card Photo and PAN Card Photo are all drawn by that one `ImageField`, so
// none of them can be left with a Remove of its own.
test("every picture on the employee form goes through that one field", () => {
  assert.match(EMPLOYEE_FORM, /if \(type === "image"\) return <ImageField/);
  for (const label of ["Profile Photo", "Aadhar Card Photo", "PAN Card Photo"]) {
    assert.match(EMPLOYEE_FORM, new RegExp(`"${label}", "image"`), `${label} is no longer an image field`);
  }
  assert.equal(EMPLOYEE_FORM.match(/<SharedImageUploadField/g).length, 1, "a second image field would need its own removable");
});

/*
 * Where taking the picture down is a real decision rather than an unanswered field: the studio's
 * own logo, a login slide, a quotation's cover. These keep Remove, and this is what says so.
 */
test("the optional pictures elsewhere keep their Remove", () => {
  for (const file of [["settings", "StudioBrandingPanel.js"], ["settings", "LoginSlidePanel.js"], ["assets", "AssetFormDialog.js"]]) {
    assert.doesNotMatch(read("components", ...file), /removable=\{false\}/, `${file[1]} has quietly lost its Remove`);
  }
});
