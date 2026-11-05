"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import DataTable from "@/components/data-table/DataTable";
import DataTableShell from "@/components/data-table/DataTableShell";
import TableFooter from "@/components/data-table/TableFooter";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import Button from "@/components/shared/Button";
import DateField from "@/components/shared/DateField";
import Dropdown from "@/components/shared/Dropdown";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import { getCrmDashboard, getReportOptions } from "@/services/sales/crm-reports.service";
import { describeRange, defaultRange, dateTime } from "@/lib/crmReports";

/**
 * Sales → Dashboard.
 *
 * The CRM in one screen. Every figure here is produced by the query that already produces it
 * somewhere else - the lead counts are the ones drawing the CRM's own tab badges, the status
 * breakdown reads the same rule the board reads, and the calls come from the Summary report. A
 * dashboard that counts things a second way is one that will eventually disagree with the screen it
 * summarises, and nobody notices until they are asked which number is right.
 *
 * Two clocks on one page, so they are labelled rather than left to be assumed: the lead figures are
 * a **position** - how the board stands right now - and the call figures are a **period**, the range
 * in the filter bar. "142 leads" beside "37 calls" otherwise reads as two measures of one window.
 *
 * Built from the module's own furniture: the header and filter row the Reports page uses, so the
 * two read as one section, and `DataTable` in a `DataTableShell` for each of the three tables.
 */

