"use client";

import { useEffect, useMemo, useState } from "react";
import RefreshRounded from "@mui/icons-material/RefreshRounded";
import SimpleTable from "@/components/data-table/SimpleTable";
import DashboardCard, { CardState } from "@/components/shared/DashboardCard";
import Button from "@/components/shared/Button";
import DateField from "@/components/shared/DateField";
import Dropdown from "@/components/shared/Dropdown";
import IconButton from "@/components/shared/IconButton";
import MultiSelectField from "@/components/shared/MultiSelectField";
import SummaryCard from "@/components/shared/SummaryCard";
import useBranchRegistry from "@/components/shared/useBranchRegistry";
import { branchLabel } from "@/lib/branchName";
import { defaultRange, hasOverviewFilters, isoDay, readableDay, sameRange } from "@/lib/attendanceOverviewRange.mjs";
import { getAttendanceOverview } from "@/services/hrm/attendance.service";
import { getEmployeeDirectory } from "@/services/hrm/employees.service";
import { getMasterData } from "@/services/hrm/master-data.service";
import AdminAttendanceEmployees from "./AdminAttendanceEmployees";
import AdminTimeOffCards from "./AdminTimeOffCards";

/**
 * HRM → Employee Attendance → **Dashboard**, the administrator's.
 *
 * An administrator does not mark their own day - no Login, no Break In, no leave to raise - so the
 * Self Dashboard everybody else opens on was, for them, a card of figures about attendance they
 * never marked. This is what that tab shows them instead: every employee's attendance, over any
 * range, past ones included.
 *
 * Two screens are its model, one for each half:
 *
 * - **The filters are Sales → Reports & Analytics'**: From and To, the people as a searchable
 *   multi-select, and a branch, then Apply - with Reset beside it and a line saying what the figures
 *   on screen were actually built from, which is not always what the bar holds.
 * - **The figures are Image Selection's dashboard**: headline cards with an arrow against the period
 *   before, pressing one narrows the table under them, and the panels read on their own below.
 *
 * Every figure comes from `GET /api/hrm/attendance/overview`, which judges each day with the same
 * rules the register and the summary use - so a count here and the register's card for a day inside
 * the range cannot disagree.
 */

/*
 * The headline cards, in the order an administrator reads them: who was in, who was not, then the
 * ways a day can go wrong. Each is a key on the response's `totals` and `trend`, and pressing one
 * narrows the Employees table to the people it counted.
 */
// `worse`: a rise is bad news, so its arrow is red rather than green. On Leave and Permission are
// neither - both are approved time off, not a fault.
//
// **Permission** is its own card beside Absent for the reason the studio asked for it: somebody with
// an approved hour or two off is read against Absent on the day their session is short, and a reader
// looking at that figure could not tell the two apart. The card counts the days a permission was
// taken and, pressed, lists exactly those people.
const CARDS = [
  { key: "present", label: "Present" },
  { key: "absent", label: "Absent", worse: true },
  { key: "permission", label: "Permission" },
  { key: "onLeave", label: "On Leave" },
  { key: "late", label: "Late", worse: true },
  { key: "halfDay", label: "Half Day", worse: true },
  { key: "earlyExit", label: "Early Exit", worse: true },
];
const cardLabel = (key) => CARDS.find((card) => card.key === key)?.label || "";

const count = (value) => Number(value || 0).toLocaleString("en-IN");
const days = (value) => (Number(value) === 1 ? "day" : "days");
const employees = (value) => `${count(value)} ${Number(value) === 1 ? "employee" : "employees"}`;

/*
 * Day by day: headed columns, so the colour beside each figure only reinforces what the heading
 * says. A holiday or a weekly off says so under its date and shows a dash for each figure, rather
 * than a row of noughts that reads the same as a working day nobody was recorded on.
 */
