import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Escape, decided in one place.
 *
 * The application is full of things that open - dialogs, full-screen forms, dropdowns, calendars,
 * context menus, the settings overlay, the chat panel - and each one used to listen on `document`
 * for itself. That produced two faults which are opposite sides of one missing idea:
 *
 *   Everything fires at once.  A dropdown inside a dialog: both listeners hear the press, the list
 *                              closes *and* the dialog closes under it, taking the half-filled form
 *                              with it.
 *   Or nothing fires.          An overlay whose author did not write the listener - Add Lead, the
 *                              lead popup, the bulk update dialog - ignored the key entirely.
 *
 * One listener and a stack fixes both, and the ordering *is* the behaviour, so it is what these
 * pin down. The hook is exercised directly rather than through a rendered component: this is a
 * module-level stack and a document listener, which is the whole of what there is to test.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "..", "src");
const read = (file) => fs.readFileSync(path.join(SRC, file), "utf8");
const HOOK = read("components/shared/useEscapeKey.js");

/* ─────────────────────────────────────────────────────── the arbiter's own rules ── */

test("only the thing on top answers, and the next one down answers after it", () => {
  /*
   * The property everything else rests on. Read out of the source because the hook is a React hook
   * and this suite has no renderer - what can be checked is that the top of the stack is what is
   * dismissed, and that a handler is taken off the stack when it goes.
   */
  assert.match(HOOK, /const top = stack\[stack\.length - 1\];/);
  assert.match(HOOK, /if \(!top\) return;/);
  assert.match(HOOK, /top\.dismiss\(event\);/);
  // Pushed on registering and spliced out on cleanup, so closing the top hands Escape to the next.
  assert.match(HOOK, /stack\.push\(entry\);/);
  assert.match(HOOK, /const index = stack\.lastIndexOf\(entry\);[\s\S]{0,80}stack\.splice\(index, 1\);/);
});

test("an event something else already dealt with is left alone", () => {
  /*
   * Three inline editors cancel themselves from their own `onKeyDown` - a shoot cell, a service
   * duration segment, an HRM option being renamed. They are the innermost thing on screen and
   * should win over the dialog around them, and they say so by calling `preventDefault`.
   *
   * An IME is the other case and matters more than it looks: Escape abandons the characters being
   * composed, and taking that away would close the form somebody is typing into.
   */
  assert.match(HOOK, /if \(event\.defaultPrevented \|\| event\.isComposing \|\| event\.keyCode === 229\) return;/);
});

test("the listener is on the document and in the bubble phase", () => {
  /*
   * Bubble, so an element that has focus sees the key first - which is what lets those inline
   * editors take it. Capture would run before them and there would be no way for the innermost
   * thing to claim the press.
   *
   * On the document rather than on the overlay, so Escape works wherever focus happens to be. That
   * is the difference between a key that works and one that works only if you tabbed into the right
   * place first.
   */
  assert.match(HOOK, /document\.addEventListener\("keydown", onDocumentKeyDown\);/);
  assert.doesNotMatch(HOOK, /addEventListener\("keydown", onDocumentKeyDown, true\)/, "capture would take the key from the inline editors");
  // And it is one listener for the whole application rather than one per overlay.
  assert.match(HOOK, /if \(listening \|\| typeof document === "undefined"\) return;/);
  assert.match(HOOK, /if \(!listening \|\| stack\.length \|\| typeof document === "undefined"\) return;/);
});

test("the handler is read through a ref, so an inline arrow does not re-order the stack", () => {
  /*
   * Almost every caller passes `() => setOpen(false)`, which is a new function every render.
   * Re-registering on that would push the overlay back on top of a menu it had opened, and Escape
   * would start closing the wrong thing after any unrelated re-render.
   */
  assert.match(HOOK, /const handlerRef = useRef\(onEscape\);/);
  assert.match(HOOK, /useEffect\(\(\) => \{ handlerRef\.current = onEscape; \}, \[onEscape\]\);/);
  // The registering effect depends on `enabled` alone, which is the only thing that should move it.
  assert.match(HOOK, /\}, \[enabled\]\);/);
});

/* ────────────────────────────────────────────── everything that opens is on the stack ── */

test("no component listens for Escape on its own any more", () => {
  /*
   * The fault this replaced, and the one way it comes back: somebody adds an overlay with a
   * `document.addEventListener("keydown", ...)` of its own, and it starts closing two things at
   * once. The exceptions are element handlers, which are allowed and are checked below.
   */
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith(".js")) continue;
      if (entry.name === "useEscapeKey.js") continue;
      const source = fs.readFileSync(full, "utf8");
      // A document- or window-level keydown listener that mentions Escape is one of the old ones.
      if (/(document|window)\.addEventListener\("keydown"/.test(source) && /"Escape"/.test(source)) {
        offenders.push(path.relative(SRC, full));
      }
    }
  };
  walk(path.join(SRC, "components"));
  assert.deepEqual(offenders, [], "these listen for Escape themselves instead of through useEscapeKey");
});