/** One headline figure. */
function Stat({ label, value, hint, tone = "" }) {
  return <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
    <p className="text-xs font-medium text-slate-500">{label}</p>
    <p className={`mt-0.5 text-lg font-semibold tabular-nums sm:text-xl ${tone || "text-slate-900"}`}>{value}</p>
    {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
  </div>;
}

/** A small table, sized to sit beside another rather than fill the page. */
function Panel({ title, note, columns, rows, empty, ariaLabel }) {
  return <section className="flex min-w-0 flex-col">
    <div className="flex flex-wrap items-baseline justify-between gap-2 pb-2">
      <h2 className="text-sm font-medium text-slate-700">{title}</h2>
      {note && <span className="text-xs text-slate-400">{note}</span>}
    </div>
    <DataTableShell>
      <DataTable
        columns={columns}
        data={rows}
        emptyMessage={empty}
        noMatchMessage="Nothing matches that search."
        getRowId={(row, index) => row.vertical || row.status || row.employee || String(index)}
        ariaLabel={ariaLabel}
        className="max-h-[18rem]"
        // No filter row on a panel this small: four rows do not need searching, and the row of
        // empty boxes costs more height than the table itself.
        features={{ filtering: false, sorting: true }}
      />
    </DataTableShell>
  </section>;
}

const number = (value) => Number(value || 0).toLocaleString();

export default function CrmDashboardPage() {
  const [draft, setDraft] = useState(() => ({ ...defaultRange(), vertical: "" }));
  const [applied, setApplied] = useState(() => ({ ...defaultRange(), vertical: "" }));
  const [options, setOptions] = useState({ verticals: [] });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const { notice, showError, clearNotice } = useNotice();

  const loadOptions = useCallback(async () => {
    try {
      const response = await getReportOptions();
      setOptions((current) => ({ ...current, ...(response?.data || {}) }));
    } catch {
      // The dashboard works with the vertical filter empty, so this is not worth a message.
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getCrmDashboard(applied);
      setData(response?.data || null);
    } catch (error) {
      setData(null);
      showError(error?.message || "Unable to load the dashboard.");
    } finally {
      setLoading(false);
    }
  }, [applied, showError]);

  /*
   * Deferred a tick, which is this codebase's convention for a first load: a fetch started straight
   * from an effect body counts as state set during that effect.
   */
  useEffect(() => {
    const timer = setTimeout(() => void loadOptions(), 0);
    return () => clearTimeout(timer);
  }, [loadOptions]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const leads = data?.leads || {};
  const calls = data?.calls || {};

  const verticalColumns = useMemo(() => [
    { id: "vertical", header: "Vertical", accessorFn: (row) => row.vertical, width: 140 },
    { id: "leads", header: "Leads", accessorFn: (row) => row.leads, cell: ({ row }) => number(row.original.leads), width: 100 },
    { id: "newToday", header: "New Today", accessorFn: (row) => row.newToday, cell: ({ row }) => number(row.original.newToday), width: 120 },
    { id: "converted", header: "Converted", accessorFn: (row) => row.converted, cell: ({ row }) => number(row.original.converted), width: 120 },
    { id: "followUpsToday", header: "Follow-ups Today", accessorFn: (row) => row.followUpsToday, cell: ({ row }) => number(row.original.followUpsToday), width: 160 },
    { id: "followUpsOutstanding", header: "Outstanding", accessorFn: (row) => row.followUpsOutstanding, cell: ({ row }) => number(row.original.followUpsOutstanding), width: 140 },
  ], []);

  const statusColumns = useMemo(() => [
    { id: "status", header: "Status", accessorFn: (row) => row.status, width: 200 },
    { id: "leads", header: "Leads", accessorFn: (row) => row.leads, cell: ({ row }) => number(row.original.leads), width: 110 },
  ], []);

  const performerColumns = useMemo(() => [
    { id: "employee", header: "Employee", accessorFn: (row) => row.employee, width: 190 },
    { id: "calls", header: "Calls", accessorFn: (row) => row.calls, cell: ({ row }) => number(row.original.calls), width: 100 },
    { id: "connected", header: "Connected", accessorFn: (row) => row.connected, cell: ({ row }) => number(row.original.connected), width: 130 },
    { id: "totalDuration", header: "Talk Time", accessorFn: (row) => row.totalDuration, width: 130 },
    { id: "lastCalledAt", header: "Last Call", accessorFn: (row) => dateTime(row.lastCalledAt), width: 180 },
  ], []);

  const dirty = JSON.stringify(draft) !== JSON.stringify(applied);
  const set = (patch) => setDraft((current) => ({ ...current, ...patch }));

  function reset() {
    const cleared = { ...defaultRange(), vertical: "" };
    setDraft(cleared);
    setApplied(cleared);
  }

  return <section className="flex h-full min-h-0 w-full min-w-0 flex-col">
    <ModulePageHeader title="Dashboard">
      <div className="w-full pb-3 pt-3">
        {/* The same controls the Reports page uses, in the same order, so moving between the two
            does not mean learning a second filter bar. Only the two that mean something here. */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <DateField label="From" helperText="First day of calls counted; press Apply to update." value={draft.from} onChange={(value) => set({ from: value })} />
          <DateField label="To" helperText="Last day of calls counted; press Apply to update." value={draft.to} onChange={(value) => set({ to: value })} />
          <Dropdown
            label="Vertical"
            helperText="Show one vertical only, or leave on all verticals."
            ariaLabel="Vertical"
            value={draft.vertical}
            onChange={(value) => set({ vertical: value })}
            options={[{ value: "", label: "All verticals" }, ...(options.verticals || []).map((name) => ({ value: name, label: name }))]}
            placeholder="All verticals"
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-500">
            Leads are the board as it stands today. Calls cover {describeRange(applied)}.
          </p>
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={reset} disabled={loading || (!applied.vertical && !dirty)}>Reset</Button>
            <Button type="button" size="sm" variant="primary" onClick={() => setApplied(draft)} disabled={loading || !dirty}>Apply</Button>
          </div>
        </div>
      </div>
    </ModulePageHeader>

    <FloatingNotice notice={notice} onClose={clearNotice} />

    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4 sm:py-4">
      {/* The board as it stands. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Leads" value={number(leads.leads)} hint="on the board" />
        <Stat label="New today" value={number(leads.newToday)} />
        <Stat label="Converted" value={number(leads.converted)} hint={`${leads.conversionRate || 0}% of leads`} />
        <Stat label="Follow-ups today" value={number(leads.followUpsToday)} hint={`${number(leads.followUpsOutstanding)} outstanding`} tone={leads.followUpsToday ? "text-amber-700" : ""} />
        <Stat label="Calls" value={number(calls.calls)} hint={describeRange(applied)} />
        <Stat label="Connect rate" value={`${calls.connectRate || 0}%`} hint={`${number(calls.connected)} of ${number(calls.calls)} · ${calls.totalDuration || "0s"}`} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel
          title="By vertical"
          note="as the CRM's own tabs count them"
          columns={verticalColumns}
          rows={data?.verticals || []}
          empty={loading ? "Loading..." : "No leads yet."}
          ariaLabel="Leads by vertical"
        />
        <Panel
          title="By status"
          note="the status each lead reads as on the board"
          columns={statusColumns}
          rows={data?.statuses || []}
          empty={loading ? "Loading..." : "No leads yet."}
          ariaLabel="Leads by status"
        />
      </div>

      <div className="mt-4">
        <Panel
          title="Who is calling"
          note={`busiest five · ${describeRange(applied)}`}
          columns={performerColumns}
          rows={data?.performers || []}
          empty={loading ? "Loading..." : "No calls in this range."}
          ariaLabel="Calls by employee"
        />
      </div>

      <DataTableShell className="mt-4">
        <TableFooter spread>
          <span>{data?.today ? `Board as at ${describeRange({ from: data.today, to: data.today })}` : ""}</span>
          <span>Calls: {describeRange(applied)}</span>
        </TableFooter>
      </DataTableShell>
    </div>
  </section>;
}
