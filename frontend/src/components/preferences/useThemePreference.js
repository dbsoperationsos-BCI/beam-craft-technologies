"use client";

import { useCallback, useEffect, useState } from "react";
import { usePreference, usePreferencesReady } from "@/components/preferences/PreferencesProvider";
import { DEFAULT_THEME, applyTheme, isTheme, readStoredTheme } from "@/lib/theme";

/** Where the appearance is kept for the account, beside the cookie that paints it. */
export const THEME_PREFERENCE_KEY = "app:theme";

/**
 * Which appearance this login reads in — remembered against the account, not the browser.
 *
 * Two stores, deliberately, each doing what only it can:
 *
 * - The **cookie** (`@/lib/theme`) is read by the server, which writes `data-theme` into the HTML it
 *   sends. That is what paints the right palette on the very first frame, before React exists. It
 *   cannot follow anybody to another machine.
 * - The **preference** is on the account, so signing in on the laptop, the desktop app or a second
 *   browser brings the appearance with it. It cannot be read before the page has loaded.
 *
 * So the cookie is how the theme arrives instantly and the account is what it is. Where they
 * disagree — a machine this login has not used before — the account wins, and the repaint happens
 * once, as the preferences arrive.
 *
 * The appearance is chosen in one place — the account menu on the top bar — and it changes through
 * here, so the cookie and the account cannot end up saying different things. It is a hook rather
 * than code inside that menu because the two stores have to be reconciled on every load, wherever
 * the choice is made, and anything else offering the appearance later should reconcile them the
 * same way rather than write its own.
 */
export default function useThemePreference(serverTheme) {
  const ready = usePreferencesReady();
  const [stored, setStored] = usePreference(THEME_PREFERENCE_KEY, null);
  /*
   * What this browser is painting: the theme the server rendered with, which came from the cookie.
   * It is only the starting point — the account's answer takes over below the moment it arrives.
   */
  const [painted, setPainted] = useState(() => (isTheme(serverTheme) ? serverTheme : DEFAULT_THEME));

  const theme = ready && isTheme(stored) ? stored : painted;

  /*
   * Painting is a side effect on the document, not React state: the palette lives in `globals.css`
   * keyed on an attribute of `<html>`, which is what reaches the portalled menus, dialogs and
   * snackbars that render outside this tree entirely. Guarded on what is already applied so this
   * repaints only when the account's answer differs from what the cookie painted.
   */
  useEffect(() => {
    if (readStoredTheme() !== theme) applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((next) => {
    const value = applyTheme(next);
    setPainted(value);
    setStored(value);
  }, [setStored]);

  return { theme, setTheme };
}
