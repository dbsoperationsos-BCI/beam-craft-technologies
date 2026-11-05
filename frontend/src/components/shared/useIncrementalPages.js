"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * One continuous list over a page-numbered endpoint: the first batch when the question (`key`)
 * changes, the next batch appended by `loadMore` (the sentinel's `useInfiniteScroll`), and
 * `refresh` re-reading everything already shown in place - for polling, or after a change - so the
 * reader never jumps back to the top. The endpoint keeps its own paging; nothing is fetched whole.
 *
 * - Items are keyed by `id`: a batch that overlaps the last one (a photo added or removed in
 *   between) or a retried request never draws a card twice.
 * - Every request carries the generation of the question it was asked under; an answer to an older
 *   question (another folder, search, filter or sort) is dropped, never shown.
 * - A batch is asked for once at a time; a failed one leaves `error` set and the list as it was, for
 *   the footer's Retry.
 *
 * `fetchPage(page, pageSize)` answers `{ items, total, ...extra }`; `extra` is kept as the latest
 * answer's (the bay's counts, the review's facet numbers). `maxPageSize` is the endpoint's own cap:
 * a refresh of more than that is read in batches of it.
 */
export function mergeById(current, incoming) {
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...incoming.filter((item) => item && !seen.has(item.id) && seen.add(item.id))];
}

export default function useIncrementalPages({ key, fetchPage, pageSize = 60, maxPageSize = 200, enabled = true }) {
  const [state, setState] = useState({ items: [], total: 0, pages: 0, extra: null, loading: true, loadingMore: false, error: "", firstError: "" });
  const latestFetch = useRef(fetchPage);
  useEffect(() => { latestFetch.current = fetchPage; });
  const generation = useRef(0);
  const pages = useRef(0);
  const loadingMore = useRef(false);
  const items = useRef([]);
  const total = useRef(0);

  // Every write carries how many batches are loaded, so `hasMore` is read from state, not refs.
  const apply = (next) => setState((current) => ({ ...current, ...next, pages: pages.current }));

  // A new question: the old answer goes, the first batch of the new one comes.
  useEffect(() => {
    if (!enabled) return undefined;
    const asked = ++generation.current;
    pages.current = 0;
    loadingMore.current = false;
    const timer = window.setTimeout(async () => {
      apply({ loading: true, error: "", firstError: "" });
      try {
        const { items: first = [], total: count = 0, ...extra } = await latestFetch.current(1, pageSize);
        if (asked !== generation.current) return;
        pages.current = 1;
        items.current = mergeById([], first);
        total.current = count;
        apply({ items: items.current, total: count, extra, loading: false, loadingMore: false, error: "", firstError: "" });
      } catch (error) {
        if (asked !== generation.current) return;
        items.current = [];
        apply({ items: [], total: 0, loading: false, firstError: error?.message || "Unable to load the photos." });
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [key, pageSize, enabled]);

  const hasMore = !state.loading && !state.firstError && state.pages * pageSize < state.total;

  const loadMore = useCallback(async () => {
    if (loadingMore.current || !pages.current || pages.current * pageSize >= total.current) return null;
    const asked = generation.current;
    loadingMore.current = true;
    apply({ loadingMore: true, error: "" });
    try {
      const { items: next = [], total: count = 0, ...extra } = await latestFetch.current(pages.current + 1, pageSize);
      if (asked !== generation.current) return null;
      pages.current += 1;
      items.current = mergeById(items.current, next);
      total.current = count;
      apply({ items: items.current, total: count, extra, loadingMore: false });
      return items.current;
    } catch (error) {
      if (asked === generation.current) apply({ loadingMore: false, error: error?.message || "Unable to load more photos." });
      return null;
    } finally {
      if (asked === generation.current) loadingMore.current = false;
    }
  }, [pageSize]);

  // Everything already shown, read again in place (in batches of the endpoint's cap).
  const refresh = useCallback(async () => {
    const asked = generation.current;
    const shown = Math.max(pages.current, 1) * pageSize;
    try {
      let fresh = [];
      let count = 0;
      let extra = {};
      if (shown <= maxPageSize) ({ items: fresh = [], total: count = 0, ...extra } = await latestFetch.current(1, shown));
      else {
        for (let page = 1; (page - 1) * maxPageSize < shown; page += 1) {
          const { items: batch = [], total: batchTotal = 0, ...rest } = await latestFetch.current(page, maxPageSize);
          if (asked !== generation.current) return;
          fresh = fresh.concat(batch); count = batchTotal; extra = rest;
          if (batch.length < maxPageSize) break;
        }
        fresh = fresh.slice(0, shown);
      }
      if (asked !== generation.current) return;
      if (!pages.current) pages.current = 1;
      items.current = mergeById([], fresh);
      total.current = count;
      apply({ items: items.current, total: count, extra, firstError: "" });
    } catch {
      // A quiet re-read that failed changes nothing on screen; the next one tries again.
    }
  }, [pageSize, maxPageSize]);

  // One loaded item changed here (a decision, a save): written in place, nothing re-read.
  const updateItems = useCallback((updater) => {
    items.current = updater(items.current);
    apply({ items: items.current });
  }, []);

  // Every remaining batch, one after another - for a move to the very end of the list. Both loaders
  // answer the list as it now stands (null when nothing new could be read).
  const loadAll = useCallback(async () => {
    for (let guard = 0; guard < 1000 && pages.current * pageSize < total.current; guard += 1) {
      if (!(await loadMore())) return null;
    }
    return items.current;
  }, [loadMore, pageSize]);

  return { items: state.items, total: state.total, extra: state.extra, loading: state.loading, loadingMore: state.loadingMore, error: state.error, firstError: state.firstError, hasMore, loadMore, loadAll, refresh, updateItems };
}
