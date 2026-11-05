"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import DataTable from "@/components/data-table/DataTable";
import DataTableShell from "@/components/data-table/DataTableShell";
import KanbanBoard from "@/components/data-table/KanbanBoard";
import TableBoardSwitch, { useTableBoardLayout } from "@/components/data-table/TableBoardSwitch";
import Button from "@/components/shared/Button";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import { columnTotal } from "@/lib/kanbanSummary.mjs";
import { payslipAmount } from "@/lib/payslipTemplate.mjs";
import { downloadMyPayslip, getMyPayslips } from "@/services/hrm/myPayslips.service";

/*
 * My Profile → Payslip (and HRM → Payslip's route): the signed-in employee's own payslips, behind
 * `HRM / My Payslip` - a table, one row a month whose payslip has been generated, with what it pays
 * (from their row on Payroll → Main Page) and a Download that prints it as Settings → Template
 * Settings lays it out. Above it, the month being paid now and the day its payslip is generated.
 */

const dayFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const day = (iso) => (iso ? dayFormat.format(new Date(`${iso}T00:00:00Z`)) : "");
// The Board's two columns: the Status column's two words, in its colours.
const BOARD_COLUMNS = [
  { value: "Not paid yet", className: "bg-amber-500 text-white" },
  { value: "Paid", className: "bg-emerald-600 text-white" },
];
const paidLabel = (row) => (row.paymentStatus === "Paid" ? "Paid" : "Not paid yet");
// The board's trend counts a payslip by the day it was generated.
const generatedOnOf = (row) => {
  const time = new Date(row.generatedOn || "").getTime();
  return Number.isNaN(time) ? null : time;
};
const days = (value) => (value === null || value === undefined ? "-" : String(value));

/** The list itself - the route's page, and My Profile's Payslip tab, both show this. */
export function MyPayslipList() {
  const { notice, showError, clearNotice } = useNotice();
  const [payslips, setPayslips] = useState([]);
  const [upcoming, setUpcoming] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [downloading, setDownloading] = useState(null);
  // Table or Board, the board standing payslips under Paid / Not paid yet. A view only; a card
  // downloads its payslip, the one thing a row does.
  const [layout, setLayout] = useTableBoardLayout("my-payslips");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await getMyPayslips();
      setPayslips(response?.data || []);
      setUpcoming(response?.upcoming || null);
    } catch (error) {
      setLoadError(error?.data?.message || error?.message || "Unable to load your payslips.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const download = useCallback(async (payslip) => {
    setDownloading(`${payslip.year}-${payslip.month}`);
    try {
      await downloadMyPayslip(payslip);
    } catch (error) {
      showError(error?.message || "Unable to download the payslip.");
    } finally {
      setDownloading(null);
    }
  }, [showError]);

  const columns = useMemo(() => [
    { id: "month", header: "Month", accessorFn: (row) => row.year * 100 + row.month, width: 150, cell: ({ row }) => <span className="font-medium text-slate-800">{row.original.label}</span> },
    { id: "cycle", header: "Pay Cycle", accessorFn: (row) => row.periodFrom || "", width: 210, cell: ({ row }) => (row.original.periodFrom ? `${day(row.original.periodFrom)} - ${day(row.original.periodTo)}` : "-") },
    { id: "paidDays", header: "Paid Days", accessorFn: (row) => row.paidDays ?? 0, width: 100, cell: ({ row }) => days(row.original.paidDays) },
    { id: "lopDays", header: "LOP Days", accessorFn: (row) => row.lopDays ?? 0, width: 100, cell: ({ row }) => days(row.original.lopDays) },
    { id: "netPay", header: "Net Pay", accessorFn: (row) => row.netPay ?? 0, width: 140, cell: ({ row }) => <span className="tabular-nums">{row.original.netPay === null || row.original.netPay === undefined ? "-" : `Rs. ${payslipAmount(row.original.netPay)}`}</span> },
    { id: "status", header: "Status", accessorFn: (row) => row.paymentStatus || "", width: 120, cell: ({ row }) => {
      const paid = row.original.paymentStatus === "Paid";
      return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${paid ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-amber-50 text-amber-800 ring-amber-200"}`}>{paid ? "Paid" : "Not paid yet"}</span>;
    } },
    { id: "generatedOn", header: "Generated On", accessorFn: (row) => row.generatedOn || "", width: 130, cell: ({ row }) => day(row.original.generatedOn) || "-" },
    { id: "download", header: "Payslip", enableSorting: false, width: 140, cell: ({ row }) => {
      const key = `${row.original.year}-${row.original.month}`;
      return <Button type="button" size="sm" busy={downloading === key} busyLabel="Preparing PDF..." disabled={Boolean(downloading) && downloading !== key} onClick={() => download(row.original)}>Download</Button>;
    } },
  ], [download, downloading]);

  return <div className="space-y-3">
    {/* The month being paid now, and the day its payslip comes - said before it is in the table. */}
    {upcoming && <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 sm:text-sm">
      <span className="font-semibold">{upcoming.label}</span> payslip (pay cycle {day(upcoming.periodFrom)} - {day(upcoming.periodTo)}) will be generated on <span className="font-semibold">{day(upcoming.generatesOn)}</span>.
    </p>}
    <div className="flex justify-end"><TableBoardSwitch value={layout} onChange={setLayout} /></div>
    {layout === "board" ? <div className="flex h-110 min-h-0 min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm">
      <KanbanBoard
        rows={payslips}
        columns={BOARD_COLUMNS}
        statusOf={paidLabel}
        // Under each column, the net pay of the viewer's own payslips standing there: paid, or still due.
        columnAmount={(rows, column) => columnTotal(rows, (row) => row.netPay, column.value === "Paid" ? "Paid" : "Due")}
        dateOf={generatedOnOf}
        card={{
          title: (row) => row.label,
          subtitle: (row) => (row.periodFrom ? `${day(row.periodFrom)} - ${day(row.periodTo)}` : ""),
          meta: (row) => [row.netPay === null || row.netPay === undefined ? "" : `Rs. ${payslipAmount(row.netPay)}`, `Paid days ${days(row.paidDays)}`].filter(Boolean).join(" · "),
        }}
        getRowId={(row) => `${row.year}-${row.month}`}
        onOpen={(row) => { if (!downloading) void download(row); }}
        // What the card's ⋮ calls opening it.
        openLabel="Download payslip"
        viewOnly="A payslip is marked paid by payroll."
        loading={loading}
        noun="payslips"
        ariaLabel="Your payslips board"
      />
    </div> : <DataTableShell className="shadow-sm">
      <DataTable
        columns={columns}
        data={payslips}
        loading={loading}
        loadingMessage="Loading your payslips..."
        emptyMessage={loadError || "No payslips yet - one appears here on the day it is generated."}
        getRowId={(row) => `${row.year}-${row.month}`}
        ariaLabel="Your payslips"
        features={{ sorting: true }}
      />
    </DataTableShell>}
    {loadError && <div className="flex justify-end"><Button type="button" size="sm" onClick={load}>Try again</Button></div>}
    <FloatingNotice notice={notice} onClose={clearNotice} />
  </div>;
}

/** HRM → Payslip's own route: the same list under its heading. Off the sidebar - it is a My Profile tab. */
export default function MyPayslipPage() {
  return <>
    <ModulePageHeader title="Payslip" />
    <div className="dashboard-canvas min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
      <MyPayslipList />
    </div>
  </>;
}
