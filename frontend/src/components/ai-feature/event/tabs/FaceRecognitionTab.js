"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "@/components/shared/Button";
import Dropdown from "@/components/shared/Dropdown";
import Loader from "@/components/shared/Loader";
import useInfiniteScroll from "@/components/shared/useInfiniteScroll";
import LazyImage from "@/components/ai-feature/shared/LazyImage";
import StatTile from "@/components/ai-feature/shared/StatTile";
import StatusChip from "@/components/ai-feature/shared/StatusChip";
import EmptyState from "@/components/ai-feature/shared/EmptyState";
import { MATCH_STATUS_LABELS, formatCount } from "@/lib/aiFeature.mjs";
import { decideAiMatch, listAiMatches } from "@/services/ai-feature/ai-feature.service";
import usePagedList from "../usePagedList";
import useProcessingPoll from "../useProcessingPoll";
import MediaLightbox from "../MediaLightbox";

const STATUSES = ["REVIEW_REQUIRED", "MATCHED", "CONFIRMED", "REJECTED"];
const STATUS_OPTIONS = [...STATUSES.map((status) => ({ label: MATCH_STATUS_LABELS[status], value: status })), { label: "All", value: "all" }];
const BAND_TONES = { HIGH: "bg-green-50 text-green-700 border-green-200", MEDIUM: "bg-amber-50 text-amber-700 border-amber-200", LOW: "bg-slate-100 text-slate-600 border-slate-200" };
const BAND_LABELS = { HIGH: "High confidence", MEDIUM: "Medium confidence", LOW: "Low confidence" };

/**
 * The match review queue. A match is the engine saying "this face is that guest"; the studio
 * confirms or rejects the ones the thresholds sent to review. Deciding needs Write on AI Face
 * Management; without it the queue is readable and the two buttons are not drawn.
 */
export default function FaceRecognitionTab({ eventId, faceAccess, mediaRevision, showSuccess, showError }) {
  const [status, setStatus] = useState("REVIEW_REQUIRED");
  const [counts, setCounts] = useState(null);
  const [deciding, setDeciding] = useState("");
  const [lightbox, setLightbox] = useState(-1);
  const [revision, setRevision] = useState(0);
  const { processing } = useProcessingPoll(eventId, mediaRevision);

  const loadCounts = useCallback(async () => {
    try {
      const results = await Promise.all(STATUSES.map((value) => listAiMatches(eventId, { status: value, pageSize: 1 })));
      setCounts(Object.fromEntries(STATUSES.map((value, index) => [value, results[index].data?.total || 0])));
    } catch { setCounts((current) => current || {}); }
  }, [eventId]);
  useEffect(() => {
    const timer = window.setTimeout(() => { loadCounts(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadCounts, mediaRevision, revision]);

  const fetchPage = useCallback((page) => listAiMatches(eventId, { status, page, pageSize: 60 }), [eventId, status]);
  const list = usePagedList(fetchPage, { resetKey: `${mediaRevision}` });
  const sentinelRef = useInfiniteScroll({ onLoadMore: list.loadMore, hasMore: list.hasMore, loading: list.loading, count: list.items.length, resetKey: `${status}|${mediaRevision}` });

  async function decide(match, decision) {
    setDeciding(match.id);
    try {
      const response = await decideAiMatch(eventId, match.id, decision);
      if (status === "all" || status === decision) list.patch(match.id, response.data); else list.remove(match.id);
      setRevision((value) => value + 1);
      showSuccess(decision === "CONFIRMED" ? `Confirmed ${match.guest?.name || "the guest"}.` : `Rejected for ${match.guest?.name || "the guest"}.`);
    } catch (cause) {
      showError(cause.message || "Unable to record that decision.");
    } finally {
      setDeciding("");
    }
  }

  const engine = processing?.engine;
  const mediaItems = list.items.map((match) => match.media).filter(Boolean);

  return <div className="space-y-4">
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {STATUSES.map((value) => <StatTile key={value} label={MATCH_STATUS_LABELS[value]} value={counts?.[value] ?? 0} onClick={() => setStatus(value)} active={status === value} tone={value === "REVIEW_REQUIRED" && counts?.[value] ? "text-amber-700" : "text-slate-900"} />)}
    </div>
    {engine && <p className={`rounded-md border px-3 py-2 text-xs ${engine.ready ? "border-green-200 bg-green-50 text-green-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
      <span className="font-semibold">{engine.ready ? "Face engine online." : "Face engine offline."}</span>{" "}
      {engine.ready ? `${formatCount(processing.queued + processing.processing)} photos waiting, ${formatCount(processing.completed)} processed.` : `Matching resumes when it is back.${engine.reason ? ` ${engine.reason}` : ""}`}
    </p>}

    <div className="flex flex-wrap items-end justify-between gap-2">
      <Dropdown label="Show" helperText="Lists only the matches with this review status." options={STATUS_OPTIONS} value={status} onChange={setStatus} sorted={false} className="w-full sm:w-52" />
      <p className="text-xs text-slate-500">{formatCount(list.total)} {list.total === 1 ? "match" : "matches"}</p>
    </div>
    {list.error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{list.error}</p>}
    {!list.loading && list.items.length === 0
      ? <EmptyState title={status === "REVIEW_REQUIRED" ? "Nothing waiting for review." : "No matches here."} message={status === "REVIEW_REQUIRED" ? "Medium-confidence matches land here as photos are processed, if the event's AI settings send them to review." : undefined} />
      : <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {list.items.map((match, index) => <li key={match.id} className="flex gap-3 rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
          <LazyImage src={match.media?.thumbnailUrl} alt={match.media?.fileName || ""} onClick={match.media ? () => setLightbox(mediaItems.indexOf(match.media)) : undefined} className="h-24 w-24 shrink-0 rounded-md sm:h-28 sm:w-28" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <p className="truncate text-sm font-medium text-slate-800">{match.guest?.name || "Unknown guest"}</p>
            <div className="flex flex-wrap gap-1">
              <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${BAND_TONES[match.band] || BAND_TONES.LOW}`}>{BAND_LABELS[match.band] || match.band}</span>
              <StatusChip status={match.status} kind="match" />
            </div>
            {match.media?.fileName && <p className="truncate text-[11px] text-slate-400">{match.media.fileName}</p>}
            {faceAccess.canWrite && <div className="mt-auto flex flex-wrap gap-1.5">
              {match.status !== "CONFIRMED" && <Button type="button" size="sm" variant="primary" disabled={deciding === match.id} onClick={() => decide(match, "CONFIRMED")}>Confirm</Button>}
              {match.status !== "REJECTED" && <Button type="button" size="sm" disabled={deciding === match.id} onClick={() => decide(match, "REJECTED")}>Reject</Button>}
            </div>}
          </div>
          <span className="sr-only">{index + 1}</span>
        </li>)}
      </ul>}
    <div ref={sentinelRef} aria-hidden="true" className="h-px" />
    {list.loading && <Loader label="Loading matches..." size="sm" className="py-6" />}
    {lightbox >= 0 && <MediaLightbox items={mediaItems} index={lightbox} onIndexChange={setLightbox} onClose={() => setLightbox(-1)} />}
  </div>;
}
