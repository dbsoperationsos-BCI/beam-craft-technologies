"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import DataTable from "@/components/data-table/DataTable";
import { NAME_COLUMN_MAX_WIDTH } from "@/components/data-table/tableLayout";
import DataTableInfoPanel from "@/components/data-table/DataTableInfoPanel";
import DataTableShell from "@/components/data-table/DataTableShell";
import KanbanBoard from "@/components/data-table/KanbanBoard";
import useProjectMoney from "@/components/project-management/useProjectMoney";
import { moneyColumn, moneyFlag } from "@/lib/projectMoney.mjs";
import { columnShoots } from "@/lib/kanbanSummary.mjs";
import TableBoardSwitch, { useTableBoardLayout } from "@/components/data-table/TableBoardSwitch";
import TableFooter from "@/components/data-table/TableFooter";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import PreProductionProjectEditor from "@/components/project-management/PreProductionProjectEditor";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import useCompactView from "@/components/shared/useCompactView";
import useStickyTab from "@/components/shared/useStickyTab";
import useLinkedParam from "@/components/shared/useLinkedParam";
import useLinkedProject from "@/components/shared/useLinkedProject";
import { boardJumpItems } from "@/lib/boardJumps.mjs";
import OptionsMenu from "@/components/ui/OptionsMenu";
import useTableSelection from "@/components/data-table/useTableSelection";
import DepartmentStatusDialog from "@/components/project-management/DepartmentStatusDialog";
import ImportMenuButton from "@/components/data-table/ImportMenuButton";
import { PRE_PRODUCTION_IMPORT_HINTS, preProductionImportColumns } from "@/constants/importColumns";
import { useModuleAccess, usePermissions } from "@/components/auth/PermissionsProvider";
import { preProductionInfoFormatters, preProductionProjectInfoSections } from "@/constants/infoPanelConfig";
import { verticalCode } from "@/components/sales/whatsappGroupNameUtils";
import { getPreProductionOptions, getPreProductionRows, setPreProductionProjectStatus } from "@/services/project-management/pre-production.service";
import { formatDate } from "@/lib/preProductionFormat";
import { projectCompletionLabel, projectCompletionStatus, projectTabStatuses, shootCompletionStatus, shootPlanStatus, shootProgress, shootsInTab } from "@/lib/preProductionProgress";
import { shootTimeLabel } from "@/lib/shootBoard.mjs";
import { followupDue } from "@/lib/productionBoard.mjs";

/*
 * The pre production board, one row per project.
 *
 * The data underneath is still one record per shoot — a location, a reporting time and a studio
 * start belong to one shoot — but the board lists the project once, because that is the unit the
 * coordinator picks up: they open a project and work through its shoots as cards. The row carries
 * the project's own columns plus a summary of its shoots (how many, how far along, the next
 * follow-up due); everything per-shoot lives inside the cards a row opens.
 */

// The project's own pre production status (`projectCompletionStatus`): from its shoots' details.
// Follow-up lists every project with a pending follow-up due today or past (a shoot's WCR date is one
// of them) - there as well as under its own status.
const tabs = ["All", "Yet to Start", "Work in Progress", "Follow-up", "Hold", "Rejected", "Planned"];

/*
 * Which vertical each of the four routes shows. Pre Production is one board with three branch views
 * cut out of it, and `vertical` (the row's `product` field) is inherited from the reserved
 * WhatsApp group name, or chosen on the sale when the group name was typed. Matched loosely: the
 * same branch is written both ways in records of different ages.
 */
const moduleRules = {
  "pre-production": { title: "Pre Production", fileName: "pre-production-projects", imports: ["WED", "QQ", "CORP"] },
  "pre-production-dum-dum": { title: "Pre Production - Dum Dum", fileName: "pre-production-dum-dum-projects", verticals: ["DUM DUM", "WED"], imports: ["WED"] },
  "pre-production-qua-qua": { title: "Pre Production - Qua Qua", fileName: "pre-production-qua-qua-projects", verticals: ["QUA QUA", "QQ"], imports: ["QQ"] },
  "pre-production-corp": { title: "Pre Production - Corp", fileName: "pre-production-corp-projects", verticals: ["CORP"], imports: ["CORP"] },
};

