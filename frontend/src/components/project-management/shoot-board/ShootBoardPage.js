"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useModuleAccess } from "@/components/auth/PermissionsProvider";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import Button from "@/components/shared/Button";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import Loader from "@/components/shared/Loader";
import MultiSelectField from "@/components/shared/MultiSelectField";
import ProductionShootPanel from "@/components/project-management/production/ProductionShootPanel";
import { addDays, dayKey, daysBetween, projectLegend, projectRows, rangeLabel } from "@/lib/shootBoard.mjs";
import { getShootBoard } from "@/services/project-management/shoot-board.service";
import ShootDateRangeFilter, { useShootDateRange } from "./ShootDateRangeFilter";
import ShootFreeShootersDialog from "./ShootFreeShootersDialog";
import ShootRunDialog from "./ShootRunDialog";
import ShootTimeline from "./ShootTimeline";

/**
 * Project Management → Shoot Board: a timeline of the shoots the viewer and their team are named on.
 * Projects run down the left, days across the top, and each project's shoots are bars along its row -
 * shoots on the same day or on days one after another joined into one bar. The timeline scrolls
 * sideways through the range, and the project column follows the days on screen.
 *
 * **Filters.** Dates: a preset looking ahead (Next 30 days by default) or Custom From / To up to 92
 * days - the range is what is loaded, and a custom pair is used only once it is a valid range, its
 * problem said on the field. Projects: the projects in the range; one picked earlier that is not in
 * the range is set aside rather than filtering silently, and comes back with a range that has it.
 * Branches: the same, over the branch each shoot's **project** belongs to - several at once, and a
 * shoot whose project has no branch linked is offered under **No branch**. Projects and Branches
 * narrow together. Clear returns all three to their defaults.
 *
 * Who is on it at all is the server's answer (`shoot-board/read.js`); the route is
 * `PROJECT / Shoot Board`. A shoot opens its production panel only where it has a production record
 * and the viewer holds `PROJECT / Production` - nothing is offered that would open onto a refusal.
 */
// What a shoot whose project has no branch linked is filtered under. A string, because the filter's
// values are strings and `null` is not something a picker can hold.
const NO_BRANCH = "none";

