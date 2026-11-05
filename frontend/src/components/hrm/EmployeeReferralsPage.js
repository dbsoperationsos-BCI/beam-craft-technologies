"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import DataTable from "@/components/data-table/DataTable";
import useTableSelection from "@/components/data-table/useTableSelection";
import DataTableShell from "@/components/data-table/DataTableShell";
import DataTableInfoPanel from "@/components/data-table/DataTableInfoPanel";
import TableFooter from "@/components/data-table/TableFooter";
import { TableCellValue } from "@/components/data-table/tableCells";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import AdministrationSwitch from "@/components/shared/AdministrationSwitch";
import useStickyTab from "@/components/shared/useStickyTab";
import { useRouteAccess } from "@/components/auth/PermissionsProvider";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import OptionsMenu from "@/components/ui/OptionsMenu";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import useCompactView from "@/components/shared/useCompactView";
import { referralInfoSections } from "@/constants/infoPanelConfig";
import referralInfoFormatters from "@/components/hrm/referralInfoFormatters";
import { instalmentLabel, isOverdue, isSettleable, outstandingTotal, referralStatus } from "@/components/hrm/referralPayouts";
import { getReferrals, updateReferralPayout } from "@/services/hrm/referrals.service";

/*
 * Who the studio owes a referral to, and what has been handed over.
 *
 * A screen of its own under HRM rather than a card list inside a settings panel: the register is
 * read to answer "who is owed what this month", which is a table's question - it wants sorting by
 * due date, filtering by branch of the studio's own making, and an export somebody can take to a
 * payment run. What a referral *pays* is still a setting, and stays on the Employee Repository's
 * ⋮ → Settings; this screen is the rows that setting produces.
 *
 * One row per referral, not per instalment. A referral is one promise to one person, made once when
 * their referral is recorded, and reading it as two rows split the promise across the table and
 * repeated the referrer's name against each half. The two instalments are columns, and the actions
 * menu names whichever of them can still be settled.
 */

const currency = (value) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(value) || 0);
const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });
const updatedFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : dateFormat.format(date);
}

/*
 * The tabs, which are the question the register is opened with. "Outstanding" is a referral with
 * anything still owed on it; "Settled" is one with nothing left to hand over, whether that is
 * because every instalment was paid or because they were called off.
 *
 * All three cut the register and nothing else. What a referral pays and how many months it is
 * settled over are both asked in the application's Settings, under Employee Referral - this screen
 * is the rows those two answers produce.
 */
const TABS = ["All", "Outstanding", "Settled"];

/** Amber while something is owed, green once it has all been handed over. */
const statusStyles = { Outstanding: "bg-amber-500", Overdue: "bg-rose-500", Paid: "bg-emerald-500", Cancelled: "bg-slate-400" };

const columns = [
  // The code the register is quoted by, first, the way every other table in the OS leads with the
  // record's own identifier. A referral written before the column existed reads "-" until the
  // backfill has run against that database.
  { id: "referralId", label: "Referral ID" },
  { id: "referredEmployeeName", label: "Referred Employee" },
  { id: "referredEmployeeCode", label: "Employee ID" },
  { id: "referrerName", label: "Referred By" },
  { id: "referredOn", label: "Date of Joining" },
  { id: "total", label: "Referral Amount" },
  // One column per instalment, each reading "₹3,000 · due 12 Jan 26" or "₹3,000 · paid 09 Jan 26",
  // so the state and the money are in the cell together rather than in a legend somewhere else.
  { id: "instalment3", label: "3rd Month" },
  { id: "instalment6", label: "6th Month" },
  { id: "outstanding", label: "Outstanding" },
  { id: "status", label: "Status" },
  { id: "actions", label: "Actions", fixed: true, sortable: false, filterable: false },
];

/** How one instalment reads in its own column: what it is worth, and where it has got to. */
function instalmentText(payout) {
  if (!payout) return "-";
  const amount = currency(payout.amount);
  if (payout.status === "Paid") return `${amount} · paid ${formatDate(payout.paidOn)}`;
  if (payout.status === "Cancelled") return `${amount} · cancelled`;
  return `${amount} · due ${formatDate(payout.dueOn)}${isOverdue(payout) ? " · overdue" : ""}`;
}

