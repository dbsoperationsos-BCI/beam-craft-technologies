import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Reassign pending work opens from the offboarding form, a full-screen SchemaFormPanel at the
 * formPanel layer. On the default dialog layer it sat behind that form; it has to clear it.
 */
const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");

test("the hand-over dialog stacks above the offboarding form it opens from", () => {
  assert.match(read("components", "employees", "SeparationFormPanel.js"), /<HandOverDialog\b/);
  assert.match(read("components", "employees", "HandOverDialog.js"), /layer="dialogOverPanel"/);
});
