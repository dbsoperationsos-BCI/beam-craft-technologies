"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import DataTable from "@/components/data-table/DataTable";
import useTableSelection from "@/components/data-table/useTableSelection";
import DataTableShell from "@/components/data-table/DataTableShell";
import DataTableInfoPanel from "@/components/data-table/DataTableInfoPanel";
import TableFooter from "@/components/data-table/TableFooter";
import KanbanBoard from "@/components/data-table/KanbanBoard";
import { columnTotal } from "@/lib/kanbanSummary.mjs";
import TableBoardSwitch, { useTableBoardLayout } from "@/components/data-table/TableBoardSwitch";
import { TableCellValue } from "@/components/data-table/tableCells";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import AdministrationSwitch from "@/components/shared/AdministrationSwitch";
import useStickyTab from "@/components/shared/useStickyTab";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import useCompactView from "@/components/shared/useCompactView";
import OptionsMenu from "@/components/ui/OptionsMenu";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useRouteAccess } from "@/components/auth/PermissionsProvider";
import { referralInfoSections } from "@/constants/infoPanelConfig";
import referralInfoFormatters from "@/components/hrm/referralInfoFormatters";
import { STOPPED, instalmentLabel, instalmentMonthsOf, instalmentProgress, isDeletable, isOverdue, isSettleable, outstandingTotal, referralStatus } from "@/components/hrm/referralPayouts";
import { deleteReferral, getReferrals, updateReferralPayout } from "@/services/hrm/referrals.service";

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
 * repeated the referrer's name against each half. Each instalment is a column, Instalments counts
 * how many are paid, and the actions menu names whichever of them can still be settled.
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

/*
 * The Board: a column per status, in the order and colours above. View-only - a drop cannot say
 * which instalment it settles, so settling by hand is the table's ⋮; nothing is dropped anywhere.
 */
const boardColumns = Object.keys(statusStyles).map((value) => ({ value, className: `${statusStyles[value]} text-white` }));
const boardStatusOf = (referral) => referralStatus(referral);
// What a referral has handed over, and what it never will (cancelled, or stopped by somebody leaving).
const sumOf = (referral, statuses) => (referral?.payouts || []).filter((payout) => statuses.includes(payout?.status)).reduce((sum, payout) => sum + (Number(payout?.amount) || 0), 0);
const paidTotal = (referral) => sumOf(referral, ["Paid"]);
const cancelledTotal = (referral) => sumOf(referral, ["Cancelled", STOPPED]);
// The board's trend counts a referral by its Referred On day (the referred person's joining date).
const referredOnOf = (referral) => {
  const time = new Date(referral.referredOn || "").getTime();
  return Number.isNaN(time) ? null : time;
};
const boardCard = {
  title: (referral) => referral.referredEmployeeName,
  subtitle: (referral) => [referral.referralId, referral.referrerName ? `by ${referral.referrerName}` : ""].filter(Boolean).join(" · "),
  // Short enough to read whole on a card: what it is worth, and how far it has been paid. What is
  // still owed is the column's own figure.
  meta: (referral) => [currency(referral.total), instalmentProgress(referral)].join(" · "),
};

/*
 * The register's columns. A referral is settled over as many instalments as Settings said when it
 * was recorded - two (3rd and 6th month) by default, three (adding the 9th) or more where the studio
 * chose so - so the instalment columns are one per month any referral here is paid in, rather than
 * a fixed 3rd and 6th that left a 9th month off the table.
 */
const columnsFor = (months) => [
  // The code the register is quoted by, first, the way every other table in the OS leads with the
  // record's own identifier. A referral written before the column existed reads "-" until the
  // backfill has run against that database.
  { id: "referralId", label: "Referral ID" },
  { id: "referredEmployeeName", label: "Referred Employee" },
  { id: "referredEmployeeCode", label: "Employee ID" },
  { id: "referrerName", label: "Referred By" },
  { id: "referredOn", label: "Date of Joining" },
  { id: "total", label: "Referral Amount" },
  // How many of its instalments are paid, "1/3 Paid" - read at a glance, as Shoots Done is.
  { id: "instalments", label: "Instalments" },
  // One column per instalment month, each reading "₹3,000 · due 12 Jan 26" or "₹3,000 · paid 09 Jan
  // 26", so the state and the money are in the cell together rather than in a legend somewhere else.
  ...months.map((month) => ({ id: `instalment${month}`, label: instalmentLabel(month).replace("month", "Month"), monthOffset: month })),
  { id: "outstanding", label: "Outstanding" },
  { id: "status", label: "Status" },
  // The ⋮: settle an instalment paid outside payroll. Only for Read / Write, and only on a row with
  // an instalment still Pending.
  { id: "actions", label: "Actions", fixed: true, sortable: false, filterable: false },
];

