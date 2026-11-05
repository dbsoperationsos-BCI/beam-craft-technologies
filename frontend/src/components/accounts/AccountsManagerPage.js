"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import useStickyTab from "@/components/shared/useStickyTab";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import ImportDialog from "@/components/data-table/ImportDialog";
import { CASH_ENTRY_IMPORT_COLUMNS } from "@/constants/importColumns";
import { importTableRows } from "@/services/api/tableImport.service";
import { useModuleAccess, useRouteAccess } from "@/components/auth/PermissionsProvider";
import DataTableInfoPanel from "@/components/data-table/DataTableInfoPanel";
import RecordViewPanel from "@/components/data-table/RecordViewPanel";
import DataTableShell from "@/components/data-table/DataTableShell";
import KanbanBoard, { columnsFromRows, groupValue } from "@/components/data-table/KanbanBoard";
import { columnTotal } from "@/lib/kanbanSummary.mjs";
import TableBoardSwitch, { useTableBoardLayout } from "@/components/data-table/TableBoardSwitch";
import CashEntryGroupingSwitch, { useCashEntryGrouping } from "./CashEntryGroupingSwitch";
import TableFooter from "@/components/data-table/TableFooter";
import Button from "@/components/shared/Button";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import Dialog from "@/components/ui/Dialog";
import OptionsMenu from "@/components/ui/OptionsMenu";
import useCompactView from "@/components/shared/useCompactView";
import { formatAmount } from "@/components/data-table/tableCells";
import { formatDay } from "@/lib/productionSteps.mjs";
import { accountsInfoSections, accountsStatusStyles, accountsTabs, PENDING_REQUEST_TAB } from "@/constants/accountsConfig";
import { getPaymentRequestOptions, getPaymentRequests } from "@/services/hrm/payment-requests.service";
import { requestInfoSections } from "@/constants/paymentRequestConfig";
import PaymentRequestExpenseSummary from "@/components/hrm/PaymentRequestExpenseSummary";
import PendingRequestsTable from "./PendingRequestsTable";
import usePaymentRequestActions from "./usePaymentRequestActions";
import { downloadCashReceipt, deleteCashEntry, getCashEntries, getCashEntryOptions } from "@/services/accounts/cash-entries.service";
import AccountsTable, { cashEntryActionItems } from "./AccountsTable";
import useTableSelection from "@/components/data-table/useTableSelection";
import CashEntryFormPanel from "./CashEntryFormPanel";
import ScheduledPaymentsTable, { paymentActionItems } from "./ScheduledPaymentsTable";
import ScheduledPaymentPanel from "./ScheduledPaymentPanel";
import { GROUPED_CASH_TABS } from "@/lib/cashEntryGroups.mjs";
import { GROUPED_PAYMENT_TABS, PAYMENT_STATUS_TONES, SCHEDULED_PAYMENT_TABS } from "@/lib/scheduledPayments.mjs";
import { getScheduledPayment, getScheduledPayments } from "@/services/accounts/scheduled-payments.service";
import ReceiptMessageDialog from "./ReceiptMessageDialog";
import StatementImportDialog from "./StatementImportDialog";
import { dueDateText } from "@/lib/paymentSchedule.mjs";

