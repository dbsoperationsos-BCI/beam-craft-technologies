import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { QUOTATION_BRANDS } from "../src/lib/quotationBrand.mjs";

/*
 * Settings: every way out of a screen that is holding an unsaved edit asks first.
 *
 * The rail already asked, and the rail was the only thing that did - which made the question look
 * answered while three other ways out of the same screen still threw the work away in silence. Ten
 * fields built on a vertical and one click on the Vertical dropdown above them: gone. A brand's PDF
 * wording and one click on the Terms tab beside it: gone. A half-built table and an F5: gone. Each
 * of those is the same loss the rail stops, a single click away from the dialog that would have
 * caught it.
 *
 * So this asserts the wiring rather than the dialog: that the controls which can discard staged
 * settings route through `useUnsavedGuard`, that the panels holding staged settings report it, and
 * that the rail knows about all of them. What must not regress is a control being added - a third
 * picker, a fourth tab - and quietly bypassing the question.
 *
 * Reads the source, the way the other settings tests here do: there is no DOM in this suite.
 */

const HERE = import.meta.dirname;
const read = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");

const GUARD = read("components", "shared", "useUnsavedGuard.js");
const TABLE_SETTINGS = read("components", "sales", "TableSettingsPanel.js");
const QUOTATION = read("components", "settings", "QuotationSettingsPanel.js");
const OVERLAY = read("components", "settings", "SettingsOverlay.js");

test("the question is worded in one place, so every screen asks it the same way", () => {
  /*
   * The rail's wording, moved into the hook. Asserted here because the point of the hook is that
   * a second copy of this dialog cannot drift from the first - "Discard & Continue" on one screen
   * and "Yes" on another is how a warning stops being read.
   */
  for (const wording of [
    "Unsaved changes will be discarded",
    "Go back if you want to save your settings.",
    "Go Back",
    "Discard & Continue",
  ]) {
    assert.ok(GUARD.includes(wording), `the guard should hold the wording ${JSON.stringify(wording)}`);
  }

  // Nobody re-types it. A panel that wrote its own title would be a second wording to keep in step.
  for (const [name, source] of [["Table Settings", TABLE_SETTINGS], ["Quotation Settings", QUOTATION]]) {
    assert.ok(
      !source.includes("Unsaved changes will be discarded"),
      `${name} should take the wording from the guard rather than repeating it`,
    );
  }
});

test("a guarded move waits for the answer instead of happening first", () => {
  /*
   * The move is stored, not run, and stored through the updater form - `setPendingMove(move)` would
   * hand React the function as an updater and run the very thing the dialog is asking about, which
   * is the one bug this hook could have that looks like it works: the dialog appears, and the work
   * is already gone behind it.
   */
  assert.ok(GUARD.includes("setPendingMove(() => move)"), "the pending move should be stored, not invoked");
  assert.ok(/if \(!held\) \{ move\(\); return; \}/.test(GUARD), "with nothing staged the move should happen straight away");
  // Cancel keeps the work: it clears what was pending and runs nothing.
  assert.ok(/onCancel: \(\) => setPendingMove\(null\)/.test(GUARD), "Go Back should drop the move rather than run it");
});

