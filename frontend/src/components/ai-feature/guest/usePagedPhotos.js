"use client";
import { useCallback, useEffect, useState } from "react";

/**
 * One list of photos, read a page at a time. `key` names the list - a tab, a folder - and `fetchPage`
 * answers a page number with `{ items, total, ...rest }`. When the key changes the list is empty
 * and loading until its first page lands; `loadMore` asks for the next page while there is one.
 *
 * Nothing is written to state synchronously inside the effect: the first page is applied when the
 * request answers, and "loading" is derived from whether the page shown belongs to the key asked
 * for. That keeps a key change instant and keeps the lint's set-state-in-effect rule quiet.
 */
export default function usePagedPhotos({ key, fetchPage, onError }) {
  const [state, setState] = useState({ key: null, items: [], total: 0, page: 0, extra: {}, error: "" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!key || !fetchPage) return undefined;
    let cancelled = false;
    fetchPage(1)
      .then((data) => { if (!cancelled) setState({ key, items: data.items || [], total: data.total || 0, page: 1, extra: data, error: "" }); })
      .catch((error) => { if (cancelled) return; onError?.(error); setState({ key, items: [], total: 0, page: 1, extra: {}, error: error?.message || "Could not load the photos." }); });
    return () => { cancelled = true; };
  }, [key, fetchPage, onError, version]);

  const ready = state.key === key;
  const items = ready ? state.items : [];
  const total = ready ? state.total : 0;
  const hasMore = ready && items.length < total;

  const loadMore = useCallback(async () => {
    if (!ready || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const data = await fetchPage(state.page + 1);
      setState((current) => (current.key === key ? { ...current, items: [...current.items, ...(data.items || [])], total: data.total ?? current.total, page: current.page + 1, extra: data } : current));
    } catch (error) { onError?.(error); }
    finally { setLoadingMore(false); }
  }, [fetchPage, hasMore, key, loadingMore, onError, ready, state.page]);

  const remove = useCallback((predicate) => setState((current) => { const items = current.items.filter((item) => !predicate(item)); return { ...current, items, total: Math.max(0, current.total - (current.items.length - items.length)) }; }), []);
  const reload = useCallback(() => setVersion((current) => current + 1), []);

  return { items, total, extra: ready ? state.extra : {}, error: ready ? state.error : "", loading: !ready, loadingMore, hasMore, loadMore, remove, reload };
}
