"use client";

import { useCallback } from "react";
import { usePreference } from "@/components/preferences/PreferencesProvider";

/** The key one screen's remembered tab is kept under. */
export const tabPreferenceKey = (key) => `tab:${key}`;

/**
 * The tab a page is on, remembered per page across a reload — and now across a device.
 *
 * Every filtered screen in the app dropped back to All the moment it was refreshed, which is worst
 * exactly where refreshing is most natural: somebody working through the Pending queue reloads to
 * see what has changed and is put back at the top of everything.
 *
 * `PreferencesProvider` reads its cache of this on the first client render, the same way this hook
 * used to read storage directly, so the page is drawn on the right tab immediately rather than
 * showing All and switching under the reader a moment later.
 *
 * `valid` is the tabs the page actually has. A remembered tab that has since been renamed or
 * removed — or one left by a different version of the page — falls back rather than filtering the
 * table by a label nothing matches, which would read as an empty screen with no explanation.
 */
export default function useStickyTab(key, fallback, valid) {
  const [stored, setStored] = usePreference(tabPreferenceKey(key), fallback);
  const tab = typeof stored === "string" && (!valid || valid.includes(stored)) ? stored : fallback;

  const selectTab = useCallback((next) => setStored(String(next)), [setStored]);

  return [tab, selectTab];
}
