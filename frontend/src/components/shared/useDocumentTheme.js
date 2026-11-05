"use client";

import { useSyncExternalStore } from "react";
import { DEFAULT_THEME, isTheme } from "@/lib/theme";

/**
 * Which appearance the document is painted in, read off `<html data-theme>`.
 *
 * The theme is applied as an attribute on the document element (see `@/lib/theme`), because that
 * is what reaches portalled menus and dialogs; `useThemePreference` is what changes it, and it
 * needs the signed-in preferences under it. A reader that wants only to *know* the theme - the
 * logo on the sign-in page, which has no preferences provider above it - reads the attribute
 * directly and is told when it changes, so a switch in the account menu reaches it on the spot.
 *
 * The server snapshot is the light theme: the markup the server sent was painted from the cookie,
 * but nothing here can read the cookie, and answering light on the first frame matches what
 * `useStudioBranding` does - nothing is known until the client has run.
 */
const listeners = new Set();
let observer = null;

function subscribe(onChange) {
  listeners.add(onChange);
  if (!observer && typeof MutationObserver !== "undefined") {
    observer = new MutationObserver(() => listeners.forEach((listener) => listener()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }
  return () => {
    listeners.delete(onChange);
    if (!listeners.size && observer) { observer.disconnect(); observer = null; }
  };
}

function read() {
  const applied = document.documentElement.getAttribute("data-theme");
  return isTheme(applied) ? applied : DEFAULT_THEME;
}

export default function useDocumentTheme() {
  return useSyncExternalStore(subscribe, read, () => DEFAULT_THEME);
}
