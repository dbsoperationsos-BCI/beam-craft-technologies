"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import DataTable from "@/components/data-table/DataTable";
import DataTableShell from "@/components/data-table/DataTableShell";
import TableFooter from "@/components/data-table/TableFooter";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import Button from "@/components/shared/Button";
import DateField from "@/components/shared/DateField";
import Dropdown from "@/components/shared/Dropdown";
import MultiSelectField from "@/components/shared/MultiSelectField";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import useCompactView from "@/components/shared/useCompactView";
import Tabs from "@/components/ui/Tabs";
import { getCrmReport, getReportOptions } from "@/services/sales/crm-reports.service";
import { REPORTS, reportById, EMPTY_FILTERS, hasFilters, filterSummary, describeRange, defaultRange, totalsSummary, ignoredNote, reportRowId, USAGE_REPORTS } from "@/lib/crmReports";

/**
 * CRM → Reports.
 *
 * Six views of the studio's own call log - what happened in a range, who did the calling, which
 * clients it was with, who never got through, who never picked up, and the calls themselves - and
 * three of how the staff use the system itself: the WhatsApp messages they send, the changes they
 * make to leads, and the hours they were at it.
 *
 * The last two are the same measured time asked two ways. Application Usage totals a person over
 * the whole range; Work Hours is the timesheet - a row per person per day, with the day's start,
 * finish, hours and idle time. One number each, or the shape of the fortnight.
 *
 * **Work Hours is the one report that joins the two halves of the studio**: its hours are the call
 * time Callyzer reports plus the time measured in the application. The browser cannot see a phone
 * call, so a salesperson on a forty-minute call used to read as forty minutes idle - which made a
 * timesheet that undercounted precisely the people it was read about. Both halves are shown beside
 * the total, and it is effort across two systems rather than wall clock: a call taken with the
 * application open counts in both, because both are true and nothing records which minutes
 * overlapped. Day Span is what stays wall clock.
 *
 * The two other usage tabs are about a different set of people and say so. A call report is about
 * the Callyzer employee who made the call - a phone; a usage report is about the ERP user who did
 * the work - a login. Those two lists are not joined, and the Employee filter offers whichever of
 * them the open tab is actually about, so picking a name always narrows the report rather than
 * emptying it. Work Hours is the exception and matches them on the name, which is the only key
 * there is: a Callyzer name with no login of that spelling shows call time and no application time,
 * and a login nobody has called from shows the reverse. Neither is lost, which is the honest way to
 * be wrong about a join with no key.
 *
 * Read from `sales_crm_call_log` rather than from Callyzer's own report API, which needs an
 * AccessKey the studio has not issued and answers "not configured" without one. Reading the calls
 * this server already stores means the reports work today, agree with the CRM's own screens because
 * they are the same rows, and can say things Callyzer cannot - which vertical a call belonged to,
 * and which lead it is against.
 *
 * The page reads top to bottom in the order the questions are asked: the range and the filters
 * first, then which report of them to see, then the report. The tabs sit between the two rather
 * than above the filters, because choosing a tab is choosing a view of what the filters selected -
 * above them it read as though each tab had filters of its own.
 *
 * Every report is a table, the Summary included. It had a row of figure cards above a table of its
 * own, which is two shapes for one answer - and the cards said "9 calls" while the table under them
 * said there were none. The totals live in the table's own footer now, beside the row count.
 */