const offDay = (day) => day.dayKind && day.dayKind !== "Working";
// Somebody can still work a Sunday or a holiday: the dash stands in only for a day off with nothing on it.
const emptyOffDay = (day) => offDay(day) && !day.present && !day.absent && !day.onLeave && !day.late;
const figure = (key) => (day) => (emptyOffDay(day) ? "—" : count(day[key]));
const DAY_COLUMNS = [
  { key: "date", label: "Date", cellClassName: "text-slate-700", render: (day) => <>
    {readableDay(day.date)}
    {offDay(day) && <span className="ml-2 text-[11px] text-slate-500">{day.dayKind}</span>}
  </> },
  { key: "present", label: "Present", headerClassName: "text-right", cellClassName: "text-right tabular-nums text-emerald-700", render: figure("present") },
  { key: "absent", label: "Absent", headerClassName: "text-right", cellClassName: "text-right tabular-nums text-red-700", render: figure("absent") },
  // Beside Absent, where the question "was that really a day missed?" is asked.
  { key: "permission", label: "Permission", headerClassName: "text-right", cellClassName: "text-right tabular-nums text-slate-700", render: figure("permission") },
  { key: "onLeave", label: "On Leave", headerClassName: "text-right", cellClassName: "text-right tabular-nums text-blue-700", render: figure("onLeave") },
  { key: "late", label: "Late", headerClassName: "text-right", cellClassName: "text-right tabular-nums text-amber-700", render: figure("late") },
];

const DEFAULT_FILTERS = () => ({ ...defaultRange(), branchId: "", employeeIds: [] });