export default function ShootBoardPage() {
  const dates = useShootDateRange();
  const { range } = dates;
  const [projectFilter, setProjectFilter] = useState([]);
  const [branchFilter, setBranchFilter] = useState([]);
  const [board, setBoard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openRun, setOpenRun] = useState(null);
  // The day whose free shooters are open, from the count under its date.
  const [freeDay, setFreeDay] = useState(null);
  const [openShootId, setOpenShootId] = useState(null);
  const { notice, showSuccess, clearNotice } = useNotice();
  const production = useModuleAccess("PROJECT", "Production");

  const days = useMemo(() => Array.from({ length: daysBetween(range.from, range.to) + 1 }, (_, index) => addDays(range.from, index)), [range]);
  const todayKey = dayKey(new Date());

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await getShootBoard(dayKey(range.from), dayKey(range.to));
      setBoard(response?.data || { shoots: [] });
    } catch (loadError) {
      setError(loadError.message || "Unable to load the shoot board.");
    } finally {
      setLoading(false);
    }
  }, [range]);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);

  const shoots = useMemo(() => board?.shoots || [], [board]);
  const allProjects = useMemo(() => projectLegend(shoots), [shoots]);
  const projectOptions = useMemo(() => allProjects.map((project) => ({ value: project.projectId, label: project.eventId && project.eventId !== project.label ? `${project.label} · ${project.eventId}` : project.label })), [allProjects]);
  // Only the picked projects that are in this range filter it; the rest wait for a range that has them.
  const activeFilter = useMemo(() => projectFilter.filter((id) => allProjects.some((project) => project.projectId === id)), [allProjects, projectFilter]);
  /*
   * The branches with a shoot in this range, each once, in name order.
   *
   * A shoot's branch is its **project's** - the branch the booking belongs to, which is what "branch
   * wise" means on every other board - read by id with the name beside it, so two branches that were
   * once typed the same way are still two branches. A shoot whose project has none is offered under
   * **No branch** rather than being quietly unfilterable.
   */
  const branchOptions = useMemo(() => {
    const seen = new Map();
    for (const shoot of shoots) {
      const value = shoot.branchId ? String(shoot.branchId) : NO_BRANCH;
      if (!seen.has(value)) seen.set(value, { value, label: shoot.branch || "No branch" });
    }
    return [...seen.values()].sort((a, b) => (a.value === NO_BRANCH ? 1 : b.value === NO_BRANCH ? -1 : a.label.localeCompare(b.label)));
  }, [shoots]);
  // The same rule the projects filter follows: a branch picked earlier that this range has no shoot
  // for is set aside rather than emptying the board, and comes back with a range that has it.
  const activeBranches = useMemo(() => branchFilter.filter((value) => branchOptions.some((option) => option.value === value)), [branchFilter, branchOptions]);
  const shown = useMemo(() => shoots.filter((shoot) => {
    if (activeFilter.length && !activeFilter.includes(shoot.projectId)) return false;
    return !activeBranches.length || activeBranches.includes(shoot.branchId ? String(shoot.branchId) : NO_BRANCH);
  }), [activeBranches, activeFilter, shoots]);
  // Colours come from every project in the range, so filtering does not repaint the ones still shown.
  const rows = useMemo(() => {
    const colours = new Map(allProjects.map((project) => [project.projectId, project.colour]));
    return projectRows(shown, days).map((row) => ({ ...row, colour: colours.get(row.projectId) || row.colour }));
  }, [allProjects, days, shown]);

  const filtered = dates.changed || activeFilter.length > 0 || activeBranches.length > 0;
  function clearFilters() {
    dates.reset();
    setProjectFilter([]);
    setBranchFilter([]);
  }

  const canOpen = production.canRead;
  const openShoot = canOpen ? (shoot) => { setOpenRun(null); setOpenShootId(shoot.productionShootId); } : undefined;
  // Every bar opens its shoots as cards first - one shoot or several - and a card opens the shoot.
  const onOpenRun = (run, row) => setOpenRun({ run, row });

  return <section className="flex h-full min-h-0 w-full min-w-0 flex-col">
    <ModulePageHeader title="Shoot Board" />
    <FloatingNotice notice={notice} onClose={clearNotice} />

    {/* Padded at the top only: the rows above the timeline carry their own sides, and the timeline
        itself runs to the left, right and bottom edges. */}
    <div className="flex min-h-0 flex-1 flex-col gap-3 pt-3 sm:pt-4 lg:pt-5">
      {/*
        * The filters, straight under the title bar on one line - dates and projects at the left, what
        * they add up to at the right. From / To join them only while Custom is picked.
        */}
      <div className="flex flex-col gap-2 px-3 sm:px-4 lg:flex-row lg:items-center lg:justify-between lg:gap-4 lg:px-5">
        <div className="flex flex-wrap items-start gap-2">
          <ShootDateRangeFilter dates={dates} />
          <MultiSelectField hideLabel className="w-full sm:w-72" label="Projects" options={projectOptions} values={activeFilter} onChange={setProjectFilter} placeholder={projectOptions.length ? "All projects" : "No projects in this range"} searchable disabled={!projectOptions.length} />
          {/* Branch, beside Projects and read the same way: several at once, and what the range holds. */}
          <MultiSelectField hideLabel className="w-full sm:w-56" label="Branches" options={branchOptions} values={activeBranches} onChange={setBranchFilter} placeholder={branchOptions.length ? "All branches" : "No branches in this range"} searchable disabled={!branchOptions.length} />
          {filtered && <Button type="button" size="sm" className="min-h-9" onClick={clearFilters}>Clear</Button>}
        </div>
        <p className="shrink-0 text-sm text-slate-600">
          {rangeLabel(range.from, range.to)}:{" "}
          <span className="font-semibold text-slate-900">{shown.length}</span> shoot{shown.length === 1 ? "" : "s"} across{" "}
          <span className="font-semibold text-slate-900">{new Set(shown.map((shoot) => shoot.projectId)).size}</span> project{new Set(shown.map((shoot) => shoot.projectId)).size === 1 ? "" : "s"}
        </p>
      </div>

      {board?.unlinked && <p className="mx-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 sm:mx-4 sm:text-sm lg:mx-5">
        Your account is not linked to an employee record, so no shoots are named on you. Ask an administrator to link your account.
      </p>}

      {error
        ? <div className="flex flex-col items-start gap-2 px-3 text-sm text-red-600 sm:px-4 lg:px-5"><p role="alert">{error}</p><Button type="button" size="sm" onClick={() => void load()}>Retry</Button></div>
        : loading && !board
          ? <Loader label="Loading shoots..." className="py-10" />
          : <div className={`flex min-h-0 flex-1 flex-col transition-opacity ${loading ? "opacity-60" : ""}`}>
            {/*
              * `fitToSelection` whenever the board has been **narrowed to something** - by project
               * or by branch, since a branch is as much a selection as a project is and the reader
               * is asking the same question of it: when are these shooting. Unnarrowed, the board is
               * scanned date by date and neither the fitting nor the dotted marks belong.
              */}
            <ShootTimeline days={days} rows={rows} todayKey={todayKey} onOpenRun={onOpenRun} freeShooters={board?.freeShooters} onOpenFree={setFreeDay} fitToSelection={activeFilter.length > 0 || activeBranches.length > 0} />
          </div>}
    </div>

    {openRun && <ShootRunDialog project={openRun.row} run={openRun.run} onOpen={openShoot} onClose={() => setOpenRun(null)} />}
    {freeDay && <ShootFreeShootersDialog day={freeDay} shooters={board?.freeShooters?.[dayKey(freeDay)] || []} onClose={() => setFreeDay(null)} />}
    {openShootId && <ProductionShootPanel
      shootId={openShootId}
      canWrite={production.canWrite}
      onClose={() => { setOpenShootId(null); void load(); }}
      onChanged={(message) => { if (message) showSuccess(message); void load(); }}
    />}
  </section>;
}
