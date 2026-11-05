"use client";

import { useCallback, useEffect, useState } from "react";
import { REVIEW_DWELL_MS } from "@/lib/spreadReview.mjs";

/**
 * Remembers which spreads this reviewer has looked at, so approval can wait until they have been
 * through the album. Shared by the QC review room and the client's proofing room, which hold to
 * the same rule.
 *
 * A spread counts once it has been on screen for a moment, not the instant it flicks past under a
 * held arrow key. The record lives in the reviewer's own browser, keyed per album and version, so
 * a reload or a return tomorrow does not send them round the spreads again — and it is only ever a
 * convenience for the reviewer, never something the studio relies on: the server decides what may
 * actually be approved.
 */
export default function useSeenSpreads(storageKey, currentPageId) {
  const [seen, setSeen] = useState(() => new Set());

  useEffect(() => {
    if (!storageKey) return;
    let stored = null;
    try { stored = JSON.parse(window.localStorage.getItem(storageKey) || "[]"); } catch { stored = null; }
    setSeen(new Set(Array.isArray(stored) ? stored.filter((id) => typeof id === "string") : []));
  }, [storageKey]);

  const markSeen = useCallback((pageId) => {
    if (!pageId || !storageKey) return;
    setSeen((current) => {
      if (current.has(pageId)) return current;
      const next = new Set(current).add(pageId);
      try { window.localStorage.setItem(storageKey, JSON.stringify([...next])); } catch { /* storage unavailable */ }
      return next;
    });
  }, [storageKey]);

  useEffect(() => {
    if (!currentPageId || !storageKey) return undefined;
    const timer = window.setTimeout(() => markSeen(currentPageId), REVIEW_DWELL_MS);
    return () => window.clearTimeout(timer);
  }, [currentPageId, markSeen, storageKey]);

  return seen;
}
