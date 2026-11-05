"use client";

import { useEffect } from "react";
import useEscapeKey from "@/components/shared/useEscapeKey";

// One dismissal rule for every hand-rolled menu: while `active`, pressing the pointer anywhere
// outside the open panel and the button that opened it — including elsewhere in the same
// component — or pressing Escape closes it. Scoping to the panel is the point: a ref around the
// whole component keeps its menu open while the user clicks other rows inside it, which is how
// menus ended up stacking across the screen instead of going away.
export default function useMenuDismiss(refs, onDismiss, active) {
  /*
   * Escape closes the menu, and only the menu.
   *
   * Through the shared arbiter: a ⋮ opened inside a dialog used to hear the same press the dialog
   * did, so one Escape shut the menu and the dialog under it. See `useEscapeKey`.
   */
  useEscapeKey(onDismiss, active);

  useEffect(() => {
    if (!active) return undefined;
    function onPointerDown(event) {
      if (refs.some((ref) => ref.current && ref.current.contains(event.target))) return;
      onDismiss();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
    // No dependency list on purpose: refs arrive as a fresh array each render, so the listeners
    // re-arm per render while a menu is open — cheap, and never stale.
  });
}
