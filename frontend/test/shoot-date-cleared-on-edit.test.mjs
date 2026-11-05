import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (...parts) => fs.readFileSync(path.join(process.cwd(), "src", "components", ...parts), "utf8");

/*
 * Editing a shoot and turning Shoot Date Known to No sends no date (`AddShootDialog`), and both
 * places that take the dialog's answer used to fall back to the shoot's saved date - so the old day
 * stayed on the shoot. The dialog's date is taken as given, none included.
 */
test("an edited shoot whose date is no longer known is saved with no date, not its old one", () => {
  const plan = read("project-management", "useProjectPlan.js");
  assert.match(plan, /dateCreated: nextShoot\.dateCreated \|\| null,/);
  const form = read("sales", "CreateProjectFormPanel.js");
  assert.match(form, /shootId: row\.shootId, dateCreated: nextShoot\.dateCreated \|\| null \}/);
  for (const source of [plan, form]) assert.doesNotMatch(source, /dateCreated \|\| (shoot|row)\.dateCreated/);
});
