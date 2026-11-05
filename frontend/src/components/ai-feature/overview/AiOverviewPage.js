"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import AiFeatureNavigation from "@/components/ai-feature/AiFeatureNavigation";
import { useRouteAccess } from "@/components/auth/PermissionsProvider";
import Button from "@/components/shared/Button";
import { CardState, EmptyDashboard } from "@/components/shared/DashboardCard";
import DashboardRangeBar from "@/components/shared/DashboardRangeBar";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import useAutoRefresh from "@/components/shared/useAutoRefresh";
import { DEFAULT_RANGE, number, periodPhrase, previousPhrase } from "@/lib/dashboardRange.mjs";
import { REFRESH_INTERVALS } from "@/lib/refreshPolicy.mjs";
import { createEventHref, eventHref } from "@/lib/aiDashboard.mjs";
import { getAiOverview } from "@/services/ai-feature/ai-feature.service";
import AiDashboardRecentEvents from "./AiDashboardRecentEvents";
import { AiSummaryCards, DetectionStorageCard, ProcessingProgressCard } from "./AiDashboardCards";

/**
 * AI Feature → Overview: the studio's event galleries as they stand, on the Image Selection
 * dashboard's pattern — the ten figures, the Recent Events table they filter, and the two panels
 * beneath — so the two read as one product.
 *
 * One request paints the page - `/api/ai-feature/overview?range=` - so no card can show one
 * moment's figure beside another's. There is no Refresh button: the page keeps itself current
 * (`useAutoRefresh`) — every half minute while the tab is in front, because the numbers it shows
 * are the ones a worker is changing in the background, and when the tab or the network comes
 * back. A quiet re-read keeps the figures on screen and swaps them in; one that fails says so.
 *
 * Two clocks, labelled rather than assumed: the figures are a **position** — every live event and
 * photo as it stands — and the line under each card is a **period**, the range picked above them.
 * Nothing on the page navigates except an event: a double click on a row of the table, a press on
 * a row of the progress list. Create Event goes to the Events list, which owns the wizard.
 *
 * IMAGE_SELECTION / AI Feature governs the route: READ sees the overview, and only READ_WRITE is
 * offered Create Event (the header decides that).
 */
export default function AiOverviewPage() {
  const router = useRouter();
  const { canWrite } = useRouteAccess();
  const { notice, showError, clearNotice } = useNotice();
  const [range, setRange] = useState(DEFAULT_RANGE);
  // Which card is pressed — what the Recent Events table is narrowed to. Null is every event.
  const [view, setView] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // "12 mins ago" is measured from when the numbers were read, not from when the tab was last looked at.
  const [now, setNow] = useState(() => new Date());
  // Read by the loader without being a dependency, so a response never re-creates it and reload.
  const hasData = useRef(false);

  const load = useCallback(async ({ quiet = false } = {}) => {
    const silent = quiet && hasData.current;
    if (!silent) { setLoading(true); setError(""); }
    try {
      const response = await getAiOverview({ range });
      setData(response?.data || null);
      hasData.current = true;
      setNow(new Date());
      setError("");
    } catch (caught) {
      const message = caught?.message || "Unable to load the AI Feature overview.";
      // A refresh that fails keeps the numbers already on screen and says so; a first load has
      // nothing to keep, so the page itself carries the message.
      if (hasData.current) showError(message); else setError(message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [range, showError]);

  // Deferred a tick, this codebase's convention for a first load; every later read is quiet.
  useEffect(() => {
    const timer = setTimeout(() => void load({ quiet: true }), 0);
    return () => clearTimeout(timer);
  }, [load]);
  useAutoRefresh(load, { intervalMs: REFRESH_INTERVALS.aiFeature });

  const openEvent = (row) => router.push(eventHref(row.id));
  const createEvent = () => router.push(createEventHref());
  const period = data?.period;
  const caption = [
    "Every AI event as it stands",
    data?.trend ? `each arrow is the change ${previousPhrase(data.period?.key)}` : null,
    period ? `${periodPhrase(period.key)}: +${number(period.eventsCreated)} events, ${number(period.photosUploaded)} photos uploaded, ${number(period.photosProcessed)} processed` : null,
  ].filter(Boolean).join(" · ");
  const isEmpty = !loading && !error && data && data.totalEventsAllTime === 0;
  const rangeKey = data?.range?.key || range;

  return <section className="flex min-h-0 flex-1 flex-col bg-white">
    <AiFeatureNavigation onCreateEvent={createEvent} />

    <FloatingNotice notice={notice} onClose={clearNotice} />

    <div className="dashboard-canvas min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
      {error && !data
        ? <CardState error={error} onRetry={() => load()} />
        : isEmpty
          ? <EmptyDashboard title="No events yet" message={canWrite ? "Create an event, add its photos and the engine finds the faces — the dashboard fills in from there." : "The dashboard fills in once an event is created."} action={canWrite && <Button type="button" variant="primary" size="sm" className="mt-4" onClick={createEvent}>+ Create Event</Button>} />
          : <>
            <DashboardRangeBar caption={caption} range={range} onRangeChange={setRange} />
            <AiSummaryCards summary={data?.summary} trend={data?.trend} rangeKey={rangeKey} loading={loading} view={view} onViewChange={setView} />
            <div className="mt-3">
              <AiDashboardRecentEvents rows={data?.eventRows || []} view={view} onClearView={() => setView(null)} loading={loading} error={!data ? error : ""} onRetry={() => load()} onOpen={openEvent} now={now} />
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <ProcessingProgressCard rows={data?.processingProgress || []} loading={loading} error={!data ? error : ""} onRetry={() => load()} onOpen={openEvent} now={now} />
              <DetectionStorageCard data={data} rangeKey={rangeKey} loading={loading} error={!data ? error : ""} onRetry={() => load()} />
            </div>
          </>}
    </div>
  </section>;
}