const payoutFor = (referral, monthOffset) => (referral?.payouts || []).find((payout) => payout.monthOffset === monthOffset) || null;

function displayValue(referral, column) {
  switch (column.id) {
    case "referredOn": return formatDate(referral.referredOn);
    case "total": return currency(referral.total);
    case "outstanding": return currency(outstandingTotal([referral]));
    case "instalment3": return instalmentText(payoutFor(referral, 3));
    case "instalment6": return instalmentText(payoutFor(referral, 6));
    case "status": return referralStatus(referral);
    default: return referral[column.id] || "-";
  }
}

export default function EmployeeReferralsPage() {
  /*
   * `HRM / Employee Referral`, the same pair `backend/src/modules/hrm/referrals/routes.js` guards
   * on. READ reads the register; marking an instalment paid is a write, so without it the actions
   * column is absent rather than present and refusing.
   */
  const { canWrite } = useRouteAccess();
  const [referrals, setReferrals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [tableStats, setTableStats] = useState({ total: 0 });
  /*
   * The tab survives a reload, the way every other filtered screen's does.
   *
   * Somebody working through what is outstanding refreshes to see what has changed; dropping them
   * back to All puts them at the top of everything, which is the one place they were not.
   */
  const [activeTab, setActiveTab] = useStickyTab("hrm-employee-referrals", "All", TABS);
  const [infoRow, setInfoRow] = useState(null);
  const [infoPanelState, setInfoPanelState] = useState("collapsed");
  const [paying, setPaying] = useState(null);
  const [busy, setBusy] = useState(false);
  const { notice, showNotice, showError, clearNotice } = useNotice();
  const { density } = useCompactView();

  /*
   * Everything, once, with the tabs counting inside it.
   *
   * The endpoint takes a status filter, but asking it per tab would reload the table on every
   * switch and leave the tab counts describing a list that is not on screen. The register is one
   * row per hire the studio has ever paid a referral for, which is a list a browser can hold.
   */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getReferrals();
      setReferrals(Array.isArray(response?.data) ? response.data : []);
      setLastUpdated(new Date());
    } catch (error) {
      setReferrals([]);
      showError(error?.data?.message || error.message || "Unable to load the referral register.");
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function confirmPaid() {
    setBusy(true);
    try {
      await updateReferralPayout(paying.payout.id, { status: "Paid", paidOn: new Date().toISOString() });
      const name = paying.referral.referredEmployeeName || "the referral";
      const amount = currency(paying.payout.amount);
      setPaying(null);
      showNotice(`Marked ${amount} paid against ${name}.`);
      await load();
    } catch (error) {
      showError(error?.data?.message || error.message || "Unable to mark that instalment paid.");
    } finally {
      setBusy(false);
    }
  }

  const tableColumns = useMemo(() => columns.map((column) => ({
    ...column,
    header: column.label,
    accessorFn: (row) => displayValue(row, column),
    cell: column.id === "status"
      ? ({ row }) => <TableCellValue value={referralStatus(row.original)} type="status" statusStyles={statusStyles} />
      : column.id === "actions"
        ? ({ row }) => {
          /* Only the instalments that still have something a person can do to them: one already
             paid has nothing to mark, and Paid is not reversible here — a correction is an
             Accounts entry, and the server refuses the reversal either way. A referral with
             nothing left to settle gets no ⋮ at all rather than one that opens on an empty menu. */
          const settleable = (row.original.payouts || []).filter(isSettleable);
          if (!settleable.length) return null;
          return <OptionsMenu
            ariaLabel={`Actions for ${row.original.referralId || row.original.referredEmployeeName || "referral"}`}
            items={settleable.map((payout) => ({
              label: `Mark ${instalmentLabel(payout.monthOffset)} paid`,
              onSelect: () => setPaying({ referral: row.original, payout }),
            }))}
          />;
        }
        : ({ row }) => displayValue(row.original, column),
    exportValue: (row) => displayValue(row, column),
    width: column.id === "actions" ? 56 : column.id.startsWith("instalment") ? 220 : 180,
    minWidth: column.id === "actions" ? 56 : 150,
  })).filter((column) => column.id !== "actions" || canWrite), [canWrite]);

  const tabCounts = useMemo(() => Object.fromEntries(TABS.map((tab) => [
    tab,
    tab === "All" ? referrals.length : referrals.filter((referral) => (referralStatus(referral) === "Paid" || referralStatus(referral) === "Cancelled") === (tab === "Settled")).length,
  ])), [referrals]);

  const visibleRows = useMemo(() => {
    if (activeTab === "All") return referrals;
    const settled = activeTab === "Settled";
    return referrals.filter((referral) => {
      const status = referralStatus(referral);
      return (status === "Paid" || status === "Cancelled") === settled;
    });
  }, [activeTab, referrals]);

  const updatedText = lastUpdated ? updatedFormat.format(lastUpdated) : "-";

  /*
   * The tick boxes, for a role holding `ADMIN / Table Select All`.
   *
   * No `prefix`, so the selection offers Export and nothing else - and that is the whole of what it
   * should offer here. A referral is a submission the studio received; it is worked through its
   * status, never deleted, and the module offers no delete on the server either.
   */
  const bulk = useTableSelection({ rows: visibleRows, noun: "referral" });

  return <section className="flex h-full min-h-0 w-full min-w-0 flex-col">
    <ModulePageHeader
      title="Employee Referral"
      /*
       * The same switch the Employee Repository carries, and the way back from here.
       *
       * This register is no longer an entry in the sidebar - it is reached from the repository's
       * heading, beside Users and Roles - so without the control it is a screen you can arrive at
       * and not leave. It reads its own name while you are on it, which is what tells you where in
       * the set of four you are.
       */
      titleAccessory={<AdministrationSwitch current="/hrm/employee-referrals" />}
      tabs={TABS.map((tab) => ({ id: tab, label: tab, count: tabCounts[tab] || 0 }))}
      tabValue={activeTab}
      onTabChange={setActiveTab}
      tabsAriaLabel="Referral status filters"
      /*
       * No ⋮. What a referral pays and how many months it is settled over are both set in the
       * application's Settings, under **Employee Referral**, with everything else the studio
       * configures once — this screen is the register those answers produce, and it had a menu
       * holding exactly one entry that led away from it.
       */
    />
    <FloatingNotice notice={notice} onClose={clearNotice} />
    <div className="min-h-0 flex-1">
      <DataTableShell
        className="h-full min-h-0"
        footer={<TableFooter spread>
          <span>Last updated: {updatedText}</span>
          <span>Total rows: {tableStats.total}</span>
        </TableFooter>}
      >
        {/* The shell stacks its children, so the table and the panel beside it need a row of their
            own — without it the info panel lands under the table instead of next to it. */}
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <div className="flex min-h-0 min-w-0 flex-1">
            <DataTable
              columns={tableColumns}
              data={visibleRows}
              density={density}
              loading={loading}
              loadingMessage="Loading referrals..."
              emptyMessage="A referral is recorded by naming a Referred By on an employee's record."
              noMatchMessage="No referrals found."
              onVisibleRowsChange={setTableStats}
              selectedRowId={infoRow?.id}
              onRowClick={(row) => { setInfoRow(row); setInfoPanelState("expanded"); }}
              ariaLabel="Employee referrals table"
              features={{ filtering: true, sorting: true, columnVisibility: true, infiniteScroll: { pageSize: 50 }, csvExport: { enabled: true, fileName: "employee-referrals", onResult: (exported) => showNotice(exported ? "Employee Referral CSV export downloaded." : "No referrals available to export.") }, selection: bulk.selection }}
            />
          </div>
          <DataTableInfoPanel
            title="Referral"
            entity={infoRow}
            sections={referralInfoSections}
            formatters={referralInfoFormatters}
            emptyText="Select a row to view the referral and its instalments."
            state={infoPanelState}
            onToggle={() => setInfoPanelState((current) => current === "expanded" ? "collapsed" : "expanded")}
          />
        </div>
      </DataTableShell>
    </div>


    {paying && <ConfirmDialog
      open
      title="Mark this instalment paid?"
      message={`${currency(paying.payout.amount)} to ${paying.referral.referrerName || "the referrer"} for referring ${paying.referral.referredEmployeeName || "this employee"}. This records that the money has left the studio and cannot be undone here — a correction is an Accounts entry.`}
      confirmLabel="Mark paid"
      busyLabel="Marking..."
      tone="primary"
      loading={busy}
      onCancel={() => setPaying(null)}
      onConfirm={confirmPaid}
    />}
  </section>;
}
