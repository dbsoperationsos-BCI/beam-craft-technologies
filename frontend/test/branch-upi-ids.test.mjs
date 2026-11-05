import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { MAX_UPI_IDS, upiIdsOf } from "../src/lib/upiIds.mjs";

/*
 * A branch's UPI IDs, as Settings → Organization → Branches holds them.
 *
 * The rule the studio asked for is about boxes: one to begin with, another each time Add is
 * pressed, the first never removable, and nothing saved for a box left empty. What reaches the
 * server is the other half of it - trimmed, no blanks, no handle twice - and that half is a plain
 * function, so it is tested rather than read.
 */

test("what the form holds becomes what the branch keeps: trimmed, no blanks, no repeats", () => {
  // A form that was never typed into sends nothing at all.
  assert.deepEqual(upiIdsOf([""]), []);
  assert.deepEqual(upiIdsOf(["", "   ", null, undefined]), []);
  assert.deepEqual(upiIdsOf([]), []);
  assert.deepEqual(upiIdsOf(null), []);
  assert.deepEqual(upiIdsOf(undefined), []);

  // The studio's own order, kept, and the boxes nobody used dropped from the middle of it.
  assert.deepEqual(
    upiIdsOf(["beamcraft@okaxis", "", "beampay@ybl", "   ", "payments@ibl"]),
    ["beamcraft@okaxis", "beampay@ybl", "payments@ibl"],
  );

  // Trimmed, and kept exactly as typed: the case is the provider's.
  assert.deepEqual(upiIdsOf(["  Beam.Craft-1@okAxis  "]), ["Beam.Craft-1@okAxis"]);

  // One handle, however it is spelled, and the first spelling is the one kept.
  assert.deepEqual(upiIdsOf(["Beam@ybl", "beam@YBL", "beam@ybl"]), ["Beam@ybl"]);
  assert.deepEqual(upiIdsOf(["a@ybl", "b@ybl", "a@ybl"]), ["a@ybl", "b@ybl"]);
});

const HERE = import.meta.dirname;
const src = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");

const PANEL = src("components", "settings", "BranchesPanel.js");
const FIELD = src("components", "shared", "RepeatableTextField.js");
const TEXT_FIELD = src("components", "shared", "TextField.js");

test("the form opens on exactly one box, and the field is the list rather than a box per branch", () => {
  // One empty box in the blank form - never two, and never none.
  assert.match(PANEL, /upiIds: \[""\],/);
  // An existing branch opens on the UPI IDs it holds, and on one empty box where it holds none.
  assert.match(PANEL, /const saved = upiIdsOf\(branch\.upiIds\);/);
  assert.match(PANEL, /upiIds: saved\.length \? saved : \[""\],/);
  // The field itself is the shared list control, labelled once, with the studio's own wording.
  assert.match(PANEL, /<RepeatableTextField[\s\S]*?label="UPI ID"[\s\S]*?addLabel="\+ Add UPI ID"[\s\S]*?placeholder="e\.g\. beamcraft@upi"[\s\S]*?\/>/);
  // Beam Craft is the example in the box, never a value: nothing writes it into the form or the payload.
  assert.doesNotMatch(PANEL, /upiIds: \[\s*"beamcraft/i);
  // What the server is sent is the normalised list, not the boxes.
  assert.match(PANEL, /upiIds: upiIdsOf\(values\.upiIds\),/);
});

test("a box that repeats is said under that box, and a blank box is not a fault", () => {
  const validate = PANEL.slice(PANEL.indexOf("function validate()"), PANEL.indexOf("async function save()"));
  assert.match(validate, /if \(!id\) return "";/, "a blank box says nothing");
  assert.match(validate, /fieldError\("upi", id\)/, "the shape comes from the shared table");
  assert.match(validate, /seenUpi\.has\(key\)\) return "This UPI ID is already listed\."/);
  assert.match(validate, /if \(upiErrors\.some\(Boolean\)\) next\.upiIds = upiErrors;/);
});

test("the first box is never removable, the rest are, and removing one only edits the form", () => {
  // Always a first row, whatever the form is holding.
  assert.match(FIELD, /const rows = Array\.isArray\(values\) && values\.length \? values : \[""\];/);
  // Remove is drawn from the second row on.
  assert.match(FIELD, /\{index > 0 && <IconButton/);
  // It edits the list this form is holding and nothing else - no request, no record.
  assert.match(FIELD, /onClick=\{\(\) => replace\(rows\.filter\(\(_, at\) => at !== index\)\)\}/);
  assert.doesNotMatch(FIELD, /fetch\(|apiRequest|\.service/, "removing a row is not a request");
  // Add appends one empty box, and neither control can submit the form around it.
  assert.match(FIELD, /onClick=\{\(\) => replace\(\[\.\.\.rows, ""\]\)\}/);
  assert.match(FIELD, /<Button type="button"/);
  assert.doesNotMatch(FIELD, /<button/, "the shared controls are used, not raw markup");
  // The boxes are the shared field, so the list wears the form's own input style.
  assert.match(FIELD, /import TextField from "\.\/TextField"/);
});

test("the form cannot build a list the server would refuse, and is told so as one message", () => {
  // The same ceiling on both sides, so Add stops where the save would have been refused.
  const backend = fs.readFileSync(path.join(HERE, "..", "..", "backend", "src", "modules", "admin", "branches", "validation.js"), "utf8");
  assert.match(backend, new RegExp(`const MAX_UPI_IDS = ${MAX_UPI_IDS};`), "the server keeps the same number");
  assert.match(PANEL, /maxRows=\{MAX_UPI_IDS\}/);
  assert.match(FIELD, /const full = maxRows > 0 && rows\.length >= maxRows;/);
  assert.match(FIELD, /\{!full && <Button type="button"/, "Add is gone once the list is full");

  /*
   * A message about the list is not a message about a box in it. The server sends one string for
   * the field; handing that to the boxes would read it one letter each, which is what a list
   * refused for its length used to show.
   */
  assert.match(PANEL, /key === "upiIds" \|\| key === "customSocialLinks" \? \{ list: list\?\.\[0\] \|\| "Check this\." \}/);
  assert.match(PANEL, /error=\{errors\.upiIds\?\.list \|\| ""\}/);
  assert.match(PANEL, /errors=\{Array\.isArray\(errors\.upiIds\) \? errors\.upiIds : \[\]\}/);
  assert.match(FIELD, /\{error && <p role="alert"/);
});

test("a field whose label belongs to its group draws no label line, and every other field is unchanged", () => {
  // The one extension the list needed: no empty label row, and no gap where it would have been.
  assert.match(TEXT_FIELD, /\{label \? <span>\{label\}/);
  assert.match(TEXT_FIELD, /className=\{`\$\{label \? "mt-1\.5" : ""\} block min-h-9/);
  // Named for a screen reader instead, since the group carries the word.
  assert.match(FIELD, /aria-label=\{rows\.length > 1 \? `\$\{name\} \$\{index \+ 1\}` : name\}/);
});
