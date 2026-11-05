"use client";

import { useEffect, useRef } from "react";

/*
 * ── Where focus is while an overlay is open ───────────────────────────────────────────────────
 *
 * `useEscapeKey` says in so many words that it is "not a focus trap and not a substitute for one",
 * and that where focus should be while an overlay is open is a separate question. This is that
 * answer, and until now nothing answered it.
 *
 * What was wrong is easiest to see on Settings → Project → Services → Edit Service. The dialog
 * opened, and focus stayed on the ⋮ that opened it — which is *behind* the dialog. The first Tab
 * therefore walked the Settings page underneath: the rail, the panel, the rows, every control the
 * dialog was covering. The dialog's own fields could be reached only by tabbing all the way around
 * the page and back into it, if at all, and nothing stopped focus leaving again on the way out.
 * A dialog marked `aria-modal="true"` that does not hold focus is telling a screen reader one thing
 * and doing another.
 *
 * Three things, and they are one idea: focus goes in when the overlay opens, stays inside while it
 * is open, and goes back where it came from when it closes.
 *
 * ── Why the container rather than the first field ──
 *
 * Focus lands on the overlay itself, not on its first input. Tab from there reaches the first
 * control immediately, so nothing is further away, and the dialog's name is announced as it opens
 * rather than a field label out of context.
 *
 * Focusing the first input instead would open the on-screen keyboard on a phone every time any
 * dialog appeared — including a confirmation whose only answer is a button — and would scroll a
 * long form to whichever box happened to be first. Neither is something the person asked for by
 * opening the dialog.
 *
 * ── Nesting ──
 *
 * Overlays sit inside one another: a Dialog opened from a panel is a DOM descendant of that panel,
 * and a confirmation opened from a Dialog is one of those in turn. Each has its own trap, so a Tab
 * inside the innermost would bubble to every trap above it and each would try to answer it.
 *
 * The innermost wins, and works it out from the DOM rather than from a shared stack: every trapped
 * container carries `data-focus-trap`, and a handler stands down unless the nearest trapped
 * ancestor of whatever was typed into is its own container. No registration, no ordering to keep
 * straight, and an overlay added later is covered without knowing this file exists.
 *
 * ── What it deliberately does not do ──
 *
 * It does not pull focus back on `focusin`. A `Dropdown`'s list is portalled to the body — outside
 * the dialog's DOM — and so are `DropdownMenu` and the date picker; a guard that dragged focus back
 * inside would fight every one of them and make the lists unusable. Trapping Tab within the
 * container is enough, because those lists keep focus on their trigger (they are `combobox` +
 * `aria-activedescendant`, not roving focus) and handle Tab themselves.
 */

/**
 * What the browser will Tab to. `[tabindex="-1"]` is excluded deliberately: it is focusable by
 * script — which is how the container itself is focused — but is not part of the Tab order.
 */
const FOCUSABLE = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[contenteditable]:not([contenteditable='false'])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const TRAP_ATTRIBUTE = "data-focus-trap";

/**
 * The Tab stops inside this container, in the order Tab visits them.
 *
 * Read fresh on every press rather than held: a dialog's controls come and go as it is filled in —
 * a pricing line is added, a field appears because the answer above it changed, a button is
 * disabled while saving — and a list captured when the dialog opened would send focus to something
 * that is no longer there.
 *
 * `getClientRects()` is the visibility check rather than `offsetParent`, which is null for anything
 * positioned `fixed` — and every dialog in this application is inside a fixed overlay.
 */
function tabbableWithin(container) {
  return Array.from(container.querySelectorAll(FOCUSABLE)).filter((element) => {
    if (element.closest("[aria-hidden='true']")) return false;
    return element.getClientRects().length > 0;
  });
}

/**
 * Holds focus inside an overlay for as long as it is open.
 *
 * Returns the ref to put on the overlay's own element — the one carrying `role="dialog"`, not the
 * backdrop around it.
 *
 * `enabled` exists for an overlay that is mounted but is not the thing in front of the person; pass
 * `false` and focus is left entirely alone, including on the way out.
 */
export default function useFocusTrap(enabled = true) {
  const ref = useRef(null);

  useEffect(() => {
    const container = ref.current;
    if (!enabled || !container) return undefined;

    /*
     * Remembered before anything is focused, and restored on the way out.
     *
     * Guarded on the way back, because the element can be gone by then — a row's ⋮ that the
     * dialog's own action removed — and `focus` on a detached node does nothing but is worth not
     * calling.
     */
    const opener = document.activeElement;

    container.setAttribute(TRAP_ATTRIBUTE, "");
    // Focusable by script so it can be given focus, but never a Tab stop of its own.
    if (!container.hasAttribute("tabindex")) container.setAttribute("tabindex", "-1");
    // Only if focus is not already inside: a caller that has deliberately focused something of its
    // own before this runs is not overruled.
    if (!container.contains(document.activeElement)) container.focus({ preventScroll: true });

    function onKeyDown(event) {
      if (event.key !== "Tab" || event.defaultPrevented) return;
      // The innermost trap answers; see the note above.
      const target = event.target instanceof Element ? event.target : null;
      if (target && target.closest(`[${TRAP_ATTRIBUTE}]`) !== container) return;

      const stops = tabbableWithin(container);
      // Nothing to move to — a dialog that is only a sentence. Focus stays on the dialog rather
      // than leaving it for the page behind, which is what Tab would otherwise do.
      if (!stops.length) {
        event.preventDefault();
        container.focus({ preventScroll: true });
        return;
      }

      const first = stops[0];
      const last = stops[stops.length - 1];
      const active = document.activeElement;

      // Backwards off the front — or off the container itself, which is where focus starts — wraps
      // to the end. Forwards off the end wraps to the front. Every other press is the browser's:
      // moving between the controls inside is exactly what it already does correctly.
      if (event.shiftKey && (active === first || active === container || !container.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    container.addEventListener("keydown", onKeyDown);
    return () => {
      container.removeEventListener("keydown", onKeyDown);
      container.removeAttribute(TRAP_ATTRIBUTE);
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [enabled]);

  return ref;
}
