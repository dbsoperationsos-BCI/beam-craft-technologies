"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import RefreshRounded from "@mui/icons-material/RefreshRounded";
import AiFeatureNavigation from "@/components/ai-feature/AiFeatureNavigation";
import EventCover from "@/components/ai-feature/shared/EventCover";
import ProgressBar from "@/components/ai-feature/shared/ProgressBar";
import StatTile from "@/components/ai-feature/shared/StatTile";
import StatusChip from "@/components/ai-feature/shared/StatusChip";
import Button from "@/components/shared/Button";
import DashboardCard, { CardState } from "@/components/shared/DashboardCard";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import IconButton from "@/components/shared/IconButton";
import { describeActivity, formatBytes, formatCount, formatEventRange } from "@/lib/aiFeature.mjs";
import { getAiOverview } from "@/services/ai-feature/ai-feature.service";

/**
 * AI Feature → Overview: the studio's event galleries as they stand.
 *
 * One request paints the page - `/api/ai-feature/overview` - so no tile can show one moment's
 * figure beside another's. It is re-read every half minute while the tab is in front, because the
 * numbers it shows are the ones a worker is changing in the background: photos processed, faces
 * found. Nothing here navigates except an event; Create Event goes to the Events list, which owns
 * the wizard.
 *
 * IMAGE_SELECTION / AI Feature governs the route: READ sees the overview, and only READ_WRITE is
 * offered Create Event (the header decides that).
 */
const POLL_MS = 30_000;
const EVENT_HREF = (id) => `/visual-curation/ai/events/${encodeURIComponent(id)}`;

/** A row of tiles. Two to a row on a phone, four from a tablet up, so each group fills one line. */
function TileRow({ title, tiles }) {
  return <section aria-label={title}>
    <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {tiles.map((tile) => <StatTile key={tile.label} {...tile} />)}
    </div>
  </section>;
}

/** Grey tiles standing in for figures still on their way. */
function TileSkeleton({ title }) {
  return <section aria-hidden="true">
    <div className="mb-2 h-3 w-24 animate-pulse rounded bg-slate-100" />
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {Array.from({ length: 4 }, (_, index) => <div key={`${title}-${index}`} className="h-[4.5rem] animate-pulse rounded-lg border border-slate-200 bg-white" />)}
    </div>
  </section>;
}

function RecentEventRow({ event, onOpen }) {
  const percent = event.processing?.percent ?? 0;
  return <li className="flex gap-3 py-3 first:pt-0 last:pb-0">
    <EventCover src={event.coverUrl} name={event.name} className="h-16 w-16 shrink-0 rounded-md sm:h-20 sm:w-20" />
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="min-w-0 truncate text-sm font-medium text-slate-800">{event.name}</p>
        <StatusChip status={event.status} />
      </div>
      <p className="mt-0.5 text-xs text-slate-500">{formatEventRange(event.startDate, event.endDate)}{event.eventType ? ` · ${event.eventType}` : ""}</p>
      <p className="mt-1 text-[11px] text-slate-500">{formatCount(event.guestCount)} guests · {formatCount(event.mediaCount)} photos · {formatCount(event.faceCount)} faces</p>
      <div className="mt-2 flex items-center gap-2">
        <ProgressBar percent={percent} label={`AI processing for ${event.name}`} className="min-w-0 flex-1" />
        <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-slate-600">{percent}%</span>
      </div>
      <div className="mt-2 sm:hidden">
        <Button type="button" size="sm" onClick={() => onOpen(event)}>Open Event</Button>
      </div>
    </div>
    <div className="hidden shrink-0 self-center sm:block">
      <Button type="button" size="sm" onClick={() => onOpen(event)}>Open Event</Button>
    </div>
  </li>;
}

function ActivityRow({ row }) {
  const at = row.createdAt ? new Date(row.createdAt) : null;
  const time = at && !Number.isNaN(at.getTime()) ? at.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "";
  const day = at && !Number.isNaN(at.getTime()) ? at.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "";
  return <li className="flex gap-3 py-2 first:pt-0 last:pb-0">
    <div className="w-14 shrink-0 text-right">
      <p className="text-[11px] tabular-nums text-slate-600">{time}</p>
      <p className="text-[10px] text-slate-400">{day}</p>
    </div>
    <div className="min-w-0 flex-1">
      <p className="text-xs text-slate-700">{describeActivity(row)}</p>
      <p className="mt-0.5 truncate text-[11px] text-slate-400">{[row.eventName, row.actorLabel].filter(Boolean).join(" · ")}</p>
    </div>
  </li>;
}

