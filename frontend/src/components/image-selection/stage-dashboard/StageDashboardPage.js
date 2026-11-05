"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import ImageSelectionNavigation from "@/components/image-selection/ImageSelectionNavigation";
import { useRouteAccess } from "@/components/auth/PermissionsProvider";
import Button from "@/components/shared/Button";
import DashboardCard, { CardState, EmptyDashboard } from "@/components/shared/DashboardCard";
import DashboardFigureList from "@/components/shared/DashboardFigureList";
import DashboardMetricCards from "@/components/shared/DashboardMetricCards";
import DashboardRangeBar from "@/components/shared/DashboardRangeBar";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import useAutoRefresh from "@/components/shared/useAutoRefresh";
import { DEFAULT_RANGE } from "@/lib/dashboardRange.mjs";
import { REFRESH_INTERVALS } from "@/lib/refreshPolicy.mjs";
import { STAGE_ROUTES, stageDashboard, stageRowHref, stageSections } from "@/lib/stageDashboards.mjs";
import { getAiCullingDashboard, getAiEditingDashboard, getSignatureAlbumDashboard } from "@/services/image-selection/stage-dashboards.service";
import StageDashboardTable from "./StageDashboardTable";

const LOADERS = { culling: getAiCullingDashboard, editing: getAiEditingDashboard, album: getSignatureAlbumDashboard };

/**
 * Visual Curation → AI Culling, AI Editing or Signature Album: one stage across every project, on
 * the Album Proofing dashboard's pattern - the headline cards, the table they filter, and a panel
 * of the figures that ask for a hand - so all of Visual Curation reads as one product.
 *
 * One request paints the page (`/api/image-selection/stage-dashboards/<stage>?range=`). The cards
 * are a position, the work as it stands now; the range picked above them scopes only the period
 * line. The page keeps itself current (`useAutoRefresh`) and has no Refresh button.
 *
 * The module's own permission opens the route (`modulePermissions.js`), and the same permission
 * opens the module's Projects page - the header switches to it, and a row opens its project there.
 * Nothing here needs Photo Selection's permission.
 */
export default function StageDashboardPage({ stage }) {
  const spec = stageDashboard(stage);
  const router = useRouter();
  // The module's own Projects page answers to the module's own permission, as this page does.
  const { canRead: canOpenProjects } = useRouteAccess();
  const { notice, showError, clearNotice } = useNotice();
  const [range, setRange] = useState(DEFAULT_RANGE);
  const [view, setView] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => new Date());
  const hasData = useRef(false);

  const load = useCallback(async ({ quiet = false } = {}) => {
    const silent = quiet && hasData.current;
    if (!silent) setLoading(true);
    setError("");
    try {
      const response = await LOADERS[stage]({ range });
      setData(response?.data || null);
      hasData.current = true;
      setNow(new Date());
    } catch (caught) {
      const message = caught?.message || "Unable to load the dashboard.";
      setError(message);
      if (hasData.current) showError(message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [stage, range, showError]);

  useEffect(() => {
    const timer = setTimeout(() => void load({ quiet: true }), 0);
    return () => clearTimeout(timer);
  }, [load]);
  useAutoRefresh(load, { intervalMs: REFRESH_INTERVALS.stageDashboards });

  const openRow = canOpenProjects ? (row) => router.push(stageRowHref(stage, row)) : null;
  const rows = data?.rows || [];
  const isEmpty = !loading && !error && data && rows.length === 0;
  const caption = ["Where every project's work stands now", data?.period ? spec.caption(data.period) : null].filter(Boolean).join(" · ");

  return <section className="flex min-h-0 flex-1 flex-col bg-white">
    <ImageSelectionNavigation title={spec.title} sections={canOpenProjects ? stageSections(stage) : []} />

    <FloatingNotice notice={notice} onClose={clearNotice} />

    <div className="dashboard-canvas min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
      {error && !data
        ? <CardState error={error} onRetry={load} />
        : isEmpty
          ? <EmptyDashboard title={spec.emptyTitle} message={spec.emptyMessage} action={canOpenProjects && <Button type="button" variant="primary" size="sm" className="mt-4" onClick={() => router.push(STAGE_ROUTES[stage].projects)}>Open Projects</Button>} />
          : <>
            <DashboardRangeBar caption={caption} range={range} onRangeChange={setRange} />
            {/* Positions, so no arrows: Lifetime is how the cards say "as of now". */}
            <DashboardMetricCards cards={spec.cards} summary={data?.summary} trend={null} rangeKey="lifetime" loading={loading} view={view} onViewChange={setView} />
            <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
              <StageDashboardTable stage={stage} rows={rows} view={view} onClearView={() => setView(null)} loading={loading} error={!data ? error : ""} onRetry={load} onOpen={openRow} now={now} />
              <DashboardCard title={spec.figuresTitle} bodyClassName="p-1.5">
                <CardState loading={loading} error={!data ? error : ""} onRetry={load} rows={4}>
                  {data && <DashboardFigureList rows={spec.figures(data)} />}
                </CardState>
              </DashboardCard>
            </div>
          </>}
    </div>
  </section>;
}
