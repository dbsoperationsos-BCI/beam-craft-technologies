import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { clientStorageChecks, clientStorageFormSections, clientStorageStatusSteps } from "../src/constants/formPanelConfig.js";
import { YES_NO_OPTIONS, dropUnansweredYesNo, yesNoField } from "../src/constants/yesNoField.js";

/*
 * Client Storage asks its yes/no questions the way the pre production shoot form does: a **Yes / No
 * radio pair**, not a switch.
 *
 * A switch shows one answer and hides the other, and an unanswered question looks exactly like one
 * answered No - which on a form whose whole job is a checklist ("was it labelled? was the footage backed
 * up?") is the one distinction that matters. The pair shows both words and shows neither picked until
 * somebody picks.
 */

const src = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");
const CONFIG = src("constants", "formPanelConfig.js");

test("the yes/no field is written once, for whichever form asks one", () => {
  /*
   * It was `preProductionYesNoField`, in the pre production field list, because that is the form that
   * needed it first. Two modules ask the same question now, so it lives on its own and is named for what
   * it is rather than for who asked first.
   */
  assert.deepEqual(YES_NO_OPTIONS, [{ value: true, label: "Yes" }, { value: false, label: "No" }]);
  assert.deepEqual(yesNoField("labeled", "Labeled?"), {
    name: "labeled",
    label: "Labeled?",
    type: "radio",
    options: YES_NO_OPTIONS,
    props: { variant: "field" },
  });
  // `extra` rides along, which is how a disabled or required one is asked for.
  assert.equal(yesNoField("x", "X", { props: { disabled: true } }).props.disabled, true);
});

test("the values stay booleans, so nothing about what is saved changes", () => {
  /*
   * The columns are booleans and the API validates them as booleans. A radio pair whose values were the
   * strings "Yes" and "No" would be a display change that quietly rewrote the record.
   */
  for (const option of YES_NO_OPTIONS) assert.equal(typeof option.value, "boolean");
});

test("every check on the storage form is a Yes / No pair", () => {
  const checks = clientStorageFormSections.find((section) => section.id === "checks");
  assert.equal(checks.fields.length, clientStorageChecks.length);
  for (const field of checks.fields) {
    assert.equal(field.type, "radio", `${field.name} should be a radio pair`);
    assert.deepEqual(field.options, YES_NO_OPTIONS);
    assert.equal(field.props.variant, "field");
  }
});

test("and so is every check the flow asks for on the way through", () => {
  /*
   * The same columns are asked again at Hand In, Footage Backup Done and HDD Out, which is where they
   * are actually answered - the form is where a record is corrected. One question cannot be a switch in
   * one place and a pair in another.
   */
  const asked = Object.values(clientStorageStatusSteps)
    .flatMap((step) => step.sections)
    .flatMap((section) => section.fields || [])
    .filter((field) => clientStorageChecks.some(([name]) => name === field.name));
  assert.equal(asked.length, 7, "all seven are asked somewhere along the flow");
  for (const field of asked) {
    assert.equal(field.type, "radio", `${field.name} should be a radio pair`);
    assert.deepEqual(field.options, YES_NO_OPTIONS);
  }
});

test("Shoot Status Pending is a reading, and reads like the answers around it", () => {
  /*
   * Not a question: it comes off the project's shoots and nothing here decides it, which is why it is
   * disabled. It is still a yes/no, and left as the one switch among seven pairs it would read as a
   * control somebody had forgotten to convert.
   */
  const shoot = clientStorageFormSections.find((section) => section.id === "shoot");
  const pending = shoot.fields.find((field) => field.name === "isShootStatusPending");
  assert.equal(pending.type, "radio");
  assert.equal(pending.props.disabled, true);
  assert.equal(pending.props.variant, "field");
});

test("a question left unanswered is left out of the save, not sent as an empty string", () => {
  /*
   * This is what the switch was hiding. `emptyValues` coerced a toggle to `Boolean(...)`, so an untouched
   * question went to the server as `false` - always a valid boolean, and always a claim that the check had
   * been made and failed. A pair leaves it genuinely unanswered, which is the point of the change, and the
   * column is `z.boolean().optional()`: the honest way to say "not answered" is to **omit the key**, and
   * sending `""` instead would have the server refuse the whole save.
   */
  const sections = [{ id: "checks", fields: [yesNoField("labeled", "Labeled?"), yesNoField("finalRenders", "Final Renders"), { name: "remarks", label: "Remarks" }] }];
  const out = dropUnansweredYesNo(sections, { labeled: true, finalRenders: "", remarks: "" });
  assert.deepEqual(out, { labeled: true, remarks: "" }, "only the unanswered yes/no goes");
  // False is an answer, and a real one - the check was made and it failed.
  assert.deepEqual(dropUnansweredYesNo(sections, { labeled: false, finalRenders: false }), { labeled: false, finalRenders: false });
  // And a field that is not a yes/no keeps its empty string, which is what a blank text box is.
  assert.equal("remarks" in out, true);
});

test("both Client Storage forms drop the unanswered ones before they save", () => {
  // The panel where a record is corrected, and the dialog that moves it along the flow - the same seven
  // questions are asked in both, so one cannot send a value the other would not.
  for (const file of ["ClientStorageFormPanel.js", "ClientStorageStatusDialog.js"]) {
    const PANEL = src("components", "assets", file);
    assert.match(PANEL, /dropUnansweredYesNo\(/, `${file} should drop unanswered yes/no answers`);
  }
});

test("the pre production shoot form drops them too", () => {
  /*
   * The form this change copied has the same shape of bug already, from when its own switches became
   * pairs: it spreads the whole form into the payload, and `travelAccommodationNeeded` is
   * `z.boolean().optional()` behind a preprocess that maps only `null` to undefined - so an unanswered
   * one arrives as `""` and the server refuses the save. Fixed with the same helper, because a bug in the
   * form being copied is a bug in the copy.
   */
  const PANEL = src("components", "project-management", "PreProductionFormPanel.js");
  assert.match(PANEL, /dropUnansweredYesNo\(/);
});

test("no switch is left on any Client Storage form", () => {
  const region = CONFIG.slice(CONFIG.indexOf("export const clientStorageChecks"), CONFIG.indexOf("// Asset status transitions"));
  assert.equal(/type: "toggle"/.test(region), false, "a leftover switch among the pairs reads as an oversight");
});