export default function AiOverviewPage() {
  const router = useRouter();
  const { notice, showError, clearNotice } = useNotice();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const response = await getAiOverview();
      setData(response?.data || null);
      setError("");
    } catch (caught) {
      const message = caught?.message || "Unable to load the AI Feature overview.";
      setError(message);
      // With figures already up, the failure is a toast rather than a page replaced by an error.
      if (quiet) showError(message);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // Re-read while the tab is in front, and straight away when it comes back to the front - a tab
  // left open overnight should not show last night's figures for half a minute.
  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible") void load({ quiet: true }); };
    const interval = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", tick); };
  }, [load]);

  const openEvent = (event) => router.push(EVENT_HREF(event.id));
  const events = data?.events; const media = data?.media; const faces = data?.faces; const storage = data?.storage;
  const showSkeleton = loading && !data;

  return <section className="flex min-h-0 flex-1 flex-col bg-white">
    <AiFeatureNavigation
      onCreateEvent={() => router.push("/visual-curation/ai/events?create=1")}
      actions={<IconButton label="Refresh overview" size="sm" onClick={() => load()} disabled={loading} className="text-slate-600 hover:bg-slate-100"><RefreshRounded fontSize="small" aria-hidden="true" className={loading ? "animate-spin" : ""} /></IconButton>}
    />
    <FloatingNotice notice={notice} onClose={clearNotice} />

    {/* Fills what is left of the shell's flex column and scrolls inside it, so the shell never
        scrolls as a page. `dashboard-canvas` is the tinted ground the cards sit on. */}
    <div className="dashboard-canvas min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
      {error && !data
        ? <CardState error={error} onRetry={() => load()} />
        : <div className="space-y-4">
          {showSkeleton
            ? <><TileSkeleton title="events" /><TileSkeleton title="photos" /><TileSkeleton title="faces" /></>
            : <>
              <TileRow title="Events" tiles={[
                { label: "Total events", value: events?.total },
                { label: "Active", value: events?.active, tone: "text-green-700" },
                { label: "Upcoming", value: events?.upcoming, tone: "text-amber-700" },
                { label: "Completed", value: events?.completed },
              ]} />
              <TileRow title="Photos" tiles={[
                { label: "Total photos", value: media?.total, note: media?.videos ? `+ ${formatCount(media.videos)} videos` : undefined },
                { label: "Processed", value: media?.processed, tone: "text-green-700", note: media?.total ? `${media.percent ?? 0}% of all media` : undefined },
                { label: "Processing", value: media?.processing, tone: "text-blue-700" },
                { label: "Failed", value: media?.failed, tone: media?.failed ? "text-red-700" : "text-slate-900" },
              ]} />
              <TileRow title="Faces" tiles={[
                { label: "Faces detected", value: faces?.detected },
                { label: "People", value: faces?.people },
                { label: "Face matches", value: faces?.matches },
                { label: "Unmatched faces", value: faces?.unmatched },
              ]} />
              <TileRow title="Storage" tiles={[
                { label: "Storage used", value: formatBytes(storage?.bytes), raw: true },
                { label: "Recent uploads (24h)", value: storage?.recentUploads },
                { label: "Guests", value: data?.guests?.total },
                { label: "Archived events", value: events?.archived },
              ]} />
            </>}

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <DashboardCard title="Recent Events" note="The six most recently worked on">
              <CardState loading={showSkeleton} error={!data ? error : ""} onRetry={() => load()} empty={!data?.recentEvents?.length} emptyMessage="No events yet. Create one to start a gallery." rows={5}>
                <ul className="divide-y divide-slate-100">
                  {(data?.recentEvents || []).map((event) => <RecentEventRow key={event.id} event={event} onOpen={openEvent} />)}
                </ul>
              </CardState>
            </DashboardCard>
            <DashboardCard title="Recent Activity" note="What just happened across every event">
              <CardState loading={showSkeleton} error={!data ? error : ""} onRetry={() => load()} empty={!data?.recentActivity?.length} emptyMessage="Nothing has happened yet." rows={6}>
                <ul className="divide-y divide-slate-100">
                  {(data?.recentActivity || []).map((row) => <ActivityRow key={row.id} row={row} />)}
                </ul>
              </CardState>
            </DashboardCard>
          </div>
        </div>}
    </div>
  </section>;
}
