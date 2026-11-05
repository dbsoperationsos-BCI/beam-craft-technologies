"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AddRounded from "@mui/icons-material/AddRounded";
import RemoveRounded from "@mui/icons-material/RemoveRounded";
import { useRouter } from "next/navigation";
import { usePermissions, useRouteAccess } from "@/components/auth/PermissionsProvider";
import { boardJumpItems } from "@/lib/boardJumps.mjs";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import Button from "@/components/shared/Button";
import Dialog from "@/components/ui/Dialog";
import ControlGroup from "@/components/shared/ControlGroup";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import IconButton from "@/components/shared/IconButton";
import Loader from "@/components/shared/Loader";
import MultiSelectField from "@/components/shared/MultiSelectField";
import useStickyTab from "@/components/shared/useStickyTab";
import ProductionScheduleView, { SCHEDULE_COLUMNS } from "@/components/project-management/production/ProductionScheduleView";
import DataTableMoreMenu from "@/components/data-table/DataTableMoreMenu";
import ManageColumnsDialog from "@/components/data-table/ManageColumnsDialog";
import { usePreference } from "@/components/preferences/PreferencesProvider";
import useCompactView from "@/components/shared/useCompactView";
import ProductionShootPanel from "@/components/project-management/production/ProductionShootPanel";
import ProductionViewSwitch from "@/components/project-management/production/ProductionViewSwitch";
import ShootDateRangeFilter, { ALL_DATES, UNKNOWN_DATE, UPCOMING, useShootDateRange } from "@/components/project-management/shoot-board/ShootDateRangeFilter";
import { boardForViewer, productionProjects } from "@/lib/productionBoard.mjs";
import { productionPlanOptions } from "@/lib/productionPlan.mjs";
import { DEFAULT_SCHEDULE_ZOOM, SCHEDULE_ZOOMS, scheduleProjectOptions, scheduleRows, scheduleShoots, seatPayload, seatValue, swapInRows, doubledBySwap, nearestShootTo, zoomBy, teamAbove, EMPTY_SCHEDULE_FILTERS, filterScheduleShoots, scheduleFilterOptions, scheduleFiltersSet } from "@/lib/productionSchedule.mjs";
import { dayKey, rangeLabel, shortDate } from "@/lib/shootBoard.mjs";
import { copyProductionTeam, getProductionOptions, getProductionShoot, getProductionShoots, saveProductionPlan, saveProductionSeat, swapProductionSeats } from "@/services/project-management/production.service";

/**
 * Project Management → Production, Schedule view: the studio's production schedule sheet - Production's
 * view beside the Table and Board, switched at the header's right end (`ProductionViewSwitch`), at
 * /project-management/production/schedule, so it answers to the board's own `PROJECT / Production`
 * permission. Every project's shoots in date order, each with who works every service booked on it -
 * read from the same endpoint as the Table, and showing the viewer the same shoots (`boardForViewer`).
 *
 * **Who works a service is changed in place** - by a viewer who may write Production, on a shoot whose
 * plan they may change (`canEditPlan`, the Production Manager's): each choice saved at once through
 * the seat save, which keeps the rest of the plan as it is and holds the plan's own rules - or by
 * dragging a person onto another service, which swaps the two (`swapProductionSeats`). Somebody
 * already on another shoot at that time is refused with a dialog naming that shoot, its project and
 * the service, so the studio changes that one first.
 *
 * **Filters**, as the Shoot Board's: Dates - **All dates** by default, every project's shoots; or a
 * preset looking ahead, or Custom From / To, a pair used only once it is a valid range - and Projects
 * among the shoots in the range. It **opens on today** - today's shoot, else the next, else the latest
 * (`nearestShootTo`) - and Today brings it back after scrolling away. **Zoom** draws the blocks smaller to
 * see more of the schedule at once, or larger to read it; the level is remembered on this device.
 * A shoot's name opens its production panel, at the viewer's level.
 */
// Three choices are all the schedule needs: every project's shoots (the default), every shoot from today
// on, or the next 30 days.
// Unknown date: the shoots with no date yet, which no span of days would show.
const SCHEDULE_DATE_PRESETS = [{ value: ALL_DATES, label: "All dates" }, UPCOMING, { value: "next30", label: "Next 30 days" }, UNKNOWN_DATE];

