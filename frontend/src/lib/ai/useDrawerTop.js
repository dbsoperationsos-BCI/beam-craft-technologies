"use client";

import { useEffect, useState } from "react";

/**
 * Where a docked assistant panel begins: the bottom edge of the application's top bar.
 *
 * Everything below that bar is the panel's to cover - the module header included. It docked below
 * the module header first, on the reasoning that a panel should not hide the controls of the page it
 * is answering about. In use that reads as a panel that cannot make up its mind how tall it is: the
 * bar it stops under changes height from screen to screen, and the strip of page left showing above
 * it is too thin to work in anyway.
 *
 * The one thing that stays visible is the top bar, because that is how you leave: the menu, who you
 * are signed in as, and your notifications.
 *
 * Measured rather than hard-coded even though the bar is a fixed `h-12` today, because a measured
 * offset cannot drift out of step with the markup the way `3rem` written in two places would.
 *
 * Returns 0 while inactive or when there is no bar, which puts a panel against the top of the
 * window - the only sensible fallback, and better than guessing at an offset.
 */
export default function useDrawerTop(active) {
  const [top, setTop] = useState(0);

  useEffect(() => {
    if (!active) return undefined;

    const measure = () => {
      const header = document.querySelector("[data-app-topbar]");
      setTop(header ? Math.max(0, Math.round(header.getBoundingClientRect().bottom)) : 0);
    };
    measure();

    /*
     * Re-measured on resize and on scroll.
     *
     * The bar is sticky rather than fixed, so on a page that scrolls the document it can sit at a
     * different offset. Capture on the scroll listener, because the pane that moves is not always
     * the window.
     */
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [active]);

  return top;
}