export default function CrmReportsPage() {
  const [activeReport, setActiveReport] = useState(REPORTS[0].id);
  // What the filter bar holds, and what the report on screen was actually built from. They differ
  // while somebody is choosing, which is what Apply is for.
  const [draft, setDraft] = useState(() => ({ ...EMPTY_FILTERS, ...defaultRange() }));
  const [applied, setApplied] = useState(() => ({ ...EMPTY_FILTERS, ...defaultRange() }));
  const [options, setOptions] = useState({ employees: [], users: [], verticals: [], callTypes: [], durations: [] });
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tableStats, setTableStats] = useState({ total: 0, showing: 0 });

  const { notice, showError, clearNotice } = useNotice();
  const { density } = useCompactView();

  const definition = reportById(activeReport);

  /*
   * The filter options, once.
   *
   * The employee list comes from whoever has actually made a call - a fixed list would go stale the
   * day somebody joins, and would offer staff whose filter can only ever return nothing.
   */
  const loadOptions = useCallback(async () => {
    try {
      const response = await getReportOptions();
      setOptions((current) => ({ ...current, ...(response?.data || {}) }));
    } catch (error) {
      // The reports still work with an empty filter bar, so this is reported and not fatal.
      showError(error?.message || "Unable to load the report filters.");
    }
  }, [showError]);

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getCrmReport(activeReport, applied);
      setReport(response?.data || null);
    } catch (error) {
      setReport(null);
      showError(error?.message || "Unable to build that report.");
    } finally {
      setLoading(false);
    }
  }, [activeReport, applied, showError]);

  /*
   * Deferred a tick, which is this codebase's convention for a first load: a fetch started straight
   * from an effect body counts as state set during that effect, and React warns about the cascading
   * render it causes.
   */
  useEffect(() => {
    const timer = setTimeout(() => void loadOptions(), 0);
    return () => clearTimeout(timer);
  }, [loadOptions]);

  useEffect(() => {
    const timer = setTimeout(() => void loadReport(), 0);
    return () => clearTimeout(timer);
  }, [loadReport]);

  const rows = useMemo(() => report?.rows || [], [report]);
  const ignored = ignoredNote(report?.ignored || []);
  // Whichever list the open tab is about: the people who made calls, or the people who used the app.
  const usage = USAGE_REPORTS.has(activeReport);
  const people = usage ? options.users : options.employees;

  const columns = useMemo(() => definition.columns.map((column) => {
    const value = (row) => column.value(row);
    return {
      id: column.id,
      header: column.label,
      accessorFn: value,
      /*
       * Only when there is a renderer.
       *
       * `cell: undefined` is not "no opinion" here - the table spreads the column as given and then
       * only fills a cell in where one is missing, so an explicit `undefined` survives and
       * overwrites its default renderer. Every column without a `render` drew nothing at all:
       * Lead Analysis showed its call counts and left Client, Number, Vertical and the rest blank.
       */
      ...(column.render ? { cell: ({ row }) => column.render(row.original) } : {}),
      exportValue: value,
      sortable: column.sortable !== false,
      filterable: column.filterable !== false,
      // `fixed` keeps the menu column out of Manage Columns - it is furniture, not data.
      ...(column.fixed ? { fixed: true } : {}),
      width: column.width || 170,
      minWidth: column.minWidth || 140,
    };
  }), [definition]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(applied);
  const set = (patch) => setDraft((current) => ({ ...current, ...patch }));

  /*
   * Switching between a call report and a usage report changes which people the Employee filter is
   * about, so a name that means nothing on the tab being opened is dropped rather than carried
   * across. Left in place it would filter the new report to nothing, which reads as "this person
   * has never used WhatsApp" instead of "that is a name from the other list".
   */
  function changeReport(id) {
    const nextPeople = USAGE_REPORTS.has(id) ? options.users : options.employees;
    setActiveReport(id);
    /*
     * The names that still mean something on the tab being opened are kept; the rest are dropped.
     * It was all-or-nothing while the filter held one name - now a reader who had picked three
     * people, two of whom are on both lists, keeps those two rather than losing the filter.
     */
    const keep = (list) => (Array.isArray(list) ? list : []).filter((value) => nextPeople.some((option) => option.value === value));
    const nextDraft = keep(draft.employee);
    const nextApplied = keep(applied.employee);
    if (nextDraft.length === (draft.employee?.length || 0) && nextApplied.length === (applied.employee?.length || 0)) return;
    setDraft((current) => ({ ...current, employee: nextDraft }));
    setApplied((current) => ({ ...current, employee: nextApplied }));
  }

  function reset() {
    const cleared = { ...EMPTY_FILTERS, ...defaultRange() };
    setDraft(cleared);
    setApplied(cleared);
  }

  return <section className="flex h-full min-h-0 w-full min-w-0 flex-col">
    {/*
      The filters live in the header's own row, where a page's controls belong. No actions: the
      report reloads whenever a filter is applied or a tab is chosen, so a Refresh button was a
      second way to do what Apply already does.
    */}
    {/* The name the sidebar already gives this module. */}
    <ModulePageHeader title="Reports & Analytics">
      {/* Space above as well as below: the labels sat hard against the rule under the title, which
          is the one place in this header where a row has a line directly over it. */}
      <div className="w-full pb-3 pt-3">
        {/*
          Six controls of one size.

          They were two families - the filter row's short date box beside the taller form dropdown -
          which left the row a jumble of heights that did not line up with each other or with their
          labels. `DateField` and `Dropdown` draw the same wrapper, the same label and the same
          `min-h-9` control, so a grid of them is even at every width.
        */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <DateField label="From" value={draft.from} onChange={(value) => set({ from: value })} />
          <DateField label="To" value={draft.to} onChange={(value) => set({ to: value })} />
          {/*
            * **Several people, not one.** Reading a team's week meant running the report once per
            * name and adding it up by hand; the filter now takes as many as the question needs.
            * `MultiSelectField` is the control the rest of the application already answers this
            * kind of question with, and it carries its own "All employees" summary when nothing is
            * chosen - so there is no "" row to pick, which on a list would mean "nobody".
            */}
          <MultiSelectField
            label="Employee"
            values={draft.employee || []}
            onChange={(value) => set({ employee: value })}
            options={people}
            // What the trigger reads with nothing chosen, which is also what an empty filter means -
            // so there is no "" row to pick, which on a list would say "nobody" rather than "anyone".
            placeholder="All employees"
            searchable
          />
          <Dropdown
            label="Vertical"
            ariaLabel="Vertical"
            value={draft.vertical}
            onChange={(value) => set({ vertical: value })}
            options={[{ value: "", label: "All verticals" }, ...options.verticals.map((name) => ({ value: name, label: name }))]}
            placeholder="All verticals"
          />
          <Dropdown
            label="Call Type"
            ariaLabel="Call type"
            value={draft.callType}
            onChange={(value) => set({ callType: value })}
            options={[{ value: "", label: "Any type" }, ...options.callTypes.map((name) => ({ value: name, label: name }))]}
            placeholder="Any type"
          />
          <Dropdown
            label="Duration"
            ariaLabel="Duration"
            value={draft.duration}
            onChange={(value) => set({ duration: value })}
            options={[{ value: "", label: "Any duration" }, ...options.durations]}
            placeholder="Any duration"
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          {/* What the report on screen was actually built from, which is not always what the bar
              holds - somebody halfway through changing the dates should be able to tell. */}
          <p className="text-xs text-slate-500">
            {filterSummary(applied, options)}
            {/* The usage reports have no vertical, call type or duration to filter on, so those are
                ignored rather than returning nothing - and the report says which, because a filter
                set and quietly not applied is worse than one that is not offered. */}
            {ignored && <span className="ml-2 text-amber-700">{ignored}</span>}
          </p>
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={reset} disabled={loading || (!hasFilters(applied) && !dirty)}>Reset</Button>
            <Button type="button" size="sm" variant="primary" onClick={() => setApplied(draft)} disabled={loading || !dirty}>Apply</Button>
          </div>
        </div>
      </div>
    </ModulePageHeader>

    <FloatingNotice notice={notice} onClose={clearNotice} />

    {/*
      Between the filters and the table, because a tab is a view of what the filters selected. The
      padding matches the header's rows above it, so the first tab sits under the first letter of
      the title.
    */}
    <div className="shrink-0 border-b border-slate-200 bg-white px-3 pb-2 pt-1 sm:px-4 lg:px-5">
      <Tabs tabs={REPORTS.map((entry) => ({ id: entry.id, label: entry.label }))} value={activeReport} onChange={changeReport} ariaLabel="CRM report" />
    </div>

    <div className="min-h-0 flex-1 pt-3">
      <DataTableShell
        className="h-full min-h-0"
        footer={<TableFooter spread>
          {/* The Summary's totals, where the row count already is. They were a row of cards above
              the table - two shapes for one answer, and the cards disagreed with the table. */}
          <span>{activeReport === "summary" && report?.totals ? totalsSummary(report.totals) : describeRange(applied)}</span>
          <span>
            {report?.capped
              ? `First ${report.limit.toLocaleString()} calls — narrow the range to see the rest`
              : `Total rows: ${tableStats.total.toLocaleString()}`}
          </span>
        </TableFooter>}
      >
        <DataTable
          columns={columns}
          data={rows}
          density={density}
          loading={loading}
          loadingMessage="Building the report..."
          emptyMessage={definition.emptyMessage}
          noMatchMessage="No rows match that search."
          getRowId={reportRowId}
          onVisibleRowsChange={setTableStats}
          ariaLabel={`${definition.label} report`}
          features={{
            filtering: true,
            sorting: true,
            columnVisibility: true,
            infiniteScroll: { pageSize: 50 },
            csvExport: { enabled: true, fileName: `crm-${definition.id}` },
          }}
        />
      </DataTableShell>
    </div>
  </section>;
}