/** How one instalment reads in its own column: what it is worth, and where it has got to. */
/** Which of the two left, in the words the register uses for them. */
const STOPPED_BECAUSE = {
  REFERRED_LEFT: "employee left",
  REFERRER_LEFT: "referrer left",
  BOTH_LEFT: "both left",
};

function instalmentText(payout, referral) {
  if (!payout) return "-";
  const amount = currency(payout.amount);
  if (payout.status === "Paid") return `${amount} · paid ${formatDate(payout.paidOn)}`;
  if (payout.status === "Cancelled") return `${amount} · cancelled`;
  // Why it will not be paid, in the cell, and which of the two it was: the hire the bonus was for
  // leaving, or the referrer it was owed to.
  if (payout.status === STOPPED) return `${amount} · stopped · ${STOPPED_BECAUSE[referral?.stoppedReason] || "employee left"}`;
  return `${amount} · due ${formatDate(payout.dueOn)}${isOverdue(payout) ? " · overdue" : ""}`;
}

const payoutFor = (referral, monthOffset) => (referral?.payouts || []).find((payout) => payout.monthOffset === monthOffset) || null;

function displayValue(referral, column) {
  switch (column.id) {
    case "referredOn": return formatDate(referral.referredOn);
    case "total": return currency(referral.total);
    case "outstanding": return currency(outstandingTotal([referral]));
    case "instalments": return instalmentProgress(referral);
    case "status": return referralStatus(referral);
    default: return column.monthOffset ? instalmentText(payoutFor(referral, column.monthOffset), referral) : referral[column.id] || "-";
  }
}

