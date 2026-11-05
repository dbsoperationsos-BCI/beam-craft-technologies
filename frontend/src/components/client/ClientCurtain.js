"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import ClientBackdrop from "./ClientBackdrop";

// Longest a closed curtain waits for the page behind it to say it is ready, before it opens anyway.
const READY_WITHIN = 8000;

const CurtainContext = createContext({ cover: async () => {}, reveal: () => {}, isDrawn: () => false });

/**
 * The passage between the client's two pages - signing in, and their project - as a length of film
 * drawn across the screen: dark, in the studio's colours, with sprocket holes along both edges.
 *
 * It lives in the client layout, which stays put while the client moves between those pages, so it
 * can be drawn over one page and drawn off over the next. `cover()` slides it down over the screen
 * and resolves once it is closed; the page that comes next calls `reveal()` when it has something
 * to show, and the film runs on down and off it - one direction of travel, as film advances through
 * a camera. A page arrived at with no curtain drawn ignores `reveal()`.
 *
 * Never left closed: it opens by itself after `READY_WITHIN` if nothing calls `reveal()`. For the
 * eye only (`aria-hidden`). A device asking for less motion never sees it - `cover()` resolves at
 * once and the pages simply change.
 */
export function ClientCurtainProvider({ children }) {
  // none | closing | closed | opening
  const [phase, setPhase] = useState("none");
  const closedRef = useRef(null);
  const wantRevealRef = useRef(false);
  // Read by a page as it mounts, to know whether it is arriving behind the curtain.
  const phaseRef = useRef(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  const isDrawn = useCallback(() => phaseRef.current !== "none", []);

  const cover = useCallback(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return Promise.resolve();
    wantRevealRef.current = false;
    phaseRef.current = "closing";
    setPhase("closing");
    return new Promise((resolve) => { closedRef.current = resolve; });
  }, []);

  const reveal = useCallback(() => {
    wantRevealRef.current = true;
    setPhase((current) => (current === "closed" ? "opening" : current));
  }, []);

  // Never left standing: a page that never says it is ready is shown anyway.
  useEffect(() => {
    if (phase !== "closed") return undefined;
    const timer = window.setTimeout(() => setPhase("opening"), READY_WITHIN);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const onAnimationEnd = (event) => {
    if (event.target !== event.currentTarget) return;
    if (phase === "closing") {
      // Asked to open while it was still closing: it opens as soon as it has closed.
      setPhase(wantRevealRef.current ? "opening" : "closed");
      closedRef.current?.();
      closedRef.current = null;
    } else if (phase === "opening") {
      setPhase("none");
    }
  };

  const value = useMemo(() => ({ cover, reveal, isDrawn }), [cover, reveal, isDrawn]);

  return <CurtainContext.Provider value={value}>
    {children}
    {phase !== "none" && <div
      aria-hidden="true"
      onAnimationEnd={onAnimationEnd}
      className={`fixed inset-0 z-[60] ${phase === "closing" ? "curtain-close" : phase === "opening" ? "curtain-open" : ""}`}
    >
      <ClientBackdrop />
      {/* The film's edges, leading as it comes down and trailing as it goes. */}
      <div className="film-sprockets absolute inset-x-0 -bottom-4 h-4 bg-[var(--client-film)]" />
      <div className="film-sprockets absolute inset-x-0 -top-4 h-4 bg-[var(--client-film)]" />
    </div>}
  </CurtainContext.Provider>;
}

/** `{ cover, reveal, isDrawn }` from the client layout's curtain. */
export function useClientCurtain() {
  return useContext(CurtainContext);
}