export default function AdminAttendanceDashboard({ onError }) {
  const today = isoDay(new Date());
  const [draft, setDraft] = useState(DEFAULT_FILTERS);
  const [applied, setApplied] = useState(DEFAULT_FILTERS);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Which card is pressed - what the Employees table is narrowed to. Null is everybody.
  const [view, setView] = useState(null);
  const [branches, setBranches] = useState([]);
  const [people, setPeople] = useState([]);
  // Bumped when Settings → Organization → Branches saves, which re-reads the branch list below.
  const branchRegistryRevision = useBranchRegistry();

  useEffect(() => {
    let cancelled = false;
    getMasterData("branches", { active: true })
      .then((response) => { if (!cancelled) setBranches(Array.isArray(response?.data) ? response.data : []); })
      // A list that will not load leaves its filter at "all" rather than an error over figures that
      // are themselves fine.
      .catch(() => { if (!cancelled) setBranches([]); });
    return () => { cancelled = true; };
  }, [branchRegistryRevision]);

  useEffect(() => {
    let cancelled = false;
    // The working employees, by name and Employee ID - the people the picker offers.
    getEmployeeDirectory({ forAttendance: true })
      .then((response) => { if (!cancelled) setPeople(Array.isArray(response?.data) ? response.data : []); })
      .catch(() => { if (!cancelled) setPeople([]); });
    return () => { cancelled = true; };
  }, []);

  const [reloadToken, setReloadToken] = useState(0);
  const reload = () => setReloadToken((token) => token + 1);

  useEffect(() => {
    let cancelled = false;
    // Deferred a tick, this codebase's convention for a load started from an effect.
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      getAttendanceOverview(applied)
        .then((response) => { if (!cancelled) setData(response?.data || null); })
        .catch((requestError) => {
          if (cancelled) return;
          const message = requestError?.message || "Unable to load the attendance dashboard.";
          /*
           * The figures on hand go with the failure. They were built from the filters before these,
           * and left on screen under a line naming the new ones they would claim an answer that was
           * never given - so the page says it failed, with Try again, instead.
           */
          setData(null);
          setError(message);
          onError?.(message);
        })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [applied, reloadToken, onError]);

  const set = (patch) => setDraft((current) => ({ ...current, ...patch }));

  const apply = () => { setView(null); setApplied({ ...draft }); };
  const reset = () => {
    const cleared = DEFAULT_FILTERS();
    setDraft(cleared);
    setView(null);
    setApplied(cleared);
  };

  const backwards = Boolean(draft.from && draft.to && draft.from > draft.to);
  const dirty = !sameRange(draft, applied);

  const employeeOptions = useMemo(() => people.map((person) => ({
    value: String(person.id),
    label: person.employeeId ? `${person.employeeName} (${person.employeeId})` : person.employeeName,
  })), [people]);
  const branchNameOf = (id) => branches.find((branch) => String(branch.id) === String(id))?.name;

  /*
   * What the figures on screen were actually built from - the applied filters, not the bar, which
   * may be holding an edit that has not been applied yet.
   */
  const range = data?.range;
  // From `applied` alone, never from the response: while a new range loads, the response on hand
  // is still the old one, and this line would name dates that were just replaced.
  const appliedSummary = [
    `${readableDay(applied.from)} to ${readableDay(applied.to)}`,
    applied.employeeIds?.length ? employees(applied.employeeIds.length) : "All employees",
    applied.branchId ? branchLabel(branchNameOf(applied.branchId)) || "One branch" : "All branches",
  ].join(" · ");

  // The one line over the cards that says what they are measured against.
  const totals = data?.totals;
  const previous = data?.previousRange;
  const compareLabel = range ? `previous ${range.days} ${days(range.days)}` : null;
  const caption = [
    range ? `${count(range.workingDays)} working ${days(range.workingDays)}` : null,
    data?.headcount != null ? employees(data.headcount) : null,
    totals?.attendanceRate != null ? `${totals.attendanceRate}% attended` : null,
    previous ? `Arrows compare with ${readableDay(previous.from)} to ${readableDay(previous.to)}` : null,
  ].filter(Boolean).join(" · ");

  // Nothing recorded at all is not the same as a perfect range - without this both read as zeros.
  const nothingRecorded = !loading && Boolean(totals) && !CARDS.some((card) => Number(totals[card.key] || 0) > 0);
  const twoColumns = "grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]";

  return <div className="dashboard-canvas min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
    {/*
      * The filters - the Reports & Analytics row. Controls of one height in one grid, so it is even
      * at every width: one to a row on a phone, where a date needs the width.
      */}
    <section aria-label="Dashboard filters" className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      {/* Four controls: two to a row on a tablet, all four in one row on a laptop. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {/* The range is the two dates alone. Neither end can be set past the other, or past today. */}
        <DateField label="From" required helperText="The first day the dashboard figures count from." value={draft.from} maxDate={draft.to || today} error={!draft.from ? "Choose a start date." : ""} onChange={(value) => set({ from: value })} />
        <DateField label="To" required helperText="The last day the dashboard figures count up to." value={draft.to} minDate={draft.from || ""} maxDate={today} error={!draft.to ? "Choose an end date." : backwards ? "To must be on or after From." : ""} onChange={(value) => set({ to: value })} />
        {/*
          * Several people, not one - the Reports & Analytics filter. Nothing chosen reads "All
          * employees", which is also what an empty filter means, so there is no "" row to pick.
          */}
        <MultiSelectField
          label="Employee"
          helperText="Show only these people's attendance; leave empty for everyone."
          values={draft.employeeIds}
          onChange={(value) => set({ employeeIds: value })}
          options={employeeOptions}
          placeholder="All employees"
          searchable
        />
        <Dropdown
          label="Branch"
          helperText="Show only staff of this branch, or all branches."
          ariaLabel="Branch"
          options={[{ value: "", label: "All branches" }, ...branches.map((branch) => ({ value: String(branch.id), label: branchLabel(branch.name) || branch.name }))]}
          value={draft.branchId}
          onChange={(value) => set({ branchId: value })}
          placeholder="All branches"
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        {/* What the figures below were built from - and, when the bar holds an edit not yet asked
            for, that it does, so the two are never mistaken for each other. */}
        <p className="min-w-0 text-xs text-slate-500">
          Showing: {appliedSummary}
          {dirty && <span className="ml-2 text-amber-700">Filters changed - press Apply</span>}
        </p>
        <div className="flex items-center gap-2">
          {/* The default sizes, not `sm`: 40px is the smallest a thumb can be trusted to hit. */}
          <IconButton label="Refresh dashboard" onClick={reload} disabled={loading}>
            <RefreshRounded fontSize="small" aria-hidden="true" className={loading ? "animate-spin" : ""} />
          </IconButton>
          <Button type="button" onClick={reset} disabled={loading || (!hasOverviewFilters(applied) && !dirty && sameRange(applied, DEFAULT_FILTERS()))}>Reset</Button>
          <Button type="button" variant="primary" onClick={apply} disabled={loading || !dirty || backwards || !draft.from || !draft.to}>Apply</Button>
        </div>
      </div>
    </section>

    {/*
      * What a screen reader is told when the figures change: one line, not the whole page. A live
      * region round the cards and the table read all of it out on every Apply.
      */}
    <p role="status" className="sr-only">
      {loading ? "Loading attendance" : data ? `Attendance updated: ${appliedSummary}, ${employees(data.headcount)}` : ""}
    </p>
    <div aria-busy={loading} className="mt-3">
      {error && !data
        ? <CardState error={error} onRetry={reload} />
        : <>
          {/* What the cards are measured against, the way Image Selection says it over its own. */}
          {/* Held back while a new range loads - it describes the response on hand, which is then the old one. */}
          <p className="mb-3 min-h-4 min-w-0 text-[11px] text-slate-500">{loading ? "Loading…" : caption}</p>

          {nothingRecorded
            ? <section className="flex min-h-40 items-center justify-center rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="max-w-md text-center">
                <h2 className="text-base font-semibold text-slate-800">No attendance recorded</h2>
                <p className="mt-1 text-xs text-slate-500">Nobody was marked present, absent or on leave from {readableDay(range?.from)} to {readableDay(range?.to)}. Try a wider range{hasOverviewFilters(applied) ? ", or clear the employee and branch filters" : ""}.</p>
                {/* The way out, where the advice above is to take the filters off. */}
                {hasOverviewFilters(applied) && <Button type="button" className="mt-4" onClick={reset}>Reset filters</Button>}
              </div>
            </section>
            : <>
              {/* Seven cards that always fill their rows: two to a row on a phone, three on a
                  tablet, four from `lg`, and all seven in one row on a wide screen.
                  `xl:grid-cols-7`, counted to the cards rather than left at six: with six columns
                  the seventh sat alone on a row of its own, which reads as a card that belongs to
                  something else. The `lg` step is there so the break before that is 4 + 3 rather
                  than 3 + 3 + 1. */}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
                {CARDS.map((card) => {
                  const pressed = view === card.key;
                  const value = totals?.[card.key];
                  const trend = data?.trend?.[card.key];
                  return <SummaryCard
                    key={card.key}
                    label={card.label}
                    value={count(value)}
                    trend={trend}
                    phrase={compareLabel}
                    trendTitle={trend && previous ? `${count(trend.before)} ${days(trend.before)} from ${readableDay(previous.from)} to ${readableDay(previous.to)}` : undefined}
                    higherIsWorse={Boolean(card.worse)}
                    compareLabel={compareLabel}
                    loading={loading}
                    pressed={pressed}
                    // Pressing a card keeps it: a second press, or a double press, does not let go - only another
                    // card moves the filter, and the chip by the table's heading clears it.
                    onClick={() => setView(card.key)}
                  />;
                })}
              </div>

              {/* Directly under the cards, because narrowing it is what a card does. */}
              <div className="mt-3">
                <AdminAttendanceEmployees
                  rows={data?.employees || []}
                  view={view}
                  viewLabel={cardLabel(view)}
                  onClearView={() => setView(null)}
                  loading={loading}
                  error={!data ? error : ""}
                  onRetry={reload}
                />
              </div>

              {/* Read on their own, and not narrowed by the cards. */}
              <div className={`mt-3 ${twoColumns}`}>
                <DashboardCard title="Day by Day" note="Most recent first · the Attendance Register has any one day in full">
                  <CardState loading={loading} error={!data ? error : ""} onRetry={reload} empty={!data?.byDay?.length} emptyMessage="No days in this range." rows={5}>
                    <SimpleTable
                      variant="plain"
                      ariaLabel="Attendance day by day"
                      classNames={{ wrapper: "max-h-72 overflow-y-auto", table: "w-full text-left text-xs", td: "px-2 py-1.5 whitespace-nowrap" }}
                      rowKey={(day) => day.date}
                      columns={DAY_COLUMNS}
                      rows={[...(data?.byDay || [])].reverse()}
                      emptyMessage="No days in this range."
                    />
                  </CardState>
                </DashboardCard>

                <DashboardCard title="By Branch" note="Present and absent days over the range" bodyClassName="p-1.5">
                  <CardState loading={loading} error={!data ? error : ""} onRetry={reload} empty={!data?.byBranch?.length} emptyMessage="No branches in this range." rows={5}>
                    <dl className="divide-y divide-slate-100">
                      {(data?.byBranch || []).map((branch) => <div key={branch.branchId ?? "none"} className="flex items-baseline justify-between gap-3 px-2 py-1.5">
                        <dt className="min-w-0 truncate text-xs text-slate-600">{branchLabel(branch.branchName) || branch.branchName}</dt>
                        <dd className="shrink-0 text-right text-xs tabular-nums">
                          <span className="font-semibold text-emerald-700">{count(branch.present)} present</span>
                          <span className="ml-2 font-semibold text-red-700">{count(branch.absent)} absent</span>
                        </dd>
                      </div>)}
                    </dl>
                  </CardState>
                </DashboardCard>
              </div>

              {/* Who used Casual Leave, permissions and comp-offs over the range - read on their own too. */}
              <div className="mt-3">
                <AdminTimeOffCards timeOff={data?.timeOff} loading={loading} error={!data ? error : ""} onRetry={reload} />
              </div>
            </>}
        </>}
    </div>
  </div>;
}
