"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Button from "@/components/shared/Button";
import DashboardCard, { CardState } from "@/components/shared/DashboardCard";
import StatTile from "@/components/ai-feature/shared/StatTile";
import ProgressBar from "@/components/ai-feature/shared/ProgressBar";
import EmptyState from "@/components/ai-feature/shared/EmptyState";
import { formatCount, formatEventDate, formatTime } from "@/lib/aiFeature.mjs";
import { listAiFolders, listAiMatches, listAiMedia, listAiPeople, retryAiFailed } from "@/services/ai-feature/ai-feature.service";
import useProcessingPoll from "../useProcessingPoll";

/**
 * The numbers of the event at a glance, the AI progress card, and each sub-event with the photos
 * filed under it. The sub-event photo count is not an endpoint: it is the folders bound to each
 * sub-event, summed here.
 */
export default function OverviewTab({ eventId, event, faceAccess, mediaRevision, bumpMedia, showSuccess, showError }) {
  const [counts, setCounts] = useState(null);
  const [folders, setFolders] = useState([]);
  const [error, setError] = useState("");
  const [retrying, setRetrying] = useState(false);
  const { processing, error: processingError, reload: reloadProcessing } = useProcessingPoll(eventId, mediaRevision);

  const load = useCallback(async () => {
    try {
      const [photos, videos, folderList, people, review] = await Promise.all([
        listAiMedia(eventId, { kind: "PHOTO", pageSize: 1 }),
        listAiMedia(eventId, { kind: "VIDEO", pageSize: 1 }),
        listAiFolders(eventId),
        faceAccess.canRead ? listAiPeople(eventId, { pageSize: 1 }) : Promise.resolve(null),
        faceAccess.canRead ? listAiMatches(eventId, { status: "REVIEW_REQUIRED", pageSize: 1 }) : Promise.resolve(null),
      ]);
      setCounts({ photos: photos.data?.total || 0, videos: videos.data?.total || 0, people: people?.data?.total ?? null, review: review?.data?.total ?? null });
      setFolders(folderList.data || []);
      setError("");
    } catch (cause) {
      setError(cause.message || "Unable to load the overview.");
    }
  }, [eventId, faceAccess.canRead]);

  useEffect(() => {
    const timer = window.setTimeout(() => { load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load, mediaRevision]);

  const subEventRows = useMemo(() => {
    const byId = new Map();
    for (const folder of folders) if (folder.subEventId) byId.set(folder.subEventId, (byId.get(folder.subEventId) || 0) + (folder.mediaCount || 0));
    return (event?.subEvents || []).map((subEvent) => ({ ...subEvent, mediaCount: byId.get(subEvent.id) || 0 }));
  }, [event?.subEvents, folders]);

  async function retryFailed() {
    setRetrying(true);
    try {
      const response = await retryAiFailed(eventId);
      showSuccess(`${formatCount(response.data?.requeued || 0)} photos queued again.`);
      bumpMedia();
      reloadProcessing();
    } catch (cause) {
      showError(cause.message || "Unable to retry the failed photos.");
    } finally {
      setRetrying(false);
    }
  }

  const engine = processing?.engine;
  const inFlight = processing ? processing.queued + processing.processing : 0;

  return <div className="space-y-4">
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <StatTile label="Photos" value={counts?.photos ?? event?.mediaCount ?? 0} />
      <StatTile label="Videos" value={counts?.videos ?? 0} />
      <StatTile label="Guests" value={event?.guestCount ?? 0} />
      <StatTile label="Faces detected" value={event?.faceCount ?? 0} />
      {faceAccess.canRead && <StatTile label="People" value={counts?.people ?? 0} note="Distinct faces grouped" />}
      {faceAccess.canRead && <StatTile label="Needs review" value={counts?.review ?? 0} note="Matches awaiting a decision" tone={counts?.review ? "text-amber-700" : "text-slate-900"} />}
    </div>
    {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

    <div className="grid gap-4 lg:grid-cols-2">
      <DashboardCard
        title="AI processing"
        note={processing ? (inFlight > 0 ? `Processing ${formatCount(processing.completed + processing.failed + processing.skipped)} / ${formatCount(processing.total)}` : processing.total ? "Every photo has been processed" : "Nothing to process yet") : undefined}
        action={faceAccess.canWrite && processing?.failed > 0 && <Button type="button" size="sm" disabled={retrying} onClick={retryFailed}>{retrying ? "Retrying..." : "Retry failed"}</Button>}
      >
        <CardState loading={!processing && !processingError} error={processingError} onRetry={reloadProcessing} rows={3}>
          {processing && <div className="space-y-3">
            <div className="flex items-center gap-3">
              <ProgressBar percent={processing.percent} className="flex-1" label="AI processing progress" tone={processing.failed && !inFlight ? "bg-amber-500" : "bg-blue-600"} />
              <span className="shrink-0 text-sm font-semibold text-slate-800">{processing.percent}%</span>
            </div>
            <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <Breakdown label="Queued" value={processing.queued} />
              <Breakdown label="Processing" value={processing.processing} tone="text-blue-700" />
              <Breakdown label="Completed" value={processing.completed} tone="text-green-700" />
              <Breakdown label="Failed" value={processing.failed} tone={processing.failed ? "text-red-700" : undefined} />
            </dl>
            {engine && !engine.ready && <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <span className="font-semibold">Face engine offline.</span> Uploads are kept and queued; they are processed once the engine is back.{engine.reason ? ` ${engine.reason}` : ""}
            </p>}
          </div>}
        </CardState>
      </DashboardCard>

      <DashboardCard title="Sub events" note={subEventRows.length ? `${subEventRows.length} scheduled` : undefined}>
        {subEventRows.length === 0
          ? <EmptyState title="No sub events yet." message="Add the ceremonies and sessions under the Sub Events tab; folders can then be filed under each." className="py-6" />
          : <ul className="divide-y divide-slate-100">
            {subEventRows.map((row) => <li key={row.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800">{row.name}</p>
                <p className="truncate text-[11px] text-slate-500">{[formatEventDate(row.date), row.startTime && `${formatTime(row.startTime)}${row.endTime ? ` – ${formatTime(row.endTime)}` : ""}`, row.location].filter(Boolean).join(" • ") || "No schedule yet"}</p>
              </div>
              <span className="shrink-0 text-xs text-slate-600">{formatCount(row.mediaCount)} photos</span>
            </li>)}
          </ul>}
      </DashboardCard>
    </div>
  </div>;
}

function Breakdown({ label, value, tone = "text-slate-800" }) {
  return <div className="rounded-md bg-slate-50 px-2.5 py-1.5">
    <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</dt>
    <dd className={`text-sm font-semibold ${tone}`}>{formatCount(value)}</dd>
  </div>;
}