const emptyOptions = { employees: [], receivedAccounts: [] };
// What the import's columns need to say, under the file picker.
const CASH_ENTRY_IMPORT_HINTS = [
  "Client Name is the project's WhatsApp group name, written in full exactly as the project shows it - that is what files each payment against its project.",
  "Event ID says which project when two share a group name, and is used whenever it is filled in. Branch is only needed for money out against no project.",
  "Entry Date is read day first: 05/10/2026, 05-10-2026, 5 Oct 2026 and 2026-10-05 are all the 5th of October.",
];
const infoPanelFormatters = { amount: formatAmount };
// A request's panel lists its expense lines rather than tabling them: the panel is a narrow column.
const requestPanelFormatters = {
  amount: formatAmount,
  expenses: (value) => <PaymentRequestExpenseSummary expenses={value} compact />,
};
// The scheduled payments' Board: a column per status tab, in the tabs' order and the pills' colours.
const PAYMENT_BOARD_COLUMNS = SCHEDULED_PAYMENT_TABS.map((tab) => ({ value: tab, label: tab, className: PAYMENT_STATUS_TONES[tab] || "bg-slate-100 text-slate-700" }));
const paymentStatusOf = (row) => row.status;
const timeOf = (value) => { const time = new Date(value || "").getTime(); return Number.isNaN(time) ? null : time; };
// The payments board's trend counts a payment by the day it falls due (a payment keeps no other date).
const paymentDueOn = (row) => timeOf(row.dueDate);
// The cash entries board's trend counts an entry by its Entry Date, the day the money moved.
const entryDateOf = (entry) => timeOf(entry.entryDate || entry.createdAt);
const entryCard = {
  title: (entry) => entry.clientName || entry.particulars || "—",
  subtitle: (entry) => [entry.entryId, entry.entryType].filter(Boolean).join(" · "),
  meta: (entry) => [formatAmount(entry.amount), formatDay(entry.entryDate)].filter(Boolean).join(" · "),
};
const paymentCard = {
  title: (row) => row.clientName || "—",
  subtitle: (row) => [row.eventId, row.category].filter(Boolean).join(" · "),
  meta: (row) => [`${formatAmount(row.pending)} pending`, dueDateText(row, formatDay)].join(" · "),
};

function errorMessage(error, fallback) {
  if (error?.status === 401 || error?.status === 403) return "Your session has expired. Please sign in again.";
  return error?.data?.message || error?.message || fallback;
}

/**
 * Accounts Manager, laid out as the Employee Repository is: a module header, then a table shell that
 * fills the rest of the page with the info panel beside the table inside it.
 *
 * It lists cash moving in and out. The tabs split the list by direction, and the footer carries what
 * the open tab adds up to — money in, money out, and the difference between them — since that is the
 * first question asked of a list of cash entries.
 *
 * Adding one starts with the direction rather than with the fields, because the answer decides what
 * the form asks for. That choice is the form's own first step, so this page only opens the panel;
 * see `CashEntryFormPanel`.
 */
