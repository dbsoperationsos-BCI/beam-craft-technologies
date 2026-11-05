"use client";

import { useEffect } from "react";

/**
 * The device's own width, for a screen laid out for the phone itself on a page that otherwise
 * declares a wide viewport - a quotation's pages declare 1112px so the sheet scales to a phone like
 * a PDF. While the screen is up the viewport is `device-width`, and it is put back as it was when
 * the screen goes. The page may already have been drawn zoomed out to a third, and a phone may keep
 * that zoom across the change, so the switch first caps the scale at 1 - pulling the zoom back to
 * actual size - and a moment later lifts the cap so pinch-zoom works again.
 *
 * Only for a screen the page does not go back from (the expired card, an error): switching the
 * viewport back to the wide sheet can leave a phone at the narrow zoom.
 */
export function useDeviceViewport() {
  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return undefined;
    const previous = meta.getAttribute("content");
    meta.setAttribute("content", "width=device-width, initial-scale=1, maximum-scale=1");
    const release = window.setTimeout(() => meta.setAttribute("content", "width=device-width, initial-scale=1"), 400);
    return () => {
      window.clearTimeout(release);
      if (previous === null) meta.removeAttribute("content"); else meta.setAttribute("content", previous);
    };
  }, []);
}

/** The same, as a wrapper, for a screen drawn from an early return where a hook cannot be called. */
export default function DeviceViewport({ children }) {
  useDeviceViewport();
  return children;
}
