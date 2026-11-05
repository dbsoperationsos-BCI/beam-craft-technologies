"use client";

import { useCallback, useEffect, useState } from "react";
import useStickyTab from "@/components/shared/useStickyTab";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import ImportMenuButton from "@/components/data-table/ImportMenuButton";
import DataTable from "@/components/data-table/DataTable";
import useTableSelection from "@/components/data-table/useTableSelection";
import { VENDOR_IMPORT_COLUMNS } from "@/constants/importColumns";
import { ACTIONS_COLUMN } from "@/components/data-table/tableCells";
import DataTableShell from "@/components/data-table/DataTableShell";
import TableFooter from "@/components/data-table/TableFooter";
import Button from "@/components/shared/Button";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import useCompactView from "@/components/shared/useCompactView";
import TextAreaField from "@/components/shared/TextAreaField";
import OptionsMenu from "@/components/ui/OptionsMenu";
import { useModuleAccess } from "@/components/auth/PermissionsProvider";
import DataTableInfoPanel from "@/components/data-table/DataTableInfoPanel";
import RecordViewPanel from "@/components/data-table/RecordViewPanel";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import VendorFormPanel from "./VendorFormPanel";
import { vendorForInfo, vendorInfoSections, vendorStatusLabels as statusLabels } from "@/constants/infoPanelConfig";
import { changeVendorStatus, createVendor, getVendorOptions, getVendors, removeVendor, updateVendor } from "@/services/assets/assets.service";

/** A status change that has to say why, so the reason sits inside the confirmation itself. */
function ReasonDialog({ action, saving, onClose, onConfirm }) {
  const [reason, setReason] = useState("");
  const removal = action?.status === "REMOVE";
  return <ConfirmDialog
    title={removal ? "Remove vendor permanently?" : `Mark vendor ${statusLabels[action.status]}?`}
    message={removal ? "Are you sure you want to delete this vendor?" : undefined}
    confirmLabel="Confirm"
    busyLabel="Saving..."
    tone={removal ? "danger" : "primary"}
    loading={saving}
    confirmDisabled={!reason.trim()}
    layer="dialogOverPanel"
    onCancel={onClose}
    onConfirm={() => onConfirm(reason)}
  >
    <TextAreaField required label="Reason" value={reason} onChange={(event) => setReason(event.target.value)} rows={4} />
  </ConfirmDialog>;
}

