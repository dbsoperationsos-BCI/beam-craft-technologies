"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import DataTable from "@/components/data-table/DataTable";
import DataTableShell from "@/components/data-table/DataTableShell";
import DataTableInfoPanel from "@/components/data-table/DataTableInfoPanel";
import RecordViewPanel from "@/components/data-table/RecordViewPanel";
import TableFooter from "@/components/data-table/TableFooter";
import { buildTableColumns, defaultVisibilityFor } from "@/components/data-table/tableCells";
import OptionsMenu from "@/components/ui/OptionsMenu";
import Button from "@/components/shared/Button";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import useCompactView from "@/components/shared/useCompactView";
import useStickyTab from "@/components/shared/useStickyTab";
import useTableSelection from "@/components/data-table/useTableSelection";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Dialog from "@/components/ui/Dialog";
import ShareableMessage from "@/components/shared/ShareableMessage";
import { useRouteAccess } from "@/components/auth/PermissionsProvider";
import { API_URL } from "@/services/api/client";
import { createClientSiteKey, deleteClientInvite, discardClientSubscriptionChange, listClientInvites, publishClientSubscription, resetClientPassword } from "@/services/subscribe/client-onboarding.service";
import { CLIENT_TABS, LIVE_TABS, liveRow, PRODUCTS, clientInfoSections, clientRow, clientStatusStyles, clientTableFieldsFor, inTab } from "@/constants/subscriptionProducts.mjs";
import ClientInviteDialog from "./ClientInviteDialog";
import ClientOnboardingInviteDialog from "./ClientOnboardingInviteDialog";
import SubscriptionDialog from "./SubscriptionDialog";
import { useUrlParam } from "@/lib/stayOnRefresh";

// Client Details → Import: the template's columns, as the server reads them (client-onboarding controller).
const CLIENT_IMPORT_COLUMNS = [
  { label: "Company Name", required: true, aliases: ["Name Of The Company"] },
  { label: "Address", required: true },
  { label: "GST Number", required: true, aliases: ["GST"] },
  { label: "PAN Number", required: true, aliases: ["PAN"] },
  { label: "Number Of Users Needed", required: true, aliases: ["Users", "Number Of Users"] },
  { label: "Main Contact Name", required: true },
  { label: "Main Contact Number", required: true, aliases: ["Main Contact Phone"] },
  { label: "Main Contact Designation", required: true },
  { label: "Secondary Contact Name", required: true },
  { label: "Secondary Contact Number", required: true, aliases: ["Secondary Contact Phone"] },
  { label: "Secondary Contact Designation", required: true },
  { label: "Company Email ID", aliases: ["Email", "Contact Email"] },
  { label: "Product" },
];

const errorMessage = (error, fallback) => error?.data?.message || error?.message || fallback;

// The lines the client's server takes into its `.env` to read its subscription from BeamCraft.
const siteEnvLines = ({ subdomain, siteKey }) => [`BEAMCRAFT_SITE=${subdomain}`, `BEAMCRAFT_SITE_KEY=${siteKey}`, `BEAMCRAFT_API_URL=${API_URL}`].join("\n");

/**
 * Beam Craft's client companies, laid out as the Employee Repository is: tabs by where each invite
 * stands, the table, the info panel beside it, and the full record on double-click. A company arrives
 * here only through its own onboarding form - there is no Add, by design.
 *
 * With a `product` it is that product's page under SUBSCRIBE; without one it is HRM -> Client Details,
 * every client together.
 */
export default function SubscriptionClientsPage(props) {
  // The open form and the selected row live in the address, which is read through a Suspense boundary.
  return <Suspense fallback={null}><SubscriptionClientsScreen {...props} /></Suspense>;
}

