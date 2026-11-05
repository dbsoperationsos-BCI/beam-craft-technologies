"use client";

import { useCallback, useState } from "react";
import { pruneDismissed } from "@/lib/notificationFeed.mjs";

/**
 * The bell's notices this reader has marked as read, for the halves with no read state on the
 * server - the derived "waiting on you" notices and the meetings.
 *
 * In this browser, the way those halves already remember what has been *seen*: it is one reader's
 * reading of work that is listed on its own screen elsewhere. `dismiss` is handed the entries the
 * bell currently holds, so the stored list is pruned to them each time and cannot grow without limit.
 */
function readDismissed(key) {
  if (typeof window === "undefined") return [];
  try {
    const stored = JSON.parse(window.localStorage.getItem(key) || "[]");
    return Array.isArray(stored) ? stored.map(String) : [];
  } catch {
    // Unreadable storage is nothing dismissed: the notices show again, the safe way to be wrong.
    return [];
  }
}

export default function useDismissedNotices(key) {
  const [dismissed, setDismissed] = useState(() => readDismissed(key));

  const dismiss = useCallback((id, entries) => {
    setDismissed((current) => {
      const next = pruneDismissed([...current, String(id)], entries);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Storage refused: the notice is gone for now and comes back on the next load.
      }
      return next;
    });
  }, [key]);

  return { dismissed, dismiss };
}
