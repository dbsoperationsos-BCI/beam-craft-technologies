"use client";
import { useCallback, useEffect, useState } from "react";
import { getAiProcessing } from "@/services/ai-feature/ai-feature.service";

const POLL_MS = 5000;

/**
 * The event's AI processing counts, re-read every five seconds while anything is still queued or
 * being processed and the page is visible. `revision` re-reads at once - bumped after an upload
 * batch or a retry - and the caller may also call `reload` itself.
 */
export default function useProcessingPoll(eventId, revision = 0) {
  const [processing, setProcessing] = useState(null);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    try {
      const response = await getAiProcessing(eventId);
      setProcessing(response.data || null);
      setError("");
    } catch (cause) {
      setError(cause.message || "Unable to read the processing progress.");
    }
  }, [eventId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { reload(); }, 0);
    return () => window.clearTimeout(timer);
  }, [reload, revision]);

  const busy = Boolean(processing && (processing.queued + processing.processing) > 0);
  useEffect(() => {
    if (!busy) return undefined;
    const tick = () => { if (document.visibilityState === "visible") reload(); };
    const timer = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, [busy, reload]);

  return { processing, error, reload, busy };
}