test("every Table Settings picker asks before it replaces the canvas", () => {
  /*
   * A vertical's fields are loaded from that vertical, so changing any picker reloads over whatever
   * is on the canvas. All three are asserted: Module clears the screen and the vertical, and Screen
   * clears the vertical, so each discards the same work by a longer route.
   */
  assert.ok(TABLE_SETTINGS.includes("useUnsavedGuard(unsaved)"), "the pickers should be guarded by the canvas's own unsaved flag");
  const guarded = TABLE_SETTINGS.match(/onChange=\{\(value\) => guardPickerChange\(/g) || [];
  assert.equal(guarded.length, 3, "the Module, Screen and Vertical pickers should all route through the guard");
  assert.ok(
    !/onChange=\{\(value\) => setActiveVertical\(value\)\}/.test(TABLE_SETTINGS),
    "the Vertical picker should no longer set the vertical straight from its onChange",
  );
  assert.ok(TABLE_SETTINGS.includes("<ConfirmDialog {...pickerConfirmProps} />"), "the panel should render the dialog it asks with");
});

test("a brand's tab bar asks before it unmounts the PDF content being edited", () => {
  /*
   * The tab that is not on screen is not mounted, so switching tab is exactly as final as leaving
   * the section - and the tab bar sits directly above the fields it would discard.
   */
  assert.ok(
    QUOTATION.includes("onChange={(next) => guardTabChange(() => setTab(next))}"),
    "the brand tab bar should route through the guard",
  );
  assert.ok(
    QUOTATION.includes("useUnsavedGuard(() => unsavedEditsRef.current)"),
    "the tab guard should read the ref at the moment of the click, not during render",
  );
  assert.ok(QUOTATION.includes("<ConfirmDialog {...tabConfirmProps} />"), "the brand panel should render the dialog it asks with");
});

test("every quotation screen that stages an edit reports it, and clears it on the way out", () => {
  /*
   * Three of them: the shared content, a brand's PDF Content, and a brand's PDF Image. The Terms
   * tab is not one - a term is written by its own dialog the moment it is saved, so it never holds
   * anything - and neither is Field Settings, whose entries save as they are typed.
   */
  const reporters = QUOTATION.match(/unsavedRef\.current = dirty;/g) || [];
  assert.equal(reporters.length, 3, "General, PDF Content and PDF Image should each publish their dirty flag");
  const cleanups = QUOTATION.match(/return \(\) => \{ unsavedRef\.current = false; \};/g) || [];
  assert.equal(cleanups.length, 3, "each should stop claiming to hold an edit once it is unmounted");
});

test("the rail knows about the quotation sections it can now be asked to leave", () => {
  /*
   * A panel reporting an unsaved edit that the rail does not look up is a flag nothing reads. The
   * brands share one entry-per-code mapping onto one ref, the way the message templates do: three
   * rail entries, one panel, only ever one of them mounted.
   */
  assert.match(OVERLAY, /"quotation-general": quotationGeneralUnsavedRef/, "the shared content section should be registered");
  assert.match(
    OVERLAY,
    /QUOTATION_BRANDS\.map\(\(brand\) => \[`quotation-brand-\$\{brand\.code\}`, quotationBrandUnsavedRef\]\)/,
    "every brand section should answer from the brand panel's ref",
  );
  assert.ok(QUOTATION_BRANDS.length > 0, "there should be brands for that mapping to cover");
  // Both panels are handed the ref the rail reads; a panel left unwired would report into nothing.
  assert.match(OVERLAY, /<QuotationGeneralSettingsPanel canWrite unsavedRef=\{quotationGeneralUnsavedRef\}/);
  assert.match(OVERLAY, /unsavedRef=\{quotationBrandUnsavedRef\}/);
});

test("a refresh is asked about too, and only while Settings is open", () => {
  /*
   * The one way out no dialog of ours can stand in front of. The browser asks in its own words and
   * only because the listener says there is something to lose; gated on `open` so nothing else in
   * the application inherits a warning about work it is not holding.
   */
  assert.match(OVERLAY, /useUnloadWarning\(open, \(\) => sectionHoldsUnsavedEdits\(activeSection\)\)/);
  assert.ok(GUARD.includes('window.addEventListener("beforeunload", onBeforeUnload)'), "the warning should be a beforeunload listener");
  assert.ok(GUARD.includes('window.removeEventListener("beforeunload", onBeforeUnload)'), "and should be taken down with the overlay");
  assert.ok(
    /if \(!\(typeof holds === "function" \? holds\(\) : holds\)\) return;/.test(GUARD),
    "a page holding nothing should refresh without a prompt",
  );
});
