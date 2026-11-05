import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Closing the enquiry popup with edits in it asks before throwing them away.
 *
 * Every field on that form writes into `draft` and nothing reaches the server until Update, so the
 * × and Escape discarded a half-filled lead without a word - on the largest form in the module, by
 * the gesture people reach for most. The settings rail had asked this question properly for a
 * while; this is the same question, through the same hook, so the wording and the shape of the
 * answer are what the application already asks everywhere else.
 *
 * Read off the source like the other CRM tests beside it: no DOM, no renderer.
 */

const PAGE = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "sales", "CRMPage.js"), "utf8");

test("the popup's close is guarded, and Escape goes through the same door", () => {
  assert.match(PAGE, /import useUnsavedGuard from "@\/components\/shared\/useUnsavedGuard";/,
    "the popup no longer uses the shared guard - a second copy of this question would drift from the settings one");
  assert.match(PAGE, /onClose=\{\(\) => guardClose\(\(\) => onClose\?\.\(\)\)\}/,
    "the × closes the popup without asking again");
  // Escape is not a second door with its own rules: it calls the same `onClose` the × does, so
  // guarding that one prop covers both. If this ever becomes its own handler it needs the guard too.
  assert.match(PAGE, /useEscapeKey\(\(\) => onClose\?\.\(\), Boolean\(open && lead\)\)/);
  assert.match(PAGE, /<ConfirmDialog \{\.\.\.closeConfirmProps\} layer="dialogOverPanel" \/>/,
    "the dialog is missing, or back on the default z-[100] where the popup's own z-[120] hides it");
});

test("the question is asked about real edits, and only about them", () => {
  // The draft is written by the form's own handlers and cleared on save; nothing seeds it on open,
  // which is what makes its emptiness a fair test of whether anybody has typed.
  assert.match(PAGE, /const holdsUnsavedEdits = Object\.keys\(draft\.lead\)\.length > 0 \|\| Object\.keys\(draft\.details\)\.length > 0;/);
  assert.match(PAGE, /useUnsavedGuard\(holdsUnsavedEdits, \{/);
});

test("the board's own popup asks too, not only the Contacts one", () => {
  /*
   * There are two ways this form reaches the screen and they are wired separately: the CRM board
   * renders `LeadPopupModal` itself, while the Contacts directory goes through `LeadPopupHost`.
   * Guarding one leaves the other throwing work away - and the board is the one the studio lives in,
   * so a guard that covers only the host covers almost nobody.
   */
  assert.match(PAGE, /const popupHoldsUnsavedEdits = Object\.keys\(popupEdits\.lead\)\.length > 0 \|\| Object\.keys\(popupEdits\.details\)\.length > 0;/);
  assert.match(PAGE, /onClose=\{\(\) => guardPopupClose\(\(\) => \{ discardPopupDraft\(\); setShowLeadPopupId\(null\); \}\)\}/,
    "the board's popup closes without asking again");
  assert.match(PAGE, /<ConfirmDialog \{\.\.\.popupCloseConfirmProps\} layer="dialogOverPanel" \/>/,
    "the board's dialog is missing, or back on the default layer where the popup hides it");
  // Saving closes the popup directly, so Update and Close is never asked to discard what it saved.
  assert.match(PAGE, /if \(closeAfter \|\| !advanceAfter\) \{\s*\n\s*setShowLeadPopupId\(null\);/);
});

test("both confirmations sit above the popup they are asking about", () => {
  /*
   * The lead popup covers the page at `z-[120]`; a dialog's own layer is `z-[100]`. Rendered on the
   * default, each confirmation was drawn *behind* the form - its scrim dimmed the page, so the
   * background changed and nothing else appeared, which reads as a button that did nothing.
   *
   * `dialogOverPanel` (z-[130]) is the layer the scale keeps for exactly this: a confirmation over a
   * form being filled in. Asserted here because the failure is invisible to every test that only
   * checks the dialog exists.
   */
  assert.match(PAGE, /className="fixed inset-0 z-\[120\] bg-black\/40/, "the lead popup has moved layer; the dialogs above it need to move with it");
  // Named rather than counted: Add Lead's own confirmation is on the same layer for the same reason,
  // and a count would break every time another form joined them.
  for (const props of ["closeConfirmProps", "popupCloseConfirmProps"]) {
    assert.match(PAGE, new RegExp(`<ConfirmDialog \\{\\.\\.\\.${props}\\} layer="dialogOverPanel" />`),
      `${props} is no longer raised above the popup it asks about`);
  }
});

test("saving and stepping on are not asked about", () => {
  /*
   * `save()` empties the draft and then closes. A guard reading that state before it settled would
   * ask about edits it had just written and saved - a dialog that can only ever be wrong. Update
   * and Proceed Next steps through `stepTo` for the same reason. Both call `onClose` directly,
   * which is why the guarded wrapper is handed to the modal rather than wrapped around the prop.
   */
  assert.match(PAGE, /if \(closeAfter\) onClose\?\.\(\);/, "Update and Close now asks whether to discard what it just saved");
  assert.match(PAGE, /if \(!id \|\| id === leadId\) \{ onClose\?\.\(\); return; \}/);
});

test("no browser prompt is asked for on top of ours", () => {
  /*
   * A `beforeunload` warning was here briefly and is gone on purpose. Our own dialog is the whole
   * of the question now: two prompts for one decision - ours, and then Chrome's generic "Reload
   * site?" over it - reads as the application asking twice and trusting neither answer.
   */
  assert.doesNotMatch(PAGE, /useUnloadWarning/, "the browser prompt is back on top of our own dialog");
});
