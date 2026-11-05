"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import DataTable from "@/components/data-table/DataTable";
import { NAME_COLUMN_MAX_WIDTH } from "@/components/data-table/tableLayout";
import { boardJumpItems } from "@/lib/boardJumps.mjs";
import DataTableShell from "@/components/data-table/DataTableShell";
import KanbanBoard from "@/components/data-table/KanbanBoard";
import useProjectMoney from "@/components/project-management/useProjectMoney";
import { moneyColumn, moneyFlag } from "@/lib/projectMoney.mjs";
import { columnShoots } from "@/lib/kanbanSummary.mjs";
import { useTableBoardLayout } from "@/components/data-table/TableBoardSwitch";
import TableFooter from "@/components/data-table/TableFooter";
import useStickyTab from "@/components/shared/useStickyTab";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import useCompactView from "@/components/shared/useCompactView";
import OptionsMenu from "@/components/ui/OptionsMenu";
import useTableSelection from "@/components/data-table/useTableSelection";
import DepartmentStatusDialog from "@/components/project-management/DepartmentStatusDialog";
import ImportMenuButton from "@/components/data-table/ImportMenuButton";
import { PRODUCTION_IMPORT_COLUMNS, PRODUCTION_IMPORT_HINTS } from "@/constants/importColumns";
import { useRouteAccess, usePermissions } from "@/components/auth/PermissionsProvider";
import ProductionPendingPill from "@/components/project-management/production/ProductionPendingPill";
import ProductionProjectPanel, { ProductionStatusPill, productionTone } from "@/components/project-management/production/ProductionProjectPanel";
import ProductionShootPanel from "@/components/project-management/production/ProductionShootPanel";
import ProductionViewSwitch from "@/components/project-management/production/ProductionViewSwitch";
import useLinkedParam from "@/components/shared/useLinkedParam";
import useLinkedProject from "@/components/shared/useLinkedProject";
import { boardForViewer, boardStatuses, inProjectTab, productionProjects, projectBoardCards, shootsInTab, projectProductionLabel, shootProductionStatus, shootStatusLabel, shootStepProgress } from "@/lib/productionBoard.mjs";
import { shootTimeLabel } from "@/lib/shootBoard.mjs";
import { formatDay, PRODUCTION_STEPS } from "@/lib/productionSteps.mjs";
import { getProductionShoots, setProductionProjectStatus } from "@/services/project-management/production.service";

/*
 * The production board: one row per **project** - a started one with a Production Manager - every one
 * the viewer may see, in one table at every width. The tabs are where each project stands, from its
 * shoots' (`productionProjects`). A project opens on a double click, or a double tap on a phone, to
 * its shoots as tiles; a tile opens that shoot's production panel.
 */
const text = (value) => (value === null || value === undefined || value === "" ? "—" : String(value));

/*
 * Each column says one thing of a project and its counterpart of a shoot, for the shoot rows a
 * project expands to (▸): `shoot` is what a shoot row shows in it.
 */
const columns = [
  { id: "eventId", label: "Event / Shoot ID", shoot: (row) => row.shootId },
  // Capped: a shoot named for several at once would otherwise widen the column for every row.
  { id: "clientName", label: "Client / Shoot", maxWidth: NAME_COLUMN_MAX_WIDTH, shoot: (row) => `${row.isMainEvent ? "★ " : ""}${row.shoot || "Shoot"}` },
  { id: "vertical", label: "Vertical / Time", shoot: (row) => shootTimeLabel(row) },
  { id: "productionManager", label: "Production Manager / Coordinator", shoot: (row) => row.productionCoordinator },
  { id: "shootCount", label: "Shoots / Place", shoot: (row) => row.shootPlace },
  { id: "shootsDone", label: "Shoots Done / Progress", shoot: (row) => shootStepProgress(row, PRODUCTION_STEPS).text },
  { id: "nextShootDate", label: "Next Shoot / Date", type: "date", shoot: (row) => formatDay(row.shootDate) },
  { id: "status", label: "Status" },
  { id: "actions", label: "Actions", fixed: true, sortable: false, filterable: false },
];

