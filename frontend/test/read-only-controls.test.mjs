import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * What "read-only" looks like, across the controls a form is built from.
 *
 * The application draws two different silences and they must not be confused, which is a rule
 * `Dropdown` states and the rest are supposed to follow:
 *
 *   `disabled`  a control that is off *for now* - the shoot picker before a project is chosen. It
 *               is still a control waiting on an earlier answer, so it keeps its chevron.
 *   `readOnly`  a value being read back, on a record nobody is editing. There is nothing behind it,
 *               so the chevron would point at nothing, and it is not refused - it is simply not a
 *               control.
 *
 * The CRD document's Event Details is a whole section of the second kind, and building it out of a
 * `disabled` fieldset is what showed why the two are worth keeping apart: controls that style
 * themselves off `:disabled` went grey, the phone field - whose wrapper hardcodes a white fill
 * around a transparent input - stayed white beside them, and every chevron stayed drawn over a list
 * that could no longer open. One section, three different answers to one question.
 */

const read = (name) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "shared", `${name}.js`), "utf8");

const CONTROLS = ["Dropdown", "ComboBoxField", "MultiSelectField", "PhoneField", "TextField"];

test("every control a read-only row is built from takes the word", () => {
  for (const name of CONTROLS) {
    assert.match(read(name), /\breadOnly\b/, `${name} has no read-only mode, so a read-only row cannot include it`);
  }
});

test("a read-only control loses the chevron a disabled one keeps", () => {
  // The chevron is what says "there is a list here". Read-only there is not.
  assert.match(read("Dropdown"), /\{!readOnly && <ChevronIcon/);
  assert.match(read("ComboBoxField"), /\{!readOnly && <button/);
  assert.match(read("MultiSelectField"), /\{!readOnly && <button/);
  // The phone field's chevron belongs to the country picker it holds, so it passes the word down
  // rather than drawing one of its own.
  assert.match(read("PhoneField"), /readOnly=\{readOnly\}\n\s*options=\{DIAL_CODE_OPTIONS\}/);
});

test("they are all the same grey, so a read-only row is one colour", () => {
  /*
   * `bg-slate-100` is what `TextField` documents for exactly this - "a value the form only shows
   * sits on grey with dimmed text" - so the others take it rather than each having an idea of its
   * own. `bg-slate-50` stays what `disabled` looks like, which is the distinction being kept.
   */
  for (const name of ["TextField", "ComboBoxField", "MultiSelectField", "PhoneField"]) {
    assert.match(read(name), /readOnly[^\n]*bg-slate-100|bg-slate-100[^\n]*readOnly/, `${name} does not use the read-back grey`);
  }
  assert.match(read("MultiSelectField"), /readOnly \? "cursor-default bg-slate-100" : disabled \? "cursor-default bg-slate-50"/, "disabled and read-only look alike again");
});

test("a read-only value can still be selected and copied", () => {
  /*
   * `readOnly` on the input rather than `disabled`, which is not a detail: a phone number and a maps
   * link are shown precisely so somebody can take them, and a disabled input cannot be selected.
   */
  assert.match(read("PhoneField"), /readOnly=\{readOnly\}\n\s*onChange=\{\(event\) => updatePhone/);
  assert.match(read("ComboBoxField"), /readOnly=\{readOnly\}/);
});
