"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import useStickyTab from "@/components/shared/useStickyTab";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import ImportMenuButton from "@/components/data-table/ImportMenuButton";
import DataTable from "@/components/data-table/DataTable";
import useTableSelection from "@/components/data-table/useTableSelection";
import { VENDOR_IMPORT_COLUMNS } from "@/constants/importColumns";
import { ACTIONS_COLUMN } from "@/components/data-table/tableCells";
import DataTableShell from "@/components/data-table/DataTableShell";
import KanbanBoard from "@/components/data-table/KanbanBoard";
import TableBoardSwitch, { useTableBoardLayout } from "@/components/data-table/TableBoardSwitch";
import TableFooter from "@/components/data-table/TableFooter";
import Button from "@/components/shared/Button";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import useCompactView from "@/components/shared/useCompactView";
import TextAreaField from "@/components/shared/TextAreaField";
import useFormErrors from "@/components/shared/useFormErrors";
import OptionsMenu from "@/components/ui/OptionsMenu";
import { useModuleAccess } from "@/components/auth/PermissionsProvider";
import DataTableInfoPanel from "@/components/data-table/DataTableInfoPanel";
import RecordViewPanel from "@/components/data-table/RecordViewPanel";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import VendorFormPanel from "./VendorFormPanel";
import VendorPaymentRequestButton from "./VendorPaymentRequestButton";
import VendorPaymentsView from "./VendorPaymentsView";
import VendorViewSwitch from "./VendorViewSwitch";
import { vendorForInfo, vendorInfoSections, vendorStatusLabels as statusLabels } from "@/constants/infoPanelConfig";
import { changeVendorStatus, createVendor, getAllVendors, getVendorOptions, removeVendor, updateVendor } from "@/services/assets/assets.service";
import { vendorLabel } from "@/lib/vendorLabel.mjs";
import { columnCount } from "@/lib/kanbanSummary.mjs";

// Under Active only, a vendor who can join a shoot's production crew: the board's tag, and what the column counts.
const vendorFlag = (vendor, column) => (column.value === "ACTIVE" && vendor.canBeProductionTeamMember ? "Crew-ready" : "");

/** A status change that has to say why, so the reason sits inside the confirmation itself. */
function ReasonDialog({ action, saving, onClose, onConfirm }) {
  const [reason, setReason] = useState("");
  const fields = useFormErrors();
  const removal = action?.status === "REMOVE";
  return <ConfirmDialog
    title={removal ? "Remove vendor permanently?" : `Mark vendor ${statusLabels[action.status]}?`}
    message={removal ? "Are you sure you want to delete this vendor?" : undefined}
    confirmLabel="Confirm"
    busyLabel="Saving..."
    tone={removal ? "danger" : "primary"}
    loading={saving}
    layer="dialogOverPanel"
    onCancel={onClose}
    onConfirm={() => {
      if (!fields.check({ reason: reason.trim() ? "" : "Enter a reason." })) return;
      onConfirm(reason);
    }}
  >
    <TextAreaField required label="Reason" helperText="Why the vendor's status is changing, kept on the vendor's history." value={reason} onChange={(event) => { setReason(event.target.value); fields.clear("reason"); }} error={fields.errors.reason} rows={4} />
  </ConfirmDialog>;
}

/*
 * The Vendors screen is two views: the **register** below, and the **payments** the studio owes its
 * vendors (`VendorPaymentsView`), chosen by the switch beside the heading.
 *
 * The payments view answers for `ACCOUNTS / Payment Request` - who may read what the studio
 * is paying is that permission's answer, not Vendor Management's - so a reader holding only this
 * module is never offered it, and the endpoint behind it refuses them in any case. Split here rather
 * than inside one component so the register's own fetches do not run behind a view that does not use
 * them.
 */
