"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import useEscapeKey from "@/components/shared/useEscapeKey";

/**
 * The ⋮ menu, opened by a right-click at the pointer instead of by a button.
 *
 * Same items in the same shape as `OptionsMenu` - `{ label, onSelect }` plus `tone: "danger"`,
 * `disabled` and `separator: true` - and the same item styling, so a row's right-click menu and its
 * ⋮ menu are visibly the same control reached two ways. Somebody who has used one has used the
 * other.
 *
 * It is a separate component rather than a mode of `OptionsMenu` because the two differ in the one
 * thing that menu is built around: `OptionsMenu` measures its trigger and hangs off it, and a
 * right-click has no trigger to measure - only a point. Threading "sometimes there is no trigger"
 * through that positioning would make the common case harder to read for the sake of the rare one.
 *
 * Placed against the window and flipped at the edges, so a right-click near the bottom of a long
 * table does not open a menu that runs off the screen.
 */

/** Breathing room kept between the menu and the edge of the window. Matches `OptionsMenu`. */
const EDGE_MARGIN = 8;

export default function ContextMenu({ x, y, items, onClose, ariaLabel = "Row actions", zIndex = 130, className = "w-48" }) {
  const menuRef = useRef(null);
  const [placement, setPlacement] = useState({ left: x, top: y, ready: false });

  /*
   * Measured before it is painted.
   *
   * `useLayoutEffect` rather than `useEffect`: the menu has to be moved into place in the same frame
   * it appears, or it is visibly drawn at the pointer and then jumps.
   */
  useLayoutEffect(() => {
    const node = menuRef.current;
    if (!node) return;
    const { width, height } = node.getBoundingClientRect();
    // Flipped rather than clamped: a menu that opens away from the edge keeps the pointer at its
    // corner, which is where the eye already is.
    const left = x + width + EDGE_MARGIN > window.innerWidth ? Math.max(EDGE_MARGIN, x - width) : x;
    const top = y + height + EDGE_MARGIN > window.innerHeight ? Math.max(EDGE_MARGIN, y - height) : y;
    setPlacement({ left, top, ready: true });
  }, [x, y]);

  // Escape closes this menu, and only this menu - not the row's table or the dialog around it.
  useEscapeKey(onClose);

  useEffect(() => {
    const onPointerDown = (event) => {
      if (menuRef.current?.contains(event.target)) return;
      onClose();
    };
    /*
     * A second right-click elsewhere closes this one and opens that one.
     *
     * Without it the browser's own menu appears over ours, or two of ours stack up - both of which
     * happen the first time somebody right-clicks a second row.
     */
    const onContext = (event) => { if (!menuRef.current?.contains(event.target)) onClose(); };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("contextmenu", onContext, true);
    // Any scroll leaves the menu pointing at nothing, so it closes rather than following.
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("contextmenu", onContext, true);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={ariaLabel}
      style={{ left: placement.left, top: placement.top, zIndex, visibility: placement.ready ? "visible" : "hidden" }}
      className={`fixed overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg ${className}`}
    >
      {items.filter(Boolean).map((item, index) => (
        item.separator
          ? <div key={`separator-${index}`} role="separator" className="my-1 border-t border-slate-100" />
          : (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => { onClose(); item.onSelect?.(); }}
              /* The same item styling as OptionsMenu, so the two menus are one control. */
              className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-transparent disabled:text-slate-400 ${
                item.tone === "danger" ? "text-red-600 hover:bg-red-50" : "text-slate-700"
              }`}
            >
              <span>{item.label}</span>
              {item.icon}
            </button>
          )
      ))}
    </div>,
    document.body,
  );
}
