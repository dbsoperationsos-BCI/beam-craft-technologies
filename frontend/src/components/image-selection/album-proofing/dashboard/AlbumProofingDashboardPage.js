"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import Add from "@mui/icons-material/Add";
import ImageSelectionNavigation from "@/components/image-selection/ImageSelectionNavigation";
import { useRouteAccess } from "@/components/auth/PermissionsProvider";
import Button from "@/components/shared/Button";
import { CardState, EmptyDashboard } from "@/components/shared/DashboardCard";
import DashboardRangeBar from "@/components/shared/DashboardRangeBar";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import useAutoRefresh from "@/components/shared/useAutoRefresh";
import { DEFAULT_RANGE, number, periodPhrase, previousPhrase } from "@/lib/dashboardRange.mjs";
import { REFRESH_INTERVALS } from "@/lib/refreshPolicy.mjs";
import { albumHref, albumProofingSections, createProjectHref } from "@/lib/albumProofingDashboard.mjs";
import { getAlbumProofingDashboard } from "@/services/image-selection/album-proofs.service";
import AlbumDashboardRecentAlbums from "./AlbumDashboardRecentAlbums";
import { AlbumSummaryCards, CorrectionWorkCard, ProofingLinkCard } from "./AlbumDashboardCards";

/**
 * Album Proofing → Dashboard: every album proof as it stands, on the Image Selection dashboard's
 * pattern — the ten figures, the Recent Albums table they filter, and the two panels beneath —
 * so the two read as one product.
 *
 * One request paints the page - `/api/image-selection/album-proofs/dashboard?range=` - so no card
 * can show one moment's figure beside another's. Two clocks, labelled rather than assumed: the
 * figures are a **position** — every live album by the state it is in — and the line under each
 * card is a **period**, the range picked above them. The dashboard only *shows* the workflow:
 * every state, correction, version and link is the server's, the same answers the album
 * workspace reads.
 *
 * Nothing on the page navigates except an album: a double click on a row of the table, a press
 * on a row of the correction list, both landing on the Projects page with that album open. New
 * Project goes to the Projects page, which owns the form.
 *
 * There is no Refresh button: the page keeps itself current (`useAutoRefresh`) — quietly, keeping
 * what is on screen — when the tab or the network comes back and once a minute while in front.
 *
 * IMAGE_SELECTION / Album Proofing governs the route: READ sees the dashboard, and only
 * READ_WRITE is offered New Project. (The API also answers a QC Lead's READ; the route map holds
 * one permission per page, so the page keeps the one the Projects page beside it has.)
 */

export default function AlbumProofingDashboardPage() {
  const { canWrite } = useRouteAccess();
  const router = useRouter();
  const { notice, showError, clearNotice } = useNotice();
  const [range, setRange] = useState(DEFAULT_RANGE);
  // Which card is pressed — what the Recent Albums table is narrowed to. Null is every album.
  const [view, setView] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // "12 mins ago" is measured from when the numbers were read, not from when the tab was last looked at.
  const [now, setNow] = useState(() => new Date());
  // Read by the loader without being a dependency, so a response never re-creates it and reloads.
  const hasData = useRef(false);

  const load = useCallback(async ({ quiet = false } = {}) => {
    const silent = quiet && hasData.current;
    if (!silent) setLoading(true);
    setError("");
    try {
      const response = await getAlbumProofingDashboard({ range });
      setData(response?.data || null);
      hasData.current = true;
      setNow(new Date());
    } catch (caught) {
      const message = caught?.message || "Unable to load the dashboard.";
      // A refresh that fails keeps the numbers already on screen and says so; a first load has
      // nothing to keep, so the page itself carries the message.
      setError(message);
      if (hasData.current) showError(message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [range, showError]);

  // Deferred a tick, this codebase's convention for a first load; every later read is quiet.
  useEffect(() => {
    const timer = setTimeout(() => void load({ quiet: true }), 0);
    return () => clearTimeout(timer);
  }, [load]);
  useAutoRefresh(load, { intervalMs: REFRESH_INTERVALS.albumProofing });

  const openAlbum = (row) => router.push(albumHref(row));
  const createProject = () => router.push(createProjectHref());
  const period = data?.period;
  const caption = [
    "Every album proof as it stands",
    data?.trend ? `each arrow is the change ${previousPhrase(data.period?.key)}` : null,
    period ? `${periodPhrase(period.key)}: +${number(period.albumsCreated)} albums, ${number(period.sentToQc)} sent to QC, ${number(period.sentToClient)} sent to clients, ${number(period.completed)} completed` : null,
  ].filter(Boolean).join(" · ");
  const isEmpty = !loading && !error && data && data.totalAlbumsAllTime === 0;
  const rangeKey = data?.range?.key || range;

  return <section className="flex min-h-0 flex-1 flex-col bg-white">
    <ImageSelectionNavigation title="Album Proofing" sections={albumProofingSections} actions={canWrite ? <Button type="button" variant="primary" size="sm" className="gap-1 whitespace-nowrap" onClick={createProject}><Add style={{ fontSize: 16 }} />New Project</Button> : null} />

    <FloatingNotice notice={notice} onClose={clearNotice} />

    <div className="dashboard-canvas min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
      {error && !data
        ? <CardState error={error} onRetry={load} />
        : isEmpty
          ? <EmptyDashboard title="No albums yet" message={canWrite ? "Create a project, add an album and import its spreads — the dashboard fills in from there." : "The dashboard fills in once an album is created."} action={canWrite && <Button type="button" variant="primary" size="sm" className="mt-4 gap-1" onClick={createProject}><Add style={{ fontSize: 16 }} />New Project</Button>} />
          : <>
            <DashboardRangeBar caption={caption} range={range} onRangeChange={setRange} />
            <AlbumSummaryCards summary={data?.summary} trend={data?.trend} rangeKey={rangeKey} loading={loading} view={view} onViewChange={setView} />
            <div className="mt-3">
              <AlbumDashboardRecentAlbums rows={data?.albumRows || []} view={view} onClearView={() => setView(null)} loading={loading} error={!data ? error : ""} onRetry={load} onOpen={openAlbum} now={now} />
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <CorrectionWorkCard rows={data?.correctionWork || []} loading={loading} error={!data ? error : ""} onRetry={load} onOpen={openAlbum} now={now} />
              <ProofingLinkCard data={data} loading={loading} error={!data ? error : ""} onRetry={load} />
            </div>
          </>}
    </div>
  </section>;
}