function SubscriptionClientsScreen({ product = null }) {
  const productLabel = product ? PRODUCTS[product] : "Client Details";
  const fields = clientTableFieldsFor(product);
  // Every change is made in HRM -> Client Details; a product's page under SUBSCRIBE only shows its clients.
  const { canWrite: canWriteRoute } = useRouteAccess();
  const canWrite = canWriteRoute && !product;
  // A product's page is a list of that product's live clients: select and delete work there too;
  // every other change (set up, edit, reset) is made in Client Management → Client Details.
  const canDelete = canWriteRoute;
  const { density } = useCompactView();
  const { notice, showNotice, showSuccess, showError, clearNotice } = useNotice();
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  // A product's page shows only what is live (All / Active / Expired); Client Details shows every step.
  const tabs = product ? LIVE_TABS : CLIENT_TABS;
  const [activeTab, setActiveTab] = useStickyTab(`clients-${product || "all"}`, "All", tabs);
  const [stats, setStats] = useState({ total: 0 });
  const [freezeCount, setFreezeCount] = useState(2);
  // The row shown in the info panel, by id - read from the latest rows, so an action or a reload
  // shows there at once, and a deleted client leaves it.
  // What is open stays open through a refresh: the selected row (?row=) and the form or record view
  // (?open=view:<id> | edit:<id> | subscription:<id> | invite | invites). A typed form keeps its draft too.
  const [infoRowId, setInfoRowId] = useUrlParam("row");
  const [infoPanelState, setInfoPanelState] = useState(() => (infoRowId ? "expanded" : "collapsed"));
  const [openParam, setOpenParam] = useUrlParam("open");
  const [openKind, openId] = String(openParam || "").split(/:(.*)/s);
  const [deletingRow, setDeletingRow] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  // Update site / Discard changes, each confirmed first: `{ row, action: "publish" | "discard" }`.
  const [pendingAction, setPendingAction] = useState(null);
  const [pendingBusy, setPendingBusy] = useState(false);
  // Reset password: the row asked about, then the message with the new password, shown once.
  const [resettingRow, setResettingRow] = useState(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [newPasswordMessage, setNewPasswordMessage] = useState(null);
  // Site key: the row asked about, then the new key's `.env` lines, shown once.
  const [keyingRow, setKeyingRow] = useState(null);
  const [keyBusy, setKeyBusy] = useState(false);
  const [newSiteEnv, setNewSiteEnv] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listClientInvites(product);
      setInvites(Array.isArray(result?.data) ? result.data : []);
      setLastUpdated(new Date());
    } catch (error) {
      setInvites([]);
      showError(errorMessage(error, "Unable to load clients."));
    } finally {
      setLoading(false);
    }
  }, [product, showError]);

  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);

  const rows = useMemo(() => (product ? invites.map(clientRow).map(liveRow).filter(Boolean) : invites.map(clientRow)), [invites, product]);
  const shown = useMemo(() => rows.filter((row) => inTab(row, activeTab)), [rows, activeTab]);
  const infoRow = useMemo(() => rows.find((row) => row.id === infoRowId) || null, [rows, infoRowId]);
  const openRow = useMemo(() => (openId ? rows.find((row) => row.id === openId) || null : null), [rows, openId]);
  const viewingRow = openKind === "view" ? openRow : null;
  const editingRow = openKind === "edit" ? openRow : null;
  const subscriptionRow = openKind === "subscription" ? openRow : null;
  const inviting = openKind === "invite";
  const viewingInvites = openKind === "invites";
  const { setViewingRow, setEditingRow, setSubscriptionRow, setInviting } = useMemo(() => {
    const opener = (kind) => (row) => setOpenParam(row ? `${kind}:${row.id}` : null);
    return { setViewingRow: opener("view"), setEditingRow: opener("edit"), setSubscriptionRow: opener("subscription"), setInviting: (value) => setOpenParam(value ? "invite" : null) };
  }, [setOpenParam]);
  const counts = useMemo(() => Object.fromEntries(tabs.map((tab) => [tab, rows.filter((row) => inTab(row, tab)).length])), [rows, tabs]);

  // Select all -> Delete, as every table in the OS does it: the ticks, the bar, one confirmation.
  const bulk = useTableSelection({
    prefix: "/api/subscribe/client-onboarding/invites",
    rows: shown,
    noun: "client",
    plural: "clients",
    canDelete,
    showSuccess,
    showError,
    onDeleted: () => load(),
  });


  async function confirmResetPassword() {
    setResetBusy(true);
    try {
      const result = await resetClientPassword(resettingRow.id);
      setResettingRow(null);
      setNewPasswordMessage(result?.data?.accountMessage || null);
    } catch (error) {
      showError(errorMessage(error, "Unable to reset the password."));
    } finally {
      setResetBusy(false);
    }
  }

  async function confirmSiteKey() {
    setKeyBusy(true);
    try {
      const result = await createClientSiteKey(keyingRow.id);
      setKeyingRow(null);
      setNewSiteEnv(result?.data?.siteKey ? siteEnvLines(result.data) : null);
      await load();
    } catch (error) {
      showError(errorMessage(error, "Unable to make the site key."));
    } finally {
      setKeyBusy(false);
    }
  }

  async function confirmPendingAction() {
    const { row, action } = pendingAction;
    setPendingBusy(true);
    try {
      const result = action === "publish" ? await publishClientSubscription(row.id) : await discardClientSubscriptionChange(row.id);
      setPendingAction(null);
      showSuccess(result?.message || (action === "publish" ? "Site updated." : "Pending change discarded."));
      await load();
    } catch (error) {
      showError(errorMessage(error, action === "publish" ? "Unable to update the site." : "Unable to discard the change."));
    } finally {
      setPendingBusy(false);
    }
  }

  async function confirmDelete() {
    setDeleteBusy(true);
    try {
      await deleteClientInvite(deletingRow.id);
      if (infoRowId === deletingRow.id) setInfoRowId(null);
      setDeletingRow(null);
      showSuccess("Client deleted.");
      await load();
    } catch (error) {
      showError(errorMessage(error, "Unable to delete the client."));
    } finally {
      setDeleteBusy(false);
    }
  }

  const defaultVisibility = useMemo(() => defaultVisibilityFor(fields), [fields]);
  const columns = useMemo(() => buildTableColumns({
    fields,
    startIndex: 0,
    statusStyles: clientStatusStyles,
    renderActions: (row) => (product ? (canDelete ? <OptionsMenu ariaLabel={`Actions for ${row.companyName || "client"}`} items={[
      { label: "Delete", tone: "danger", onSelect: () => setDeletingRow(row) },
    ]} /> : null) : canWrite ? <OptionsMenu ariaLabel={`Actions for ${row.companyName || "client"}`} items={[
      ...(row.state === "Submitted" ? [{ label: row.client?.activatedAt ? "Edit subscription" : "Set up account", onSelect: () => setSubscriptionRow(row) }] : []),
      ...(row.client?.activatedAt ? [
        { label: "Reset password", onSelect: () => setResettingRow(row) },
        // Not a setup step: a site on our own server connects by itself (its key is worked out from the
        // shared secret). A key made here is only for a site running on another server.
        { label: "Manual site key (other server)", onSelect: () => setKeyingRow(row) },
      ] : []),
      ...(row.client?.pendingChanges ? [
        { label: "Update site", onSelect: () => setPendingAction({ row, action: "publish" }) },
        { label: "Discard changes", onSelect: () => setPendingAction({ row, action: "discard" }) },
      ] : []),
      { label: "Edit", onSelect: () => setEditingRow(row) },
      { label: "Delete", tone: "danger", onSelect: () => setDeletingRow(row) },
    ]} /> : null),
  }), [canDelete, canWrite, fields, product, setEditingRow, setSubscriptionRow]);

  const updatedText = lastUpdated ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(lastUpdated) : "—";

  return <section className="flex h-full min-h-0 w-full min-w-0 flex-col">
    <ModulePageHeader
      title={productLabel}
      tabs={tabs.map((tab) => ({ id: tab, label: tab, count: counts[tab] || 0 }))}
      tabValue={activeTab}
      onTabChange={setActiveTab}
      tabsAriaLabel={`${productLabel} clients`}
      // Invites are sent from HRM -> Client Details only; a product page just lists that product's clients.
      // The product pages are lists only; the monitor checks every site on its own every 5 minutes.
      actions={!product && canWrite ? <Button type="button" variant="primary" onClick={() => setInviting(true)}>Create Onboarding Invite</Button> : null}
      // Every invite sent, with what became of each - as the Employee Repository's own ⋮, after Nebula.
      menu={!product && canWrite ? <OptionsMenu ariaLabel="Client invite options" items={[{ label: "View All Invites", onSelect: () => setOpenParam("invites") }]} /> : null}
    />
    <FloatingNotice notice={notice} onClose={clearNotice} />
    <DataTableShell className="min-h-0 flex-1" footer={<TableFooter spread className="z-30"><span>Last updated: {updatedText}</span><span>Total rows: {stats.total}</span></TableFooter>}>
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1">
          <DataTable
            key={activeTab}
            // Table Options → Import: companies filed as submitted forms, ready for Set up account. On a
            // product page every imported company is that product's.
            importConfig={canDelete ? {
              prefix: product ? `/api/subscribe/client-onboarding/invites/product/${product}` : "/api/subscribe/client-onboarding/invites",
              title: "Import Clients",
              templateName: `${(product || "all").toLowerCase()}-clients-import-template`,
              columns: CLIENT_IMPORT_COLUMNS.filter((column) => !(product && column.label === "Product")),
              hints: [
                "Each row arrives as Submitted, ready for ⋮ → Set up account. Add the logo and favicon afterwards with ⋮ → Edit.",
                "GST is 15 characters and PAN 10; phone numbers include the country code, e.g. +91 9876543210.",
                ...(product ? [] : ["Product is optional: Orbyt or Nilo."]),
              ],
              onImported: () => load(),
            } : undefined}
            columns={columns}
            data={shown}
            density={density}
            loading={loading}
            loadingMessage="Loading clients..."
            emptyMessage={product ? "No live clients for this product yet. Accounts are set up in HRM → Client Details." : "No clients yet. Send an onboarding invite to add one."}
            noMatchMessage="No matching clients found."
            selectedRowId={infoRow?.id}
            onRowClick={(row) => { setInfoRowId(row.id); setInfoPanelState("expanded"); }}
            onRowDoubleClick={setViewingRow}
            defaultColumnVisibility={defaultVisibility}
            onVisibleRowsChange={setStats}
            ariaLabel={`${productLabel} clients table`}
            features={{
              filtering: true,
              sorting: true,
              columnVisibility: true,
              columnResize: true,
              frozenColumns: { count: freezeCount, onChange: setFreezeCount },
              infiniteScroll: { pageSize: 50 },
              selection: canDelete ? bulk.selection : undefined,
              csvExport: { enabled: true, fileName: `${(product || "all").toLowerCase()}-clients`, onResult: (exported) => showNotice(exported ? "Clients CSV export downloaded." : "No rows available to export.") },
            }}
          />
        </div>
        <DataTableInfoPanel
          title="Info"
          entity={infoRow}
          sections={clientInfoSections}
          emptyText="Select a client to view details."
          state={infoPanelState}
          onToggle={() => setInfoPanelState((current) => (current === "expanded" ? "collapsed" : "expanded"))}
        />
      </div>
    </DataTableShell>
    {viewingRow && <RecordViewPanel title={viewingRow.companyName || viewingRow.contactName} entity={viewingRow} sections={clientInfoSections} sidebarAriaLabel="Client sections" onClose={() => setViewingRow(null)} />}
    {subscriptionRow && <SubscriptionDialog row={subscriptionRow} onClose={() => setSubscriptionRow(null)} onSaved={(message) => { if (message) showSuccess(message); void load(); }} />}
    {resettingRow && <ConfirmDialog
      title="Reset password"
      message={`Make a new password for ${resettingRow.client?.adminUsername || "the Admin"} on ${resettingRow.client?.subdomain || "the client"}.beamcraft.tech? The old password stops working at once.`}
      confirmLabel="Reset password"
      busyLabel="Resetting..."
      tone="primary"
      loading={resetBusy}
      onCancel={() => setResettingRow(null)}
      onConfirm={() => void confirmResetPassword()}
    />}
    {newPasswordMessage && <Dialog title="New Password" size="md" onClose={() => setNewPasswordMessage(null)} footer={<Button className="max-sm:flex-1" type="button" onClick={() => setNewPasswordMessage(null)}>Close</Button>}>
      <ShareableMessage label="Message to send them" rows={10} message={newPasswordMessage} />
      <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">This password is shown only once. Copy the message before closing.</p>
    </Dialog>}
    {keyingRow && <ConfirmDialog
      title="Manual site key"
      message={`Not needed for ${keyingRow.client?.subdomain || "the client"}.beamcraft.tech on our own server: it connects to Beam Craft by itself. Make a manual key only if this client's site runs on another server.${keyingRow.client?.hasSiteKey ? " Making a new one stops the old manual key at once." : ""}`}
      confirmLabel="Make key"
      busyLabel="Making..."
      tone="primary"
      loading={keyBusy}
      onCancel={() => setKeyingRow(null)}
      onConfirm={() => void confirmSiteKey()}
    />}
    {newSiteEnv && <Dialog title="Manual Site Key" size="md" onClose={() => setNewSiteEnv(null)} footer={<Button className="max-sm:flex-1" type="button" onClick={() => setNewSiteEnv(null)}>Close</Button>}>
      <ShareableMessage label="For the server's .env, not for the client" rows={4} message={newSiteEnv} />
      <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">Only for a site on another server. This key is shown only once: put it in that server&apos;s .env before closing, and never send it to the client.</p>
    </Dialog>}
    {pendingAction && <ConfirmDialog
      title={pendingAction.action === "publish" ? "Update site" : "Discard changes"}
      message={pendingAction.action === "publish"
        ? `Put the saved changes live on ${pendingAction.row.client?.subdomain || "the client"}.beamcraft.tech now, as version ${(pendingAction.row.client?.liveVersion || 0) + 1}?`
        : `Discard the saved changes for ${pendingAction.row.companyName || "this client"}? Their live site stays on ${pendingAction.row.versionLabel || "its current version"}.`}
      confirmLabel={pendingAction.action === "publish" ? "Update site" : "Discard"}
      busyLabel={pendingAction.action === "publish" ? "Updating..." : "Discarding..."}
      tone={pendingAction.action === "publish" ? "primary" : "danger"}
      loading={pendingBusy}
      onCancel={() => setPendingAction(null)}
      onConfirm={() => void confirmPendingAction()}
    />}
    {editingRow && <ClientInviteDialog row={editingRow} onClose={() => setEditingRow(null)} onSaved={() => { setEditingRow(null); showSuccess("Client details saved."); void load(); }} />}
    {deletingRow && <ConfirmDialog
      title="Delete client"
      message={`Delete ${deletingRow.companyName || "this client"}? Their details, subscription and onboarding link are removed for good${deletingRow.client?.subdomain ? `, and ${deletingRow.client.subdomain}.beamcraft.tech can no longer read its plan from Beam Craft` : ""}.`}
      confirmLabel="Delete"
      busyLabel="Deleting..."
      loading={deleteBusy}
      onCancel={() => setDeletingRow(null)}
      onConfirm={() => void confirmDelete()}
    />}
    {(inviting || viewingInvites) && <ClientOnboardingInviteDialog
      key={openKind}
      initialMode={viewingInvites ? "list" : "create"}
      onClose={() => setInviting(false)}
      onInviteCreated={() => void load()}
      onInviteSent={(message, failed) => (failed ? showError : showSuccess)(message)}
    />}
  </section>;
}
