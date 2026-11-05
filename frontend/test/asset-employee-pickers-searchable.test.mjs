import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Every picker that offers the whole staff list carries its filter box.
 *
 * These lists are the studio's entire payroll, and a dropdown of that length without a search is a
 * scroll rather than a choice. The rule is easy to break one field at a time, and was: Add/Edit
 * Asset had it on Manager and not on Assigned Person - the two fields side by side, the same list
 * in both - and none of the seven employee pickers on the status forms had it at all.
 *
 * Pinned by reading the shipped source rather than by rendering, which is how this suite checks the
 * other cross-cutting control rules.
 */
const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");

test("every `options: \"people\"` field on the asset forms is searchable", () => {
  const config = read("constants", "formPanelConfig.js");
  const pickers = config.split("\n").filter((line) => line.includes('options: "people"'));
  assert.ok(pickers.length >= 7, `expected the asset status forms' employee pickers, found ${pickers.length}`);
  const missing = pickers.filter((line) => !line.includes("searchable: true")).map((line) => line.match(/name: "(\w+)"/)?.[1]);
  assert.deepEqual(missing, [], `employee pickers without a search box: ${missing.join(", ")}`);
});

test("Assigned Person and Manager on Add/Edit Asset agree", () => {
  // They take the same `employees` list and sit in the same row, so one having a filter box and the
  // other not is the inconsistency a person actually notices.
  const dialog = read("components", "assets", "AssetFormDialog.js");
  for (const label of ['label="Assigned Person"', 'label="Manager"']) {
    const line = dialog.split("\n").find((candidate) => candidate.includes(label));
    assert.ok(line, `${label} was not found in AssetFormDialog.js`);
    assert.match(line, /<Dropdown searchable/, `${label} is missing \`searchable\``);
  }
});
