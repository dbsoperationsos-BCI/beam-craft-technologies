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
import TableFooter from "@/components/data-table/TableFooter";
import Button from "@/components/shared/Button";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import Dialog from "@/components/ui/Dialog";
import OptionsMenu from "@/components/ui/OptionsMenu";
import useCompactView from "@/components/shared/useCompactView";
import { formatAmount } from "@/components/data-table/tableCells";
import { accountsInfoSections, accountsTabs } from "@/constants/accountsConfig";
import { deleteCashEntry, getCashEntries, getCashEntryOptions } from "@/services/accounts/cash-entries.service";
import AccountsTable from "./AccountsTable";
import useTableSelection from "@/components/data-table/useTableSelection";
import BankAccountsPanel from "./BankAccountsPanel";
import CashEntryFormPanel from "./CashEntryFormPanel";
import ReceiptMessageDialog from "./ReceiptMessageDialog";

const emptyOptions = { employees: [], receivedAccounts: [] };
const infoPanelFormatters = { amount: formatAmount };

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
  // ACCOUNTS / Cash Management records the entries. Settings is a different thing entirely: the bank
  // accounts it maintains are HRM master data, written through /api/hrm, so it is asked for by name
  // rather than assumed from this screen's own permission.
  const { canWrite } = useRouteAccess();
  const { canWrite: canEditBankAccounts } = useModuleAccess("HRM", "Employee Management");
  const [entries, setEntries] = useState([]);
  const [options, setOptions] = useState(emptyOptions);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useStickyTab("accounts-manager", "All", accountsTabs.map((tab) => tab.label));
  const [lastUpdated, setLastUpdated] = useState(null);
  const [infiniteStats, setInfiniteStats] = useState({ total: 0, showing: 0 });
  const [freezeCount, setFreezeCount] = useState(3);
  const [infoEntry, setInfoEntry] = useState(null);
  // Double-click reads the entry in full; changing it is the ⋮ menu's own entry.
  const [viewingEntry, setViewingEntry] = useState(null);
  const [infoPanelState, setInfoPanelState] = useState("collapsed");
  // Either a new entry, whose direction the form itself asks for, or an entry being corrected.
  const [formState, setFormState] = useState(null);
  // The receipt to send the client, held here rather than in the form: Save & Close takes the form
  // down, and the message has to outlive it.
  const [receipt, setReceipt] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteEntry, setDeleteEntry] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const { notice, showNotice, showSuccess, showError, clearNotice } = useNotice();
  const { density } = useCompactView();

  const [importOpen, setImportOpen] = useState(false);

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
  const tabCounts = useMemo(
    () => Object.fromEntries(accountsTabs.map((tab) => [tab.label, tab.entryTypes ? entries.filter((row) => tab.entryTypes.includes(row.entryType)).length : entries.length])),
    [entries],
  );
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
  async function saved(message, { keepOpen = false, receiptMessage = null, entryId = "" } = {}) {
    if (!keepOpen) setFormState(null);
    /*
     * The receipt for a payment, offered the moment it is recorded - after Save & Next as much as
     * Save & Close, since a run of receipts is exactly when nobody wants to go back and look one
     * up. Shown from here rather than from the form because Save & Close takes the form down.
     *
     * Only money received has one, and only when the studio has written the wording: the server
     * sends nothing otherwise and this stays closed.
     */
    if (receiptMessage?.body) setReceipt({ message: receiptMessage, entryId });
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
        tabs={accountsTabs.map((tab) => ({ id: tab.label, label: tab.label, count: tabCounts[tab.label] || 0 }))}
        tabValue={activeTab}
        onTabChange={setActiveTab}
        tabsAriaLabel="Accounts filters"
        actions={!canWrite && !canEditBankAccounts ? null : <>
          {canWrite && <Button type="button" variant="primary" onClick={() => setFormState({})}>Add Entry</Button>}
          {/* Settings is maintenance, not one of the day's actions, so it sits behind the ⋮ beside
              Add Entry rather than competing with it. The trigger takes the default quiet tone — a
              bare ⋮ that fills on hover — so the header carries one bordered control, the action. */}
          {/* One ⋮, not two. Import joins Settings here rather than standing beside it: the header
              carries one bordered control - the action - and everything quieter sits behind this. */}
          {(canWrite || canEditBankAccounts) && <><OptionsMenu
            ariaLabel="More accounts actions"
            menuClassName="w-40"
            items={[
              ...(canWrite ? [{ label: "Import", onSelect: () => setImportOpen(true) }] : []),
              ...(canEditBankAccounts ? [{ label: "Settings", onSelect: () => setSettingsOpen(true) }] : []),
            ]}
          />
          {importOpen && <ImportDialog
            onClose={() => setImportOpen(false)}
            title="Import Cash Entries"
            columns={CASH_ENTRY_IMPORT_COLUMNS}
            templateName="accounts-import-template"
            onImportChunk={(chunk) => importTableRows("/api/accounts/cash-entries", chunk).then((answer) => answer?.data || answer)}
            onImported={() => load()}
          />}</>}
        </>}
      />

      <FloatingNotice notice={notice} onClose={clearNotice} />

      <DataTableShell className="min-h-0 flex-1" footer={<TableFooter spread className="z-30">
        <span>Last updated: {updatedText}</span>
        <span>Total rows: {infiniteStats.total}</span>
      </TableFooter>}>
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <div className="flex min-h-0 min-w-0 flex-1">
            <AccountsTable
              key={activeTab}
              selection={bulk.selection}
              entries={filteredRows}
              density={density}
              loading={loading}
              freezeCount={freezeCount}
              onFreezeColumnsChange={setFreezeCount}
              startIndex={0}
              selectedEntryId={infoEntry?.id}
              onRowClick={openInfoPanel}
              onRowDoubleClick={setViewingEntry}
              onEdit={(entry) => setFormState({ entry })}
              onDelete={setDeleteEntry}
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
        </div>
      </DataTableShell>

      {/* Closing reloads the dropdowns, so an account added here is offered by the next entry
          without the page being reloaded. */}
      {/* Closing reloads the dropdowns, so an account added here is offered by the next entry
          without the page being reloaded. */}
      {viewingEntry && <RecordViewPanel title={viewingEntry.entryCode || viewingEntry.particulars || "Entry"} entity={viewingEntry} sections={accountsInfoSections} formatters={infoPanelFormatters} sidebarAriaLabel="Entry sections" onClose={() => setViewingEntry(null)} />}
      {settingsOpen && <BankAccountsPanel onClose={() => { setSettingsOpen(false); void loadOptions(); }} />}

      {receipt && <ReceiptMessageDialog message={receipt.message} entryId={receipt.entryId} onClose={() => setReceipt(null)} />}

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
