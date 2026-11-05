"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Add from "@mui/icons-material/Add";
import ImageSelectionNavigation from "@/components/image-selection/ImageSelectionNavigation";
import { useRouteAccess } from "@/components/auth/PermissionsProvider";
import Button from "@/components/shared/Button";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import { openProjectHref, periodPhrase, previousPhrase, projectsHref } from "@/lib/imageSelectionDashboard.mjs";
import { CardState, EmptyDashboard } from "@/components/shared/DashboardCard";
import DashboardRangeBar from "@/components/shared/DashboardRangeBar";
import DashboardRecentProjects from "./DashboardRecentProjects";
import { SelectionProgressCard, StorageCard, SummaryCards } from "./DashboardCards";
import useImageSelectionDashboard from "./useImageSelectionDashboard";

/**
 * Image Selection → Dashboard.
 *
 * One request paints the page: the ten figures, the progress list, storage and the recent table
 * all come from `/api/image-selection/dashboard`, so no panel can show one moment's number beside
 * another's.
 *
 * Two clocks, and they are labelled rather than left to be assumed. The figures are a **position**
 * — every Image Selection project as it stands, Album Proofing's never among them — while the line
 * under each card is a **period**, the range picked above them. So the picker sits with the cards
 * it changes, and the header keeps what acts on the page: Refresh, New Project and the module's ⋮.
 *
 * Nothing on the page navigates except a project. The cards are filters on the Recent Projects
 * table at the foot of the page; a row of that
 * table (or of the progress list) is the one thing that opens the Projects workspace.
 *
 * There is no Refresh button: the page keeps itself current (`useAutoRefresh`) — quietly, keeping
 * what is on screen — when the tab comes back to the front, when the network comes back, when an
 * upload from this browser lands, and once a minute while it is in front. The desktop app keeps a
 * Refresh button beside the same policy, because it holds state the server cannot push.
 *
 * IMAGE_SELECTION / Project Management governs the route: READ sees the dashboard, and only
 * READ_WRITE is offered New Project.
 */

export default function ImageSelectionDashboardPage() {
  const { canWrite } = useRouteAccess();
  const router = useRouter();
  const { notice, showError, clearNotice } = useNotice();
  const { range, setRange, data, loading, error, now, load } = useImageSelectionDashboard({ onRefreshError: showError });
  // Which card is pressed — what the Recent Projects table is narrowed to. Null is every project.
  // It lives here because the cards press it and the table reads it.
  const [view, setView] = useState(null);

  const openProject = (row) => router.push(projectsHref({ projectId: row.id }));
  // The table's rows open on their shoot while the table is showing Yet to Download.
  const openRecentProject = (row) => router.push(openProjectHref(row, view));
  const createProject = () => router.push(projectsHref({ create: true }));
  // The one line that says what the range is doing to the page: which point the arrows measure
  // from, and what the range itself added.
  const period = data?.period;
  const count = (value) => Number(value || 0).toLocaleString("en-IN");
  const caption = [
    "Every Image Selection project as it stands",
    data?.trend ? `each arrow is the change ${previousPhrase(data.period?.key)}` : null,
    period ? `${periodPhrase(period.key)}: +${count(period.projectsCreated)} projects, ${count(period.selectionsMade)} photos picked, ${count(period.itemsSubmitted)} items submitted` : null,
  ].filter(Boolean).join(" · ");
  const isEmpty = !loading && !error && data && data.totalProjectsAllTime === 0;
  const twoColumns = "grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]";

  return <section className="flex min-h-0 flex-1 flex-col bg-white">
    {/* The header keeps what acts on the page — New Project. The range is a filter on what the
        page shows, so it sits with the figures it changes, at the top of the workspace. */}
    <ImageSelectionNavigation actions={canWrite ? <Button type="button" variant="primary" size="sm" className="gap-1 whitespace-nowrap" onClick={createProject}><Add style={{ fontSize: 16 }} />New Project</Button> : null} />

    <FloatingNotice notice={notice} onClose={clearNotice} />

    {/* Fills what is left of the shell's flex column and scrolls inside it, so the shell never
        scrolls as a page. `dashboard-canvas` is the tinted ground the cards sit on - defined per
        theme in globals.css, because it has to stay behind them in the dark appearances too. */}
    <div className="dashboard-canvas min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
      {error && !data
        ? <CardState error={error} onRetry={load} />
        : isEmpty
          ? <EmptyDashboard title="No image selection projects yet" message={canWrite ? "Create a project, add its photos and publish the gallery — the dashboard fills in from there." : "The dashboard fills in once a project is created."} action={canWrite && <Button type="button" variant="primary" size="sm" className="mt-4 gap-1" onClick={createProject}><Add style={{ fontSize: 16 }} />New Project</Button>} />
          : <>
            {/* The workspace's own top row: what the page is showing on the left, the range that
                scopes the period figures on the right. */}
            <DashboardRangeBar caption={caption} range={range} onRangeChange={setRange} />
            <SummaryCards summary={data?.summary} trend={data?.trend} rangeKey={data?.range?.key || range} loading={loading} view={view} onViewChange={setView} />
            {/* Recent Projects sits directly under the cards, because that is what a card *does*:
                pressing one narrows this table, and a filter whose result is a screen further down
                is a filter nobody sees work. The two panels that follow are read on their own and
                are not filtered by anything above them, so they take the space below it. */}
            <div className="mt-3">
              <DashboardRecentProjects rows={data?.recentProjects || []} view={view} onClearView={() => setView(null)} loading={loading} error={!data ? error : ""} onRetry={load} onOpen={openRecentProject} now={now} />
            </div>
            <div className={`mt-3 ${twoColumns}`}>
              <SelectionProgressCard rows={data?.selectionProgress || []} loading={loading} error={!data ? error : ""} onRetry={load} onOpen={openProject} now={now} />
              <StorageCard storage={data?.storage} rangeKey={data?.range?.key || range} loading={loading} error={!data ? error : ""} onRetry={load} />
            </div>
          </>}
    </div>
  </section>;
}
