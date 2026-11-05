"use client";

import { useEffect } from "react";

const OVERLAY_SELECTOR = '[role="dialog"], [aria-modal="true"]';

/** Whether something between `target` and the page can still scroll sideways in this direction. */
function scrollsSideways(target, deltaX) {
  for (let node = target instanceof Element ? target : null; node && node !== document.body; node = node.parentElement) {
    if (node.scrollWidth <= node.clientWidth) continue;
    const { overflowX } = getComputedStyle(node);
    if (overflowX !== "auto" && overflowX !== "scroll") continue;
    if (deltaX < 0 ? node.scrollLeft > 0 : node.scrollLeft + node.clientWidth < node.scrollWidth - 1) return true;
  }
  return false;
}

/**
 * No touchpad swipe back or forward while a panel, dialog or pop-up is open.
 *
 * The CSS rule in `globals.css` (`overscroll-behavior-x: none` while an overlay is in the document)
 * is the whole of it in Chrome and Edge. Safari ignores that for its history swipe, so a sideways
 * wheel is refused here instead - but only when nothing under the pointer can still scroll that way,
 * so a wide table inside a dialog scrolls as it always did and the swipe is stopped only at its edge,
 * where it would otherwise have become Back.
 *
 * Mounted once in the root layout, so it covers every overlay - the shared `Dialog`, schema-form
 * panels and the pop-ups modules draw themselves - without each one having to ask for it.
 */
export default function SwipeNavigationGuard() {
  useEffect(() => {
    function onWheel(event) {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      if (!document.querySelector(OVERLAY_SELECTOR)) return;
      if (scrollsSideways(event.target, event.deltaX)) return;
      event.preventDefault();
    }
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, []);
  return null;
}
