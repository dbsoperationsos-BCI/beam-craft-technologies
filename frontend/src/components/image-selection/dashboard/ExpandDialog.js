"use client";

import { useCallback, useMemo, useState } from "react";
import Dialog from "@/components/ui/Dialog";
import Dropdown from "@/components/shared/Dropdown";
import HelpTip from "@/components/shared/HelpTip";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import { CardState } from "@/components/shared/DashboardCard";
import { RANGE_OPTIONS } from "@/lib/dashboardRange.mjs";
import { layers } from "@/constants/layers";
import DashboardRecentProjects from "./DashboardRecentProjects";
import { ExpandCards } from "./DashboardCards";
import useExpandToggle from "./useExpandToggle";
import useImageSelectionDashboard from "./useImageSelectionDashboard";

/**
 * Projects sidebar → filter → Expand: the Image Selection dashboard's ten cards and its projects
 * table in a popup over the Projects page, as the reader has arranged it for themselves.
 *
 * Same request, same rules, same components as the Dashboard page. The cards count only the
 * projects enabled in the reader's Expand view; the table lists every project, its Activity saying
 * Enabled or Disabled, and each row's ⋮ holds an Enabled switch that turns it off and on there and
 * then - the cards are read again after each change. The header ⋮ is the Table Options every table
 * carries. Both menus open on the layer above the popup (`layers.menuOverPanel`), or they would
 * open behind it. A pressed card narrows the table to the enabled projects it counted, so
 * the card and the rows under it always agree.
 *
 * Above them, the Enabled and Disabled cards count every project by its switch, as it stands now,
 * and narrow the table to those - the only cards that can show a disabled project, since the summary
 * cards count enabled ones alone. One view at a time: pressing either kind lets go of the other.
 *
 * Disabling is one state for everyone, on the project itself: it holds back uploading, publishing
 * and sending, and pauses the client's link, until it is enabled again (the server enforces it).
 *
 * Nothing on the page behind is touched while this is open: the selected project, its tab and its
 * folder are still there when it closes. A double-click on a row opens that project in the page
 * behind (`onOpenProject`) and closes this, which is the one way out that changes anything.
 */
export default function ExpandDialog({ onClose, onOpenProject, canWrite = false, onProjectChanged }) {
  const { notice, showError, clearNotice } = useNotice();
  const { range, setRange, data, setData, loading, error, now, load } = useImageSelectionDashboard({ expand: true, onRefreshError: showError });
  const [view, setView] = useState(null);
  // After a switch: the cards are read again, and the page behind hears which project changed.
  const changed = useCallback((row, enabled) => { load({ quiet: true }); onProjectChanged?.(row, enabled); }, [load, onProjectChanged]);
  const toggle = useExpandToggle({ setData, onError: showError, onChanged: changed });
  // The switch is Project Management Read / Write's: a Read login sees Activity but no switch.
  const expand = useMemo(() => ({ ...toggle, canToggle: canWrite }), [toggle, canWrite]);
  const allRows = data?.recentProjects;
  // A summary card counts enabled projects alone, so its view narrows to those first; the Enabled
  // and Disabled cards' own view (`{ expand }`) does its narrowing in the table.
  const rows = useMemo(() => (view && !view.expand ? (allRows || []).filter((row) => row.expandEnabled !== false) : allRows || []), [allRows, view]);

  return <Dialog
    title="Expand"
    description="Every Image Selection project. Disabling a project pauses its client link and stops uploads and link sending until it is enabled again; its photos and selections are kept."
    onClose={onClose}
    size="wide"
    height="tall"
    bodyClassName="dashboard-canvas"
    headerActions={<div className="flex shrink-0 items-center gap-1"><div className="w-32"><Dropdown ariaLabel="Date range" className="dashboard-range-picker" mode="input" options={RANGE_OPTIONS} value={range} onChange={setRange} sorted={false} /></div><HelpTip text="The period the summary cards below are counted over." /></div>}
  >
    <FloatingNotice notice={notice} onClose={clearNotice} />
    {error && !data
      ? <CardState error={error} onRetry={load} />
      : <>
        <ExpandCards rows={allRows} summary={data?.summary} trend={data?.trend} comparedAt={data?.comparedAt} rangeKey={data?.range?.key || range} loading={loading} view={view} onViewChange={setView} />
        <div className="mt-3">
          <DashboardRecentProjects title="Projects" ariaLabel="Expand projects" rows={rows} view={view} onClearView={() => setView(null)} loading={loading} error={!data ? error : ""} onRetry={load} onOpen={(row) => { onOpenProject?.(row); onClose(); }} now={now} expand={expand} menuZIndexClassName={layers.menuOverPanel} />
        </div>
      </>}
  </Dialog>;
}
