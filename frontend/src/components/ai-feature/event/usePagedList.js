"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A list that is read one page at a time and grows as the reader scrolls - media, people, guests
 * and matches all page the same way (`{ items, total, page, pageSize }`). `fetchPage(page)` is the
 * service call for one page; `resetKey` empties the list and reads the first page again whenever a
 * filter changes. `patch` and `remove` edit rows in place after a write, so the list does not have
 * to be re-read to show what just happened.
 */
export default function usePagedList(fetchPage, { pageSize = 60, resetKey = "" } = {}) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestRef = useRef(0);

  const load = useCallback(async (nextPage, append) => {
    const request = ++requestRef.current;
    setLoading(true);
    try {
      const response = await fetchPage(nextPage);
      if (request !== requestRef.current) return;
      const data = response.data || {};
      setItems((current) => append ? [...current, ...(data.items || [])] : (data.items || []));
      setTotal(data.total || 0);
      setPage(nextPage);
      setError("");
    } catch (cause) {
      if (request !== requestRef.current) return;
      setError(cause.message || "Unable to load the list.");
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [fetchPage]);

  useEffect(() => {
    const timer = window.setTimeout(() => { load(1, false); }, 0);
    return () => window.clearTimeout(timer);
    // `resetKey` is what asks for a fresh first page; `load` changes with the fetcher.
  }, [load, resetKey]);

  const hasMore = items.length < total;
  const loadMore = useCallback(() => { if (!loading && hasMore) load(page + 1, true); }, [hasMore, load, loading, page]);
  const reload = useCallback(() => load(1, false), [load]);
  const patch = useCallback((id, changes) => setItems((current) => current.map((item) => (item.id === id ? { ...item, ...changes } : item))), []);
  const remove = useCallback((id) => { setItems((current) => current.filter((item) => item.id !== id)); setTotal((current) => Math.max(0, current - 1)); }, []);

  return { items, total, loading, error, hasMore, loadMore, reload, patch, remove, pageSize };
}
