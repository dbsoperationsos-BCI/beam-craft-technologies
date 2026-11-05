import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

test("a counted question says Pending until it is answered, through one shared tag", () => {
  const tag = read("components/shared/PendingField.js");
  assert.match(tag, /if \(!pending\) return children;/);
  assert.match(tag, /<ProgressChip color=\{PROGRESS_COLORS\.notStarted\}[^>]*>Pending<\/ProgressChip>/);
  // The schema form tags a required field left empty, only where the form asks for it.
  const fields = read("components/schema-form/SchemaFormFields.js");
  assert.match(fields, /if \(!context\?\.pendingTags \|\| field\.type === "custom"\) return control;/);
  assert.match(fields, /<PendingField pending=\{required && isEmptyAnswer\(values\?\.\[field\.name\]\)\}/);
});

test("Pre Production's shoot form and Production's plan turn it on - their asterisks are what they count", () => {
  assert.match(read("components/project-management/PreProductionFormPanel.js"), /pendingTags: true,/);
  assert.match(read("components/project-management/production/ProductionShootPanel.js"), /pendingTags: true,/);
  // Each service's person, and a vendor still Waiting, are counted too and drawn by the crew itself.
  const crew = read("components/project-management/production/ProductionServiceCrew.js");
  assert.match(crew, /<PendingField pending=\{role === "LEAD" && !row\.person\}>/);
  assert.match(crew, /<PendingField pending=\{\(row\.vendorStatus \|\| "WAITING"\) !== "CONFIRMED"\}>/);
});
