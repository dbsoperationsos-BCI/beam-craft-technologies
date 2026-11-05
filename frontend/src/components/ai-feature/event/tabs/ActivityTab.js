"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "@/components/shared/Button";
import Loader from "@/components/shared/Loader";
import EmptyState from "@/components/ai-feature/shared/EmptyState";
import { describeActivity } from "@/lib/aiFeature.mjs";
import { listAiEventActivity } from "@/services/ai-feature/ai-feature.service";

const PAGE = 50;
const TONES = {
  AI_PROCESSING_FAILED: "bg-rose-500", MATCH_REJECTED: "bg-rose-400", EVENT_DELETED: "bg-rose-500", SHARE_REVOKED: "bg-rose-400",
  AI_PROCESSING_COMPLETED: "bg-emerald-500", MATCH_CONFIRMED: "bg-emerald-500", GUEST_JOINED: "bg-emerald-400",
  MEDIA_UPLOADED: "bg-blue-500", EVENT_SHARED: "bg-blue-500", AI_PROCESSING_STARTED: "bg-blue-400", FACES_DETECTED: "bg-violet-400", MATCH_CREATED: "bg-amber-400",
};
const ACTOR_FALLBACK = { GUEST: "Guest", SYSTEM: "AI engine", STAFF: "Studio" };

/** Everything that has happened to the event, newest first, fifty rows at a time. */
export default function ActivityTab({ eventId, mediaRevision }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (before) => {
    setLoading(true);
    try {
      const response = await listAiEventActivity(eventId, { limit: PAGE, before });
      const batch = response.data || [];
      setRows((current) => (before ? [...current, ...batch] : batch));
      setMore(batch.length === PAGE);
      setError("");
    } catch (cause) {
      setError(cause.message || "Unable to load the activity.");
    } finally {
      setLoading(false);
    }
  }, [eventId]);
  useEffect(() => {
    const timer = window.setTimeout(() => { load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load, mediaRevision]);

  if (loading && rows.length === 0) return <Loader label="Loading activity..." />;
  if (error && rows.length === 0) return <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>;
  if (rows.length === 0) return <EmptyState title="No activity yet." message="Uploads, guest joins, matches and every setting change land here." />;

  return <div className="mx-auto max-w-3xl">
    <ol className="relative border-l border-slate-200 pl-4">
      {rows.map((row) => <li key={row.id} className="relative pb-4">
        <span aria-hidden="true" className={`absolute -left-[21.5px] top-1 h-2.5 w-2.5 rounded-full ring-2 ring-white ${TONES[row.event] || "bg-slate-300"}`} />
        <p className="text-xs text-slate-800">
          <span className="font-semibold">{row.actorLabel || ACTOR_FALLBACK[row.actorType] || "Studio"}</span>
          {" "}<span>{describeActivity(row)}</span>
        </p>
        <p className="mt-0.5 text-[10px] text-slate-400">{new Date(row.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}</p>
      </li>)}
    </ol>
    {error && <p role="alert" className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
    {more && <div className="flex justify-center"><Button type="button" size="sm" disabled={loading} onClick={() => load(rows[rows.length - 1]?.createdAt)}>{loading ? "Loading..." : "Load more"}</Button></div>}
  </div>;
}
