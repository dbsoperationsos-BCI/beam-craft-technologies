"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import useStickyTab from "@/components/shared/useStickyTab";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import { useRouteAccess } from "@/components/auth/PermissionsProvider";
import DataTable from "@/components/data-table/DataTable";
import useTableSelection from "@/components/data-table/useTableSelection";
import DataTableInfoPanel from "@/components/data-table/DataTableInfoPanel";
import DataTableShell from "@/components/data-table/DataTableShell";
import KanbanBoard from "@/components/data-table/KanbanBoard";
import { columnTotal } from "@/lib/kanbanSummary.mjs";
import TableBoardSwitch, { useTableBoardLayout } from "@/components/data-table/TableBoardSwitch";
import RecordDetails, { sectionsWithContent } from "@/components/data-table/RecordDetails";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import TableFooter from "@/components/data-table/TableFooter";
import { buildTableColumns, defaultVisibilityFor, formatAmount } from "@/components/data-table/tableCells";
import Button from "@/components/shared/Button";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import useCompactView from "@/components/shared/useCompactView";
import OptionsMenu from "@/components/ui/OptionsMenu";
import PaymentRequestExpenseSummary from "@/components/hrm/PaymentRequestExpenseSummary";
import PaymentRequestFormPanel from "@/components/hrm/PaymentRequestFormPanel";
import usePaymentRequestActions from "./usePaymentRequestActions";
import {
  getPaymentRequestOptions,
  getPaymentRequests,
} from "@/services/hrm/payment-requests.service";
import {
  requestInfoSections,
  requestStatusStyles,
  requestTableFields,
  requestTabs,
} from "@/constants/paymentRequestConfig";

// The Board's columns: the status tabs, less All, in their order and colours.
const REQUEST_BOARD_COLUMNS = requestTabs.filter((tab) => tab.statuses).map((tab) => ({ value: tab.statuses[0], label: tab.label, className: `${requestStatusStyles[tab.statuses[0]] || "bg-slate-400"} text-white` }));
const boardStatusOf = (row) => row.status;
const ALL_TAB = requestTabs[0].label;

const emptyOptions = { employees: [], projects: [], shoots: [], accounts: [], expenseTypes: [], canDecide: false };
const infoPanelFormatters = {
  amount: formatAmount,
  // The panel is a narrow column, so the lines are listed rather than tabled.
  expenses: (value) => <PaymentRequestExpenseSummary expenses={value} compact />,
};

/**
 * What the reading panel shows: the info panel's sections, less everything the panel says for
 * itself.
 *
 * Its heading carries the request code and the type, its description who raised it and when, and
 * the strip above the sections the amount and the status — so repeating those as fields would be
 * the same record stated twice. Dropping them empties the "Request" section, which then drops
 * itself.
 *
 * The decision goes too. This is for reading what was asked for; what came of it is the status in
 * the strip, and the entry that paid it is the Accounts Manager's to show.
 *
 * What is left is still filtered per record by `hideEmpty`, because these sections describe four
 * kinds of request between them and any one request answers for only its own share.
 */
const SUMMARISED_FIELDS = new Set(["requestCode", "typeLabel", "amount", "status", "createdAt"]);
const OMITTED_SECTIONS = new Set(["Decision"]);
const detailSections = requestInfoSections
  .filter((section) => !OMITTED_SECTIONS.has(section.title))
  .map((section) => ({ ...section, fields: section.fields.filter(([key]) => !SUMMARISED_FIELDS.has(key)) }));

/** The reading panel has the width the info column does not, so the lines get their proper table. */
const detailFormatters = {
  amount: formatAmount,
  expenses: (value) => <PaymentRequestExpenseSummary expenses={value} heading={false} />,
};