export default function VendorManagementView() {
  // READ lists vendors and opens the detail panel; everything that changes one needs READ_WRITE.
  const { canWrite } = useModuleAccess("ASSET", "Vendor Management");
  const [rows, setRows] = useState([]), [options, setOptions] = useState({}), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [error, setError] = useState(""), [formVendor, setFormVendor] = useState(undefined), [action, setAction] = useState(null);
  const [status, setStatus] = useStickyTab("vendors", "ALL", ["ALL", "ACTIVE", "INACTIVE"]);
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

  const load = useCallback(async () => { setLoading(true); try { const result = await getVendors({ status: status === "ALL" ? undefined : status }); const data = result.data || []; setRows(data); setCounts(result.counts || {}); setLastUpdated(new Date()); setSelectedVendor((current) => current ? data.find((vendor) => vendor.id === current.id) || null : current); } catch (requestError) { showError(requestError.message || "Unable to load vendors."); } finally { setLoading(false); } }, [showError, status]);
  useEffect(() => { getVendorOptions().then((result) => setOptions(result.data || {})).catch((requestError) => showError(requestError.message || "Unable to load vendor options.")); }, [showError]);
  useEffect(() => { const timer = setTimeout(() => void load(), 250); return () => clearTimeout(timer); }, [load]);
  async function save(payload) { setSaving(true); setError(""); try { const editing = Boolean(formVendor?.id); if (editing) await updateVendor(formVendor.id, payload); else await createVendor(payload); setFormVendor(undefined); await load(); showSuccess(editing ? "Vendor updated successfully." : "Vendor added successfully."); } catch (requestError) { setError(requestError.message || "Unable to save vendor."); } finally { setSaving(false); } }
  async function performStatus(vendor, nextStatus, reason) { setSaving(true); try { await changeVendorStatus(vendor.id, { status: nextStatus, reason: reason || null }); setAction(null); await load(); showSuccess("Vendor status updated successfully."); } catch (requestError) { showError(requestError.message || "Unable to update status."); } finally { setSaving(false); } }
  async function confirmAction(reason) { if (action.status !== "REMOVE") return performStatus(action.vendor, action.status, reason); setSaving(true); try { await removeVendor(action.vendor.id, reason); setAction(null); await load(); showSuccess("Vendor removed successfully."); } catch (requestError) { showError(requestError.message || "Unable to remove vendor."); } finally { setSaving(false); } }
  const textCell = (field) => ({ row }) => row.original[field] || "—";
  const columns = [{ accessorKey: "sourceType", header: "Source", cell: ({ row }) => <span className="rounded bg-violet-50 px-2 py-1 font-semibold text-violet-700">{row.original.sourceType || "EXT"}</span> }, { accessorKey: "vendorId", header: "Vendor ID", cell: textCell("vendorId") }, { accessorKey: "vendorName", header: "Vendor Name", cell: textCell("vendorName") }, { accessorKey: "vendorType", header: "Vendor Type", cell: textCell("vendorType") }, { accessorKey: "contactPerson", header: "Contact Person", cell: textCell("contactPerson") }, { accessorKey: "mobileNumber", header: "Mobile", cell: textCell("mobileNumber") }, { accessorKey: "city", header: "City", cell: textCell("city") }, { id: "skills", header: "Skills", accessorFn: (row) => (row.skills || []).join(", "), cell: ({ row }) => (row.original.skills || []).join(", ") || "—" }, { id: "experience", header: "Experience", accessorFn: (row) => row.yearsOfExperience ?? "", cell: ({ row }) => row.original.yearsOfExperience == null ? "—" : `${row.original.yearsOfExperience} years` }, { accessorKey: "rating", header: "Rating", cell: textCell("rating") }, { id: "status", header: "Status", accessorFn: (row) => statusLabels[row.status] || row.status || "", cell: ({ row }) => statusLabels[row.original.status] }, { id: "addedBy", header: "Added By", accessorFn: (row) => row.addedBy?.name || "", cell: ({ row }) => row.original.addedBy?.name || "—" }, { ...ACTIONS_COLUMN, cell: ({ row }) => <OptionsMenu ariaLabel={`Actions for ${row.original.vendorName}`} items={[
    // The column is no longer gated on canWrite: a reader who may change nothing still has to be
    // able to open the record, and on a touch screen this menu is the only way in — a double-click
    // there is the browser's zoom gesture rather than something the row receives.
    { label: "View", onSelect: () => setViewingVendor(row.original) },
    ...(canWrite ? [{ label: "Edit", onSelect: () => setFormVendor(row.original) }, ...["ACTIVE", "INACTIVE"].filter((item) => item !== row.original.status).map((item) => ({ label: `Mark ${statusLabels[item]}`, onSelect: () => item === "ACTIVE" ? void performStatus(row.original, item, "") : setAction({ vendor: row.original, status: item }) })), { label: "Remove Permanently", tone: "danger", onSelect: () => setAction({ vendor: row.original, status: "REMOVE" }) }] : []),
  ]} /> }];
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
  return <section className="flex h-full min-h-0 flex-col"><ModulePageHeader title="Vendors" actions={canWrite ? <><Button variant="primary" onClick={() => setFormVendor(null)}>Add Vendor</Button><ImportMenuButton ariaLabel="More vendor actions" importConfig={vendorImportConfig} /></> : null} tabs={["ALL", "ACTIVE", "INACTIVE"].map((item) => ({ id: item, label: item === "ALL" ? "All" : statusLabels[item], count: (item === "ALL" ? counts.all : counts[item]) ?? 0 }))} tabValue={status} onTabChange={setStatus} tabsAriaLabel="Vendor status filters" /><FloatingNotice notice={notice} onClose={clearNotice} /><DataTableShell className="min-h-0 flex-1 rounded-none border-0" footer={<TableFooter spread><span className="text-xs sm:text-sm">Last updated: {updatedText}</span><span className="shrink-0 text-xs sm:text-sm">Total rows: {rows.length}</span></TableFooter>}><div className="relative flex min-h-0 flex-1 overflow-hidden"><DataTable key={status} columns={columns.filter((column) => column.accessorKey !== "sourceType")} data={rows} density={density} loading={loading} emptyMessage="No vendors found." noMatchMessage="No matching vendors found." ariaLabel="Vendor management table" importConfig={vendorImportConfig} tableClassName="min-w-max" getRowId={(row) => String(row.id)} selectedRowId={selectedVendor ? String(selectedVendor.id) : undefined} onRowClick={(vendor) => { setSelectedVendor(vendor); setInfoPanelState("expanded"); }} onRowDoubleClick={setViewingVendor} features={{ filtering: true, sorting: true, columnVisibility: true, selection: bulk.selection }} /><DataTableInfoPanel title="Vendor Details" entity={vendorForInfo(selectedVendor)} sections={vendorInfoSections} emptyText="Select a vendor row to view details." state={infoPanelState} onToggle={() => setInfoPanelState((current) => current === "expanded" ? "collapsed" : "expanded")} /></div></DataTableShell>{formVendor !== undefined && <VendorFormPanel vendor={formVendor} options={options} saving={saving} error={error} onClose={() => setFormVendor(undefined)} onSave={save} />}{viewingVendor && <RecordViewPanel title={viewingVendor.vendorName || viewingVendor.name || "Vendor"} entity={vendorForInfo(viewingVendor)} sections={vendorInfoSections} sidebarAriaLabel="Vendor sections" onClose={() => setViewingVendor(null)} />}{action && <ReasonDialog action={action} saving={saving} onClose={() => setAction(null)} onConfirm={confirmAction} />}</section>;
}