// A shoot row is one of the shoots a project expands to; it carries its own record id.
const isShootRow = (row) => Boolean(row?.shootRecordId);
const displayValue = (row, column) => {
  if (isShootRow(row)) return text(column.shoot?.(row));
  return column.type === "date" ? formatDay(row[column.id]) || "—" : text(row[column.id]);
};
const sortValue = (row, column) => (column.type === "date" ? new Date(row[column.id] || 0).getTime() || 0 : String(row[column.id] ?? "").toLocaleLowerCase());

/*
 * The Board's columns: the viewer's status tabs less All and Follow-up (a due date, not a status), and
 * any other status their cards stand under (`boardStatuses`), in the flow's order and in the status
 * pill's colours. A card dropped on Planned, Hold or Rejected opens the row's
 * own Update status with it chosen - the three one project's ⋮ may set (`departmentStatusOptions`);
 * the rest are worked out from the shoots or set over ticked projects only, so they take no drop.
 */
// In the project's flow - not started, preparing, planned, shooting, done - with the two it can stop at last.
const PRODUCTION_FLOW = ["Yet to Start", "Work in Progress", "Planned", "Execution", "Completed", "Hold", "Rejected"];
const boardColumnsFor = (tabs, cards) => boardStatuses(tabs, cards)
  .sort((a, b) => PRODUCTION_FLOW.indexOf(a) - PRODUCTION_FLOW.indexOf(b)).map((tab) => ({ value: tab, label: tab, className: productionTone(tab)[0] }));
const BOARD_DROPS = { Planned: "PLANNED", Hold: "HOLD", Rejected: "REJECTED" };
// One card per status a project's shoots are at (`projectBoardCards`), each with those shoots only.
const boardStatusOf = (card) => card.boardStatus;
// The board's trend counts a project by when its first shoot plan reached Production, else by its first shoot's date.
const reachedProductionOn = (project) => {
  const times = (project.shoots || []).map((shoot) => new Date(shoot.planSubmittedAt || "").getTime()).filter((time) => !Number.isNaN(time));
  if (times.length) return Math.min(...times);
  const time = new Date(project.shoots?.[0]?.shootDate || "").getTime();
  return Number.isNaN(time) ? null : time;
};
const BOARD_CARD = {
  title: (project) => project.clientName || project.eventId,
  subtitle: (project) => [project.eventId, project.productionManager].filter(Boolean).join(" · "),
  meta: (project) => [project.nextShootDate ? `Next shoot ${formatDay(project.nextShootDate)}` : "", project.shootsDone].filter(Boolean).join(" · "),
};

// One template per vertical, like Pre Production's; each shoot is checked against the one chosen.
const IMPORT_VERTICALS = [["WED", "Dum Dum"], ["QQ", "Qua Qua"], ["CORP", "Corp"]];

