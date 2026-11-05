"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { usePreferenceValues, usePreferencesReady } from "@/components/preferences/PreferencesProvider";
import { LAST_PAGE_KEYS, familyOf, lastPageKey } from "@/lib/lastPage.mjs";

/**
 * Remembers which screen of a page family - User Management's, Pre Production's, Production's and
 * the rest in `lib/lastPage.mjs` - this login is on, so the family's sidebar row brings them back to
 * it (`useSidebarLayout`). Mounted once, in the app shell. Written only when it changes, and only
 * once the stored preferences have arrived, so a first frame cannot overwrite what another device
 * saved.
 */
export default function useRememberLastPage() {
  const pathname = usePathname();
  const ready = usePreferencesReady();
  const { values, set } = usePreferenceValues(LAST_PAGE_KEYS);

  useEffect(() => {
    if (!ready) return;
    const family = familyOf(pathname);
    if (!family) return;
    const path = String(pathname || "").replace(/\/+$/, "");
    const key = lastPageKey(family);
    if (values[key] !== path) set(key, path);
  }, [pathname, ready, values, set]);
}
