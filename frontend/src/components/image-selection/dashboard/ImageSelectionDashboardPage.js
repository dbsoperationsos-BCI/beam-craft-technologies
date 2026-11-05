"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import Add from "@mui/icons-material/Add";
import RefreshRounded from "@mui/icons-material/RefreshRounded";
import ImageSelectionNavigation from "@/components/image-selection/ImageSelectionNavigation";
import { useRouteAccess } from "@/components/auth/PermissionsProvider";
import Button from "@/components/shared/Button";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import IconButton from "@/components/shared/IconButton";
import Dropdown from "@/components/shared/Dropdown";
import { getImageSelectionDashboard } from "@/services/image-selection/image-selection.service";
import { DEFAULT_RANGE, RANGE_OPTIONS, periodPhrase, previousPhrase, projectsHref } from "@/lib/imageSelectionDashboard.mjs";
import { CardState } from "@/components/shared/DashboardCard";
import DashboardRecentProjects from "./DashboardRecentProjects";
import { SelectionProgressCard, StorageCard, SummaryCards } from "./DashboardCards";

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
 * IMAGE_SELECTION / Project Management governs the route: READ sees the dashboard, and only
 * READ_WRITE is offered New Project.
 */

/** A studio with no projects at all: the one message and the one thing to do next. */
function EmptyDashboard({ canWrite, onCreate }) {
  return <section className="flex min-h-72 items-center justify-center rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
    <div className="max-w-md text-center">
      <h2 className="text-base font-semibold text-slate-800">No image selection projects yet</h2>
      <p className="mt-1 text-xs text-slate-500">{canWrite ? "Create a project, add its photos and publish the gallery — the dashboard fills in from there." : "The dashboard fills in once a project is created."}</p>
      {canWrite && <Button type="button" variant="primary" size="sm" className="mt-4 gap-1" onClick={onCreate}><Add style={{ fontSize: 16 }} />New Project</Button>}
    </div>
  </section>;
}

export default function ImageSelectionDashboardPage() {
  const { canWrite } = useRouteAccess();
  const router = useRouter();
  const { notice, showError, clearNotice } = useNotice();
  const [range, setRange] = useState(DEFAULT_RANGE);
  // Which card is pressed — what the Recent Projects table is narrowed to. Null is every project.
  // It lives here because the cards press it and the table reads it.
  const [view, setView] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // "12 mins ago" is measured from when the numbers were read, not from when the tab was last looked at.
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await getImageSelectionDashboard({ range });
      setData(response?.data || null);
      setNow(new Date());
    } catch (caught) {
      const message = caught?.message || "Unable to load the dashboard.";
      // A refresh that fails keeps the numbers already on screen and says so; a first load has
      // nothing to keep, so the page itself carries the message.
      setError(message);
      if (data) showError(message);
    } finally {
      setLoading(false);
    }
    // `data` is read only to decide where the message goes; re-creating the loader on every
    // response would re-run the effect below and load twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, showError]);

  // Deferred a tick, which is this codebase's convention for a first load: a fetch started
  // straight from an effect body counts as state set during that effect.
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const openProject = (row) => router.push(projectsHref({ projectId: row.id }));
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
    {/* The header keeps what acts on the page — Refresh and New Project. The range is a filter on
        what the page shows, so it sits with the figures it changes, at the top of the workspace. */}
    <ImageSelectionNavigation actions={<>
      <IconButton label="Refresh dashboard" size="sm" onClick={load} disabled={loading} className="text-slate-600 hover:bg-slate-100"><RefreshRounded fontSize="small" aria-hidden="true" className={loading ? "animate-spin" : ""} /></IconButton>
      {canWrite && <Button type="button" variant="primary" size="sm" className="gap-1 whitespace-nowrap" onClick={createProject}><Add style={{ fontSize: 16 }} />New Project</Button>}
    </>} />

    <FloatingNotice notice={notice} onClose={clearNotice} />

    {/* Fills what is left of the shell's flex column and scrolls inside it, so the shell never
        scrolls as a page. `dashboard-canvas` is the tinted ground the cards sit on - defined per
        theme in globals.css, because it has to stay behind them in the dark appearances too. */}
    <div className="dashboard-canvas min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
      {error && !data
        ? <CardState error={error} onRetry={load} />
        : isEmpty
          ? <EmptyDashboard canWrite={canWrite} onCreate={createProject} />
          : <>
            {/* The workspace's own top row: what the page is showing on the left, the range that
                scopes the period figures on the right. On a phone the two stack and the range
                stays at the right, above the line that explains it. */}
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <p className="order-2 min-w-0 text-[11px] text-slate-500 sm:order-1">{caption}</p>
              {/* The shared dropdown in its field mode, not its `switch` mode. A switch carries a
                  160px floor paired to its menu, which left a hand of empty box beside a word as
                  short as "Lifetime" - invisible on the white header this used to sit in, and not
                  on the tinted canvas. A field sizes its menu to the trigger instead, so the box
                  can hug its content and the two still line up. The width lives here rather than
                  on the control, so the box does not resize as the selection changes. */}
              <div className="order-1 w-32 shrink-0 self-end sm:order-2 sm:self-auto">
                <Dropdown ariaLabel="Date range" className="dashboard-range-picker" mode="input" options={RANGE_OPTIONS} value={range} onChange={setRange} sorted={false} />
              </div>
            </div>
            <SummaryCards summary={data?.summary} trend={data?.trend} rangeKey={data?.range?.key || range} loading={loading} view={view} onViewChange={setView} />
            {/* Recent Projects sits directly under the cards, because that is what a card *does*:
                pressing one narrows this table, and a filter whose result is a screen further down
                is a filter nobody sees work. The two panels that follow are read on their own and
                are not filtered by anything above them, so they take the space below it. */}
            <div className="mt-3">
              <DashboardRecentProjects rows={data?.recentProjects || []} view={view} onClearView={() => setView(null)} loading={loading} error={!data ? error : ""} onRetry={load} onOpen={openProject} now={now} />
            </div>
            <div className={`mt-3 ${twoColumns}`}>
              <SelectionProgressCard rows={data?.selectionProgress || []} loading={loading} error={!data ? error : ""} onRetry={load} onOpen={openProject} now={now} />
              <StorageCard storage={data?.storage} rangeKey={data?.range?.key || range} loading={loading} error={!data ? error : ""} onRetry={load} />
            </div>
          </>}
    </div>
  </section>;
}