/*
 * The Board's columns: the status tabs less All and Follow-up (a due date, not a status), in their
 * order. A card dropped on Planned, Hold or Rejected opens the row's own Update status with it chosen -
 * the three one project's ⋮ may set (`departmentStatusOptions`); Yet to Start and Work in Progress are
 * set over ticked projects only, so they take no drop.
 */
// In the project's flow - not started, being planned, planned - with the two it can stop at after.
const BOARD_COLUMNS = ["Yet to Start", "Work in Progress", "Planned", "Hold", "Rejected"].map((tab) => ({ value: tab, label: tab }));
const BOARD_DROPS = { Planned: "PLANNED", Hold: "HOLD", Rejected: "REJECTED" };
// One card per status a project's shoots are at (`projectTabStatuses`), each with those shoots only.
const boardStatusOf = (card) => card.boardStatus;
const boardCards = (projects) => projects.flatMap((project) => projectTabStatuses(project.shoots).map((status) => ({ ...project, id: `${project.id}:${status}`, boardStatus: status, shoots: shootsInTab(project.shoots, status) })));
const BOARD_CARD = {
  title: (project) => project.clientName || project.eventId,
  subtitle: (project) => [project.eventId, project.preProductionCoordinator].filter(Boolean).join(" · "),
  meta: (project) => [project.mainEventDate ? `Event ${formatDate(project.mainEventDate)}` : "", project.completionSummary].filter(Boolean).join(" · "),
};

const IMPORT_VERTICAL_NAMES = { WED: "Dum Dum", QQ: "Qua Qua", CORP: "Corp" };

const text = (value) => (value === null || value === undefined || value === "" ? "—" : String(value));
const yesNo = (value) => (value ? "Yes" : "No");

/**
 * A follow-up whose date has gone by on a project that is not finished.
 *
 * Asked of the project, because the follow-up is the project's: a date that has passed while any
 * shoot is still open is a client somebody owes a call.
 */
