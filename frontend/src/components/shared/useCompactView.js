"use client";

import { useCallback } from "react";
import { usePreference } from "@/components/preferences/PreferencesProvider";

/** The one key the density is kept under, for every table in the application. */
export const COMPACT_VIEW_KEY = "app:compactView";

/**
 * How densely the application draws its tables: one answer for every table, not one per page.
 *
 * Compact view is a preference the studio sets once, from the Table Options menu of any table, and
 * every table follows it. It used to be kept per page, which made one decision fifteen times and
 * let two boards read at two densities; then it was taken out of the menu altogether and fixed at
 * comfortable. This is the middle: the tick is in every table's menu because the studio wants to
 * reach it from wherever they are, and it moves every table at once so the application still reads
 * as one.
 *
 * It is now remembered against the login rather than the browser, so somebody who works compact
 * gets compact on the laptop as well as at the desk. `PreferencesProvider` still reads its cache of
 * that answer synchronously on the first client render, so a table is drawn at the right density
 * immediately instead of switching under the reader a moment later; the server's answer only has to
 * arrive on a machine this account has not used before.
 */
export default function useCompactView() {
  const [compact, setCompact] = usePreference(COMPACT_VIEW_KEY, false);
  const toggleCompact = useCallback(() => setCompact(!compact), [compact, setCompact]);
  return { compact, density: compact ? "compact" : "comfortable", toggleCompact };
}
