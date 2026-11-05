import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const PANEL = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "employees", "EmployeeFormPanel.js"), "utf8");

/*
 * The "You have unsaved work" dialog's Discard / Keep editing / Save draft buttons. Discard is
 * always secondary - it throws the edit away. Exactly one of Keep editing / Save draft is primary
 * at a time, never both: with Save draft offered, it carries the emphasis and Keep editing steps
 * back to secondary (it is also what the × and Escape already do, so it does not need to compete
 * for attention); without Save draft, Keep editing is the one positive answer left and is primary.
 */
test("Discard is always the secondary button", () => {
  const start = PANEL.indexOf('title="You have unsaved work"');
  assert.ok(start > -1, "the close-confirmation dialog must exist");
  const dialog = PANEL.slice(start, start + 3000);
  assert.match(dialog, /variant="secondary"[\s\S]*?>Discard<\/Button>/);
});

test("Keep editing is primary only when Save draft is not offered - never both at once", () => {
  const start = PANEL.indexOf('title="You have unsaved work"');
  const dialog = PANEL.slice(start, start + 3000);
  assert.match(dialog, /variant=\{\(recordDirty \|\| credentialsDraftable\) \? "secondary" : "primary"\}[\s\S]*?>Keep editing<\/Button>/);
});

test("Save draft is the sole primary button when it is offered", () => {
  const start = PANEL.indexOf('title="You have unsaved work"');
  const dialog = PANEL.slice(start, start + 5000);
  assert.match(dialog, /\(recordDirty \|\| credentialsDraftable\) && <Button type="button" variant="primary"[\s\S]*?Save draft/);
});
