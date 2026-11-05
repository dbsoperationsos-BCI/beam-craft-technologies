import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { shootCustomText, shootDisplayName } from "../src/lib/shootDisplay.mjs";
import { eventTypeNames } from "../src/lib/quotationEventTypes.mjs";

const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");

test("a shoot's Additional Text is shown in brackets beside it, and never as empty brackets", () => {
  assert.equal(shootDisplayName({ shoot: "Rituals", customText: "Bride Varatham" }), "Rituals (Bride Varatham)");
  assert.equal(shootDisplayName({ shoot: "Wedding", customText: "  Muhurtham  " }), "Wedding (Muhurtham)");
  for (const customText of [undefined, null, "", "   "]) assert.equal(shootDisplayName({ shoot: "Reception", customText }), "Reception");
  // A quotation saved before the field existed reads as it always did.
  assert.equal(shootDisplayName({ shoot: "Wedding" }), "Wedding");
  assert.equal(shootDisplayName({ shoot: "", customText: "x" }, "Shoot"), "Shoot (x)");
  assert.equal(shootCustomText({ customText: "  Bride Entry " }), "Bride Entry");
});

test("the Event Type header reads the shoots' own names, not their Additional Text", () => {
  const shoots = [{ shoot: "Wedding", customText: "Muhurtham", isMainEvent: true }, { shoot: "Rituals", customText: "Bride Varatham" }, { shoot: "Reception" }];
  assert.deepEqual(eventTypeNames(shoots), ["Wedding", "Rituals", "Reception"]);
  assert.deepEqual(shoots.map((shoot) => shootDisplayName(shoot)), ["Wedding (Muhurtham)", "Rituals (Bride Varatham)", "Reception"]);
});

test("Add Shoot asks Additional Text per selected shoot, above Mark as Main Event, on a quotation only", () => {
  const dialog = read("components", "project-management", "AddShootDialog.js");
  assert.match(dialog, /allowCustomText = false/);
  // No common box beside Shoot any more: the Shoot row is the original one.
  const shootRow = dialog.slice(dialog.indexOf('label="Shoot" required placeholder="Search or select shoot"'), dialog.indexOf('label="Shoot Type"'));
  assert.doesNotMatch(shootRow, /Additional Text/);
  // One box per selected shoot, keyed by the shoot, in a section just above Mark as Main Event.
  const section = dialog.indexOf("<span>Additional Text</span>");
  assert.ok(section > 0 && section < dialog.indexOf("Mark as Main Event<span"), "above Mark as Main Event");
  assert.match(dialog, /\{textShoots\.map\(\(name, index\) => <TextField\s+key=\{name\}\s+label=\{name\}/);
  assert.match(dialog, /value=\{customTextByShoot\[name\] \|\| ""\}/);
  /*
   * A box per ticked shoot still, though they now become one shoot: the texts are joined in the
   * order they were ticked ("Bride Varatham; Groom Varatham"), so nothing typed is lost when the
   * names are. Trimmed, and null when every box is empty.
   */
  assert.match(dialog, /names\.map\(customTextFor\)\.filter\(Boolean\)\.join\("; "\) \|\| null/);
  assert.match(dialog, /const customTextFor = \(name\) => String\(customTextByShoot\[name\] \|\| ""\)\.trim\(\) \|\| null;/);
  // Removing a shoot from the selection removes only its box; the others keep what was typed.
  assert.match(dialog, /setCustomTextByShoot\(\(current\) => Object\.fromEntries\(values\.map\(\(name\) => \[name, name in current \? current\[name\] : copiedCustomText\]\)\)\);/);
  // Editing a saved shoot opens on its own text; a Duplicate carries the copied text onto the shoot chosen (`test/shoot-duplicate.test.mjs`).
  // Opening a saved shoot fills its text in, keyed by its first name - the boxes are one per name.
  assert.match(dialog, /const \[first\] = shootNamesOf\(initialShoot\?\.shoot \|\| ""\);\n\s*return first && initialShoot\?\.customText \? \{ \[first\]: String\(initialShoot\.customText\) \} : \{\};/);
  // The same shoot with different text is a different shoot, not a duplicate.
  assert.match(dialog, /const keyOf = \(shoot\) => `\$\{shoot\.shoot\}\\u0000\$\{String\(shoot\.customText \|\| ""\)\.trim\(\)\.toLowerCase\(\)\}`;/);
  // Only the Quotation Generator turns it on.
  assert.match(read("components", "sales", "QuotationGeneratorPanel.js"), /\n\s+allowCustomText\n/);
  for (const file of [["components", "sales", "CreateProjectFormPanel.js"], ["components", "project-management", "StartProjectFormPanel.js"]]) {
    assert.doesNotMatch(read(...file), /allowCustomText/, file.join("/"));
  }
  // The shoot cards - generator, client page and its PDF - and the dialog's list name it through the one helper.
  assert.match(read("components", "sales", "PublicQuotationPage.js"), /\{shootDisplayName\(shoot, "Shoot"\)\}<\/h3>/);
  assert.match(read("components", "project-management", "ProjectServiceCreationSection.js"), /\{shootDisplayName\(shoot, "Shoot"\)\}<\/h3>/);
  assert.match(dialog, /render: \(shoot\) => shootDisplayName\(shoot\)/);
});

test("the Shoot List table and its phone cards name a shoot the same way the cards above them do", () => {
  /*
   * The quotation's own shoot list - the table under **Shoot List** and the cards it becomes on a
   * phone - printed the bare name while the card it opens, the client's quotation and the Add Shoot
   * list all read "Rituals (Bride Varatham)". One shoot, two names, on one screen.
   *
   * No flag gates it, and none is needed: Additional Text is the generator's own field, kept in the
   * quotation's payload, and a quotation becoming a project leaves it behind - `SHOOT_FIELDS` does
   * not carry it and `project_shoot` has no column for it. So on Booking & Converted and every
   * project screen there is no `customText` to show and this reads exactly as it did.
   */
  const list = read("components", "project-management", "ProjectShootList.js");
  assert.match(list, /import \{ shootDisplayName \} from "@\/lib\/shootDisplay\.mjs";/);
  assert.match(list, /id: "shoot", header: "Shoot", accessorFn: \(shoot\) => shootDisplayName\(shoot, "—"\)/);
  assert.match(list, /title: \(shoot\) => shootDisplayName\(shoot, "—"\), cell: \(\{ row \}\) => shootDisplayName\(row\.original, "—"\)/);
  assert.match(list, /<p className="font-semibold text-slate-900">\{shootDisplayName\(shoot, "—"\)\}<\/p>/);
  // The dash is still what an unnamed shoot reads as, in the table and on the phone alike.
  assert.equal(shootDisplayName({}, "—"), "—");

  // And the project side genuinely has nothing to show: the hand-off does not carry the field.
  const plan = read("components", "sales", "quotationProjectPlan.js");
  const fields = plan.slice(plan.indexOf("const SHOOT_FIELDS = ["), plan.indexOf("];", plan.indexOf("const SHOOT_FIELDS = [")));
  assert.doesNotMatch(fields, /customText/);
});
