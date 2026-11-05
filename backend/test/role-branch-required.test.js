const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * A role has to reach at least one branch.
 *
 * The Roles dialog has marked Branches required since it was written, and for a long time that mark
 * was the only thing saying so. The field is a custom one, which the schema form deliberately does
 * not judge - a custom field's answer need not live under its own name at all - and the route read
 * an empty list as "parked". So the form asked for a branch, refused nothing when it was not given,
 * and stored a role reaching nowhere: its permissions grant nothing in any branch, which reads on
 * screen as the permissions being broken rather than as a role that was never finished.
 *
 * Read as source text, the way `data-scope.test.js` reads its controllers: what is being held here
 * is that the refusal exists in the route rather than only in the dialog, because a dialog is not
 * what decides this.
 */

const routes = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "admin", "routes.js"), "utf8");

test("the route refuses a role with no branches rather than storing one", () => {
  assert.match(routes, /if \(!branchIds\.length\) \{ res\.status\(400\)/);
  assert.match(routes, /A role must reach at least one branch\./);
  // And not the old reading, which answered an empty list with an empty list.
  assert.doesNotMatch(routes, /if \(!branchIds\.length\) return \[\];/);
});

test("both the create and the edit go through that same read", () => {
  // Create defaults a missing list to `[]`, which is now refused rather than quietly accepted.
  assert.match(routes, /const branchIds = await readBranchIds\(req\.body\?\.branchIds \?\? \[\], res, req\);/);
  // An edit that says nothing about branches still leaves them alone; one that names none is refused.
  assert.match(routes, /if \(req\.body\?\.branchIds !== undefined\) \{/);
  assert.match(routes, /if \(input === undefined\) return undefined;/);
});
