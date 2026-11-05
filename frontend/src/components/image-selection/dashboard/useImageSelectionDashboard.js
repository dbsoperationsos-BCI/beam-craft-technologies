"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import useAutoRefresh from "@/components/shared/useAutoRefresh";
import { getImageSelectionDashboard } from "@/services/image-selection/image-selection.service";
import { REFRESH_INTERVALS } from "@/lib/refreshPolicy.mjs";
import { subscribeUploadCompletion } from "@/lib/imageSelectionUploadStore";
import { DEFAULT_RANGE } from "@/lib/imageSelectionDashboard.mjs";

/**
 * The Image Selection dashboard's one request and how it keeps itself current - read by the
 * Dashboard page, and by the Expand popup on the Projects page with `expand`, so the two can never
 * count by different rules.
 *
 * A quiet read keeps the figures on screen and swaps them in; only a read with nothing to keep
 * shows the skeletons. Every read after the first is quiet: the range change, the auto refresh.
 * `onRefreshError` hears a failed refresh, which keeps the numbers already on screen; a first load
 * has nothing to keep, so `error` carries it to the screen instead.
 */
export default function useImageSelectionDashboard({ expand = false, onRefreshError } = {}) {
  const [range, setRange] = useState(DEFAULT_RANGE);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // "12 mins ago" is measured from when the numbers were read, not from when the tab was last looked at.
  const [now, setNow] = useState(() => new Date());

  // Read by the loader without being a dependency, so a response never re-creates it and reloads.
  const hasData = useRef(false);
  const refreshError = useRef(onRefreshError);
  useEffect(() => { refreshError.current = onRefreshError; }, [onRefreshError]);

  const load = useCallback(async ({ quiet = false } = {}) => {
    const silent = quiet && hasData.current;
    if (!silent) setLoading(true);
    setError("");
    try {
      const response = await getImageSelectionDashboard({ range, expand });
      setData(response?.data || null);
      hasData.current = true;
      setNow(new Date());
    } catch (caught) {
      const message = caught?.message || "Unable to load the dashboard.";
      setError(message);
      if (hasData.current) refreshError.current?.(message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [range, expand]);

  // Deferred a tick, which is this codebase's convention for a first load: a fetch started
  // straight from an effect body counts as state set during that effect.
  useEffect(() => {
    const timer = setTimeout(() => void load({ quiet: true }), 0);
    return () => clearTimeout(timer);
  }, [load]);
  useAutoRefresh(load, { intervalMs: REFRESH_INTERVALS.imageSelection, signals: [subscribeUploadCompletion] });

  return { range, setRange, data, setData, loading, error, now, load };
}