function isOverdue(entity) {
  if (!entity.nextFollowupDate) return false;
  if (entity.completionStatus === "Planned") return false;
  const due = new Date(entity.nextFollowupDate);
  if (Number.isNaN(due.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today;
}

/**
 * The shoot rows folded into one row per project.
 *
 * The project-level columns are identical on every shoot row, so they are read off the first; the
 * shoot summary is worked out across all of them. `shoots` rides along in full for the cards panel
 * and never renders in the table.
 */
function aggregateProjects(rows) {
  const byProject = new Map();
  for (const row of rows) {
    if (!byProject.has(row.projectId)) byProject.set(row.projectId, []);
    byProject.get(row.projectId).push(row);
  }
  return [...byProject.values()].map((shoots) => {
    const first = shoots[0];
    // Planned by its details, whatever a shoot is marked by hand.
    const completed = shoots.filter((shoot) => shootPlanStatus(shoot) === "Planned").length;
    const pending = shoots.filter((shoot) => shootPlanStatus(shoot) !== "Planned");
    return {
      id: first.projectId,
      projectId: first.projectId,
      // When the project came to pre production - its first shoot's arrival - for the Board's trend.
      createdAt: shoots.map((shoot) => shoot.createdAt).filter(Boolean).sort()[0] || null,
      // Which of the five screens this project is on, for the row menu's "Navigate to" line: a
      // project row is built here from its shoots, so what the server said has to be carried over
      // or the menu is asked about a project that claims to be on nothing.
      boards: first.boards || [],
      // The Pre Production status set on the project by hand, and why - read in the Info panel.
      preProductionStatusRemarks: first.preProductionStatus ? [first.preProductionStatusRemarks, [first.preProductionStatusBy, first.preProductionStatusAt && new Date(first.preProductionStatusAt).toLocaleDateString("en-GB")].filter(Boolean).join(", ")].filter(Boolean).join(" - ") : null,
      eventId: first.eventId,
      clientName: first.clientName,
      clientMainNumber: first.clientMainNumber,
      sourceBranch: first.sourceBranch,
      product: first.product,
      crdDocumentStatus: first.crdDocumentStatus,
      // Read from the CRD document itself rather than the hand-set note beside it.
      crdDocumentState: first.crdDocumentState,
      crdSidesReceived: first.crdSidesReceived,
      crdCompletion: first.crdCompletion,
      crdSubmittedAt: first.crdSubmittedAt,
      salesPreProductionRemarks: first.salesPreProductionRemarks,
      crmName: first.crmName,
      preProductionCoordinator: first.preProductionCoordinator,
      creativeManager: first.creativeManager,
      postProductionCoordinator: first.postProductionCoordinator,
      // Both: the name for the General bar to show, the id for its picker to start on.
      productionManager: first.productionManager,
      productionManagerEmployeeId: first.productionManagerEmployeeId,
      mainEventDate: first.mainEventDate,
      projectStatus: first.projectStatus,
      storageId: first.storageId,
      storageStatus: first.storageStatus,
      receivedTheStorage: first.receivedTheStorage,
      shoots,
      shootCount: shoots.length,
      shootIds: shoots.map((shoot) => shoot.shootId).filter(Boolean).join(", ") || null,
      shootNames: shoots.map((shoot) => shoot.shoot).filter(Boolean).join(", ") || null,
      subEventDates: shoots.map((shoot) => formatDate(shoot.subEventDate)).join(", "),
      completionStatus: projectCompletionStatus(shoots),
      // As shown: "Work in Progress (45%)", the percentage the average of the shoots' own progress.
      completionStatusLabel: projectCompletionLabel(shoots),
      // The shoots still owed, by name, so the column filter answers "which projects still have a
      // Reception to do?" — a question the planned count cannot. Anything not Planned is pending.
      shootsPending: pending.map((shoot) => shoot.shoot).filter(Boolean).join(", ") || "—",
      shootsPendingCount: pending.length,
      completionSummary: `${completed}/${shoots.length} Planned`,
      // The follow-ups are the project's, so every shoot row already reports the same values.
      lastFollowupDate: first.lastFollowupDate,
      nextFollowupDate: first.nextFollowupDate,
      followupRemarks: first.followupRemarks,
    };
  });
}

/*
 * The project's columns, then the shoot summary. A project row opens (▸) to its shoots, one row each:
 * `shoot` is what a shoot row shows in a column - its ID, name and place, date and time, its own
 * status and how much of it is filled - and a column without one is left blank on it.
 */
const columns = [
  { id: "eventId", label: "Event ID / Shoot ID", shoot: (row) => row.shootId },
  // Capped: a shoot named for several at once would otherwise widen the column for every row.
  { id: "clientName", label: "Client Name / Shoot", maxWidth: NAME_COLUMN_MAX_WIDTH, shoot: (row) => [`${row.isMainEvent ? "★ " : ""}${row.shoot || "Shoot"}`, row.shootPlace].filter(Boolean).join(" · ") },
  { id: "clientMainNumber", label: "Client Number" },
  { id: "sourceBranch", label: "Source Branch" },
  { id: "product", label: "Vertical", type: "vertical" },
  { id: "crdDocumentStatus", label: "CRD Document Groom / Bride / Baby Shoot" },
  { id: "crdDocumentState", label: "CRD Document State" },
  { id: "crdSidesReceived", label: "CRD Sides Received" },
  { id: "crdCompletion", label: "CRD Completion %", type: "number" },
  { id: "salesPreProductionRemarks", label: "Sales Pre Production Remarks" },
  { id: "crmName", label: "CRM" },
  { id: "preProductionCoordinator", label: "Pre Production Coordinator" },
  { id: "creativeManager", label: "Creative Manager" },
  { id: "postProductionCoordinator", label: "Post Production Coordinator" },
  // Beside the other seats, so the register can be read, sorted and filtered by who is running the
  // project. One list of columns serves all four tabs, so it appears in every one of them.
  { id: "productionManager", label: "Production Manager" },
  { id: "mainEventDate", label: "Main Event Date", type: "date" },
  { id: "receivedTheStorage", label: "Received The Storage", type: "boolean" },
  { id: "storageId", label: "Storage ID" },
  { id: "shootCount", label: "Shoots", type: "number" },
  { id: "shootNames", label: "Shoot Names", maxWidth: NAME_COLUMN_MAX_WIDTH },
  { id: "shootIds", label: "Shoot IDs" },
  { id: "subEventDates", label: "Sub Event Dates", shoot: (row) => [formatDate(row.subEventDate), shootTimeLabel({ startTime: row.eventStartTime, endTime: row.eventEndTime, session: row.sessionTiming })].filter((value) => value && value !== "—").join(" · ") },
  { id: "completionStatusLabel", label: "Pre Production Status", shoot: (row) => row.completionStatus },
  { id: "completionSummary", label: "Shoots Planned", shoot: (row) => { const progress = shootProgress(row); return `${progress.filled}/${progress.total} filled (${progress.percent}%)`; } },
  { id: "shootsPending", label: "Shoots Pending" },
  { id: "shootsPendingCount", label: "Shoots Pending Count", type: "number" },
  { id: "lastFollowupDate", label: "Last Followup Date", type: "date" },
  { id: "nextFollowupDate", label: "Next Followup Date", type: "date" },
  { id: "followupRemarks", label: "Followup Remarks" },
  { id: "actions", label: "Actions", fixed: true, sortable: false, filterable: false },
];

// A shoot row is one of the shoots a project row opens to; it carries its own shoot record id.
const isShootRow = (row) => Boolean(row?.shootRecordId);

function displayValue(row, column) {
  if (isShootRow(row)) return column.shoot ? text(column.shoot(row)) : "";
  if (column.type === "date") return formatDate(row[column.id]);
  if (column.type === "boolean") return yesNo(row[column.id]);
  // DD, not the stored WED - see `verticalCode`.
  if (column.type === "vertical") return verticalCode(row[column.id]) || "—";
  return text(row[column.id]);
}

function sortValue(row, column) {
  if (column.type === "date") {
    const date = new Date(row[column.id]);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  }
  if (column.type === "boolean") return row[column.id] ? 1 : 0;
  if (column.type === "number") return Number(row[column.id]) || 0;
  return String(row[column.id] ?? "").toLocaleLowerCase();
}

export default function PreProductionPage({ moduleKey }) {
  const rule = moduleRules[moduleKey];
  const { canWrite } = useModuleAccess("PROJECT", "Pre Production");
  // For the row menu's "Navigate to" line: which boards this viewer may open, and how to get there.
  const { hasPermission } = usePermissions();
  const router = useRouter();
  const jumpTo = useCallback((href) => router.push(href), [router]);
  // The import creates bookings as well as filling pre production in, so the server asks for Sales
  // Manager write on top of this board's own; offered only to somebody holding both.
  const { canWrite: canCreateBookings } = useModuleAccess("SALES", "Sales Manager");
  // Replacing deletes the project already in the app, so it is offered to whoever may delete any
  // project - the Delete button's rule. The server asks again of every project it would delete.
  const { canRead: administersBranches } = useModuleAccess("ADMIN", "Branch Administration");
  const { canWrite: worksEveryProject } = useModuleAccess("PROJECT", "Show All Projects");
  const [rows, setRows] = useState([]);
  // Every shoot carries the status its details add up to, so the tabs, cards and counts all read
  // one worked-out answer instead of a field somebody had to remember to change.
  const shootRows = useMemo(() => rows.map((row) => ({ ...row, completionStatus: shootCompletionStatus(row) })), [rows]);
  const [options, setOptions] = useState({ employees: [] });
  const [scopeUnavailable, setScopeUnavailable] = useState(false);
  const [activeTab, setActiveTab] = useStickyTab(`pre-production-${moduleKey}`, "All", tabs);
  const [loading, setLoading] = useState(true);
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  // The project whose shoots are open as cards. Everything shoot-level goes through here: a project
  // is several shoots and the coordinator works them one at a time.
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [infoPanelState, setInfoPanelState] = useState("collapsed");
  const [tableStats, setTableStats] = useState({ total: 0 });
  const [lastUpdated, setLastUpdated] = useState(null);
  const { notice, showNotice, showSuccess, showError, clearNotice } = useNotice();
  const { toggleCompact, density } = useCompactView(`pre-production-${moduleKey}`);

  const loadRows = useCallback(async ({ notifyOnError = true } = {}) => {
    setLoading(true);
    try {
      const response = await getPreProductionRows();
      if (response?.meta?.scopeUnavailable) {
        setScopeUnavailable(true);
        return true;
      }
      setRows(Array.isArray(response?.data) ? response.data : []);
      setScopeUnavailable(false);
      setLastUpdated(new Date());
      return true;
    } catch (error) {
      if (notifyOnError) showError(error.message || "Unable to load pre production projects.");
      return false;
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadRows(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadRows]);

  // The form's vocabulary, fetched once. A board opened only to read never needs it.
  useEffect(() => {
    if (!canWrite) return;
    getPreProductionOptions()
      .then((response) => setOptions(response?.data || { employees: [] }))
      // Not swallowed: without this the statuses, travel modes and vehicles are all empty and the
      // form looks broken rather than unfetched.
      .catch((error) => showError(error.message || "Unable to load the pre production form options."));
  }, [canWrite, showError]);

  const moduleRows = useMemo(
    () => (rule.verticals ? shootRows.filter((row) => rule.verticals.includes(String(row.product || "").trim().toUpperCase())) : shootRows),
    [shootRows, rule],
  );
  const projects = useMemo(() => aggregateProjects(moduleRows), [moduleRows]);
  /*
   * A project stands under every status its shoots are at (`projectTabStatuses`): one with a shoot
   * Planned and another still in Work in Progress is listed under both, and opened there shows only
   * the shoots at that status (`shootsInTab`). A status set on the project by hand keeps it whole.
   */
  const belongsToTab = useCallback((project, tab) => {
    if (tab === "All") return true;
    // The next date is the earliest still pending, so it is due exactly when any of them is.
    if (tab === "Follow-up") return followupDue(project.nextFollowupDate);
    return projectTabStatuses(project.shoots).includes(tab);
  }, []);
  const tabCounts = useMemo(
    () => Object.fromEntries(tabs.map((tab) => [tab, projects.filter((project) => belongsToTab(project, tab)).length])),
    [belongsToTab, projects],
  );
  const boardRows = useMemo(() => boardCards(projects), [projects]);
  const tabProjects = useMemo(
    () => projects.filter((project) => belongsToTab(project, activeTab)).map((project) => ({ ...project, shoots: shootsInTab(project.shoots, activeTab) })),
    [activeTab, belongsToTab, projects],
  );

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) || null,
    [projects, selectedProjectId],
  );

  // The shoot to open straight away inside its project - a shoot row double-clicked under its project.
  const [openShootId, setOpenShootId] = useState(null);
  const openShoots = useCallback((project) => { setOpenShootId(null); setActiveProjectId(project.projectId); }, []);
  const openShoot = useCallback((shoot) => { setOpenShootId(shoot.shootRecordId); setActiveProjectId(shoot.projectId); }, []);
  /*
   * A shoot named in the address - the calendar's "Shoots · 6" pop-up links here with `?shoot=` - opens
   * its form as soon as its row has loaded, and the address lets it go.
   */
  /*
   * A project named in the address - a "Navigate to" from another board - filters the table to it,
   * and nothing is opened: arriving answers "here it is, on this board", and a panel would answer
   * a question nobody asked. The address lets it go once the row has been found.
   */
  const [linkedEventId, clearLinkedProject] = useLinkedProject({ tab: activeTab, onTab: setActiveTab });
  const [landedOn, setLandedOn] = useState("");
  useEffect(() => {
    if (!linkedEventId || landedOn === linkedEventId) return undefined;
    const timer = window.setTimeout(() => { setLandedOn(linkedEventId); clearLinkedProject(); }, 0);
    return () => window.clearTimeout(timer);
  }, [clearLinkedProject, landedOn, linkedEventId]);

  const [linkedShootId, clearLinkedShoot] = useLinkedParam("shoot");
  const linkedRow = linkedShootId ? shootRows.find((row) => row.shootRecordId === linkedShootId) : null;
  const [openedLink, setOpenedLink] = useState("");
  if (linkedRow && openedLink !== linkedShootId) {
    setOpenedLink(linkedShootId);
    openShoot(linkedRow);
  }
  useEffect(() => { if (openedLink && openedLink === linkedShootId) clearLinkedShoot(); }, [clearLinkedShoot, linkedShootId, openedLink]);

  /*
   * The project's overall Pre Production status, set by hand: one project from its row's ⋮ Update
   * status, or every ticked project with Update. Never a shoot. No Delete over the ticks - a project
   * is not deleted from here.
   */
  const [statusFor, setStatusFor] = useState(null);
  const bulk = useTableSelection({
    prefix: "/api/project-management/pre-production",
    rows: tabProjects,
    rowId: (row) => row.projectId,
    // A shoot row under its project takes no tick: the status set here is the project's.
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
      const response = await setPreProductionProjectStatus(statusFor.ids, change);
      const { updated = 0, refused = 0, missing = 0 } = response?.data || {};
      const left = refused + missing;
      showSuccess([
        `${updated} project${updated === 1 ? "" : "s"} updated.`,
        left ? `${left} ${left === 1 ? "was" : "were"} left alone: only its Pre Production Coordinator, or someone who works every project, can change it.` : "",
      ].filter(Boolean).join(" "));
      if (statusFor.bulk) bulk.clear();
      setStatusFor(null);
      await loadRows({ notifyOnError: false });
    } catch (error) {
      showError(error.message || "Unable to update the project status.");
    }
  }

  // A project row's ⋮, for the table and for a Board card - each card is one of these projects.
  const projectActions = useCallback((project) => [
    { label: canWrite ? "Edit" : "View", onSelect: () => openShoots(project) },
    ...(canWrite ? [{ label: "Update status", onSelect: () => setStatusFor({ ids: [project.projectId], count: 1, title: `Update status - ${project.eventId}` }) }] : []),
    // The same project on the other boards, where this viewer may open one and the project
    // is actually there (`lib/boardJumps.mjs`).
    ...boardJumpItems({ from: "pre-production", boards: project.boards, eventId: project.eventId, can: hasPermission, onJump: jumpTo }),
  ], [canWrite, openShoots, hasPermission, jumpTo]);

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
        ? <OptionsMenu ariaLabel={`Actions for ${row.original.shootId}`} items={[{ label: canWrite ? "Edit" : "View", onSelect: () => openShoot(row.original) }]} />
        : <OptionsMenu ariaLabel={`Actions for ${row.original.eventId}`} items={projectActions(row.original)} />)
      // Only the follow-up date is coloured, and only when one of the project's open shoots has
      // actually gone past it: an overdue chase is the one thing here somebody must act on today.
      : column.id === "nextFollowupDate"
        ? ({ row }) => <span className={isOverdue(row.original) ? "font-semibold text-rose-600" : undefined}>{displayValue(row.original, column)}</span>
        : ({ row }) => displayValue(row.original, column),
    exportValue: (row) => displayValue(row, column),
    width: column.id === "actions" ? 56 : 180,
    minWidth: column.id === "actions" ? 56 : 160,
  })), [canWrite, openShoot, projectActions]);

  /*
   * The saved shoot replaces itself in the flat rows; the project aggregates and the cards recompute
   * from there, so the board updates without a reload losing anyone's place.
   */
  const applySavedRow = useCallback((saved) => setRows((current) => current.map((row) => (row.id === saved.id ? saved : row))), []);

  /*
   * The follow-ups are the project's, so every one of its shoot rows carries the list the server
   * answers with — which keeps the board's columns and the panel beside the cards telling the same
   * story without a reload.
   */
  const applyFollowups = useCallback((summary) => {
    if (!summary?.projectId) return;
    const { projectId, ...followups } = summary;
    setRows((current) => current.map((row) => (row.projectId === projectId ? { ...row, ...followups } : row)));
  }, []);

  const activeProjectRows = useMemo(
    () => (activeProjectId ? shootRows.filter((row) => row.projectId === activeProjectId) : []),
    [activeProjectId, shootRows],
  );

  const importConfigs = canWrite && canCreateBookings ? rule.imports.map((vertical) => ({
    prefix: `/api/project-management/pre-production/vertical/${vertical}`,
    columns: preProductionImportColumns(vertical),
    hints: PRE_PRODUCTION_IMPORT_HINTS,
    replaceOption: administersBranches || worksEveryProject ? {
      label: "Replace projects that already exist",
      description: "Without this, a project in the app with the same client name is kept and given the sheet's IDs: the project is filled in where it is empty, and its shoots are updated from the sheet. With it, that project is deleted, with all its shoots and details, and the file's booking imported instead - except one with payments or an Image Selection gallery, which is kept and filled in the same way. You see the list before anything is deleted.",
    } : null,
    // Offered to everyone who may import: it deletes nothing and changes no rule, it only keeps a row
    // the old sheet got wrong instead of throwing the row away for one cell.
    lenientOption: {
      label: "Import rows with errors",
      description: "A cell the import cannot read - a date written as a place, a number with letters in it - comes in empty and the row still imports, instead of the whole row being skipped. Event ID, Client Name, Branch, Shoot ID and Shoot Name still need a value. The summary lists which columns came in empty, by row.",
    },
    // Undoes a delete, so it is offered to the same people Replace is; the server asks the delete rule
    // of each project again.
    restoreOption: administersBranches || worksEveryProject ? {
      label: "Restore deleted projects and shoots",
      description: "A project or shoot deleted in the app that a row names again is brought back and updated from the file - same IDs, no duplicates. One that had a gallery, a client login, client storage or post production is skipped and listed.",
    } : null,
    templateName: `pre-production-${IMPORT_VERTICAL_NAMES[vertical].toLowerCase().replace(/\s+/g, "-")}-import-template`,
    title: `Import ${IMPORT_VERTICAL_NAMES[vertical]} Pre Production`,
    menuLabel: rule.imports.length > 1 ? `Import ${IMPORT_VERTICAL_NAMES[vertical]}` : "Import",
    onImported: () => loadRows({ notifyOnError: false }),
  })) : [];

  const [layout, setLayout] = useTableBoardLayout(`pre-production-${moduleKey}`);
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

  const selectRow = (project) => { setSelectedProjectId(project.id); setInfoPanelState("expanded"); };
  const updatedText = lastUpdated ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(lastUpdated) : "—";

  return <section className="flex h-full min-h-0 w-full min-w-0 flex-col">
    <ModulePageHeader
      title={rule.title}
      // The Board stands every project under its status, so the status tabs step aside while it shows.
      tabs={onBoard ? undefined : tabs.map((tab) => ({ id: tab, label: tab, count: tabCounts[tab] || 0 }))}
      tabValue={activeTab}
      onTabChange={setActiveTab}
      tabsAriaLabel={`${rule.title} project status filters`}
      actions={<TableBoardSwitch value={layout} onChange={setLayout} />}
      menu={<ImportMenuButton ariaLabel="More pre production actions" importConfigs={importConfigs} />}
    />
    <FloatingNotice notice={notice} onClose={clearNotice} />
    {scopeUnavailable && <p className="mx-3 mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 sm:mx-4 sm:text-sm">
      No projects are available because your account is not linked to an employee record. Ask an administrator to link your account.
    </p>}
    {onBoard ? <KanbanBoard
      rows={boardRows}
      columns={BOARD_COLUMNS}
      statusOf={boardStatusOf}
      // How many shoots each column holds, and the nearest still to come.
      columnAmount={money ? (rows) => moneyColumn(rows, money) : (rows) => columnShoots(rows)}
      cardFlag={money ? (row) => moneyFlag(row, money) : undefined}
      card={BOARD_CARD}
      onOpen={openShoots}
      // The card's ⋮ is the project row's ⋮: a card is that project, at one of its statuses.
      cardActions={projectActions}
      canDropAt={canDropAt}
      onDrop={dropProject}
      loading={loading}
      noun="projects"
      ariaLabel={`${rule.title} board`}
    /> : <div className="min-h-0 flex-1">
      <DataTableShell className="h-full min-h-0" footer={<TableFooter spread><span>Last updated: {updatedText}</span><span>Total rows: {tableStats.total}</span></TableFooter>}>
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <DataTable
            key={activeTab}
            columns={tableColumns}
            data={tabProjects}
            density={density}
            onToggleCompact={toggleCompact}
            loading={loading}
            loadingMessage="Loading pre production projects..."
            emptyMessage="No pre production projects found."
            noMatchMessage="No matching projects found."
            selectedRowId={selectedProjectId}
            filterPreset={landedOn ? { id: "eventId", value: landedOn } : undefined}
            // A shoot row reads its project in the Info panel, and opens straight to itself.
            onRowClick={(row) => selectRow(isShootRow(row) ? { id: row.projectId } : row)}
            onRowDoubleClick={(row) => (isShootRow(row) ? openShoot(row) : openShoots(row))}
            onVisibleRowsChange={setTableStats}
            ariaLabel={`${rule.title} table`}
            features={{
              filtering: true,
              sorting: true,
              columnVisibility: true,
              infiniteScroll: { pageSize: 50 },
              selection,
              // ▸ on a project row shows its shoots under it.
              expandable: { label: "this project's shoots", canExpand: (row) => !isShootRow(row) && row.shoots?.length > 0, getSubRows: (row) => (isShootRow(row) ? undefined : row.shoots) },
              csvExport: { enabled: true, fileName: rule.fileName, onResult: (exported) => (exported ? showSuccess("Pre production CSV export downloaded.") : showNotice("No rows available to export.")) },
            }}
          />
          <DataTableInfoPanel
            title="Pre Production Project Details"
            entity={selectedProject}
            state={infoPanelState}
            onToggle={() => setInfoPanelState((current) => (current === "expanded" ? "collapsed" : "expanded"))}
            sections={preProductionProjectInfoSections}
            formatters={preProductionInfoFormatters}
            emptyText="Select a project row to view details."
          />
        </div>
      </DataTableShell>
    </div>}
    {activeProjectId && activeProjectRows.length > 0 && <PreProductionProjectEditor
      key={`${activeProjectId}-${openShootId || "cards"}`}
      rows={activeProjectRows}
      openShootId={openShootId}
      employees={options.employees || []}
      branches={options.branches || []}
      canWrite={canWrite}
      onClose={() => setActiveProjectId(null)}
      onRowSaved={applySavedRow}
      onFollowups={applyFollowups}
      onReload={() => loadRows({ notifyOnError: false })}
      onSuccess={showSuccess}
      onError={showError}
    />}
    {statusFor && <DepartmentStatusDialog department="preProduction" title={statusFor.title} count={statusFor.count} bulk={Boolean(statusFor.bulk)} initialStatus={statusFor.status} onSave={saveProjectStatus} onClose={() => setStatusFor(null)} />}
  </section>;
}
