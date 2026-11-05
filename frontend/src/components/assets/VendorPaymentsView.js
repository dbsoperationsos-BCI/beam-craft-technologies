"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import DataTable from "@/components/data-table/DataTable";
import DataTableShell from "@/components/data-table/DataTableShell";
import DataTableInfoPanel from "@/components/data-table/DataTableInfoPanel";
import RecordViewPanel from "@/components/data-table/RecordViewPanel";
import TableFooter from "@/components/data-table/TableFooter";
import { buildTableColumns, defaultVisibilityFor } from "@/components/data-table/tableCells";
import OptionsMenu from "@/components/ui/OptionsMenu";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import useCompactView from "@/components/shared/useCompactView";
import { requestStatusStyles, vendorPaymentInfoSections, vendorPaymentTableFields } from "@/constants/paymentRequestConfig";
import { getVendorPayments } from "@/services/hrm/payment-requests.service";
import VendorViewSwitch from "./VendorViewSwitch";
import VendorPaymentRequestButton from "./VendorPaymentRequestButton";

/*
 * Asset Management → Vendors → **Vendor Payments**: what the studio owes each vendor, and what it
 * has paid.
 *
 * One row per Vendor Payment request, read from the vendor's side rather than the requester's: the
 * bill, where it got to, and the cash that has actually left against it. The vendor and the status
 * narrow it; the counts and the totals are of everything the reader can see, so a tab never reads
 * zero for what is on screen.
 *
 * **Read-only on purpose.** Raising a bill is HRM → Payment Request's job and deciding one is
 * Payment Requests', because the approval form is where the studio says how the money actually
 * moves. A second place to approve money is a second answer to "has this been paid".
 *
 * The permission is `ACCOUNTS / Payment Request`, which is what the endpoint behind this
 * is guarded with - a reader holding Vendor Management alone is never offered the view. The server's
 * own visibility rule applies underneath: somebody who may not decide requests sees the bills they
 * raised themselves, which from here reads as "the bills I sent in for this vendor".
 */

const money = (value) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(value) || 0);
const STATUS_TABS = [["ALL", "All"], ["PENDING", "Pending"], ["APPROVED", "Approved"], ["REJECTED", "Rejected"]];

