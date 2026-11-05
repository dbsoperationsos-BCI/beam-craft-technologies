import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * The other half of the same rule: the dialog answers on the field rather than by failing a save.
 *
 * `requiredProblems` skips `type: "custom"`, so the `required` mark on Branches was decoration and
 * the form saved a role without one. The panel's own contract for a field it cannot judge is that
 * the caller judges it and passes the mark down, which is what the dialog now does - the server
 * refuses it as well, and that is what actually decides it.
 */

const HERE = import.meta.dirname;
const src = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");

const DIALOG = src("components", "admin", "RoleDialog.js");

test("the roles dialog refuses a save with no branch chosen", () => {
  assert.match(DIALOG, /const branchesMissing = !\(values\.branchIds \|\| \[\]\)\.length;/);
  assert.match(DIALOG, /if \(branchesMissing\) \{/);
  assert.match(DIALOG, /onSubmit=\{readOnly \? undefined : submit\}/);
});

/*
 * Refusing is only half of it: the panel is a real `<form>` whose footer button is a plain
 * `<button>`, so `type="submit"` by default, and `SchemaFormPanel.handleSubmit` calls
 * `preventDefault` only on the paths where *it* refuses - the passing one is handed to `onSubmit`
 * along with the event, and whoever takes it owns that call.
 *
 * So a handler that ignores the event lets the browser submit the form natively. Refusing a save
 * then navigated the whole page, which looks exactly like the save going through and the panel
 * closing; allowing one reached `RoleManagement.save(undefined)`, whose own
 * `event?.preventDefault?.()` did nothing, and the page reloaded after a successful save.
 */
test("refusing a save stops the browser submitting the form anyway", () => {
  const submit = DIALOG.slice(DIALOG.indexOf("function submit("), DIALOG.indexOf("function submit(") + 320);
  assert.match(submit, /function submit\(event\)/, "submit must accept the event");
  const refusal = submit.slice(submit.indexOf("if (branchesMissing)"));
  assert.match(refusal, /event\?\.preventDefault\?\.\(\)/, "the refusal path must call preventDefault");
  assert.ok(refusal.indexOf("preventDefault") < refusal.indexOf("return"), "and before it returns");
});

test("a save that is allowed hands the event on, so the page does not reload", () => {
  const submit = DIALOG.slice(DIALOG.indexOf("function submit("), DIALOG.indexOf("function submit(") + 320);
  assert.match(submit, /onSubmit\(event\)/, "RoleManagement.save calls preventDefault on what it is given");
});

test("and says so on the field, not only at the top of the form", () => {
  assert.match(DIALOG, /error=\{branchError\}/);
  assert.match(DIALOG, /Select at least one branch\./);
  assert.match(DIALOG, /error=\{branchError \? "Complete required fields: Branches" : error\}/);
});

/*
 * Why the dialog has to do this at all: the validator is deliberately blind to custom fields, and
 * Branches is one. If that ever changes, this file is where the reason was written down.
 */
test("the schema form still leaves custom fields to their caller", () => {
  const validator = src("components", "schema-form", "requiredProblems.js");
  assert.match(validator, /const JUDGEABLE = \(field\) => field\.type !== "custom";/);
});
