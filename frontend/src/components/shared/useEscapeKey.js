"use client";

import { useEffect, useRef } from "react";

/*
 * ── Escape, decided in one place ──────────────────────────────────────────────────────────────
 *
 * Escape means "undo the last thing that opened", and the application is full of things that open:
 * dialogs, full-screen forms, dropdowns, date pickers, context menus, the settings overlay, the
 * chat panel. Every one of them used to listen on `document` for itself, which produced two faults
 * that are opposite sides of the same missing idea.
 *
 * **Everything fires at once.** Open a Dropdown inside a Dialog and press Escape: both listeners
 * hear it, the list closes *and* the dialog closes underneath it, and whatever was being filled in
 * is gone. That is not Escape working twice - it is Escape working on the wrong thing.
 *
 * **Or nothing fires.** An overlay whose author did not write the listener - Add Lead, the lead
 * popup, the bulk update dialog, the meetings drawer - simply ignored the key, so the one gesture
 * everybody reaches for did nothing on the screens people spend the most time in.
 *
 * So there is one listener and a stack. Whatever opened most recently is on top, and Escape reaches
 * that and only that. Close it and the next one down becomes the answer. Nesting works without
 * anybody having to think about nesting.
 *
 * ── Bubble, not capture ──
 *
 * The listener sits on `document` in the bubble phase, so an element that has focus sees the key
 * first. That matters: three inline editors in this application cancel themselves on Escape from
 * their own `onKeyDown` - a shoot cell, a service duration segment, an HRM option being renamed -
 * and they are the innermost thing on screen, so they *should* win over the dialog around them.
 * Each calls `preventDefault`, and this steps aside for an event already dealt with.
 *
 * That is the contract for anything handling Escape on an element: **call `preventDefault`**. It is
 * what says "this one was mine", and without it the surrounding form would close as well as the
 * edit being cancelled.
 *
 * ── What it is not ──
 *
 * Not a focus trap and not a substitute for one. Escape works from anywhere on the page because the
 * listener is on the document, which is what makes it reliable; where focus should be while an
 * overlay is open is a separate question, answered by `Dialog` and the panels themselves.
 */

/**
 * The open things, oldest first. The last one is the one Escape is currently about.
 *
 * Module-level and deliberately so: the whole point is that overlays which know nothing about each
 * other still take their turn in the right order, and the only thing they can all share is this.
 */
const stack = [];
let listening = false;

function onDocumentKeyDown(event) {
  if (event.key !== "Escape") return;
  /*
   * Already dealt with. Two cases, and both must be left alone: an element handler that cancelled
   * its own inline edit, and a browser mid-composition - an IME uses Escape to abandon the
   * characters being composed, and taking that away would close the form somebody is typing into.
   */
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;

  const top = stack[stack.length - 1];
  if (!top) return;
  /*
   * Marked as handled, so anything still listening for itself - a component not yet moved onto this
   * hook, or one added later by somebody who did not find this file - stands down rather than
   * closing a second thing on the same press.
   */
  event.preventDefault();
  top.dismiss(event);
}

function listen() {
  if (listening || typeof document === "undefined") return;
  document.addEventListener("keydown", onDocumentKeyDown);
  listening = true;
}

function stopListening() {
  if (!listening || stack.length || typeof document === "undefined") return;
  document.removeEventListener("keydown", onDocumentKeyDown);
  listening = false;
}

/**
 * Closes this thing when Escape is pressed, if it is the thing on top.
 *
 * `enabled` is what puts it on the stack and takes it off, so a dropdown registers when its list
 * opens and a dialog registers for as long as it is mounted. Pass `false` while a thing must not be
 * dismissed - a dialog mid-save - and Escape falls through to whatever is underneath it, which is
 * the honest behaviour: the save is not cancellable, so the key is not about it.
 *
 * The handler is read through a ref, so a caller may pass a fresh function every render - as an
 * inline arrow, which almost every caller does - without re-ordering the stack. Re-registering on
 * every render would put an overlay back on top of a menu it had opened.
 */
export default function useEscapeKey(onEscape, enabled = true) {
  const handlerRef = useRef(onEscape);
  // Assigned from an effect rather than during render, which the compiler refuses - a ref is not
  // something a render reads or writes.
  useEffect(() => { handlerRef.current = onEscape; }, [onEscape]);

  useEffect(() => {
    if (!enabled) return undefined;
    const entry = { dismiss: (event) => handlerRef.current?.(event) };
    stack.push(entry);
    listen();
    return () => {
      const index = stack.lastIndexOf(entry);
      if (index !== -1) stack.splice(index, 1);
      stopListening();
    };
  }, [enabled]);
}

/**
 * How many things are currently listening for Escape.
 *
 * For tests, which is the only way to see a module-level stack from outside - and the ordering is
 * the whole behaviour, so it is worth being able to assert on.
 */
export function escapeStackSize() {
  return stack.length;
}
