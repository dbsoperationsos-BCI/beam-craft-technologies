import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { settingsNoteOf } from "../src/lib/deliverableAnswers.mjs";

/*
 * The Remarks a service or deliverable carries in Settings start a new quotation line's own Remarks.
 *
 * Settings is the reusable default; the line holds an editable copy, made once when the line is
 * first added and never written back. A line reopened from a saved quotation keeps what it was
 * saved with, whatever Settings says since.
 */
const PANEL = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "sales", "QuotationGeneratorPanel.js"), "utf8");
const bodyOf = (name) => PANEL.slice(PANEL.indexOf(`function ${name}(`), PANEL.indexOf("\n  }\n", PANEL.indexOf(`function ${name}(`)));

test("the Settings note is the words, and an old Yes/No switch answer is not a note", () => {
  assert.equal(settingsNoteOf("Sent flat, never rolled."), "Sent flat, never rolled.");
  assert.equal(settingsNoteOf("  Drone needs a permit  "), "Drone needs a permit");
  for (const old of ["Yes", "no", "YES", true, false, null, undefined, ""]) assert.equal(settingsNoteOf(old), "", `${String(old)} is not a note`);
  // A note that merely starts with "No" is still a note.
  assert.equal(settingsNoteOf("Not applicable for indoor shoots"), "Not applicable for indoor shoots");
});

test("a new service line and a new deliverable line each start from their own Settings note", () => {
  for (const name of ["serviceRowFor", "deliverableRowFor"]) {
    const body = bodyOf(name);
    assert.match(body, /remarks: settingsNoteOf\(definition\?\.remarksEnabled\),/, `${name} starts the line's Remarks from its own definition`);
    // Before `...extra`, so a package or the calculator that names its own still wins.
    assert.ok(body.indexOf("remarks: settingsNoteOf") < body.indexOf("...extra"));
  }
});

test("a reopened line keeps its saved remarks, and nothing writes back to Settings", () => {
  // Saved rows are read through the normalisers, which keep the row's own remarks as they are.
  assert.match(PANEL, /remarks: row\.remarks \|\| "",/);
  assert.equal((PANEL.match(/settingsNoteOf\(/g) || []).length, 2, "only the two row builders read the default");
  // The quotation screen never saves a service or deliverable definition.
  assert.doesNotMatch(PANEL, /updateServiceDefinition|updateDeliverableDefinition/);
});