/** A section's own heading, as the id its rail link and its scroll target are keyed on. */
const sectionId = (title) => `detail-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;

function errorMessage(error, fallback) {
  if (error?.status === 401) return "Your session has expired. Please sign in again.";
  return error?.data?.message || error?.message || fallback;
}

/**
 * Payment Requests, laid out as the Accounts Manager beside it is: a module header, then a table
 * shell that fills the rest of the page with the info panel beside the table inside it.
 *
 * It sits under Accounts rather than under HRM because approving a request writes a cash entry —
 * the money it asks for is Accounts' to move, and the entry it produces is read one screen away.
 *
 * One screen serves both readers. An employee sees the requests they raised and can withdraw one
 * nobody has looked at yet; an admin sees every request and is the only one offered Approve and
 * Reject. Which of the two is looking is the server's answer, not a guess from the role here, so
 * the buttons on offer and the rows behind them can never disagree.
 */
export default function PaymentRequestsPage() {
  // ACCOUNTS / Payment Request. Raising a request, withdrawing one and deciding one are all
  // writes; `canDecide` narrows the last of those further to the people who may approve.
  const { canWrite } = useRouteAccess();
  const [requests, setRequests] = useState([]);
  const [options, setOptions] = useState(emptyOptions);
  const [canDecide, setCanDecide] = useState(false);
  // Who is reading, so Withdraw is offered on their own rows and on no others (`meta.myEmployeeId`).
  const [myEmployeeId, setMyEmployeeId] = useState(null);
  const [loading, setLoading] = useState(true);
  // A remembered tab that is no longer one of these - Extra Quotations, which moved to the project's
  // own Payments - lands on All.
  const [activeTab, setActiveTab] = useStickyTab("payment-requests", "All", requestTabs.map((tab) => tab.label));
  const [lastUpdated, setLastUpdated] = useState(null);
  const [infiniteStats, setInfiniteStats] = useState({ total: 0, showing: 0 });
  const [freezeCount, setFreezeCount] = useState(3);
  const [infoRequest, setInfoRequest] = useState(null);
  const [infoPanelState, setInfoPanelState] = useState("collapsed");
  // The request being read in full, opened by double-clicking its row. Reading only: what a request
  // says was fixed when it was raised, and the three things that can still be done to one are on
  // the row's own ⋮ rather than buried in a dialog that otherwise cannot be acted on.
  const [detailRequest, setDetailRequest] = useState(null);
  const [raising, setRaising] = useState(false);
  const { notice, showNotice, showSuccess, showError, clearNotice } = useNotice();
  const { density } = useCompactView();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getPaymentRequests();
      setRequests(Array.isArray(result?.data) ? result.data : []);
      setCanDecide(Boolean(result?.meta?.canDecide));
      setMyEmployeeId(result?.meta?.myEmployeeId ?? null);
      setLastUpdated(new Date());
    } catch (requestError) {
      setRequests([]);
      showError(errorMessage(requestError, "Unable to load payment requests."));
    } finally {
      setLoading(false);
    }
  }, [showError]);

  const loadOptions = useCallback(() => getPaymentRequestOptions()
    .then((result) => setOptions({ ...emptyOptions, ...(result?.data || {}) }))
    .catch(() => setOptions(emptyOptions)), []);

  // Deferred a tick so the first render is not the one that flips the table into loading.
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);
  useEffect(() => { void loadOptions(); }, [loadOptions]);

  const selectedTab = requestTabs.find((tab) => tab.label === activeTab) || requestTabs[0];

  const filteredRows = useMemo(
    () => selectedTab.statuses ? requests.filter((row) => selectedTab.statuses.includes(row.status)) : requests,
    [requests, selectedTab],
  );
  const tabCounts = useMemo(
    () => Object.fromEntries(requestTabs.map((tab) => [tab.label, tab.statuses ? requests.filter((row) => tab.statuses.includes(row.status)).length : requests.length])),
    [requests],
  );
  /*
   * The Board: every request in a column per status, so the status tabs give way to it - leaving All.
   * Extra quotations are raised and decided on the project's own Payments, not here. A card
   * opens what a double click opens. Dropping a pending card on Approved or Rejected runs that row's
   * own ⋮ entry - the approval panel, or the rejection's reason - and only for somebody it offers it
   * to; nothing else moves, since a decided request is a closed record.
   */
  const [layout, setLayout] = useTableBoardLayout("payment-requests");
  const onBoard = layout === "board";
  /*
   * What can be done to a request, and the panels that do it — the same definition Accounts
   * Manager's Pending tab uses, so deciding money is written once rather than in two screens that
   * would drift. `onChanged` reloads this screen's rows and its option lists; `onGone` lets the
   * info panel beside the table drop a request that has just been withdrawn.
   */
  const requestActions = usePaymentRequestActions({
    options,
    canWrite,
    canDecide,
    myEmployeeId,
    onChanged: async () => { await load(); void loadOptions(); },
    onGone: (request) => setInfoRequest((current) => (current?.id === request.id ? null : current)),
    showSuccess,
    showError,
    view: setDetailRequest,
  });

  // Dragging decides, so it answers to the approver's permission alone - the same as the ⋮'s Approve
  // and Reject, which no longer ask for the raiser's permission beside it.
  const canDropRequest = useCallback((request, to) => canDecide && request.status === "PENDING" && (to === "APPROVED" || to === "REJECTED"), [canDecide]);
  const dropRequest = useCallback(
    (request, to) => (to === "APPROVED" ? requestActions.approve(request) : requestActions.reject(request)),
    [requestActions],
  );

  const updatedText = lastUpdated ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(lastUpdated) : "—";

  /*
   * The tick boxes, for a role holding `ADMIN / Table Select All`.
   *
   * Export only, no `prefix`: a payment request is withdrawn by the person who raised it, which is a
   * status the record keeps, not a row that leaves the register. The module offers no delete.
   */
  const bulkRequests = useTableSelection({ rows: filteredRows, noun: "request" });

  const defaultVisibility = useMemo(() => defaultVisibilityFor(requestTableFields), []);
  const columns = useMemo(() => buildTableColumns({
    fields: requestTableFields,
    statusStyles: requestStatusStyles,
    // A decided request offers nothing but reading: its decision is part of the record, and the
    // entry it produced is the Accounts Manager's to correct, not this screen's.
    renderActions: (request) => <OptionsMenu ariaLabel={`Actions for ${request.requestCode || "request"}`} items={requestActions.items(request)} />,
  }), [requestActions]);

  /**
   * The sections the reading panel draws, and the rail lists.
   *
   * Only the ones this request has something to say for: an empty section would otherwise be a
   * heading over nothing and, worse, a link in the rail that scrolls to it. `RecordDetails` asks
   * the same question of the fields it draws, so the rail and the body cannot disagree.
   */
  const detailPanelSections = useMemo(() => sectionsWithContent(detailRequest, detailSections, true).map((section) => ({
    id: sectionId(section.title),
    title: section.title,
    render: () => <RecordDetails entity={detailRequest} sections={[section]} formatters={detailFormatters} variant="rows" hideEmpty />,
  })), [detailRequest]);

  function openInfoPanel(request) {
    setInfoRequest(request);
    setInfoPanelState("expanded");
  }

  const toggleInfoPanel = () => setInfoPanelState((current) => current === "expanded" ? "collapsed" : "expanded");

  // Raising a request is this screen's own, the row's actions being the shared hook's.
  async function afterChange(message) {
    setRaising(false);
    showSuccess(message);
    await load();
    // An account just typed on an approval is offered to the next one without a page reload.
    void loadOptions();
  }

  return (
    <section className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <ModulePageHeader
        title="Payment Requests"
        tabs={(onBoard ? requestTabs.filter((tab) => !tab.statuses) : requestTabs).map((tab) => ({ id: tab.label, label: tab.label, count: tabCounts[tab.label] || 0 }))}
        // On the board a status tab is a column, so whichever was open reads as All.
        tabValue={onBoard ? ALL_TAB : activeTab}
        onTabChange={setActiveTab}
        tabsAriaLabel="Payment request filters"
        /* A fragment, not a wrapper - the header lays its own actions out and sizes them with
           `.module-page-header-actions > button`, a *child* combinator. Wrapped in a div of their
           own these two were grandchildren, missed that rule and kept Tailwind's taller default, so
           the title bar stood a step too tall and then shrank the moment a selection replaced them
           with buttons that are the header's own children. See `TableSelectionActions`. */
        actions={<>
          <TableBoardSwitch value={layout} onChange={setLayout} />
          {canWrite && <Button type="button" variant="primary" onClick={() => setRaising(true)}>Add Request</Button>}
        </>}
      />

      <FloatingNotice notice={notice} onClose={clearNotice} />

      {/* The board fills the row and scrolls sideways inside its own rail; the page never does. */}
      {onBoard ? <div className="flex min-h-0 min-w-0 flex-1">
        <KanbanBoard
          rows={requests}
          columns={REQUEST_BOARD_COLUMNS}
          statusOf={boardStatusOf}
          card={{ title: (request) => request.typeLabel || "Request", subtitle: (request) => [request.requestCode, request.requestedByName].filter(Boolean).join(" · "), meta: (request) => [formatAmount(request.amount), request.branch].filter(Boolean).join(" · ") }}
          onOpen={setDetailRequest}
          // The card's ⋮ is the row's ⋮: View, Edit, Approve, Reject, Withdraw as this person may.
          cardActions={requestActions.items}
          // The money in each column: what is waiting, what was approved, what was turned down.
          columnAmount={(rows, column) => columnTotal(rows, (request) => request.amount, { PENDING: "Requested", APPROVED: "Approved", REJECTED: "Rejected" }[column.value] || "Total")}
          canDropAt={canDropRequest}
          onDrop={dropRequest}
          loading={loading}
          noun="requests"
          ariaLabel="Payment requests board"
        />
      </div> : <DataTableShell className="min-h-0 flex-1" footer={<TableFooter spread className="z-30">
        <span>Last updated: {updatedText}</span>
        <span>Total rows: {infiniteStats.total}</span>
      </TableFooter>}>
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <div className="flex min-h-0 min-w-0 flex-1">
            <DataTable
              key={activeTab}
              columns={columns}
              data={filteredRows}
              density={density}
              loading={loading}
              loadingMessage="Loading payment requests..."
              emptyMessage="No payment requests yet."
              noMatchMessage="No matching requests found."
              selectedRowId={infoRequest?.id}
              onRowClick={openInfoPanel}
              onRowDoubleClick={setDetailRequest}
              defaultColumnVisibility={defaultVisibility}
              onVisibleRowsChange={setInfiniteStats}
              ariaLabel="Payment requests table"
              features={{
                filtering: true,
                sorting: true,
                columnVisibility: true,
                columnResize: true,
                frozenColumns: { count: freezeCount, onChange: setFreezeCount },
                infiniteScroll: { pageSize: 50 },
                csvExport: { enabled: true, fileName: "payment-requests", onResult: (exported) => showNotice(exported ? "Payment requests CSV export downloaded." : "No rows available to export.") },
                selection: bulkRequests.selection,
              }}
            />
          </div>
          <DataTableInfoPanel
            title="Info"
            entity={infoRequest}
            sections={requestInfoSections}
            formatters={infoPanelFormatters}
            emptyText="Select a request to view details."
            state={infoPanelState}
            onToggle={toggleInfoPanel}
          />
        </div>
      </DataTableShell>}

      {/* One request read in full: what it says, and nothing it has no answer for. It opens in the
          same full-screen panel the form does, so reading a request and raising one are the same
          surface — the rail lists whichever sections this request actually has. The fields are the
          info panel's own, so one added there is here too; this only says less of them. */}
      {detailRequest && <SchemaFormPanel
        title={`${detailRequest.requestCode || "Request"} · ${detailRequest.typeLabel || ""}`.trim()}
        description={[
          `Raised by ${detailRequest.requestedByName || "—"}`,
          detailRequest.createdAt ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(detailRequest.createdAt)) : null,
        ].filter(Boolean).join(" · ")}
        sections={detailPanelSections}
        sidebarAriaLabel="Payment request sections"
        closeAriaLabel="Close payment request"
        onClose={() => setDetailRequest(null)}
        // Nothing here is submitted; the panel is the form shell, read back rather than filled in.
        onSubmit={(event) => event.preventDefault()}
        footer={<Button className="max-sm:w-full" type="button" variant="primary" onClick={() => setDetailRequest(null)}>Close</Button>}
      >
        {/* What is asked first of any request — how much, and whether anyone has decided it yet —
            read as a figure rather than as two more fields among twenty. Above the first section,
            because it is what the sections below are describing. */}
        <div className="w-full max-w-[1040px] px-4 py-4 sm:px-6 sm:py-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Amount</p>
              <p className="mt-0.5 text-xl font-semibold text-slate-900 sm:text-2xl">{formatAmount(detailRequest.amount)}</p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700">
              <span className={`h-2 w-2 shrink-0 rounded-full ${requestStatusStyles[detailRequest.status] || "bg-slate-400"}`} />
              {detailRequest.status}
            </span>
          </div>
        </div>
      </SchemaFormPanel>}

      {raising && <PaymentRequestFormPanel
        options={options}
        onClose={() => setRaising(false)}
        onSaved={afterChange}
      />}


      {/* Edit, Approve, Reject and Withdraw, defined once and shared with Accounts Manager. */}
      {requestActions.panels}
    </section>
  );
}
