"use client";

import { useCallback, useEffect, useRef } from "react";
import { recordCullingViews } from "@/services/image-selection/image-selection.service";

// A tile counts as seen after this long at least 60% on screen - or, for a tile taller than the
// screen (a phone), filling 60% of it.
const SEEN_AFTER_MS = 1000;
const FLUSH_MS = 5000;
const BATCH = 200;

/**
 * Which photos the photographer actually saw during review, for the training labels: a tile on
 * screen for a second (GRID), or a photo opened in the preview (PREVIEW). Each photo is sent once
 * per source, batched every few seconds and on leaving, and quietly - a failed send is dropped,
 * it never interrupts the review. Off unless `enabled` (a writer, on a run under review).
 *
 * Returns { observe(element), opened(resultId) }: `observe` is a tile's ref (the tile carries
 * data-culling-result with its result id).
 */
export default function useCullingViews({ projectId, sessionId, enabled }) {
  const queues = useRef({ GRID: new Set(), PREVIEW: new Set() });
  const sent = useRef({ GRID: new Set(), PREVIEW: new Set() });
  const timers = useRef(new Map());
  const observer = useRef(null);
  // Tiles register as they mount, which can be before the observer exists; it picks them all up.
  const elements = useRef(new Set());

  const flush = useCallback(() => {
    if (!enabled) return;
    for (const source of ["GRID", "PREVIEW"]) {
      const ids = [...queues.current[source]];
      queues.current[source].clear();
      for (let index = 0; index < ids.length; index += BATCH) {
        recordCullingViews(projectId, sessionId, ids.slice(index, index + BATCH), source).catch(() => {});
      }
    }
  }, [enabled, projectId, sessionId]);

  const queue = useCallback((resultId, source) => {
    if (!enabled || !resultId || sent.current[source].has(resultId)) return;
    sent.current[source].add(resultId);
    queues.current[source].add(resultId);
  }, [enabled]);

  useEffect(() => {
    if (!enabled || typeof IntersectionObserver === "undefined") return undefined;
    const pending = timers.current;
    observer.current = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = entry.target.getAttribute("data-culling-result");
        const onScreen = entry.intersectionRatio >= 0.6 || (entry.rootBounds && entry.intersectionRect.height >= 0.6 * entry.rootBounds.height);
        if (entry.isIntersecting && onScreen) {
          if (!pending.has(id)) pending.set(id, window.setTimeout(() => { pending.delete(id); queue(id, "GRID"); }, SEEN_AFTER_MS));
        } else if (pending.has(id)) {
          window.clearTimeout(pending.get(id));
          pending.delete(id);
        }
      }
    }, { threshold: [0, 0.25, 0.6] });
    for (const element of elements.current) if (element.isConnected) observer.current.observe(element);
    const interval = window.setInterval(flush, FLUSH_MS);
    return () => {
      observer.current?.disconnect();
      observer.current = null;
      for (const timer of pending.values()) window.clearTimeout(timer);
      pending.clear();
      window.clearInterval(interval);
      flush();
    };
  }, [enabled, flush, queue]);

  const observe = useCallback((element) => {
    if (!element) return;
    elements.current.add(element);
    if (observer.current) observer.current.observe(element);
  }, []);
  const opened = useCallback((resultId) => queue(resultId, "PREVIEW"), [queue]);
  return { observe, opened };
}