// How much smaller Compact view draws the sheet than its Zoom.
const COMPACT_SCALE = 0.85;
// The boards a shoot's ⋮ navigates to from the schedule.
const SCHEDULE_JUMP_BOARDS = ["projects", "pre-production", "production"];
// What Manage Columns' reset goes back to: the shoot's own four shown, the optional ones hidden.
const DEFAULT_SHOWN = Object.fromEntries(SCHEDULE_COLUMNS.map((column) => [column.id, !column.extra]));

export default function ProductionSchedulePage() {
  const { canWrite } = useRouteAccess();
  const { hasPermission } = usePermissions();
  const router = useRouter();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Opens on Upcoming: the days ahead are what the schedule is worked from, and a studio's whole history
  // is thousands of shoots to load and draw. All dates is still one choice away.
  const dates = useShootDateRange({ presets: SCHEDULE_DATE_PRESETS, defaultPreset: UPCOMING.value });
  const { range } = dates;
  const [projectFilter, setProjectFilter] = useState([]);
  // The box under each column (`filterScheduleShoots`): lists of what the shoots hold, a typed day, and
  // the Production plan's people - on a service or the Assist.
  const [quickFilters, setQuickFilters] = useState(EMPTY_SCHEDULE_FILTERS);
  const [zoom, setZoom] = useStickyTab("production-schedule-zoom", DEFAULT_SCHEDULE_ZOOM, SCHEDULE_ZOOMS);
  /*
   * The Table Options every table has: Freeze Columns, Manage Columns - which of the shoot's own
   * columns show, and the optional ones - and Compact view, the application's one density setting,
   * which draws the sheet a size smaller on top of the Zoom here.
   *
   * Kept per viewer as one table layout (`table:production-schedule`), the shape the server keeps
   * for every table: `columnVisibility` (both answers, so an optional column ticked on stays on),
   * `freezeCount` and `columnSizing` - the widths pulled on the header's grips, in the sheet's units.
   * The old `production-schedule:*` keys were never a shape the server accepts, so they lived only in
   * the browser they were set in.
   */
  const [layout, setLayout] = usePreference("table:production-schedule", {});
  const saved = useMemo(() => (layout && typeof layout === "object" ? layout : {}), [layout]);
  const updateLayout = useCallback((changes) => setLayout({ ...saved, ...changes }), [saved, setLayout]);
  const hiddenIds = useMemo(() => SCHEDULE_COLUMNS.filter((column) => !(saved.columnVisibility?.[column.id] ?? DEFAULT_SHOWN[column.id])).map((column) => column.id), [saved.columnVisibility]);
  // Freeze Columns: how many of the shown columns, counting the Shoot after them, stay at the left.
  const freezeCount = Number(saved.freezeCount) || 0;
  const [managingColumns, setManagingColumns] = useState(false);
  const { compact, toggleCompact } = useCompactView();
  const drawnZoom = compact ? Math.round(Number(zoom) * COMPACT_SCALE) : zoom;
  // Column widths pulled on the header's grips; `liveWidths` while one is being dragged.
  const savedWidths = useMemo(() => saved.columnSizing || {}, [saved]);
  const [liveWidths, setLiveWidths] = useState(null);
  const widths = liveWidths || savedWidths;
  const resizeColumn = useCallback((id, units, done) => {
    const next = { ...savedWidths, ...(liveWidths || {}), [id]: units };
    if (done) { updateLayout({ columnSizing: next }); setLiveWidths(null); } else setLiveWidths(next);
  }, [liveWidths, savedWidths, updateLayout]);
  // Reset Table Layout, as the tables offer it - only once something has been hidden, frozen or pulled.
  const customLayout = Object.keys(saved.columnVisibility || {}).length > 0 || freezeCount > 0 || Object.keys(savedWidths).length > 0;
  const resetLayout = useCallback(() => setLayout({}), [setLayout]);
  /*
   * Each shoot's ⋮: Navigate to Projects, Pre Production or Production for its project - the row
   * menu's own entry (`boardJumpItems`), so a board is offered only where the project is on it and the
   * viewer holds that board's permission. Production is offered too, though this is part of it: it
   * opens the Production table filtered to the project.
   */
  const jumpTo = useCallback((href) => router.push(href), [router]);
  const shootMenu = useCallback((shoot) => boardJumpItems({
    from: "schedule",
    boards: [...new Set([...(shoot.boards || []), "production"])].filter((key) => SCHEDULE_JUMP_BOARDS.includes(key)),
    eventId: shoot.eventId,
    can: hasPermission,
    onJump: jumpTo,
  }), [hasPermission, jumpTo]);
  const tableMenu = <DataTableMoreMenu ariaLabel="Schedule options" onFreezeColumnsChange={(count) => updateLayout({ freezeCount: count })} freezeCount={freezeCount} onManageColumns={() => setManagingColumns(true)} onResetColumnOrder={customLayout ? resetLayout : undefined} onToggleCompact={toggleCompact} compact={compact} />;
  const [openShootId, setOpenShootId] = useState(null);
  const loaded = useRef(false);
  // The people a service may be given - shooters and vendors - loaded only for a viewer who may write.
  const [people, setPeople] = useState([]);
  const [saving, setSaving] = useState("");
  const { notice, showSuccess, showError, clearNotice } = useNotice();

  /*
   * Only the days chosen are asked for (`window`) - the server narrows them, a day wider each side, and
   * `scheduleShoots` keeps the exact days. A newer request supersedes an older one still on its way, so
   * a quick change of dates never draws the range before it.
   */
  const window = useMemo(() => (!range ? null : range.undated ? { undated: true } : { from: dayKey(range.from), to: range.to ? dayKey(range.to) : undefined }), [range]);
  const latestLoad = useRef(0);
  /*
   * Who is out on another shoot at a shoot's time (`busyCrewEmployeeIds` on the shoot's own read, the
   * server's `availability.js`, by each shoot's own time), as `emp:<id>` picker values: asked when a
   * picker opens on that shoot, kept until the schedule reloads.
   */
  const busyAsked = useRef(new Map());
  const busyFor = useCallback((shootId) => {
    if (!busyAsked.current.has(shootId)) {
      busyAsked.current.set(shootId, getProductionShoot(shootId)
        .then((response) => new Set((response?.data?.busyCrewEmployeeIds || []).map((id) => `emp:${id}`)))
        // Not known is not busy: the server still refuses a clash on save.
        .catch(() => { busyAsked.current.delete(shootId); return new Set(); }));
    }
    return busyAsked.current.get(shootId);
  }, []);
  // `quiet`: a refresh behind a change already drawn, which does not dim the schedule while it runs.
  const load = useCallback(async ({ quiet = false } = {}) => {
    const ticket = ++latestLoad.current;
    busyAsked.current.clear();
    if (!quiet) setLoading(true);
    setError("");
    try {
      const response = await getProductionShoots(window);
      if (ticket !== latestLoad.current) return;
      setRows(Array.isArray(response?.data) ? response.data : []);
      loaded.current = true;
    } catch (loadError) {
      // A reload that fails over a schedule already on screen leaves it there and says so.
      const message = loadError.message || "Unable to load the production schedule.";
      if (loaded.current) showError(message);
      else setError(message);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [showError, window]);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);
  useEffect(() => {
    if (!canWrite) return undefined;
    let live = true;
    getProductionOptions()
      .then((response) => {
        if (!live) return;
        // As the shoot's form offers them: employees in the Technical department, then every active vendor.
        const { people: list = [] } = productionPlanOptions(response?.data || {});
        setPeople(list.filter((option) => String(option.value).startsWith("ven:") || option.shooter));
      })
      .catch((optionsError) => { if (live) showError(optionsError.message || "Unable to load the people to assign."); });
    return () => { live = false; };
  }, [canWrite, showError]);

  async function assignSeat(shoot, service, value) {
    const key = `${shoot.shootRecordId}:${service.definitionId}`;
    setSaving(key);
    try {
      await saveProductionSeat(shoot.shootRecordId, { serviceDefinitionId: service.definitionId, ...seatPayload(value) });
      showSuccess(`${service.name} on ${shoot.shootId} saved.`);
    } catch (saveError) {
      showError(saveError.message || "Unable to save the service's person.");
    } finally {
      await load();
      setSaving("");
    }
  }
  /*
   * A vendor's answer - Waiting or Confirmed - changed on the line under them: the seat saved with the
   * vendor already on it and the answer chosen, which `saveSeat` keeps for the vendor who is there.
   */
  async function saveVendorStatus(shoot, service, status) {
    const key = `${shoot.shootRecordId}:${service.definitionId}`;
    setSaving(key);
    try {
      await saveProductionSeat(shoot.shootRecordId, { serviceDefinitionId: service.definitionId, ...seatPayload(seatValue(service)), vendorStatus: status });
      showSuccess(`${service.person || "The vendor"} is ${status === "CONFIRMED" ? "Confirmed" : "Waiting"} for ${service.name} on ${shoot.shootId}.`);
    } catch (saveError) {
      showError(saveError.message || "Unable to change the vendor's status.");
    } finally {
      await load();
      setSaving("");
    }
  }
  /*
   * The shoot's Assist, picked on the sheet: the whole list sent as the plan's `team`, as the plan form
   * sends it, so the plan's own rules hold - the Production Manager's, a working employee or an active
   * vendor, and nobody newly added who is on another shoot at that time.
   */
  async function saveAssist(shoot, values) {
    const key = `${shoot.shootRecordId}:assist`;
    setSaving(key);
    try {
      await saveProductionPlan(shoot.shootRecordId, { team: [...new Set(values)].map(seatPayload).filter((entry) => entry.employeeId || entry.vendorId) });
      showSuccess(`Assist on ${shoot.shootId} saved.`);
    } catch (saveError) {
      showError(saveError.message || "Unable to save the Assist.");
    } finally {
      await load();
      setSaving("");
    }
  }
  // The drag: the service a person was picked up from, and the one the drag is over.
  const [dragging, setDragging] = useState(null);
  const [over, setOver] = useState(null);
  /*
   * A swap refused, said in a dialog rather than a passing notice - the drop needs an answer the
   * studio reads before going on - headed "This action is not possible": `message` says why, and,
   * where somebody already has a shoot at that time the viewer may see, that shoot, its project and
   * the service are listed under it.
   */
  const [clash, setClash] = useState(null);
  async function swapTo(target) {
    const from = dragging;
    setDragging(null);
    setOver(null);
    if (!from || from.key === target.key) return;
    const fromRef = { shootId: from.shootId, serviceDefinitionId: from.serviceDefinitionId };
    const toRef = { shootId: target.shootId, serviceDefinitionId: target.serviceDefinitionId };
    // One person works one service of a shoot: a drop that would break it is said, not drawn.
    const doubled = doubledBySwap(rows, fromRef, toRef);
    if (doubled) { setClash({ message: `${doubled} is already on another service of that shoot. One person works one service of a shoot.` }); return; }
    // Drawn at once; the server's answer then replaces it - or puts it back, if it refuses.
    setRows((current) => swapInRows(current, fromRef, toRef));
    try {
      const response = await swapProductionSeats(fromRef, toRef);
      showSuccess(response?.data?.message || "Swapped.");
    } catch (swapError) {
      const details = swapError.status === 409 ? swapError.data?.details : null;
      setClash(details?.shoot || details?.shootId
        ? { ...details, message: `${details.person} already has a shoot at that time. Change that shoot first, then swap.` }
        : { message: swapError.message || "Unable to swap the people." });
    } finally {
      await load({ quiet: true });
    }
  }
  // Each person's face by picker value, looked up once rather than searched for on every seat.
  const avatars = useMemo(() => new Map(people.filter((option) => option.avatar).map((option) => [option.value, option.avatar])), [people]);
  const assign = canWrite && people.length ? {
    people, busyFor, avatarOf: (value) => avatars.get(value), saving, canAssign: (shoot) => Boolean(shoot.canEditPlan), onAssign: assignSeat, onChangeVendorStatus: saveVendorStatus, onSaveAssist: saveAssist,
    dragging, over,
    onDragStart: setDragging,
    onDragEnd: () => { setDragging(null); setOver(null); },
    onDragOver: setOver,
    onDrop: swapTo,
  } : null;

  // The shoots the production board shows this viewer.
  const shoots = useMemo(() => boardForViewer(productionProjects(rows)).projects.flatMap((project) => project.shoots || []), [rows]);
  const inRange = useMemo(() => scheduleShoots(shoots, { range }), [range, shoots]);
  const projectOptions = useMemo(() => scheduleProjectOptions(inRange), [inRange]);
  // A project picked earlier that this range has no shoot for is set aside rather than emptying the page.
  const activeProjects = useMemo(() => projectFilter.filter((id) => projectOptions.some((option) => option.value === id)), [projectFilter, projectOptions]);
  const projectShoots = useMemo(() => scheduleShoots(shoots, { range, projectIds: activeProjects }), [activeProjects, range, shoots]);
  // A hidden column's box is not on screen, so it filters nothing.
  const activeQuick = useMemo(() => ({ ...quickFilters, ...Object.fromEntries(hiddenIds.map((id) => [id, EMPTY_SCHEDULE_FILTERS[id]])) }), [hiddenIds, quickFilters]);
  const quickOptions = useMemo(() => scheduleFilterOptions(projectShoots), [projectShoots]);
  const shownShoots = useMemo(() => filterScheduleShoots(projectShoots, activeQuick), [activeQuick, projectShoots]);
  const scheduleFilters = { values: activeQuick, options: quickOptions, onChange: (key, value) => setQuickFilters((current) => ({ ...current, [key]: value })) };
  const shown = shownShoots.length;
  const rowsShown = useMemo(() => scheduleRows(shownShoots), [shownShoots]);
  /*
   * Where the schedule stands: today's shoot, or the nearest. `at` is bumped by Today to go back to
   * it; it starts at 1 so the first load goes there too, and a refresh after a change - same `at` -
   * leaves the reader where they are.
   */
  const [focusAt, setFocusAt] = useState(1);
  const todayShoot = useMemo(() => nearestShootTo(rowsShown), [rowsShown]);
  /*
   * "Use the same team as above", on a shoot's ⋮ where the viewer may change its plan and the shoot of
   * the same project above it shares a service with somebody on it: those services take that shoot's
   * people, saved at once under the plan's rules; the others are left as they are. A refusal - somebody
   * busy at this shoot's time, or already on another of its services - is said in the dialog.
   */
  async function takeTeamAbove(shoot, above) {
    try {
      await copyProductionTeam(shoot.shootRecordId, above.shootRecordId);
      showSuccess(`${shoot.shootId} now has ${above.shootId}'s team on the services they share.`);
    } catch (copyError) {
      setClash({ message: copyError.message || "Unable to use that team." });
    } finally {
      await load({ quiet: true });
    }
  }
  const rowMenu = (shoot) => {
    const above = assign?.canAssign(shoot) ? teamAbove(rowsShown, shoot) : null;
    return [...(above ? [{ label: "Use the same team as above", onSelect: () => void takeTeamAbove(shoot, above) }] : []), ...shootMenu(shoot)];
  };
  const focus = useMemo(() => ({ id: todayShoot, at: focusAt }), [focusAt, todayShoot]);

  const filtered = dates.changed || activeProjects.length > 0 || scheduleFiltersSet(activeQuick);
  function clearFilters() {
    dates.reset();
    setProjectFilter([]);
    setQuickFilters(EMPTY_SCHEDULE_FILTERS);
  }

  return <section className="flex h-full min-h-0 w-full min-w-0 flex-col">
    <ModulePageHeader title="Production" actions={<ProductionViewSwitch />} />
    <FloatingNotice notice={notice} onClose={clearNotice} />

    <div className="flex min-h-0 flex-1 flex-col gap-3 pt-3 sm:pt-4 lg:pt-5">
      <div className="flex flex-col gap-2 px-3 sm:px-4 lg:flex-row lg:items-center lg:justify-between lg:gap-4 lg:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <ShootDateRangeFilter dates={dates} />
          <MultiSelectField hideLabel className="w-full sm:w-72" label="Projects" options={projectOptions} values={activeProjects} onChange={setProjectFilter} placeholder={projectOptions.length ? "All projects" : "No projects in this range"} searchable disabled={!projectOptions.length} />
          {filtered && <Button type="button" size="sm" className="min-h-9" onClick={clearFilters}>Clear</Button>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 lg:justify-end">
          <p className="text-sm text-slate-600">
            {!range ? "All dates" : range.undated ? "Unknown date" : range.to ? rangeLabel(range.from, range.to) : `From ${shortDate(range.from)} ${range.from.getFullYear()}`}: <span className="font-semibold text-slate-900">{shown}</span> shoot{shown === 1 ? "" : "s"}
          </p>
          <Button type="button" size="sm" className="min-h-9" disabled={!todayShoot} onClick={() => setFocusAt((at) => at + 1)}>Today</Button>
          <ControlGroup label="Zoom">
            <IconButton label="Zoom out" variant="plain" size="md" className="text-slate-600" disabled={zoom === SCHEDULE_ZOOMS[0]} onClick={() => setZoom(zoomBy(zoom, -1))}><RemoveRounded fontSize="small" /></IconButton>
            <span className="min-w-10 text-center text-xs tabular-nums text-slate-600" aria-live="polite">{zoom}%</span>
            <IconButton label="Zoom in" variant="plain" size="md" className="text-slate-600" disabled={zoom === SCHEDULE_ZOOMS.at(-1)} onClick={() => setZoom(zoomBy(zoom, 1))}><AddRounded fontSize="small" /></IconButton>
          </ControlGroup>
          {/* On a phone the sheet has no header row to carry it, so the menu sits here. */}
          <div className="md:hidden">{tableMenu}</div>
        </div>
      </div>

      {error
        ? <div className="flex flex-col items-start gap-2 px-3 text-sm text-red-600 sm:px-4 lg:px-5"><p role="alert">{error}</p><Button type="button" size="sm" onClick={() => void load()}>Retry</Button></div>
        : loading && rows.length === 0
          ? <Loader label="Loading production schedule..." className="py-10" />
          // Emptied only by the boxes under the columns, the sheet stays - those boxes are on it.
          : projectShoots.length === 0
            ? <p className="px-4 py-10 text-center text-sm text-slate-500">{filtered ? "No shoots match these filters." : "No production shoots in this range. A shoot appears here once its project has started and has a Production Manager."}</p>
            : <div className={`flex min-h-0 flex-1 flex-col border-t border-slate-200 transition-opacity ${loading ? "opacity-60" : ""}`}>
              <ProductionScheduleView shoots={rowsShown} focus={focus} zoom={drawnZoom} hiddenColumns={hiddenIds} widths={widths} freezeCount={freezeCount} onResize={resizeColumn} menu={tableMenu} rowMenu={rowMenu} filters={scheduleFilters} onOpenShoot={setOpenShootId} assign={assign} />
            </div>}
    </div>

    {/* Mounted only while open, as the tables mount it, so it opens on the columns as they stand. */}
    {managingColumns && <ManageColumnsDialog
      open
      columns={SCHEDULE_COLUMNS}
      visibility={Object.fromEntries(SCHEDULE_COLUMNS.map((column) => [column.id, !hiddenIds.includes(column.id)]))}
      defaultVisibility={DEFAULT_SHOWN}
      onClose={() => setManagingColumns(false)}
      onApply={(visibility) => updateLayout({ columnVisibility: Object.fromEntries(SCHEDULE_COLUMNS.map((column) => [column.id, visibility[column.id] !== false])) })}
    />}

    {clash && <Dialog
      title="This action is not possible"
      description={clash.message}
      onClose={() => setClash(null)}
      footer={<Button type="button" variant="primary" onClick={() => setClash(null)}>OK</Button>}
    >
      {(clash.shoot || clash.shootId) && <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-slate-500">Shoot</dt><dd className="text-slate-900">{[clash.shoot, clash.shootId && `(${clash.shootId})`].filter(Boolean).join(" ") || "—"}</dd>
        <dt className="text-slate-500">Project</dt><dd className="text-slate-900">{[clash.project, clash.eventId && clash.eventId !== clash.project && `(${clash.eventId})`].filter(Boolean).join(" ") || "—"}</dd>
        <dt className="text-slate-500">Service</dt><dd className="text-slate-900">{clash.service || "—"}</dd>
      </dl>}
    </Dialog>}
    {openShootId && <ProductionShootPanel
      shootId={openShootId}
      canWrite={canWrite}
      summary={rows.find((row) => row.shootRecordId === openShootId) || null}
      onClose={() => setOpenShootId(null)}
      onChanged={(message) => { if (message) showSuccess(message); void load(); }}
    />}
  </section>;
}
