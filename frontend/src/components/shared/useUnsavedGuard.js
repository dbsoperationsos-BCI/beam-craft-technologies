"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Asking before a move that throws away an edit the server has not been told about.
 *
 * The settings rail already asked this question, and asked it well - leave a section holding a
 * staged edit and a dialog says so. The trouble was that the rail was the only way out anyone had
 * thought about. A Table Settings canvas is thrown away just as completely by changing the Vertical
 * dropdown above it, and a brand's PDF content by clicking the tab next to it, and neither of those
 * asked anything: the work was simply gone, one click away from a dialog that would have saved it.
 *
 * So the question lives here now, worded once, and every control that can leave staged work behind
 * routes through it. `guard` takes what the control was going to do: with nothing staged it happens
 * straight away, and with something staged it waits behind the dialog instead.
 *
 *   const { guard, confirmProps } = useUnsavedGuard(dirty);
 *   <Dropdown onChange={(value) => guard(() => setVertical(value))} />
 *   <ConfirmDialog {...confirmProps} />
 *
 * `holdsUnsavedEdits` may be a boolean or a function. A function is for the caller whose answer
 * lives in a ref rather than in state - a panel that publishes its dirty flag upward without
 * re-rendering the shell on every keystroke - since a ref read during render would be read too
 * early, and read inside `guard` it is read at the moment the click happens.
 */
export default function useUnsavedGuard(holdsUnsavedEdits, options = {}) {
  /*
   * What the guarded control was going to do, held until the question is answered. `null` while
   * there is nothing pending, which is also what tells the dialog to stay shut.
   */
  const [pendingMove, setPendingMove] = useState(null);

  const guard = (move) => {
    const held = typeof holdsUnsavedEdits === "function" ? holdsUnsavedEdits() : holdsUnsavedEdits;
    if (!held) { move(); return; }
    // Stored through the updater form: a function handed to setState directly would be *run* to
    // produce the next state rather than kept as it.
    setPendingMove(() => move);
  };

  return {
    guard,
    /*
     * Spread onto a `ConfirmDialog`. Cancel keeps the work and stays where it is, so the answer
     * that loses nothing is the one that needs no decision - closing the dialog is Cancel.
     */
    confirmProps: {
      open: Boolean(pendingMove),
      title: options.title || "Unsaved changes will be discarded",
      message: options.message || "Go back if you want to save your settings.",
      cancelLabel: options.cancelLabel || "Go Back",
      confirmLabel: options.confirmLabel || "Discard & Continue",
      onCancel: () => setPendingMove(null),
      onConfirm: () => {
        const move = pendingMove;
        setPendingMove(null);
        move?.();
      },
    },
  };
}

/**
 * The way out that no dialog of ours can stand in front of: a refresh, a closed tab, a typed
 * address. The browser asks its own question there and only if a listener says the page is holding
 * something - so the same staged edits that stop a rail click now also stop an F5.
 *
 * `active` says whether to listen at all, and `holdsUnsavedEdits` is read when the event fires
 * rather than when the listener was attached, so a ref that turned dirty in between still counts.
 */
export function useUnloadWarning(active, holdsUnsavedEdits) {
  /*
   * The predicate kept in a ref rather than in the effect's dependencies. It is a fresh closure on
   * every render, so depending on it would tear the listener down and put it back on each
   * keystroke; through a ref the listener is attached once and still asks the current question.
   */
  const holdsRef = useRef(holdsUnsavedEdits);
  // Written after the render rather than during it: a ref is not a rendering value, and the
  // listener below only ever reads it from an event, long after this has run.
  useEffect(() => { holdsRef.current = holdsUnsavedEdits; });

  useEffect(() => {
    if (!active || typeof window === "undefined") return undefined;
    const onBeforeUnload = (event) => {
      const holds = holdsRef.current;
      if (!(typeof holds === "function" ? holds() : holds)) return;
      event.preventDefault();
      // Legacy browsers need returnValue set; the string itself is never shown - the browser
      // insists on its own wording here, which is why this one warning is not ours to write.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [active]);
}