export default function VendorManagementView() {
  const params = useSearchParams();
  const { canRead: canSeePayments } = useModuleAccess("ACCOUNTS", "Payment Request");
  return canSeePayments && params.get("view") === "payments"
    ? <VendorPaymentsView />
    : <VendorRegisterView canSeePayments={canSeePayments} />;
}

function VendorRegisterView({ canSeePayments }) {
  // READ lists vendors and opens the detail panel; everything that changes one needs READ_WRITE.
  const { canWrite } = useModuleAccess("ASSET", "Vendor Management");
  const [rows, setRows] = useState([]), [options, setOptions] = useState({}), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [error, setError] = useState(""), [formVendor, setFormVendor] = useState(undefined), [action, setAction] = useState(null);
  const [status, setStatus] = useStickyTab("vendors", "ALL", ["ALL", "ACTIVE", "INACTIVE"]);
  /*
   * The Board: every vendor in a column per status, so the status tabs step aside while it shows
   * and the list is read unfiltered. Dropping a card runs the ⋮ menu's own Mark entry - Active
   * straight away, Inactive through the same reason dialog - and only for somebody who may write.
   */
  const [layout, setLayout] = useTableBoardLayout("asset-vendors");
  const onBoard = layout === "board";
  const listStatus = onBoard ? "ALL" : status;
  // Counts every vendor rather than the tab being shown, so the numbers stay put as tabs change.
  const [counts, setCounts] = useState({});
  const [selectedVendor, setSelectedVendor] = useState(null);
  // Double-click reads the row in full; editing is the ⋮ menu's own entry.
  const [viewingVendor, setViewingVendor] = useState(null);
  const [infoPanelState, setInfoPanelState] = useState("collapsed");
  const { notice, showSuccess, showError, clearNotice } = useNotice();
  const { density } = useCompactView();
  // When this view last read the list, matching how the asset, employee and project tables report
  // it in their own footers.
  const [lastUpdated, setLastUpdated] = useState(null);
  const updatedText = lastUpdated ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(lastUpdated) : "—";
  // Import, offered in the header's ⋮ and in the table's, defined once.
  const vendorImportConfig = canWrite ? {
    prefix: "/api/vendors",
    columns: VENDOR_IMPORT_COLUMNS,
    templateName: "vendor-import-template",
    title: "Import Vendors",
    onImported: () => load(),
  } : undefined;

  const load = useCallback(async () => { setLoading(true); try { const result = await getAllVendors({ status: listStatus === "ALL" ? undefined : listStatus }); const data = result.data || []; setRows(data); setCounts(result.counts || {}); setLastUpdated(new Date()); setSelectedVendor((current) => current ? data.find((vendor) => vendor.id === current.id) || null : current); } catch (requestError) { showError(requestError.message || "Unable to load vendors."); } finally { setLoading(false); } }, [showError, listStatus]);
  useEffect(() => { getVendorOptions().then((result) => setOptions(result.data || {})).catch((requestError) => showError(requestError.message || "Unable to load vendor options.")); }, [showError]);
  useEffect(() => { const timer = setTimeout(() => void load(), 250); return () => clearTimeout(timer); }, [load]);
  async function save(payload) { setSaving(true); setError(""); try { const editing = Boolean(formVendor?.id); if (editing) await updateVendor(formVendor.id, payload); else await createVendor(payload); setFormVendor(undefined); await load(); showSuccess(editing ? "Vendor updated successfully." : "Vendor added successfully."); } catch (requestError) { setError(requestError.message || "Unable to save vendor."); } finally { setSaving(false); } }
  async function performStatus(vendor, nextStatus, reason) { setSaving(true); try { await changeVendorStatus(vendor.id, { status: nextStatus, reason: reason || null }); setAction(null); await load(); showSuccess("Vendor status updated successfully."); } catch (requestError) { showError(requestError.message || "Unable to update status."); } finally { setSaving(false); } }
  async function confirmAction(reason) { if (action.status !== "REMOVE") return performStatus(action.vendor, action.status, reason); setSaving(true); try { await removeVendor(action.vendor.id, reason); setAction(null); await load(); showSuccess("Vendor removed successfully."); } catch (requestError) { showError(requestError.message || "Unable to remove vendor."); } finally { setSaving(false); } }
  const textCell = (field) => ({ row }) => row.original[field] || "—";
  // A vendor's ⋮ - read by the table row and the Board card.
  const vendorActionItems = (vendor) => [
    // The column is no longer gated on canWrite: a reader who may change nothing still has to be
    // able to open the record, and on a touch screen this menu is the only way in — a double-click
    // there is the browser's zoom gesture rather than something the row receives.
    { label: "View", onSelect: () => setViewingVendor(vendor) },
    ...(canWrite ? [{ label: "Edit", onSelect: () => setFormVendor(vendor) }, ...["ACTIVE", "INACTIVE"].filter((item) => item !== vendor.status).map((item) => ({ label: `Mark ${statusLabels[item]}`, onSelect: () => item === "ACTIVE" ? void performStatus(vendor, item, "") : setAction({ vendor, status: item }) })), { label: "Remove Permanently", tone: "danger", onSelect: () => setAction({ vendor, status: "REMOVE" }) }] : []),
  ];
  const columns = [{ accessorKey: "sourceType", header: "Source", cell: ({ row }) => <span className="rounded bg-violet-50 px-2 py-1 font-semibold text-violet-700">{row.original.sourceType || "EXT"}</span> }, { accessorKey: "vendorId", header: "Vendor ID", cell: textCell("vendorId") }, { accessorKey: "vendorName", header: "Vendor Name", cell: textCell("vendorName") }, { accessorKey: "vendorType", header: "Vendor Type", cell: textCell("vendorType") }, { accessorKey: "contactPerson", header: "Contact Person", cell: textCell("contactPerson") }, { accessorKey: "mobileNumber", header: "Mobile", cell: textCell("mobileNumber") }, { accessorKey: "city", header: "City", cell: textCell("city") }, { id: "skills", header: "Skills", accessorFn: (row) => (row.skills || []).join(", "), cell: ({ row }) => (row.original.skills || []).join(", ") || "—" }, { id: "experience", header: "Experience", accessorFn: (row) => row.yearsOfExperience ?? "", cell: ({ row }) => row.original.yearsOfExperience == null ? "—" : `${row.original.yearsOfExperience} years` }, { accessorKey: "rating", header: "Rating", cell: textCell("rating") }, { id: "status", header: "Status", accessorFn: (row) => statusLabels[row.status] || row.status || "", cell: ({ row }) => statusLabels[row.original.status] }, { id: "addedBy", header: "Added By", accessorFn: (row) => row.addedBy?.name || "", cell: ({ row }) => row.original.addedBy?.name || "—" }, { ...ACTIONS_COLUMN, cell: ({ row }) => <OptionsMenu ariaLabel={`Actions for ${row.original.vendorName}`} items={vendorActionItems(row.original)} /> }];
  const boardColumns = ["ACTIVE", "INACTIVE"].map((item) => ({ value: item, label: statusLabels[item] }));
  const dropVendor = (vendor, to) => (to === "ACTIVE" ? void performStatus(vendor, to, "") : setAction({ vendor, status: to }));
  /*
   * The tick boxes, for a role holding `ADMIN / Table Select All`.
   *
   * `requireReason` because removing a vendor is a removal *with a reason on it* - `deleteInput`
   * refuses a body without one and the audit row carries it - so the confirmation asks for the
   * reason once and it stands for the whole selection, exactly as `ReasonDialog` asks for one row.
   */
  const bulk = useTableSelection({
    prefix: "/api/vendors",
    rows,
    rowId: (row) => String(row.id),
    noun: "vendor",
    canDelete: canWrite,
    requireReason: true,
    reasonLabel: "Reason for removing these vendors",
    showSuccess,
    showError,
    onDeleted: () => load(),
  });
  return <section className="flex h-full min-h-0 flex-col"><ModulePageHeader title="Vendors" titleAccessory={<VendorViewSwitch view="register" canSeePayments={canSeePayments} />} actions={<><TableBoardSwitch value={layout} onChange={setLayout} /><VendorPaymentRequestButton onRaised={showSuccess} />{canWrite && <Button variant="primary" onClick={() => setFormVendor(null)}>Add Vendor</Button>}</>} menu={canWrite && <ImportMenuButton ariaLabel="More vendor actions" importConfig={vendorImportConfig} />} tabs={onBoard ? undefined : ["ALL", "ACTIVE", "INACTIVE"].map((item) => ({ id: item, label: item === "ALL" ? "All" : statusLabels[item], count: (item === "ALL" ? counts.all : counts[item]) ?? 0 }))} tabValue={status} onTabChange={setStatus} tabsAriaLabel="Vendor status filters" /><FloatingNotice notice={notice} onClose={clearNotice} />{onBoard ? <KanbanBoard rows={rows} columns={boardColumns} statusOf={(vendor) => vendor.status} /* Under Active only, the crew-ready vendors, each tagged. */ columnAmount={(rows, column) => (column.value === "ACTIVE" ? columnCount(rows, (vendor) => Boolean(vendorFlag(vendor, column)), "Crew-ready") : null)} cardFlag={vendorFlag} card={{ title: (vendor) => vendorLabel(vendor), subtitle: (vendor) => [vendor.vendorId, vendor.contactPerson].filter(Boolean).join(" · "), meta: (vendor) => [vendor.vendorType, vendor.city].filter(Boolean).join(" · ") }} getRowId={(vendor) => String(vendor.id)} onOpen={setViewingVendor} /* The card's ⋮ is the row's ⋮. */ cardActions={vendorActionItems} canDropAt={(vendor, to) => canWrite && vendor.status !== to} onDrop={dropVendor} loading={loading} noun="vendors" ariaLabel="Vendors board" /> : <DataTableShell className="min-h-0 flex-1 rounded-none border-0" footer={<TableFooter spread><span className="text-xs sm:text-sm">Last updated: {updatedText}</span><span className="shrink-0 text-xs sm:text-sm">Total rows: {rows.length}</span></TableFooter>}><div className="relative flex min-h-0 flex-1 overflow-hidden"><DataTable key={status} columns={columns.filter((column) => column.accessorKey !== "sourceType")} data={rows} density={density} loading={loading} emptyMessage="No vendors found." noMatchMessage="No matching vendors found." ariaLabel="Vendor management table" importConfig={vendorImportConfig} tableClassName="min-w-max" getRowId={(row) => String(row.id)} selectedRowId={selectedVendor ? String(selectedVendor.id) : undefined} onRowClick={(vendor) => { setSelectedVendor(vendor); setInfoPanelState("expanded"); }} onRowDoubleClick={setViewingVendor} features={{ filtering: true, sorting: true, columnVisibility: true, selection: bulk.selection }} /><DataTableInfoPanel title="Vendor Details" entity={vendorForInfo(selectedVendor)} sections={vendorInfoSections} emptyText="Select a vendor row to view details." state={infoPanelState} onToggle={() => setInfoPanelState((current) => current === "expanded" ? "collapsed" : "expanded")} /></div></DataTableShell>}{formVendor !== undefined && <VendorFormPanel vendor={formVendor} options={options} saving={saving} error={error} onClose={() => setFormVendor(undefined)} onSave={save} />}{viewingVendor && <RecordViewPanel title={vendorLabel(viewingVendor) || viewingVendor.name || "Vendor"} entity={vendorForInfo(viewingVendor)} sections={vendorInfoSections} sidebarAriaLabel="Vendor sections" onClose={() => setViewingVendor(null)} />}{action && <ReasonDialog action={action} saving={saving} onClose={() => setAction(null)} onConfirm={confirmAction} />}</section>;
}