export default function AccountsManagerPage() {
  /*
   * ACCOUNTS / Cash Management records the entries, and that is now the only permission this screen
   * asks about.
   *
   * It used to ask for HRM / Employee Management as well, for a **Settings** entry that maintained a
   * bank-account list of its own as HRM master data. That list is gone: the studio's accounts are
   * kept on the branch they belong to, in Settings -> Organization -> Branches, and the "received
   * into" dropdown on an entry reads them from there. One list, maintained by whoever maintains the
   * branches, rather than the same accounts typed in two places by two different permissions.
   */
  const { canWrite } = useRouteAccess();
  const [entries, setEntries] = useState([]);
  const [options, setOptions] = useState(emptyOptions);
  const [loading, setLoading] = useState(true);
  /*
   * The payments projects are still owed, under three more tabs - Due, Overdue, On Hold - on this
   * screen's own permission. What has been received is already under Received as its cash entry, so
   * a payment received in full leaves these tabs; a part payment's paid half is there too, and the
   * rest is Due.
   */
  /*
   * Pending - the requests somebody has approved and the studio has not paid yet - sits last, after
   * the entries and the scheduled payments, and only for a reader who may see payment requests.
   *
   * The rows are the Payment Requests screen's own data, governed by `ACCOUNTS / Payment Request
   * Approval` rather than by this screen's `Cash Management`, and **Read** on it is what the list
   * answers for - so it decides whether the tab exists at all, absent rather than there and refusing
   * to load. Write on that permission is the approver's and is not read here: approving and
   * rejecting belong to the Payment Requests screen, and paying is this screen's own `canWrite`
   * (Cash Management) instead. The Payment Requests screen keeps the Pending tab it always had,
   * which is the one for requests still awaiting a decision.
   */
  const { canRead: canReadRequests } = useModuleAccess("ACCOUNTS", "Payment Request");
  const tabs = useMemo(
    () => [...accountsTabs.map((tab) => tab.label), ...SCHEDULED_PAYMENT_TABS, ...(canReadRequests ? [PENDING_REQUEST_TAB] : [])],
    [canReadRequests],
  );
  const [activeTab, setActiveTab] = useStickyTab("accounts-manager", "All", tabs);
  const onScheduledTab = SCHEDULED_PAYMENT_TABS.includes(activeTab);
  const onPendingTab = activeTab === PENDING_REQUEST_TAB;
  const [pendingRequests, setPendingRequests] = useState([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [pendingStats, setPendingStats] = useState({ total: 0 });
  const [requestOptions, setRequestOptions] = useState(null);
  // Double-click, and the ⋮'s View: the request read in full, in this screen's own panel.
  const [viewingRequest, setViewingRequest] = useState(null);
  const [payments, setPayments] = useState([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [openPayment, setOpenPayment] = useState(null);
  const [paymentStats, setPaymentStats] = useState({ total: 0 });
  const [lastUpdated, setLastUpdated] = useState(null);
  const [infiniteStats, setInfiniteStats] = useState({ total: 0, showing: 0 });
  const [freezeCount, setFreezeCount] = useState(3);
  const [infoEntry, setInfoEntry] = useState(null);
  // Double-click reads the entry in full; changing it is the ⋮ menu's own entry.
  const [viewingEntry, setViewingEntry] = useState(null);
  const [infoPanelState, setInfoPanelState] = useState("collapsed");
  // Either a new entry, whose direction the form itself asks for, or an entry being corrected.
  const [formState, setFormState] = useState(null);
  // The receipt a Cash Received row's Share invoice opens, to copy or send to the project's group.
  const [receipt, setReceipt] = useState(null);
  const [deleteEntry, setDeleteEntry] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const { notice, showNotice, showSuccess, showError, clearNotice } = useNotice();

  // ⋮ → Download invoice on a cash received row: the same PDF the project's Payments tab downloads.
  const downloadInvoice = useCallback((entry) => {
    void downloadCashReceipt(entry.id, entry.entryId).catch((downloadError) => showError(downloadError.message || "Unable to download the invoice."));
  }, [showError]);
  const { density } = useCompactView();

  const [importOpen, setImportOpen] = useState(false);
  // Accounts Manager -> Import from PDF: bank statements and receipts, each payment then recorded by hand.
  const [pdfImportOpen, setPdfImportOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getCashEntries();
      setEntries(Array.isArray(result?.data) ? result.data : []);
      setLastUpdated(new Date());
    } catch (requestError) {
      setEntries([]);
      showError(errorMessage(requestError, "Unable to load cash entries."));
    } finally {
      setLoading(false);
    }
  }, [showError]);

  const loadOptions = useCallback(() => getCashEntryOptions()
    .then((result) => setOptions({ ...emptyOptions, ...(result?.data || {}) }))
    .catch(() => setOptions(emptyOptions)), []);

  const loadPayments = useCallback(async () => {
    setPaymentsLoading(true);
    try {
      const result = await getScheduledPayments();
      setPayments(Array.isArray(result?.data) ? result.data : []);
    } catch (requestError) {
      showError(errorMessage(requestError, "Unable to load the scheduled payments."));
    } finally {
      setPaymentsLoading(false);
    }
  }, [showError]);

  useEffect(() => { const timer = setTimeout(() => void loadPayments(), 0); return () => clearTimeout(timer); }, [loadPayments]);

  /*
   * The approved requests nothing has been paid against yet — the queue of money to release, which
   * is what this tab is. Asked for as approved-and-unpaid rather than by a status: paid is the cash
   * book's own answer (does this request have entries), not a fourth status on the request.
   *
   * Fetched **with the page**, not when the tab is opened.
   *
   * It was lazy, and the tab beside every other one then read "Pending (0)" until somebody clicked
   * it - a truthful count of an array nothing had filled yet, sitting next to All (27) and Overdue
   * (16), which are counted on load. The one tab whose job is to say money is waiting was the one
   * saying nothing was, and the only way to find out otherwise was to disbelieve it and click.
   */
  const loadPendingRequests = useCallback(async () => {
    setPendingLoading(true);
    try {
      const result = await getPaymentRequests({ status: "APPROVED", paid: "no" });
      setPendingRequests(Array.isArray(result?.data) ? result.data : []);
    } catch (requestError) {
      setPendingRequests([]);
      showError(errorMessage(requestError, "Unable to load the approved payment requests."));
    } finally {
      setPendingLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    if (!canReadRequests) return undefined;
    const timer = setTimeout(() => void loadPendingRequests(), 0);
    return () => clearTimeout(timer);
  }, [canReadRequests, loadPendingRequests]);

  /*
   * The lists the payment form needs - employees, projects, shoots, accounts, expense types - still
   * fetched when the tab is opened rather than with the page, since nothing but the panel that
   * releases the money asks for them. Null until it arrives, which is what the actions wait on.
   */
  useEffect(() => {
    if (!onPendingTab || !canReadRequests || requestOptions) return;
    void getPaymentRequestOptions()
      .then((result) => setRequestOptions(result?.data || {}))
      .catch(() => setRequestOptions({}));
  }, [canReadRequests, onPendingTab, requestOptions]);

  /*
   * The actions, from the definition the Payment Requests screen shares.
   *
   * `canPay` is this screen's own write access — `ACCOUNTS / Cash Management`, the cash book's
   * permission, which is what releasing money needs and what the `/pay` route guards on. Deciding is
   * not offered here: approving happens where the request is read in full, and a request only
   * reaches this tab once somebody has approved it.
   */
  const requestActions = usePaymentRequestActions({
    options: requestOptions || {},
    canWrite: false,
    canPay: canWrite,
    onChanged: loadPendingRequests,
    showSuccess,
    showError,
    view: setViewingRequest,
  });

  // A double click reads the payment; ⋮ → Record opens it to work.
  const showPayment = useCallback(async (row, recording = false) => {
    try {
      const result = await getScheduledPayment(row.id);
      setOpenPayment({ payment: result?.data || row, recording });
    } catch (requestError) {
      showError(errorMessage(requestError, "Unable to open this payment."));
    }
  }, [showError]);

  // Deferred a tick so the first render is not the one that flips the table into loading.
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);

  // The dropdown lists are loaded once for the page rather than on each open of the form, so opening
  // it is immediate and a branch added elsewhere still arrives on the next visit.
  useEffect(() => { void loadOptions(); }, [loadOptions]);

  const selectedTab = accountsTabs.find((tab) => tab.label === activeTab) || accountsTabs[0];
  const filteredRows = useMemo(
    () => selectedTab.entryTypes ? entries.filter((row) => selectedTab.entryTypes.includes(row.entryType)) : entries,
    [entries, selectedTab],
  );
  /*
   * The tick boxes, for a role holding `ADMIN / Table Select All`. Held by the page rather than by
   * `AccountsTable`, which draws whatever it is handed - the selection is acted on here, cleared
   * here, and reloaded here, so a second copy inside the table would be a second answer to it.
   */
  const bulk = useTableSelection({
    prefix: "/api/accounts/cash-entries",
    rows: filteredRows,
    noun: "entry",
    plural: "entries",
    canDelete: canWrite,
    showSuccess,
    showError,
    onDeleted: () => load(),
  });
  const tabCounts = useMemo(() => ({
    ...Object.fromEntries(accountsTabs.map((tab) => [tab.label, tab.entryTypes ? entries.filter((row) => tab.entryTypes.includes(row.entryType)).length : entries.length])),
    ...Object.fromEntries(SCHEDULED_PAYMENT_TABS.map((tab) => [tab, payments.filter((row) => row.status === tab).length])),
    [PENDING_REQUEST_TAB]: pendingRequests.length,
  }), [entries, payments, pendingRequests]);
  /*
   * The Board, on every tab. The tabs stay, being the only way between cash entries and scheduled
   * payments.
   *
   * Scheduled payments (Due, Overdue, On Hold) stand side by side by status - the tab's own rows,
   * the very ones its table lists, so an Active payment (more than five days before it falls due,
   * on no tab) is never on the board either. A card opens the
   * payment, as a double click does. Putting one On Hold, or taking it off hold, is the payment's ⋮
   * Record, so dropping it there opens Record - for whoever may write - where the remarks are asked
   * and Save decides. Due and Overdue follow the due date, so nothing is dropped between them.
   *
   * Cash entries have a direction, not a status, so their board is grouped and view-only: All by
   * direction (Received, Spent), and a direction's own tab by its category. A card opens the entry
   * as a double click does; editing stays the ⋮'s.
   */
  const [layout, setLayout] = useTableBoardLayout("accounts-manager");
  /*
   * One row per project, or one per entry. The grouping was always on for the three tabs that have a
   * project behind them; it is now the reader's choice, and **Ungrouped is the default** - "what came
   * in today" is the question this page is opened with, and a project row sits where its first entry
   * would, so today's receipt was down the page under a wedding from August.
   */
  const [grouping, setGrouping] = useCashEntryGrouping("accounts-manager");
  // A cash entry's ⋮ handlers, shared by the table row and the Board card.
  const editEntry = (entry) => setFormState({ entry });
  // ⋮ → Share invoice: the receipt with its invoice link, to copy or send to the project's group.
  const shareInvoice = canWrite ? (entry) => setReceipt({ entryId: entry.entryId, cashEntryId: entry.id }) : undefined;
  // Pending is a list either way: a column per status is no use where every row holds the same one.
  const onBoard = layout === "board" && !onPendingTab;
  // Only where there is a project to group by, and only as a table: the board groups by category of
  // its own, and a transfer carries no project at all.
  const canGroup = GROUPED_CASH_TABS.includes(activeTab) && !onBoard;
  const grouped = canGroup && grouping === "grouped";
  const onPaymentBoard = onScheduledTab && onBoard;
  const entryGroupKey = selectedTab.entryTypes ? "category" : "entryType";
  const entryStatusOf = useCallback((entry) => groupValue(entry[entryGroupKey]), [entryGroupKey]);
  const entryColumns = useMemo(() => (entryGroupKey === "entryType"
    ? Object.keys(accountsStatusStyles).map((type) => ({ value: type, label: type, className: `${accountsStatusStyles[type]} text-white` }))
    : columnsFromRows(filteredRows, (entry) => entry.category)), [entryGroupKey, filteredRows]);
  const canDropPayment = useCallback((row, to) => canWrite && (row.status === "On Hold") !== (to === "On Hold"), [canWrite]);
  const tabPayments = useMemo(() => payments.filter((row) => row.status === activeTab), [activeTab, payments]);
  const updatedText = lastUpdated ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(lastUpdated) : "—";

  function openInfoPanel(entry) {
    setInfoEntry(entry);
    setInfoPanelState("expanded");
  }

  const toggleInfoPanel = () => setInfoPanelState((current) => current === "expanded" ? "collapsed" : "expanded");

  /**
   * `keepOpen` is Save & Next: the entry is filed and the list behind refreshed, but the form stays
   * up for the following one. Everything else is the same either way, so the only difference is
   * whether the panel is taken down.
   */
  async function saved(message, { keepOpen = false } = {}) {
    if (!keepOpen) setFormState(null);
    // A payment's receipt is no longer offered here: the server sends it into the project's WhatsApp
    // group on its own (Settings → Project Management → Payment reminder's sender). Share invoice on
    // the row still opens it.
    showSuccess(message);
    await load();
    // The account just typed is offered to the next entry without waiting for a reload of the page.
    void loadOptions();
  }

  async function confirmDelete() {
    setDeleting(true);
    try {
      await deleteCashEntry(deleteEntry.id);
      if (infoEntry?.id === deleteEntry.id) setInfoEntry(null);
      const removed = deleteEntry.entryId;
      setDeleteEntry(null);
      showSuccess(`Entry ${removed} removed.`);
      await load();
    } catch (requestError) {
      showError(errorMessage(requestError, "Unable to remove this cash entry."));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <ModulePageHeader
        title="Accounts Manager"
        tabs={tabs.map((tab) => ({ id: tab, label: tab, count: tabCounts[tab] || 0 }))}
        tabValue={activeTab}
        onTabChange={setActiveTab}
        tabsAriaLabel="Accounts filters"
        actions={<>
          {/* Beside the layout switch, and absent on a tab with nothing to group by - a control the
              reader cannot use is not drawn disabled. */}
          {canGroup && <CashEntryGroupingSwitch value={grouping} onChange={setGrouping} />}
          <TableBoardSwitch value={layout} onChange={setLayout} />
          {canWrite && <Button type="button" variant="primary" onClick={() => setFormState({})}>Add Entry</Button>}
        </>}
        /* Settings is maintenance, not one of the day's actions, so it sits behind the ⋮ rather than
           competing with Add Entry. The trigger takes the default quiet tone — a bare ⋮ that fills
           on hover — so the header carries one bordered control, the action.

           One ⋮, not two. Import joins Settings here rather than standing beside it: the header
           carries one bordered control - the action - and everything quieter sits behind this. In
           the header's own trailing slot, so it ends the row after Nebula as every page's does. */
        menu={<>
          {canWrite && <><OptionsMenu
            ariaLabel="More accounts actions"
            menuClassName="w-44"
            items={[
              { label: "Import", onSelect: () => setImportOpen(true) },
              { label: "Import from PDF", onSelect: () => setPdfImportOpen(true) },
            ]}
          />
          {importOpen && <ImportDialog
            onClose={() => setImportOpen(false)}
            title="Import Cash Entries"
            columns={CASH_ENTRY_IMPORT_COLUMNS}
            templateName="accounts-import-template"
            hints={CASH_ENTRY_IMPORT_HINTS}
            onImportChunk={(chunk) => importTableRows("/api/accounts/cash-entries", chunk).then((answer) => answer?.data || answer)}
            onImported={() => load()}
          />}</>}
        </>}
      />

      <FloatingNotice notice={notice} onClose={clearNotice} />

      {/* The board fills the row and scrolls sideways inside its own rail; the page never does. */}
      {onPaymentBoard ? <div className="flex min-h-0 min-w-0 flex-1">
        <KanbanBoard
          rows={tabPayments}
          columns={PAYMENT_BOARD_COLUMNS}
          statusOf={paymentStatusOf}
          // What is still to come in, in each column.
          columnAmount={(rows) => columnTotal(rows, (row) => row.pending, "Pending")}
          dateOf={paymentDueOn}
          card={paymentCard}
          onOpen={(row) => void showPayment(row)}
          // The card's ⋮ is the row's ⋮.
          cardActions={(row) => paymentActionItems(row, { canWrite, onOpen: (payment, recording) => void showPayment(payment, recording) })}
          canDropAt={canDropPayment}
          onDrop={(row) => void showPayment(row, true)}
          loading={paymentsLoading}
          noun="payments"
          ariaLabel="Scheduled payments board"
        />
      </div> : onBoard ? <div className="flex min-h-0 min-w-0 flex-1">
        <KanbanBoard
          key={activeTab}
          rows={filteredRows}
          columns={entryColumns}
          statusOf={entryStatusOf}
          // The money in each column: Received, Spent or Transfer by type, or the total of a category.
          columnAmount={(rows, column) => columnTotal(rows, (entry) => entry.amount, entryGroupKey === "entryType" ? column.value : "Total")}
          dateOf={entryDateOf}
          card={entryCard}
          onOpen={setViewingEntry}
          // The card's ⋮ is the row's ⋮, handed the same handlers as the table below.
          cardActions={(entry) => cashEntryActionItems(entry, { canWrite, onView: setViewingEntry, onDownloadInvoice: downloadInvoice, onShareInvoice: shareInvoice, onEdit: editEntry, onDelete: setDeleteEntry })}
          viewOnly="A cash entry's direction and category are changed in its Edit, from the row's ⋮."
          loading={loading}
          noun="entries"
          ariaLabel="Cash entries board"
        />
      </div> : <DataTableShell className="min-h-0 flex-1" footer={<TableFooter spread className="z-30">
        <span>Last updated: {updatedText}</span>
        <span>Total rows: {onPendingTab ? pendingStats.total : onScheduledTab ? paymentStats.total : infiniteStats.total}</span>
      </TableFooter>}>
        {onPendingTab ? <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <PendingRequestsTable
            key={activeTab}
            rows={pendingRequests}
            loading={pendingLoading}
            density={density}
            items={requestActions.items}
            onOpen={setViewingRequest}
            onVisibleRowsChange={setPendingStats}
            onExported={(exported) => (exported ? showSuccess("Pending requests CSV downloaded.") : showNotice("No rows available to export."))}
          />
        </div> : onScheduledTab ? <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <ScheduledPaymentsTable
            key={activeTab}
            rows={tabPayments}
            loading={paymentsLoading}
            density={density}
            canWrite={canWrite}
            // Due and Overdue: one row per project, each of its payments under it with its own ⋮ Record.
            grouped={GROUPED_PAYMENT_TABS.includes(activeTab)}
            onOpen={(row, recording) => void showPayment(row, recording)}
            onVisibleRowsChange={setPaymentStats}
            onExported={(exported) => (exported ? showSuccess("Scheduled payments CSV downloaded.") : showNotice("No rows available to export."))}
          />
        </div> : <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <div className="flex min-h-0 min-w-0 flex-1">
            <AccountsTable
              key={activeTab}
              // All, Received and Spent: one row per project, money in and out under it, each with its own ⋮.
              grouped={grouped}
              selection={bulk.selection}
              entries={filteredRows}
              density={density}
              loading={loading}
              freezeCount={freezeCount}
              onFreezeColumnsChange={setFreezeCount}
              selectedEntryId={infoEntry?.id}
              onRowClick={openInfoPanel}
              onRowDoubleClick={setViewingEntry}
              onEdit={editEntry}
              onDelete={setDeleteEntry}
              onDownloadInvoice={downloadInvoice}
              onShareInvoice={shareInvoice}
              onTableNotice={showNotice}
              onInfiniteStats={setInfiniteStats}
              canWrite={canWrite}
            />
          </div>
          <DataTableInfoPanel
            title="Info"
            entity={infoEntry}
            sections={accountsInfoSections}
            // Money reads the same in the panel as it does in the table it was clicked in.
            formatters={infoPanelFormatters}
            emptyText="Select an entry to view details."
            state={infoPanelState}
            onToggle={toggleInfoPanel}
          />
        </div>}
      </DataTableShell>}

      {/* One scheduled payment, read on a double click or ⋮ → View, or opened by ⋮ → Record to work:
          its Status - Clear, Partially paid, On Hold. */}
      {openPayment && <ScheduledPaymentPanel
        key={`${openPayment.payment.id}-${openPayment.recording ? "record" : "view"}`}
        payment={openPayment.payment}
        recording={openPayment.recording}
        canWrite={canWrite}
        cashOptions={canWrite ? options : null}
        onClose={() => setOpenPayment(null)}
        onChanged={(payment, message) => {
          if (payment) setOpenPayment((current) => (current ? { ...current, payment } : current));
          if (message) showSuccess(message);
          void loadPayments();
          void load();
        }}
      />}

      {viewingEntry && <RecordViewPanel title={viewingEntry.entryCode || viewingEntry.particulars || "Entry"} entity={viewingEntry} sections={accountsInfoSections} formatters={infoPanelFormatters} sidebarAriaLabel="Entry sections" onClose={() => setViewingEntry(null)} />}
      {/* A pending request read in full, in the same panel this screen reads a cash entry in. */}
      {viewingRequest && <RecordViewPanel
        title={`${viewingRequest.requestCode || "Request"} · ${viewingRequest.typeLabel || ""}`.trim()}
        entity={viewingRequest}
        sections={requestInfoSections}
        formatters={requestPanelFormatters}
        sidebarAriaLabel="Request sections"
        onClose={() => setViewingRequest(null)}
      />}
      {/* Approve, Reject, Edit and Withdraw, mounted once for the table's ⋮. */}
      {requestActions.panels}

      {/* Each payment recorded from a PDF is an entry like any other: the list behind reloads, and
          its receipt goes to the project's group from the server, as Add Entry's does. */}
      {canWrite && pdfImportOpen && <StatementImportDialog
        options={options}
        onClose={() => setPdfImportOpen(false)}
        onRecorded={(_answer, entryId) => void saved(`Entry ${entryId} recorded.`, { keepOpen: true })}
      />}

      {/* Over the cash form, which stays open on Save & Next. */}
      {receipt && <ReceiptMessageDialog entryId={receipt.entryId} cashEntryId={receipt.cashEntryId} layer="dialogOverPanel" onClose={() => setReceipt(null)} />}

      {formState && <CashEntryFormPanel
        entry={formState.entry || null}
        options={options}
        onClose={() => setFormState(null)}
        onSaved={saved}
      />}

      {deleteEntry && <Dialog
        title="Remove this entry?"
        description={`${deleteEntry.entryId} · ${deleteEntry.clientName} · ${formatAmount(deleteEntry.amount)}. It stops appearing in the Accounts Manager, and stays on record.`}
        busy={deleting}
        onClose={() => setDeleteEntry(null)}
        footer={<>
          <Button className="max-sm:flex-1" type="button" onClick={() => setDeleteEntry(null)} disabled={deleting}>Cancel</Button>
          <Button className="max-sm:flex-1" type="button" variant="danger" onClick={confirmDelete} disabled={deleting}>{deleting ? "Removing..." : "Remove Entry"}</Button>
        </>}
      />}
    </section>
  );
}
