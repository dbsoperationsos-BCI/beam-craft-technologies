"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { layers } from "@/constants/layers";

/**
 * A menu entry's description on hover or keyboard focus - "Orbyt · Media Studio OS" - drawn as a card
 * beside the entry. Rendered into the body, because the sidebar's list scrolls and would clip anything
 * drawn inside it. `children` is the entry itself, which receives the hover and focus handlers.
 */
export default function SidebarHint({ title, hint, children }) {
  const [place, setPlace] = useState(null);
  if (!hint) return children;

  const show = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setPlace({ left: rect.right + 10, top: rect.top + rect.height / 2 });
  };
  const hide = () => setPlace(null);

  return <>
    <div onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>{children}</div>
    {place && typeof document !== "undefined" && createPortal(
      <div role="tooltip" className={`pointer-events-none fixed ${layers.popover} -translate-y-1/2`} style={{ left: place.left, top: place.top }}>
        <div className="relative rounded-lg bg-slate-900 px-3 py-2 shadow-lg shadow-slate-900/20 ring-1 ring-white/10">
          {/* The arrow, pointing back at the entry. */}
          <span aria-hidden="true" className="absolute -left-1 top-1/2 h-2 w-2 -translate-y-1/2 rotate-45 bg-slate-900" />
          <p className="whitespace-nowrap text-sm font-semibold leading-5 text-white">{title}</p>
          <p className="whitespace-nowrap text-xs leading-4 text-slate-300">{hint}</p>
        </div>
      </div>,
      document.body,
    )}
  </>;
}