export default function VendorPaymentsView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { density } = useCompactView();
  const { notice, showError, showSuccess, clearNotice } = useNotice();
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ counts: {}, totals: { amount: 0, paid: 0, balance: 0 } });
  /*
   * Which filter the rows on screen were read for, rather than a `loading` flag set inside the
   * effect - that is a second render every time a filter moves, and React's own lint says so. The
   * table reads as loading while the answer in hand is for a different filter than the one asked.
   */
  const [answered, setAnswered] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [selected, setSelected] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [infoPanelState, setInfoPanelState] = useState("collapsed");

  /*
   * The tab lives in the URL beside the view itself, so a link holds what it was shared on.
   *
   * There is no vendor filter: the table's own column filter and its search already narrow to a
   * vendor, and a second picker above them would be a second answer to the same question.
   */
  const status = STATUS_TABS.some(([value]) => value === params.get("status")) ? params.get("status") : "ALL";

  // The token is part of what was asked, so raising a bill marks the list stale and re-reads it.
  const [reloadToken, setReloadToken] = useState(0);
  const asked = `${status}|${reloadToken}`;
  const loading = answered !== asked;

  const change = useCallback((key, value) => {
    const query = new URLSearchParams(params.toString());
    if (value && value !== "ALL") query.set(key, value);
    else query.delete(key);
    const text = query.toString();
    router.replace(text ? `${pathname}?${text}` : pathname);
  }, [params, pathname, router]);

  useEffect(() => {
    let cancelled = false;
    getVendorPayments({ status: status === "ALL" ? undefined : status })
      .then((result) => {
        if (cancelled) return;
        const data = result.data || [];
        setRows(data);
        setMeta(result.meta || { counts: {}, totals: { amount: 0, paid: 0, balance: 0 } });
        setLastUpdated(new Date());
        setAnswered(asked);
        // The row open in the panel, as this answer has it - or closed, where the filter dropped it.
        setSelected((current) => current ? data.find((row) => row.id === current.id) || null : current);
      })
      // Marked answered even when it failed, or the table reads as loading for ever over a notice
      // that has already said what went wrong.
      .catch((error) => { if (!cancelled) { setAnswered(asked); showError(error.message || "Unable to load vendor payments."); } });
    return () => { cancelled = true; };
  }, [asked, showError, status]);

  /*
   * The ⋮ carries the one thing this view offers - reading the bill - and with it the row height
   * every other table in the OS has: its trigger's `min-h-10` is what sets the row, so a table
   * without one reads as a cramped band of text beside the register next to it. It is also the only
   * way into a row on a touch screen, where a double click is the browser's zoom gesture.
   */
  const columns = useMemo(() => buildTableColumns({
    fields: vendorPaymentTableFields,
    statusStyles: requestStatusStyles,
    listFilters: ["branch", "vendorName"],
    renderActions: (row) => <OptionsMenu ariaLabel={`Actions for ${row.requestCode || "bill"}`} items={[
      { label: "View", onSelect: () => setViewing(row) },
    ]} />,
  }), []);
  const defaultVisibility = useMemo(() => defaultVisibilityFor(vendorPaymentTableFields), []);
  const updatedText = lastUpdated ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(lastUpdated) : "—";

  return <section className="flex h-full min-h-0 w-full min-w-0 flex-col">
    <ModulePageHeader
      title="Vendors"
      titleAccessory={<VendorViewSwitch view="payments" canSeePayments />}
      /* Raising a bill is the one thing this read-only ledger offers, and it is the same form the
         Payment Requests screen raises it with - deciding it stays there. */
      actions={<VendorPaymentRequestButton onRaised={(message) => { showSuccess(message); setReloadToken((token) => token + 1); }} />}
      tabs={STATUS_TABS.map(([value, label]) => ({ id: value, label, count: meta.counts?.[value] ?? 0 }))}
      tabValue={status}
      onTabChange={(value) => change("status", value)}
      tabsAriaLabel="Vendor payment status filters"
    />
    <FloatingNotice notice={notice} onClose={clearNotice} />
    <DataTableShell
      className="min-h-0 flex-1 rounded-none border-x-0 border-y-0 lg:border-r"
      /* The three figures the ledger is read for, of everything the reader can see rather than of
         the tab in front of them - so switching tabs does not change what the studio owes. */
      footer={<TableFooter spread contentClassName="!items-center">
        <span className="text-xs sm:text-sm">Last updated: {updatedText}</span>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:text-sm">
          <span>Billed: <span className="font-semibold text-slate-900">{money(meta.totals?.amount)}</span></span>
          <span>Paid: <span className="font-semibold text-emerald-700">{money(meta.totals?.paid)}</span></span>
          <span>Still owed: <span className="font-semibold text-amber-700">{money(meta.totals?.balance)}</span></span>
          <span className="shrink-0">Total rows: {rows.length}</span>
        </span>
      </TableFooter>}
    >
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <DataTable
          key={status}
          columns={columns}
          data={rows}
          density={density}
          loading={loading}
          loadingMessage="Loading vendor payments..."
          emptyMessage="No vendor payments yet. A bill raised in HRM → Payment Request as a Vendor Payment, or with Add Request here, appears once it is saved."

          noMatchMessage="No matching vendor payments found."
          defaultColumnVisibility={defaultVisibility}
          getRowId={(row) => String(row.id)}
          selectedRowId={selected ? String(selected.id) : undefined}
          onRowClick={(row) => { setSelected(row); setInfoPanelState("expanded"); }}
          // Reads the bill in full, as a double click does on every other table in the OS.
          onRowDoubleClick={setViewing}
          ariaLabel="Vendor payments table"
          features={{
            filtering: true,
            sorting: true,
            columnVisibility: true,
            infiniteScroll: { pageSize: 50 },
            csvExport: { enabled: true, fileName: "vendor-payments" },
          }}
        />
        <DataTableInfoPanel
          title="Payment Details"
          entity={selected}
          sections={vendorPaymentInfoSections}
          emptyText="Select a payment row to view details."
          state={infoPanelState}
          onToggle={() => setInfoPanelState((current) => current === "expanded" ? "collapsed" : "expanded")}
        />
      </div>
    </DataTableShell>
    {viewing && <RecordViewPanel
      title={`${viewing.requestCode}${viewing.vendorName ? ` · ${viewing.vendorName}` : ""}`}
      entity={viewing}
      sections={vendorPaymentInfoSections}
      sidebarAriaLabel="Vendor payment sections"
      onClose={() => setViewing(null)}
    />}
  </section>;
}