test("an element that claims Escape says so with preventDefault", () => {
  /*
   * The contract, and it is not optional: without it the arbiter cannot tell "somebody handled
   * this" from "nobody did", and the form around the field closes as well as the edit being
   * cancelled. One of these was missing it - the service picker's own suggestion list - and closing
   * the list closed the panel behind it.
   */
  const inline = [
    "components/project-management/ProjectShootList.js",
    "components/project-management/ProjectServiceCreationSection.js",
    "components/shared/HrmOptionListEditor.js",
  ];
  for (const file of inline) {
    const lines = read(file).split("\n");
    lines.forEach((line, index) => {
      if (!line.includes('"Escape"')) return;
      // The claim can be on the same line or in the block it opens, so a few lines are read on.
      const block = lines.slice(index, index + 5).join("\n");
      assert.match(block, /preventDefault\(\)/, `${file} handles Escape on an element without claiming it: ${line.trim()}`);
    });
  }
});

test("the overlays people spend the day in all close on Escape", () => {
  /*
   * Named one by one rather than counted, because the ones that matter are the ones somebody sits
   * in front of - and every one of these ignored the key before. The board's own overlays are
   * hand-rolled `fixed inset-0` markup rather than the shared `Dialog`, so none of them inherited
   * it.
   */
  const board = read("components/sales/CRMPage.js");
  for (const [what, call] of [
    // Through `requestCloseAddLead`, which asks before it discards - Escape is the same door as
    // the × and Cancel, not a quicker one that skips the question.
    ["Add Lead", /useEscapeKey\(requestCloseAddLead, showAddLead\)/],
    ["the lead popup", /useEscapeKey\(\(\) => onClose\?\.\(\), Boolean\(open && lead\)\)/],
    ["Update Details", /useEscapeKey\(\(\) => setShowBulkUpdateDialog\(false\), showBulkUpdateDialog\)/],
    ["the delete confirmation", /useEscapeKey\(\(\) => setPendingDeleteLead\(null\), Boolean\(pendingDeleteLead\) && !deletingLead\)/],
    ["the convert confirmation", /useEscapeKey\(\(\) => setConvertLead\(null\), Boolean\(convertLead\)\)/],
    ["the import dialog", /useEscapeKey\(\(\) => setShowImportDialog\(false\), showImportDialog && !isImporting\)/],
    // Opened from the lead popup, which is why its omission read as Escape closing the wrong thing
    // rather than as Escape doing nothing. See the test below.
    ["the quotation calculator", /useEscapeKey\(\(\) => onClose\?\.\(\), open\)/],
  ]) {
    assert.match(board, call, `${what} no longer closes on Escape`);
  }
  // And the two shells every other module's forms are built from.
  assert.match(read("components/ui/Dialog.js"), /useEscapeKey\(\(\) => onClose\?\.\(\), !busy\)/);
  assert.match(read("components/schema-form/SchemaFormPanel.js"), /useEscapeKey\(\(\) => onClose\?\.\(\), !saving\)/);
});

test("nothing is dismissed out from under work that cannot be undone", () => {
  /*
   * A save, an import, a delete being carried out. Passing `enabled: false` keeps them off the
   * stack entirely rather than swallowing the key, so Escape falls through to whatever is
   * underneath - which is the honest behaviour, since the work is not cancellable and the key is
   * therefore not about that dialog.
   */
  assert.match(read("components/ui/Dialog.js"), /!busy\);/);
  assert.match(read("components/schema-form/SchemaFormPanel.js"), /!saving\);/);
  assert.match(read("components/sales/ScheduleMeetDialog.js"), /!scheduling\);/);
  assert.match(read("components/sales/MeetingsPage.js"), /&& !cancelling\);/);
  assert.match(read("components/image-selection/client-gallery/SelectionPinDialog.js"), /useEscapeKey\(onClose, !busy\);/);
});

test("the panel stack that was invented locally is gone", () => {
  /*
   * `SchemaFormPanel` had the right idea and the wrong scope: it kept a stack of *panels*, so two
   * panels took turns correctly and a dialog opened from one was still a second listener hearing
   * the same press. One stack, for everything that opens.
   */
  const panel = read("components/schema-form/SchemaFormPanel.js");
  assert.doesNotMatch(panel, /const openPanels = \[\]/, "SchemaFormPanel is keeping a second stack again");
  assert.match(panel, /import useEscapeKey/);
});

/*
 * An overlay opened from another overlay: the calculator raised from the lead popup.
 *
 * This is the case a missing registration hides in. `QuotationCalculatorModal` never joined the
 * stack, so with both on screen the top of it was still the *popup* - and a press meant for the
 * calculator closed the lead behind it while the calculator stayed. Escape appeared to work in
 * reverse rather than to be missing, which is why it was worth writing down.
 */
test("an overlay opened from another one closes before the one that opened it", () => {
  const board = read("components/sales/CRMPage.js");
  const start = board.indexOf("function QuotationCalculatorModal(");
  assert.notEqual(start, -1, "QuotationCalculatorModal was not found");
  const body = board.slice(start, board.indexOf("\nfunction ", start + 1));

  assert.match(body, /useEscapeKey\(\(\) => onClose\?\.\(\), open\)/, "the calculator must take its turn on the stack");
  /*
   * Keyed on `open`, and that is the ordering rather than a tidiness: the component stays mounted
   * for as long as the popup is, so registering unconditionally would put it on the stack *below*
   * the popup - a child's effect runs before its parent's - and Escape would close the wrong one
   * again, from the other direction.
   */
  assert.ok(
    !/useEscapeKey\(\(\) => onClose\?\.\(\)\)/.test(body),
    "registering for the whole mount would put the calculator under the popup that opens it",
  );
  // It renders nothing until it is open, so there is no window where it is on the stack unseen.
  assert.match(body, /if \(!open\) return null;/);
});
