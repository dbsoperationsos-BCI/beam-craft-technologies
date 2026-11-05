"use client";

import { useEffect, useRef } from "react";
import { isStale } from "@/lib/refreshPolicy.mjs";

/**
 * Keeps a dashboard current without a Refresh button, on the shared policy in
 * `lib/refreshPolicy.mjs`: a quiet re-read when the tab comes back to the front after going
 * stale, when the network comes back, when any of `signals` fires (an upload landing, a run
 * finishing), and every `intervalMs` while the tab is in front. Quiet means the page keeps what
 * it shows and swaps the figures in; the caller's `refresh({ quiet: true })` decides what that
 * looks like.
 *
 * `refresh` may change identity (it usually closes over the range); the latest one is always the
 * one called, without re-arming the timers. `signals` are subscribe functions returning an
 * unsubscribe, the shape every store here already offers.
 */
export default function useAutoRefresh(refresh, { intervalMs, signals = [], enabled = true } = {}) {
  const latest = useRef(refresh);
  // Kept current after every render rather than during it, which React forbids for a ref.
  useEffect(() => { latest.current = refresh; });
  const lastAt = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;
    const run = () => { lastAt.current = Date.now(); void latest.current({ quiet: true }); };
    const onVisible = () => { if (document.visibilityState === "visible" && isStale(lastAt.current)) run(); };
    const onTick = () => { if (document.visibilityState === "visible") run(); };
    const timer = intervalMs ? window.setInterval(onTick, intervalMs) : null;
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", run);
    const unsubscribes = signals.map((subscribe) => subscribe(run));
    return () => {
      if (timer) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", run);
      unsubscribes.forEach((unsubscribe) => unsubscribe?.());
    };
    // `signals` is a fresh array literal on every render; its members are module-level subscribe functions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, intervalMs, ...signals]);

  /** Lets a page mark its own first read, so a tab flip right after it does not read twice. */
  return { markRead: () => { lastAt.current = Date.now(); } };
}