export default function EmployeeReferralsPage() {
  /*
   * `HRM / Employee Referral`, the pair `backend/src/modules/hrm/referrals/routes.js` guards on. READ
   * reads the register; settling an instalment by hand is a write, so without it the ⋮ is absent
   * rather than present and refusing.
   */
  const { canWrite } = useRouteAccess();
  const [paying, setPaying] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
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
  // Table or Board. The tabs only cut the register by status, so the Board - every status a column
  // - shows the whole register and the tabs are put away while it is open.
  const [layout, setLayout] = useTableBoardLayout("hrm-employee-referrals");
  const onBoard = layout === "board";
  const [infoRow, setInfoRow] = useState(null);
  const [infoPanelState, setInfoPanelState] = useState("collapsed");
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

  /*
   * An instalment is paid in one of two ways, and either settles it once.
   *
   * Through **payroll** - Payroll → Main Page carries it as the referrer's **Referral Bonus** in its
   * due month, and paying that month records it as paid here (`settleReferralBonus`). Or **by hand**
   * here, on the row's ⋮, when it was handed over outside payroll (cash, a transfer). Payroll carries
   * only what is still Pending, so one settled here is never paid there as well.
   */
  async function confirmDelete() {
    setBusy(true);
    try {
      await deleteReferral(deleting.id);
      showNotice(`Deleted ${deleting.referralId || "the referral"}.`);
      setDeleting(null);
      if (infoRow?.id === deleting.id) setInfoRow(null);
      await load();
    } catch (error) {
      showError(error?.data?.message || error.message || "Unable to delete that referral.");
    } finally {
      setBusy(false);
    }
  }

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

  /* One referral's ⋮ - the table row's and the Board card's, and nothing without `canWrite`.
     Only the instalments still Pending: one paid has nothing to mark, and a stopped one has nobody
     to pay. Delete only while nothing on it was paid - a paid instalment is money that left the
     studio, and the server refuses it too. A row with neither gets no ⋮ at all. */
  const rowActionItems = useCallback((referral) => {
    if (!canWrite) return undefined;
    const settleable = (referral.payouts || []).filter(isSettleable);
    const deletable = isDeletable(referral);
    return [
      ...settleable.map((payout) => ({
        label: `Mark ${instalmentLabel(payout.monthOffset)} paid`,
        onSelect: () => setPaying({ referral, payout }),
      })),
      ...(deletable ? [...(settleable.length ? [{ separator: true }] : []), { label: "Delete", tone: "danger", onSelect: () => setDeleting(referral) }] : []),
    ];
  }, [canWrite]);

  // Every instalment month on the register, kept as a key so the columns are rebuilt only when it changes.
  const monthsKey = useMemo(() => instalmentMonthsOf(referrals).join(","), [referrals]);
  const tableColumns = useMemo(() => columnsFor(monthsKey.split(",").map(Number)).map((column) => ({
    ...column,
    header: column.label,
    accessorFn: (row) => displayValue(row, column),
    cell: column.id === "status"
      ? ({ row }) => <TableCellValue value={referralStatus(row.original)} type="status" statusStyles={statusStyles} />
      : column.id === "actions"
        ? ({ row }) => {
          const items = rowActionItems(row.original);
          return items?.length ? <OptionsMenu
            ariaLabel={`Actions for ${row.original.referralId || row.original.referredEmployeeName || "referral"}`}
            items={items}
          /> : null;
        }
        : ({ row }) => displayValue(row.original, column),
    exportValue: (row) => displayValue(row, column),
    width: column.id === "actions" ? 56 : column.monthOffset ? 220 : column.id === "instalments" ? 140 : 180,
    minWidth: column.id === "actions" ? 56 : 150,
  })).filter((column) => column.id !== "actions" || canWrite), [canWrite, monthsKey, rowActionItems]);

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
   * Export, and Delete for Read / Write (`DELETE /api/hrm/referrals/bulk`). A ticked referral with
   * an instalment already paid is left alone by the server, and the notice counts it as not deleted.
   */
  const bulk = useTableSelection({
    prefix: "/api/hrm/referrals",
    rows: visibleRows,
    noun: "referral",
    canDelete: canWrite,
    showSuccess: showNotice,
    showError,
    onDeleted: () => { void load(); },
  });

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
      tabs={onBoard ? undefined : TABS.map((tab) => ({ id: tab, label: tab, count: tabCounts[tab] || 0 }))}
      tabValue={activeTab}
      onTabChange={setActiveTab}
      tabsAriaLabel="Referral status filters"
      actions={<TableBoardSwitch value={layout} onChange={setLayout} />}
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
          <span>Total rows: {onBoard ? referrals.length : tableStats.total}</span>
        </TableFooter>}
      >
        {/* The shell stacks its children, so the table and the panel beside it need a row of their
            own — without it the info panel lands under the table instead of next to it. */}
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          {/* A card opens the referral in the panel beside the Board, as a row click does beside the table. */}
          {onBoard ? <KanbanBoard
            rows={referrals}
            columns={boardColumns}
            statusOf={boardStatusOf}
            // What each column is worth: owed while Outstanding or Overdue, paid once Paid, and what will
            // never be paid under Cancelled (cancelled or stopped instalments).
            columnAmount={(rows, column) => (column.value === "Paid" ? columnTotal(rows, (referral) => paidTotal(referral), "Paid")
              : column.value === "Cancelled" ? columnTotal(rows, (referral) => cancelledTotal(referral), "Cancelled")
                : columnTotal(rows, (referral) => outstandingTotal([referral]), "Owed"))}
            dateOf={referredOnOf}
            card={boardCard}
            onOpen={(row) => { setInfoRow(row); setInfoPanelState("expanded"); }}
            // The card's ⋮ is the row's ⋮.
            cardActions={rowActionItems}
            viewOnly="A referral's status follows its instalments - paid through payroll, or marked paid on its ⋮."
            loading={loading}
            noun="referrals"
            ariaLabel="Employee referrals board"
          /> : <div className="flex min-h-0 min-w-0 flex-1">
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
          </div>}
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
      message={`${currency(paying.payout.amount)} to ${paying.referral.referrerName || "the referrer"} for referring ${paying.referral.referredEmployeeName || "this employee"}, paid outside payroll. Payroll will not pay it again. This cannot be undone here - a correction is an Accounts entry.`}
      confirmLabel="Mark paid"
      busyLabel="Marking..."
      tone="primary"
      loading={busy}
      onCancel={() => setPaying(null)}
      onConfirm={confirmPaid}
    />}
    {deleting && <ConfirmDialog
      open
      title="Delete this referral?"
      message={`${deleting.referralId || "This referral"} - ${deleting.referrerName || "the referrer"} referring ${deleting.referredEmployeeName || "this employee"} - and its instalments are deleted, and payroll will not pay them. The employee's Referred By reads empty afterwards. This cannot be undone.`}
      confirmLabel="Delete"
      busyLabel="Deleting..."
      tone="danger"
      loading={busy}
      onCancel={() => setDeleting(null)}
      onConfirm={confirmDelete}
    />}
  </section>;
}
