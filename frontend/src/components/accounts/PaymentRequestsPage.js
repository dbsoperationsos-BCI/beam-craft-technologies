"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import useStickyTab from "@/components/shared/useStickyTab";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import ExtraQuotationFormPanel from "@/components/project-management/ExtraQuotationFormPanel";
const EXTRA_TAB = "Extra Quotations";
import { approveExtraQuotation, getExtraQuotations, rejectExtraQuotation } from "@/services/sales/extra-quotations.service";
import { useModuleAccess, useRouteAccess } from "@/components/auth/PermissionsProvider";
import DataTable from "@/components/data-table/DataTable";
import useTableSelection from "@/components/data-table/useTableSelection";
import DataTableInfoPanel from "@/components/data-table/DataTableInfoPanel";
import DataTableShell from "@/components/data-table/DataTableShell";
import RecordDetails, { sectionsWithContent } from "@/components/data-table/RecordDetails";
import RecordViewPanel from "@/components/data-table/RecordViewPanel";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import TableFooter from "@/components/data-table/TableFooter";
import { buildTableColumns, defaultVisibilityFor, formatAmount } from "@/components/data-table/tableCells";
import Button from "@/components/shared/Button";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import TextAreaField from "@/components/shared/TextAreaField";
import useCompactView from "@/components/shared/useCompactView";
import Dialog from "@/components/ui/Dialog";
import OptionsMenu from "@/components/ui/OptionsMenu";
import PaymentRequestApprovalPanel from "@/components/hrm/PaymentRequestApprovalPanel";
import PaymentRequestExpenseSummary from "@/components/hrm/PaymentRequestExpenseSummary";
import PaymentRequestFormPanel from "@/components/hrm/PaymentRequestFormPanel";
import {
  getPaymentRequestOptions,
  getPaymentRequests,
  rejectPaymentRequest,
  withdrawPaymentRequest,
} from "@/services/hrm/payment-requests.service";
import {
  extraQuotationInfoSections,
  extraQuotationStatusStyles,
  extraQuotationTableFields,
  requestInfoSections,
  requestStatusStyles,
  requestTableFields,
  requestTabs,
} from "@/constants/paymentRequestConfig";

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
  // ACCOUNTS / Payment Request Approval. Raising a request, withdrawing one and deciding one are all
  // writes; `canDecide` narrows the last of those further to the people who may approve.
  const { canWrite } = useRouteAccess();
  // An extra quotation answers to the project, not to Accounts, so the offer to raise one is shown
  // only to somebody holding that permission — the endpoint asks for it either way.
  const { canWrite: canRaiseExtra } = useModuleAccess("PROJECT", "Projects");
  const [requests, setRequests] = useState([]);
  const [options, setOptions] = useState(emptyOptions);
  const [canDecide, setCanDecide] = useState(false);
  const [loading, setLoading] = useState(true);
  // Extra Quotations is a tab only for somebody who may raise one, so it is a *valid* remembered
  // tab only for them: a person who left the page there and has since lost the grant lands on All
  // rather than on a table the header no longer lists, under a tab strip with nothing lit.
  const [activeTab, setActiveTab] = useStickyTab("payment-requests", "All", [...requestTabs.map((tab) => tab.label), ...(canRaiseExtra ? [EXTRA_TAB] : [])]);
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
  // The request being corrected. Only ever a PENDING one — approving has already written the cash
  // entry that pays it, so a decided request is a closed record.
  const [editingRequest, setEditingRequest] = useState(null);
  const [raisingExtra, setRaisingExtra] = useState(false);
  /*
   * Extra quotations, which are not payment requests and live in their own table — but this is
   * where people come to see what is waiting on them, so they are shown here under a tab of their
   * own rather than mixed into a table whose columns they do not share.
   *
   * `mine` is both halves at once: what I raised and what I am the one to decide.
   */
  const [extras, setExtras] = useState([]);
  const [loadingExtras, setLoadingExtras] = useState(false);
  const [decidingExtraId, setDecidingExtraId] = useState("");
  const showingExtras = activeTab === EXTRA_TAB;
  const [infoExtra, setInfoExtra] = useState(null);
  // Double-click reads an extra quotation in full, the way every other table in the OS answers one.
  // Single click still only selects the row and fills the info panel beside it.
  const [viewingExtra, setViewingExtra] = useState(null);
  const [approving, setApproving] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [rejectRemarks, setRejectRemarks] = useState("");
  const [withdrawing, setWithdrawing] = useState(null);
  const [busy, setBusy] = useState(false);
  const { notice, showNotice, showSuccess, showError, clearNotice } = useNotice();
  const { density } = useCompactView();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getPaymentRequests();
      setRequests(Array.isArray(result?.data) ? result.data : []);
      setCanDecide(Boolean(result?.meta?.canDecide));
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

  const loadExtras = useCallback(async () => {
    setLoadingExtras(true);
    try {
      const result = await getExtraQuotations({ mine: true });
      setExtras(result?.data || []);
    } catch (extrasError) {
      showError(extrasError.data?.message || extrasError.message || "Unable to load extra quotations.");
    } finally {
      setLoadingExtras(false);
    }
  }, [showError]);

  // Fetched when the tab is opened rather than with the page: most readings of this screen are
  // about payment requests and never ask for the extras at all.
  useEffect(() => {
    if (!showingExtras) return undefined;
    const timer = window.setTimeout(() => { void loadExtras(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadExtras, showingExtras]);

  /** A rejection has to say why: the person who raised it is owed the reason. */
  const decideExtra = useCallback(async (extra, decision) => {
    let remarks = null;
    if (decision === "reject") {
      remarks = window.prompt(`Why is ${extra.requestCode} being rejected?`);
      if (!remarks || !remarks.trim()) return;
    }
    setDecidingExtraId(extra.id);
    try {
      if (decision === "approve") await approveExtraQuotation(extra.id, remarks ? { remarks } : {});
      else await rejectExtraQuotation(extra.id, { remarks: remarks.trim() });
      showSuccess(`${extra.requestCode} ${decision === "approve" ? "approved" : "rejected"}.`);
      await loadExtras();
    } catch (decisionError) {
      showError(decisionError.data?.message || decisionError.message || "Unable to record that decision.");
    } finally {
      setDecidingExtraId("");
    }
  }, [loadExtras, showError, showSuccess]);

  /**
   * The extras, tabled exactly as the requests beside them are: same builder, same column menu,
   * same filters and export. The only difference is what a row offers — a decision belongs to the
   * project's manager, and the server says per row whether this reader is them.
   */
  const extraColumns = useMemo(() => buildTableColumns({
    fields: extraQuotationTableFields,
    startIndex: 0,
    statusStyles: extraQuotationStatusStyles,
    renderActions: (extra) => {
      const items = [{ label: "View", onSelect: () => setViewingExtra(extra) }];
      if (extra.status === "PENDING" && extra.canDecide) {
        items.push({ label: "Approve", onSelect: () => void decideExtra(extra, "approve") });
        items.push({ label: "Reject", tone: "danger", onSelect: () => void decideExtra(extra, "reject") });
      }
      if (!items.length) items.push({ label: "No actions available", disabled: true, onSelect: () => {} });
      return <OptionsMenu ariaLabel={`Actions for ${extra.requestCode || "extra quotation"}`} items={items} />;
    },
  }), [decideExtra]);
  const filteredRows = useMemo(
    () => selectedTab.statuses ? requests.filter((row) => selectedTab.statuses.includes(row.status)) : requests,
    [requests, selectedTab],
  );
  const tabCounts = useMemo(
    () => Object.fromEntries(requestTabs.map((tab) => [tab.label, tab.statuses ? requests.filter((row) => tab.statuses.includes(row.status)).length : requests.length])),
    [requests],
  );
  const updatedText = lastUpdated ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(lastUpdated) : "—";

  /*
   * The tick boxes, for a role holding `ADMIN / Table Select All`. One per table, because the two
   * tabs are two different registers with different columns - a selection made on one has nothing
   * to say about the other.
   *
   * Export only, no `prefix`: a payment request and an extra quotation are both withdrawn by the
   * person who raised them, which is a status the record keeps, not a row that leaves the register.
   * Neither module offers a delete at all.
   */
  const bulkRequests = useTableSelection({ rows: filteredRows, noun: "request" });
  const bulkExtras = useTableSelection({ rows: extras, noun: "extra quotation" });

  const defaultVisibility = useMemo(() => defaultVisibilityFor(requestTableFields), []);
  const columns = useMemo(() => buildTableColumns({
    fields: requestTableFields,
    startIndex: 0,
    statusStyles: requestStatusStyles,
    // A decided request offers nothing but reading: its decision is part of the record, and the
    // entry it produced is the Accounts Manager's to correct, not this screen's.
    renderActions: (request) => {
      const items = [{ label: "View", onSelect: () => setDetailRequest(request) }];
      if (canWrite && canDecide && request.status === "PENDING") {
        items.push({ label: "Approve", onSelect: () => setApproving(request) });
        items.push({ label: "Reject", tone: "danger", onSelect: () => { setRejectRemarks(""); setRejecting(request); } });
      }
      // Correcting a mistake before anybody decides it, rather than withdrawing and raising again.
      if (canWrite && request.status === "PENDING") items.push({ label: "Edit", onSelect: () => setEditingRequest(request) });
      if (canWrite && request.status === "PENDING") items.push({ label: "Withdraw", tone: "danger", onSelect: () => setWithdrawing(request) });
      if (!items.length) items.push({ label: "No actions available", disabled: true, onSelect: () => {} });
      return <OptionsMenu ariaLabel={`Actions for ${request.requestCode || "request"}`} items={items} />;
    },
  }), [canDecide, canWrite]);

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

  async function afterChange(message) {
    setRaising(false);
    setEditingRequest(null);
    setApproving(null);
    showSuccess(message);
    await load();
    // An account just typed on an approval is offered to the next one without a page reload.
    void loadOptions();
  }

  async function confirmReject() {
    if (!rejectRemarks.trim()) {
      showError("Enter why this request is being turned down.");
      return;
    }
    setBusy(true);
    try {
      await rejectPaymentRequest(rejecting.id, rejectRemarks.trim());
      const code = rejecting.requestCode;
      setRejecting(null);
      showSuccess(`${code} rejected.`);
      await load();
    } catch (requestError) {
      showError(errorMessage(requestError, "Unable to reject this request."));
    } finally {
      setBusy(false);
    }
  }

  async function confirmWithdraw() {
    setBusy(true);
    try {
      await withdrawPaymentRequest(withdrawing.id);
      const code = withdrawing.requestCode;
      if (infoRequest?.id === withdrawing.id) setInfoRequest(null);
      setWithdrawing(null);
      showSuccess(`${code} withdrawn.`);
      await load();
    } catch (requestError) {
      showError(errorMessage(requestError, "Unable to withdraw this request."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <ModulePageHeader
        title="Payment Requests"
        tabs={[
          ...requestTabs.map((tab) => ({ id: tab.label, label: tab.label, count: tabCounts[tab.label] || 0 })),
          ...(canRaiseExtra ? [{ id: EXTRA_TAB, label: EXTRA_TAB, count: extras.length }] : []),
        ]}
        tabValue={activeTab}
        onTabChange={setActiveTab}
        tabsAriaLabel="Payment request filters"
        /* A fragment, not a wrapper - the header lays its own actions out and sizes them with
           `.module-page-header-actions > button`, a *child* combinator. Wrapped in a div of their
           own these two were grandchildren, missed that rule and kept Tailwind's taller default, so
           the title bar stood a step too tall and then shrank the moment a selection replaced them
           with buttons that are the header's own children. See `TableSelectionActions`. */
        actions={<>
          {/* An extra quotation is not a payment request — it agrees work rather than paying for it,
              and lives in its own record. It is offered here because this is where people come to
              raise things, and only to somebody who holds the permission it answers to: this screen
              is Accounts', while an extra is the project's. */}
          {canRaiseExtra && <Button type="button" onClick={() => setRaisingExtra(true)}>Extra Quotation</Button>}
          {canWrite && <Button type="button" variant="primary" onClick={() => setRaising(true)}>Add Request</Button>}
        </>}
      />

      <FloatingNotice notice={notice} onClose={clearNotice} />

      <DataTableShell className="min-h-0 flex-1" footer={<TableFooter spread className="z-30">
        <span>Last updated: {updatedText}</span>
        <span>Total rows: {infiniteStats.total}</span>
      </TableFooter>}>
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          {/* The extras tab replaces the table rather than filtering it: they are a different record
              with different columns, and half a table of blanks would serve neither. */}
          {showingExtras ? <div className="flex min-h-0 min-w-0 flex-1">
            <DataTable
              key={EXTRA_TAB}
              columns={extraColumns}
              data={extras}
              density={density}
              loading={loadingExtras}
              loadingMessage="Loading extra quotations..."
              emptyMessage="No extra quotation is waiting on you, and you have raised none."
              noMatchMessage="No matching extra quotations found."
              selectedRowId={infoExtra?.id}
              onRowClick={setInfoExtra}
              onRowDoubleClick={setViewingExtra}
              ariaLabel="Extra quotations table"
              features={{
                filtering: true,
                sorting: true,
                columnVisibility: true,
                columnResize: true,
                infiniteScroll: { pageSize: 50 },
                csvExport: { enabled: true, fileName: "extra-quotations", onResult: (exported) => showNotice(exported ? "Extra quotations CSV export downloaded." : "No rows available to export.") },
                selection: bulkExtras.selection,
              }}
            />
          </div> : <div className="flex min-h-0 min-w-0 flex-1">
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
          </div>}
          {/* One info panel per table, each drawn from its own record's sections. */}
          {showingExtras ? <DataTableInfoPanel
            title="Extra Quotation"
            entity={infoExtra}
            sections={extraQuotationInfoSections}
            formatters={infoPanelFormatters}
            emptyText="Select an extra quotation to view details."
            state={infoPanelState}
            onToggle={toggleInfoPanel}
          /> : <DataTableInfoPanel
            title="Info"
            entity={infoRequest}
            sections={requestInfoSections}
            formatters={infoPanelFormatters}
            emptyText="Select a request to view details."
            state={infoPanelState}
            onToggle={toggleInfoPanel}
          />}
        </div>
      </DataTableShell>

      {/* One request read in full: what it says, and nothing it has no answer for. It opens in the
          same full-screen panel the form does, so reading a request and raising one are the same
          surface — the rail lists whichever sections this request actually has. The fields are the
          info panel's own, so one added there is here too; this only says less of them. */}
      {viewingExtra && <RecordViewPanel
        title={viewingExtra.quotationCode || viewingExtra.projectName || "Extra Quotation"}
        entity={viewingExtra}
        sections={extraQuotationInfoSections}
        formatters={infoPanelFormatters}
        sidebarAriaLabel="Extra quotation sections"
        onClose={() => setViewingExtra(null)}
      />}
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
        footer={<Button className="ml-auto max-sm:w-full" type="button" variant="primary" onClick={() => setDetailRequest(null)}>Close</Button>}
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

      {/* The same panel the project's own Extras column opens, with no project settled — so it asks
          which project the extra is for, and the shoots follow that answer. */}
      {raisingExtra && <ExtraQuotationFormPanel
        onClose={() => setRaisingExtra(false)}
        onCreated={(created, message) => { setRaisingExtra(false); showSuccess(message); }}
      />}
      {raising && <PaymentRequestFormPanel
        options={options}
        onClose={() => setRaising(false)}
        onSaved={afterChange}
      />}

      {editingRequest && <PaymentRequestFormPanel
        request={editingRequest}
        options={options}
        onClose={() => setEditingRequest(null)}
        onSaved={afterChange}
      />}

      {approving && <PaymentRequestApprovalPanel
        request={approving}
        options={options}
        onClose={() => setApproving(null)}
        onDecided={afterChange}
      />}

      {rejecting && <Dialog
        title={`Reject ${rejecting.requestCode}?`}
        description="The reason is sent back to whoever raised it, so say what would have to change."
        busy={busy}
        onClose={() => setRejecting(null)}
        onSubmit={(event) => { event.preventDefault(); void confirmReject(); }}
        footer={<>
          <Button className="max-sm:flex-1" type="button" onClick={() => setRejecting(null)} disabled={busy}>Cancel</Button>
          <Button className="max-sm:flex-1" variant="danger" disabled={busy}>{busy ? "Rejecting..." : "Reject Request"}</Button>
        </>}
      >
        <TextAreaField
          required
          label="Reason for Rejection"
          value={rejectRemarks}
          onChange={(event) => setRejectRemarks(event.target.value)}
          rows={4}
          placeholder="e.g. The bills attached do not add up to the amount claimed"
        />
      </Dialog>}

      {withdrawing && <Dialog
        title={`Withdraw ${withdrawing.requestCode}?`}
        description="It stops appearing for approval. Only a request nobody has decided yet can be withdrawn."
        busy={busy}
        onClose={() => setWithdrawing(null)}
        footer={<>
          <Button className="max-sm:flex-1" type="button" onClick={() => setWithdrawing(null)} disabled={busy}>Cancel</Button>
          <Button className="max-sm:flex-1" type="button" variant="danger" onClick={confirmWithdraw} disabled={busy}>{busy ? "Withdrawing..." : "Withdraw Request"}</Button>
        </>}
      />}
    </section>
  );
}
