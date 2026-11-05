"use client";

import { useEffect, useRef } from "react";

/**
 * Closes a portalled popover once the field it belongs to has scrolled out of sight.
 *
 * A menu or a calendar is rendered into `document.body` so the pane it sits in cannot clip it —
 * which is what lets a field near the foot of a scrolling panel show its options at all. The cost
 * is that the popover is no longer part of that pane: scrolling the panel moves the field but not
 * the popover's clipping, so an open menu would ride up over the header and reappear from nowhere
 * on the way back down.
 *
 * Rather than clip the popover to a pane it deliberately escaped, it is closed. Reopening is one
 * click, and a menu that is still open for a field nobody can see is answering a question that has
 * left the screen.
 *
 * `IntersectionObserver` is what makes this reliable: it reports the trigger's visible area with
 * every ancestor's clipping already applied, so a field scrolled out of an `overflow-auto` panel
 * counts as hidden even though the window itself has not moved. Watching scroll events instead
 * would mean finding the scrolling ancestor by hand and comparing rectangles against it.
 */
export default function useCloseWhenTriggerHidden(open, triggerRef, onHidden) {
  // Held in a ref so a caller passing an inline arrow does not tear the observer down and rebuild
  // it on every render.
  const onHiddenRef = useRef(onHidden);
  useEffect(() => { onHiddenRef.current = onHidden; }, [onHidden]);

  useEffect(() => {
    const trigger = triggerRef.current;
    if (!open || !trigger || typeof IntersectionObserver === "undefined") return undefined;

    // Fires once on observe with the current state, which is `true` for a field that was just
    // clicked, so opening never closes itself.
    const observer = new IntersectionObserver(
      (entries) => { if (entries.some((entry) => !entry.isIntersecting)) onHiddenRef.current?.(); },
      { threshold: 0 },
    );
    observer.observe(trigger);
    return () => observer.disconnect();
  }, [open, triggerRef]);
}
