import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { assetCategoryLabel, assetTypeLabel } from "../src/lib/assetCategoryLabels.mjs";

/*
 * Add Asset's Subcategory offers "Others": a box beside it asks which, and the asset is filed under
 * its Category with the typed name - shown as its Type everywhere.
 */
test("an Others asset reads its Category, and Others with the typed name as its Type", () => {
  const listed = { category: { name: "Cameras", parent: { name: "Equipment" } } };
  assert.equal(assetCategoryLabel(listed), "Equipment");
  assert.equal(assetTypeLabel(listed), "Cameras");
  const other = { subCategoryOther: "Gimbal", category: { name: "Equipment", parent: null } };
  assert.equal(assetCategoryLabel(other), "Equipment");
  assert.equal(assetTypeLabel(other), "Others – Gimbal");
});

test("the form offers Others last, asks its name beside it, and saves it under the Category", () => {
  const form = fs.readFileSync(new URL("../src/components/assets/AssetFormDialog.js", import.meta.url), "utf8");
  assert.match(form, /\.\.\.\(form\.topCategoryId \? \[\{ value: OTHER_SUBCATEGORY, label: "Others" \}\] : \[\]\)/);
  assert.match(form, /\{form\.categoryId === OTHER_SUBCATEGORY && <TextField required error=\{errors\.subCategoryOther\} label="Subcategory \(Others\)"/);
  assert.match(form, /categoryId: form\.categoryId === OTHER_SUBCATEGORY \? form\.topCategoryId \|\| null : form\.categoryId \|\| null,/);
  assert.match(form, /subCategoryOther: current\.categoryId === OTHER_SUBCATEGORY && !current\.subCategoryOther\.trim\(\) \? "Say which subcategory\." : "",/);
});