export default function ProductionPage() {
  const { canWrite } = useRouteAccess();
  // For the row menu's "Navigate to" line: which boards this viewer may open, and how to get there.
  const { hasPermission } = usePermissions();
  const router = useRouter();
  const jumpTo = useCallback((href) => router.push(href), [router]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openShootId, setOpenShootId] = useState(null);
  // Whether the open shoot was reached from its project's tiles - it then has a way back to them,
  // and a Plan saved there returns to them, as Pre Production's shoot form does.
  const [shootFromTiles, setShootFromTiles] = useState(false);
  const openShoot = (id, fromTiles = false) => { setShootFromTiles(fromTiles); setOpenShootId(id); };
  // The project whose shoots are open as tiles; read back from the rows, so it follows every reload.
  const [openProjectId, setOpenProjectId] = useState(null);
  /*
   * A shoot named in the address - the calendar links here with `?shoot=` - opens as Pre Production
   * opens it: inside its project, over the project's shoot tiles, so the shoot form has the back
   * arrow to them and a saved Plan returns there. That waits for the board's rows to say which
   * project the shoot is in. A shoot this viewer's board does not list still opens once the rows are
   * in, on its own as before - its panel loads the shoot itself. The address then lets it go.
   */
  const [linkedShootId, clearLinkedShoot] = useLinkedParam("shoot");
  const [openedLink, setOpenedLink] = useState("");
  const linkedRow = linkedShootId ? rows.find((row) => row.shootRecordId === linkedShootId) : null;
  if (linkedShootId && openedLink !== linkedShootId && (linkedRow || !loading)) {
    setOpenedLink(linkedShootId);
    if (linkedRow?.projectId) {
      setOpenProjectId(linkedRow.projectId);
      openShoot(linkedShootId, true);
    } else {
      setShootFromTiles(false);
      setOpenShootId(linkedShootId);
    }
  }
  useEffect(() => { if (openedLink && openedLink === linkedShootId) clearLinkedShoot(); }, [clearLinkedShoot, linkedShootId, openedLink]);
  const [tableStats, setTableStats] = useState({ total: 0 });
  /*
   * What this viewer is shown: a project they run (its Production Manager, Project Manager or
   * Coordinator, or whoever runs every project) at every status; one they are only crew on from
   * Planned on, and before that with the shoots of theirs already planned. Every status tab is the
   * leads' alone (`boardForViewer`).
   */
  const board = useMemo(() => boardForViewer(productionProjects(rows)), [rows]);
  const tabs = board.tabs;
  const [activeTab, setActiveTab] = useStickyTab("production-board", "All", tabs);
  const [lastUpdated, setLastUpdated] = useState(null);
  const { notice, showNotice, showSuccess, showError, clearNotice } = useNotice();
  const { toggleCompact, density } = useCompactView();

  const loadRows = useCallback(async ({ notifyOnError = true } = {}) => {
    setLoading(true);
    try {
      const response = await getProductionShoots();
      setRows(Array.isArray(response?.data) ? response.data : []);
      setLastUpdated(new Date());
      return true;
    } catch (error) {
      if (notifyOnError) showError(error.message || "Unable to load production shoots.");
      return false;
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => { const timer = window.setTimeout(() => { void loadRows(); }, 0); return () => window.clearTimeout(timer); }, [loadRows]);

  // Offered only to whoever may write production; the route asks the same.
  const importConfigs = canWrite ? IMPORT_VERTICALS.map(([vertical, name]) => ({
    prefix: `/api/project-management/production/vertical/${vertical}`,
    columns: PRODUCTION_IMPORT_COLUMNS,
    hints: PRODUCTION_IMPORT_HINTS,
    templateName: `production-${name.toLowerCase().replace(/\s+/g, "-")}-import-template`,
    title: `Import ${name} Production`,
    menuLabel: `Import ${name}`,
    onImported: () => loadRows({ notifyOnError: false }),
  })) : [];


  const projects = board.projects;
  const openProject = projects.find((project) => project.projectId === openProjectId) || null;
  // Under every status its shoots are at, opened there to only those shoots (`shootsInTab`).
  const tabRows = useMemo(() => projects.filter((project) => inProjectTab(project, activeTab)).map((project) => ({ ...project, shoots: shootsInTab(project, activeTab) })), [activeTab, projects]);
  const boardRows = useMemo(() => projectBoardCards(projects), [projects]);
  const boardColumns = useMemo(() => boardColumnsFor(tabs, boardRows), [boardRows, tabs]);
  /*
   * A project named in the address - a "Navigate to" from another board - filters the table to it,
   * and nothing is opened: arriving answers "here it is, on this board". The address lets it go
   * once the row has been found, so a reload does not drag the reader back to it.
   */
  const [linkedEventId, clearLinkedProject] = useLinkedProject({ tab: activeTab, onTab: setActiveTab });
  const [landedOn, setLandedOn] = useState("");
  useEffect(() => {
    if (!linkedEventId || landedOn === linkedEventId) return undefined;
    const timer = window.setTimeout(() => { setLandedOn(linkedEventId); clearLinkedProject(); }, 0);
    return () => window.clearTimeout(timer);
  }, [clearLinkedProject, landedOn, linkedEventId]);
  /*
   * The project's overall Production status, set by hand: one project from its row's ⋮ Update status,
   * or every ticked project with Update. Never a shoot. Only project rows take a tick - the shoot rows
   * a project expands to do not - and there is no Delete over them.
   */
  const [statusFor, setStatusFor] = useState(null);
  const bulk = useTableSelection({
    prefix: "/api/project-management/production",
    rows: tabRows,
    rowId: (row) => row.projectId,
    canSelectRow: (row) => !isShootRow(row),
    noun: "project",
    canDelete: false,
    showSuccess,
    showError,
    onDeleted: () => {},
  });
  const selectedCount = bulk.selectedCount;
  const selection = useMemo(() => (bulk.selection ? {
    ...bulk.selection,
    actions: canWrite && selectedCount ? [{ id: "status", label: "Update", variant: "primary", onClick: () => setStatusFor({ ids: [...bulk.selectedIds], count: selectedCount, bulk: true }) }] : [],
  } : undefined), [bulk.selection, bulk.selectedIds, canWrite, selectedCount]);

  async function saveProjectStatus(change) {
    try {
      const response = await setProductionProjectStatus(statusFor.ids, change);
      const { updated = 0, refused = 0, missing = 0 } = response?.data || {};
      const left = refused + missing;
      showSuccess([
        `${updated} project${updated === 1 ? "" : "s"} updated.`,
        left ? `${left} ${left === 1 ? "was" : "were"} left alone: only its Production Manager, or someone who works every project, can change it.` : "",
      ].filter(Boolean).join(" "));
      if (statusFor.bulk) bulk.clear();
      setStatusFor(null);
      await loadRows({ notifyOnError: false });
    } catch (error) {
      showError(error.message || "Unable to update the project status.");
    }
  }

  const [layout, setLayout] = useTableBoardLayout("production-board");
  const onBoard = layout === "board";
  // The projects' money under each column, and "Balance due ₹…" on a card whose client still owes - only for
  // somebody who may see a project's Payments tab (`useProjectMoney`), and only while the Board is open.
  const money = useProjectMoney(onBoard ? boardRows : null);
  // A "Jump to" from another board filters the table to its project, so it brings the table back.
  useEffect(() => {
    if (!linkedEventId || !onBoard) return undefined;
    const timer = window.setTimeout(() => setLayout("table"), 0);
    return () => window.clearTimeout(timer);
  }, [linkedEventId, onBoard, setLayout]);
  const canDropAt = useCallback((project, to) => canWrite && Boolean(BOARD_DROPS[to]), [canWrite]);
  const dropProject = useCallback((project, to) => setStatusFor({ ids: [project.projectId], count: 1, title: `Update status - ${project.eventId}`, status: BOARD_DROPS[to] }), []);

  const tabCounts = useMemo(() => Object.fromEntries(tabs.map((tab) => [tab, projects.filter((project) => inProjectTab(project, tab)).length])), [projects, tabs]);
  // A project row's ⋮, for the table and for a Board card - each card is one of these projects.
  const projectActions = useCallback((project) => [
    { label: canWrite ? "Edit" : "View", onSelect: () => setOpenProjectId(project.projectId) },
    ...(canWrite ? [{ label: "Update status", onSelect: () => setStatusFor({ ids: [project.projectId], count: 1, title: `Update status - ${project.eventId}` }) }] : []),
    // The same project on the other boards, where this viewer may open one and the project
    // is actually there (`lib/boardJumps.mjs`).
    ...boardJumpItems({ from: "production", boards: project.boards, eventId: project.eventId, can: hasPermission, onJump: jumpTo }),
  ], [canWrite, hasPermission, jumpTo]);

  const tableColumns = useMemo(() => columns.map((column) => ({
    ...column,
    header: column.label,
    accessorFn: (row) => displayValue(row, column),
    // What a clipped cell says in full when it is hovered or read out.
    title: (row) => displayValue(row, column),
    sortingFn: (first, second) => {
      const a = sortValue(first.original, column);
      const b = sortValue(second.original, column);
      return typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true });
    },
    cell: column.id === "actions"
      ? ({ row }) => (isShootRow(row.original)
        // Edit opens it; a viewer who may only read is offered View instead.
        ? <OptionsMenu ariaLabel={`Actions for ${row.original.shootId}`} items={[{ label: canWrite ? "Edit" : "View", onSelect: () => openShoot(row.original.shootRecordId) }]} />
        : <OptionsMenu ariaLabel={`Actions for ${row.original.eventId}`} items={projectActions(row.original)} />)
      : column.id === "status"
        ? ({ row }) => (isShootRow(row.original)
          ? <ProductionStatusPill status={shootProductionStatus(row.original)} label={shootStatusLabel(row.original)} />
          : <ProductionStatusPill status={row.original.status} label={projectProductionLabel(row.original.shoots, PRODUCTION_STEPS)} />)
        : ({ row }) => displayValue(row.original, column),
    exportValue: (row) => displayValue(row, column),
    width: column.id === "actions" ? 56 : 180,
    minWidth: column.id === "actions" ? 56 : 140,
  })), [canWrite, projectActions]);

  const updatedText = lastUpdated ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(lastUpdated) : "—";

  return <section className="flex h-full min-h-0 w-full min-w-0 flex-col">
    <ModulePageHeader
      title="Production"
      // The Board stands every project under its status, so the status tabs step aside while it shows.
      tabs={onBoard ? undefined : tabs.map((tab) => ({ id: tab, label: tab, count: tabCounts[tab] || 0 }))}
      tabValue={activeTab}
      onTabChange={setActiveTab}
      tabsAriaLabel="Production project status"
      // Table, Board or Schedule - the board's three views, in one dropdown at the right end.
      actions={<ProductionViewSwitch />}
      menu={<ImportMenuButton ariaLabel="More production actions" importConfigs={importConfigs} />}
    />
    <FloatingNotice notice={notice} onClose={clearNotice} />
    {onBoard ? <KanbanBoard
      rows={boardRows}
      columns={boardColumns}
      statusOf={boardStatusOf}
      // How many shoots each column holds, and the nearest still to come.
      columnAmount={money ? (rows) => moneyColumn(rows, money) : (rows) => columnShoots(rows)}
      cardFlag={money ? (row) => moneyFlag(row, money) : undefined}
      dateOf={reachedProductionOn}
      card={BOARD_CARD}
      onOpen={(project) => setOpenProjectId(project.projectId)}
      // The card's ⋮ is the project row's ⋮: a card is that project, at one of its statuses.
      cardActions={projectActions}
      canDropAt={canDropAt}
      onDrop={dropProject}
      loading={loading}
      noun="projects"
      ariaLabel="Production board"
    /> : <div className="flex min-h-0 flex-1 flex-col">
      <DataTableShell className="h-full min-h-0" footer={<TableFooter spread><span>Last updated: {updatedText}</span><span>Total rows: {tableStats.total}</span></TableFooter>}>
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <DataTable
            columns={tableColumns}
            key={activeTab}
            data={tabRows}
            density={density}
            onToggleCompact={toggleCompact}
            loading={loading}
            loadingMessage="Loading production projects..."
            filterPreset={landedOn ? { id: "eventId", value: landedOn } : undefined}
            emptyMessage="No production projects yet. A project appears here once it has started and has a Production Manager."
            noMatchMessage="No matching projects found."
            // A project opens to its shoots as tiles; a shoot row (under its project's ▸) straight to the shoot.
            onRowDoubleClick={(row) => (isShootRow(row) ? openShoot(row.shootRecordId) : setOpenProjectId(row.projectId))}
            onVisibleRowsChange={setTableStats}
            ariaLabel="Production projects table"
            features={{
              filtering: true,
              sorting: true,
              columnVisibility: true,
              infiniteScroll: { pageSize: 50 },
              // Eight columns end short of a wide screen: share the spare width out among them
              // rather than leave a blank strip beside Status.
              layout: "fill",
              selection,
              // ▸ on a project row shows its shoots under it, in the order they happen.
              expandable: { label: "this project's shoots", canExpand: (row) => !isShootRow(row) && row.shoots?.length > 0, getSubRows: (row) => (isShootRow(row) ? undefined : row.shoots) },
              csvExport: { enabled: true, fileName: "production-projects", onResult: (exported) => (exported ? showSuccess("Production CSV export downloaded.") : showNotice("No rows available to export.")) },
            }}
          />
        </div>
      </DataTableShell>
    </div>}
    {openProject && <ProductionProjectPanel project={openProject} onOpenShoot={(id) => openShoot(id, true)} onClose={() => setOpenProjectId(null)} />}
    {openShootId && <ProductionShootPanel
      shootId={openShootId}
      canWrite={canWrite}
      // Titled from its board row until it loads.
      summary={rows.find((row) => row.shootRecordId === openShootId) || null}
      // From the tiles: the arrow, Close and saving the Plan all go back to them. From a row there is
      // no arrow; Close and saving the Plan close it.
      onBack={shootFromTiles ? () => setOpenShootId(null) : undefined}
      onClose={() => setOpenShootId(null)}
      onChanged={(message) => { if (message) showSuccess(message); void loadRows({ notifyOnError: false }); }}
    />}
    {statusFor && <DepartmentStatusDialog department="production" title={statusFor.title} count={statusFor.count} bulk={Boolean(statusFor.bulk)} initialStatus={statusFor.status} onSave={saveProjectStatus} onClose={() => setStatusFor(null)} />}
  </section>;
}
