import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * District and State are not asked for on Add / Edit Shoot, anywhere the dialog is used.
 *
 * Where a shoot happens is often settled long after it is booked - a quotation is raised with a city
 * in mind at most - so refusing the shoot for them only had the studio typing a guess it would
 * correct later. They are still on the form, and a district still fills its state in. This replaces
 * the rule that made District optional on the Quotation Generator alone (`districtOptional`), which
 * is gone: it has nothing left to say now that every screen leaves both open.
 */
const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");
const DIALOG = read("components", "project-management", "AddShootDialog.js");

test("neither field is required, and neither holds the save", () => {
  assert.match(DIALOG, /<ComboBoxField label="District"(?: helperText="[^"]*")? placeholder/, "District asks, it does not demand");
  assert.match(DIALOG, /<ComboBoxField label="State"(?: helperText="[^"]*")? placeholder/);
  assert.doesNotMatch(DIALOG, /label="District"(?: helperText="[^"]*")? required|label="State"(?: helperText="[^"]*")? required/);
  // What the dialog does still refuse, and the only sentence left about it.
  assert.match(DIALOG, /if \(!shoot\.shoot\) problems\.shoot = "Choose the shoot\.";/);
  assert.match(DIALOG, /if \(!shoot\.shootPlace\.trim\(\)\) problems\.shootPlace = "Enter the shoot place\.";/);
  assert.doesNotMatch(DIALOG, /District, and State/);
  // The rest of the rules are untouched.
  assert.match(DIALOG, /if \(shoot\.dateKnown && !shoot\.dateCreated\) problems\.dateCreated = "Enter the Date, or set Shoot Date Known to No\.";/);
});

test("the per-screen exception is gone, so no screen can ask for them again by accident", () => {
  for (const file of [
    ["components", "project-management", "AddShootDialog.js"],
    ["components", "sales", "QuotationGeneratorPanel.js"],
    ["components", "sales", "CreateProjectFormPanel.js"],
    ["components", "project-management", "StartProjectFormPanel.js"],
    ["components", "project-management", "useProjectPlan.js"],
  ]) {
    assert.doesNotMatch(read(...file), /districtOptional/, `${file.at(-1)} still mentions districtOptional`);
  }
  // Both saves - Add Shoot List and Save - go through the one rule, now asked nothing extra.
  assert.equal((DIALOG.match(/validateShoot\(currentShoot, wedding\)/g) || []).length, 1);
  // Once, in `formRows` - both adding and editing build their row through it now.
  assert.equal((DIALOG.match(/fields\.check\(formProblems\(\)\)/g) || []).length, 1);
});

test("the server agrees: a shoot saves with neither", () => {
  const controller = fs.readFileSync(path.join(import.meta.dirname, "..", "..", "backend", "src", "modules", "sales", "projects", "controller.js"), "utf8");
  // Both schemas a shoot is written through - the project's shoots, and one shoot on its own.
  assert.equal((controller.match(/state: z\.string\(\)\.trim\(\)\.max\(191\)\.nullable\(\)\.optional\(\),/g) || []).length, 2);
  assert.doesNotMatch(controller, /state: requiredText\.max\(191\)/);
});
