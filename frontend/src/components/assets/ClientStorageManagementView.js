"use client";

import { useCallback, useEffect, useState } from "react";
import useStickyTab from "@/components/shared/useStickyTab";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import ImportMenuButton from "@/components/data-table/ImportMenuButton";
import DataTable from "@/components/data-table/DataTable";
import useTableSelection from "@/components/data-table/useTableSelection";
import { CLIENT_STORAGE_IMPORT_COLUMNS } from "@/constants/importColumns";
import { ACTIONS_COLUMN } from "@/components/data-table/tableCells";
import DataTableShell from "@/components/data-table/DataTableShell";
import TableFooter from "@/components/data-table/TableFooter";
import Button from "@/components/shared/Button";
import Dropdown from "@/components/shared/Dropdown";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import useCompactView from "@/components/shared/useCompactView";
import OptionsMenu from "@/components/ui/OptionsMenu";
import { useModuleAccess } from "@/components/auth/PermissionsProvider";
import Dialog from "@/components/ui/Dialog";
import ClientStorageFormPanel from "./ClientStorageFormPanel";
import { clientStorageChecks as checks } from "@/constants/formPanelConfig";
import DataTableInfoPanel from "@/components/data-table/DataTableInfoPanel";
import RecordViewPanel from "@/components/data-table/RecordViewPanel";
import { clientStorageForInfo, clientStorageInfoSections } from "@/constants/infoPanelConfig";
import ClientStorageStatusDialog from "./ClientStorageStatusDialog";
import ClientStorageTransitDialog from "./ClientStorageTransitDialog";
import { getEmployeeDirectory } from "@/services/hrm/employees.service";
import {
  changeClientStorageStatus,
  createClientStorageRecord,
  getClientStorageOptions,
  getClientStorageRecords,
  getClientStorageShoots,
  updateClientStorageRecord,
} from "@/services/assets/assets.service";

/**
 * Which moves a record can make is decided by the API and carried on the record itself as
 * `nextStatuses`, so the row menu can only ever offer something the server would accept.
 *
 * These three collect their own fields in the shared status dialog first; "Assigned" and
 * "In Transit" have dialogs of their own, and anything else applies straight from the menu.
 */
const detailSteps = ["Hand In", "Footage Backup Done", "HDD Out"];
/**
 * The tabs shown under the header: the two steps at the start of the flow, plus the missed backup,
 * which is the one status that needs chasing rather than simply passing through. Everything else
 * (Hand In, the completed backup, and the run from HDD Out to Delivered) is read under All.
 */
const statusTabs = [["all", "All"], ["Yet to Receive", "Yet to Receive"], ["Yet to Start", "Yet to Start"], ["Footage BackUp not done", "Footage BackUp not done"]];
const assignedStatus = "Assigned";
const transitStatus = "In Transit";

function formatDateTime(value) {
  return value ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
}

function formatDate(value) {
  return value ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(value)) : "—";
}

/**
 * The shell both small dialogs below share. There is still no shared confirmation dialog in
 * `components/`, so this at least keeps the two on this page from drifting apart.
 */
function SmallDialog({ title, description, error, saving, confirmLabel, confirmVariant = "primary", onClose, onSubmit, children }) {
  return <Dialog
    title={title}
    description={description}
    layer="dialogOverPanel"
    busy={saving}
    onClose={onClose}
    footer={<>
      <Button className="max-sm:flex-1" type="button" onClick={onClose} disabled={saving}>Cancel</Button>
      <Button className="max-sm:flex-1" type="button" variant={confirmVariant} disabled={saving} onClick={onSubmit}>{saving ? "Saving..." : confirmLabel}</Button>
    </>}
  >
    {children}
    {/* Shown here rather than only on the page, which the overlay covers while this is open. */}
    {error && <p role="alert" className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
  </Dialog>;
}

/** Post production naming the person who will carry the disc out to the client. */
function AssignDialog({ record, employees, error, saving, onClose, onConfirm }) {
  const [assignedToId, setAssignedToId] = useState("");
  return <SmallDialog title={`Assign ${record.storageId}`} description="Choose the person this hard disc is handed to. They then move it to In Transit and on to Delivered." error={error} saving={saving} confirmLabel="Assign" onClose={onClose} onSubmit={() => onConfirm(assignedToId)}>
    {/* The dialog stacks at z-[140], so the menu has to open above that to be clickable. */}
    <Dropdown searchable required className="mt-4" menuZIndexClassName="z-[150]" label="Assigned To" value={assignedToId} onChange={setAssignedToId} placeholder="Select employee" options={employees.map((employee) => ({ value: String(employee.id), label: `${employee.employeeName} (${employee.employeeId || "—"})` }))} />
  </SmallDialog>;
}

export default function ClientStorageManagementView() {
  // There is no Add here - records are raised by the project start flow - so READ_WRITE decides
  // only whether a record can be edited or moved along the flow.
  const { canWrite } = useModuleAccess("ASSET", "Client Storage");
  const [rows, setRows] = useState([]);
  const [shoots, setShoots] = useState([]);
  const [options, setOptions] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { notice, showSuccess, showError, clearNotice } = useNotice();
  const { density } = useCompactView();
  const [formRecord, setFormRecord] = useState(undefined);
  // Carries which step is being moved into, since three of them share one dialog.
  const [statusChange, setStatusChange] = useState(null);
  const [statusFilter, setStatusFilter] = useStickyTab("client-storage", "all", statusTabs.map(([value]) => value));
  const [counts, setCounts] = useState({});
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [assignRecord, setAssignRecord] = useState(null);
  const [transitRecord, setTransitRecord] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [selectedRecord, setSelectedRecord] = useState(null);
  // Double-click reads the row in full; editing is the ⋮ menu's own entry.
  const [viewingRecord, setViewingRecord] = useState(null);
  const [infoPanelState, setInfoPanelState] = useState("collapsed");

  /*
   * The tick boxes, for a role holding `ADMIN / Table Select All`. `requireReason` because a record
   * leaves the register *with a reason on it* - `deleteInput` refuses a body without one - so the
   * confirmation asks once and that reason is written against every record in the selection.
   */
  const bulk = useTableSelection({
    prefix: "/api/client-storage",
    rows,
    rowId: (row) => String(row.id),
    noun: "record",
    canDelete: canWrite,
    requireReason: true,
    reasonLabel: "Reason for removing these records",
    showSuccess,
    showError,
    onDeleted: () => load(),
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // The tab counts and the last-updated note describe every record, so they are read from the
      // response rather than the filtered page.
      const result = await getClientStorageRecords(statusFilter === "all" ? undefined : { status: statusFilter });
      setRows(result.data || []);
      setCounts(result.counts || {});
      setLastUpdatedAt(result.lastUpdatedAt || null);
      setError("");
    } catch (requestError) {
      showError(requestError.message || "Unable to load client storage records.");
    } finally {
      setLoading(false);
    }
  }, [showError, statusFilter]);

  /*
   * Import, offered in the header's ⋮ and in the table's, defined once.
   *
   * Gated on `canWrite` like every other write on this screen, so a reader is offered nothing to
   * press; the ⋮ hides itself when the config is `undefined`.
   */
  const storageImportConfig = canWrite ? {
    prefix: "/api/client-storage",
    columns: CLIENT_STORAGE_IMPORT_COLUMNS,
    templateName: "client-storage-import-template",
    title: "Import Client Storage",
    onImported: () => void load(),
  } : undefined;

  // Deferred so the fetch's setState does not run synchronously inside the effect body.
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);
  useEffect(() => {
    Promise.all([getClientStorageShoots(), getClientStorageOptions(), getEmployeeDirectory()])
      .then(([shootResult, optionResult, employeeResult]) => { setShoots(shootResult.data || []); setOptions(optionResult.data || {}); setEmployees(employeeResult.data || []); })
      .catch((requestError) => showError(requestError.message || "Unable to load shoots."));
  }, [showError]);

  async function save(payload) {
    setSaving(true);
    setError("");
    try {
      const editing = Boolean(formRecord?.id);
      if (editing) await updateClientStorageRecord(formRecord.id, payload);
      else await createClientStorageRecord(payload);
      setFormRecord(undefined);
      await load();
      showSuccess(editing ? "Storage record updated successfully." : "Storage record added successfully.");
    } catch (requestError) {
      setError(requestError.message || "Unable to save the storage record.");
    } finally {
      setSaving(false);
    }
  }

  /**
   * Whichever dialog is open is closed on success only, so a rejected move leaves the answers on
   * screen to correct rather than discarding them.
   */
  async function changeStatus(record, payload) {
    setSaving(true);
    setError("");
    try {
      await changeClientStorageStatus(record.id, payload);
      setStatusChange(null);
      setAssignRecord(null);
      setTransitRecord(null);
      await load();
      showSuccess("Storage status updated successfully.");
    } catch (requestError) {
      setError(requestError.message || "Unable to change the status.");
    } finally {
      setSaving(false);
    }
  }


  // Every column carries an accessor. TanStack treats a column with only `id` + `cell` as a display
  // column, and DataTable then hides both its sort toggle and its filter box, so the nested values
  // (client, shoot, project) were previously neither sortable nor searchable.
  const textColumn = (id, header, get) => ({ id, header, accessorFn: (row) => get(row) ?? "", cell: ({ row }) => get(row.original) || "—" });
  const yesNoColumn = (id, header) => ({ id, header, accessorFn: (row) => row[id] ? "Yes" : "No", cell: ({ row }) => row.original[id] ? "Yes" : "No" });
  // Sorts chronologically on the timestamp while filtering against the text actually rendered.
  const dateColumn = (id, header, get, format = formatDate) => ({
    id,
    header,
    accessorFn: (row) => { const value = get(row); return value ? new Date(value).getTime() : undefined; },
    sortUndefined: "last",
    cell: ({ row }) => format(get(row.original)),
    filterFn: (row, columnKey, filterValue) => format(get(row.original)).toLowerCase().includes(String(filterValue).trim().toLowerCase()),
  });

  const columns = [
    textColumn("storageId", "SM ID", (row) => row.storageId),
    textColumn("status", "Status", (row) => row.status),
    yesNoColumn("isShootStatusPending", "Shoot Status Pending"),
    textColumn("shootCode", "Shoot ID", (row) => row.shoot?.shootId),
    dateColumn("dateCreated", "Date Created", (row) => row.shoot?.dateCreated),
    textColumn("clientName", "Client Name", (row) => row.project?.clientName),
    textColumn("projectStatus", "Project Status", (row) => row.project?.projectStatus),
    textColumn("product", "Product", (row) => row.product),
    textColumn("type", "Type", (row) => row.type),
    textColumn("shoot", "Shoot", (row) => row.shoot?.shoot),
    dateColumn("mainEventDate", "Main Event Date", (row) => row.project?.mainEventDate),
    textColumn("sourceBranch", "Source Branch", (row) => row.project?.sourceBranch),
    textColumn("crm", "CRM", (row) => row.project?.crmName),
    textColumn("preProductionCoordinator", "Pre Production Coordinator", (row) => row.project?.preProductionCoordinator),
    textColumn("creativeManager", "Creative Manager", (row) => row.project?.creativeManager),
    textColumn("postProductionCoordinator", "Post Production Coordinator", (row) => row.project?.postProductionCoordinator),
    textColumn("wid", "WID", (row) => row.wid),
    textColumn("workType", "Work Type", (row) => row.workType),
    textColumn("footageLocation", "Footage Location", (row) => row.footageLocation),
    textColumn("storageType", "Storage Type", (row) => row.storageType),
    { id: "footageLink", header: "Footage Link", accessorFn: (row) => row.footageLink ?? "", cell: ({ row }) => row.original.footageLink ? <a href={row.original.footageLink} target="_blank" rel="noreferrer" className="text-blue-700 underline">Open</a> : "—" },
    textColumn("remarks", "Remarks", (row) => row.remarks),
    textColumn("hardDiscBrand", "Hard Disc Brand", (row) => row.hardDiscBrand),
    textColumn("hardDiscColour", "Hard Disc Colour", (row) => row.hardDiscColour),
    textColumn("hardDiscCapacity", "Hard Disc Capacity", (row) => row.hardDiscCapacity),
    textColumn("items", "Items", (row) => row.items),
    yesNoColumn("labeled", "Labeled?"),
    yesNoColumn("footageBackup", "Footage Backup"),
    textColumn("footageSize", "Footage Size", (row) => row.footageSize),
    ...checks.filter(([key]) => !["labeled", "footageBackup"].includes(key)).map(([key, label]) => yesNoColumn(key, label)),
    textColumn("hardDiskIn", "Hard disk in", (row) => row.hardDiskIn),
    // Transit details are only editable on the way into "In Transit", so they are surfaced here
    // to stay readable afterwards. All hideable through Manage Columns.
    textColumn("transitCondition", "Condition", (row) => row.transitCondition),
    textColumn("transferFrom", "Transfer From", (row) => row.transferFrom),
    textColumn("transferTo", "Transfer To", (row) => row.transferTo),
    textColumn("sentBy", "Sent By", (row) => row.sentBy),
    textColumn("receivedBy", "Received By", (row) => row.receivedBy),
    textColumn("courierService", "Courier Service", (row) => row.courierService),
    textColumn("trackingNumber", "Tracking Number", (row) => row.trackingNumber),
    textColumn("shipmentType", "Shipment Type", (row) => row.shipmentType),
    dateColumn("shipmentDateTime", "Shipment Date", (row) => row.shipmentDateTime, formatDateTime),
    dateColumn("shipmentEta", "ETA", (row) => row.shipmentEta),
    textColumn("courierCharge", "Courier Charge", (row) => row.courierCharge),
    textColumn("assignedToName", "Assigned To", (row) => row.assignedToName),
    dateColumn("assignedAt", "Assigned On", (row) => row.assignedAt, formatDateTime),
    textColumn("addedBy", "Added By", (row) => row.addedBy?.name),
    dateColumn("createdAt", "Added On", (row) => row.createdAt, formatDateTime),
    ...(canWrite ? [{ ...ACTIONS_COLUMN, cell: ({ row }) => {
      const record = row.original;
      // Each dialog opens on a clean slate, so a message left over from an earlier failure is
      // not mistaken for something wrong with the record just opened.
      const open = (setter, value = record) => { setError(""); setter(value); };
      // The record carries its own allowed moves, because after In Transit the next step depends
      // on whether the project still has a shoot to come, not just on the current status.
      const moves = (record.nextStatuses || []).map((next) => ({
        label: next === assignedStatus ? "Assign to a person" : `Move to ${next}`,
        onSelect: () => {
          if (detailSteps.includes(next)) return open(setStatusChange, { record, nextStatus: next });
          if (next === assignedStatus) return open(setAssignRecord);
          if (next === transitStatus) return open(setTransitRecord);
          return changeStatus(record, { nextStatus: next });
        },
      }));
      return <OptionsMenu ariaLabel={`Actions for ${record.storageId}`} items={[
        { label: "View", onSelect: () => setViewingRecord(record) },
        ...moves,
        { label: "Edit", onSelect: () => open(setFormRecord) },
      ]} />;
    } }] : []),
  ];

  return <section className="flex h-full min-h-0 flex-col">
    {/* No Add button: records are raised by the project start flow, never by hand. */}
    <ModulePageHeader
      title="Client Storage"
      // Only the early steps get a tab; everything further along the flow is read under All.
      // Counts are across every record rather than the filtered page, so they do not shift as
      // tabs are switched.
      tabs={statusTabs.map(([value, label]) => ({ id: value, label, count: counts[value] ?? 0 }))}
      tabValue={statusFilter}
      onTabChange={setStatusFilter}
      tabsAriaLabel="Client storage status filters"
      actions={<ImportMenuButton ariaLabel="More storage actions" importConfig={storageImportConfig} />}
    />
    <FloatingNotice notice={notice} onClose={clearNotice} />
    <DataTableShell className="min-h-0 flex-1 rounded-none border-0" footer={<TableFooter spread><span className="text-xs sm:text-sm">Last updated: {lastUpdatedAt ? formatDateTime(lastUpdatedAt) : "—"}</span><span className="shrink-0 text-xs sm:text-sm">Total rows: {rows.length}</span></TableFooter>}>
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* selectedRowId is stringified to match getRowId: DataTable compares the two with ===, so
            a number here would never highlight the row the panel has open. */}
        <DataTable
          columns={columns}
          data={rows}
          density={density}
          loading={loading}
          emptyMessage="No client storage records yet."
          noMatchMessage="No matching records found."
          ariaLabel="Client storage management table"
          importConfig={storageImportConfig}
          tableClassName="min-w-max"
          getRowId={(row) => String(row.id)}
          selectedRowId={selectedRecord ? String(selectedRecord.id) : undefined}
          onRowClick={(record) => { setSelectedRecord(record); setInfoPanelState("expanded"); }}
          onRowDoubleClick={setViewingRecord}
          features={{ filtering: true, sorting: true, columnVisibility: true, selection: bulk.selection }}
        />
        <DataTableInfoPanel title="Storage Details" entity={clientStorageForInfo(selectedRecord)} sections={clientStorageInfoSections} emptyText="Select a storage record to see its full details." state={infoPanelState} onToggle={() => setInfoPanelState((current) => current === "expanded" ? "collapsed" : "expanded")} />
      </div>
    </DataTableShell>
    {viewingRecord && <RecordViewPanel title={viewingRecord.storageId || viewingRecord.clientName || "Storage record"} entity={clientStorageForInfo(viewingRecord)} sections={clientStorageInfoSections} sidebarAriaLabel="Storage record sections" onClose={() => setViewingRecord(null)} />}
    {formRecord !== undefined && <ClientStorageFormPanel record={formRecord} shoots={shoots} options={options} saving={saving} error={error} onClose={() => setFormRecord(undefined)} onSave={save} />}
    {statusChange && <ClientStorageStatusDialog record={statusChange.record} nextStatus={statusChange.nextStatus} options={options} saving={saving} error={error} onClose={() => setStatusChange(null)} onSubmit={(payload) => changeStatus(statusChange.record, payload)} />}
    {assignRecord && <AssignDialog record={assignRecord} employees={employees} error={error} saving={saving} onClose={() => setAssignRecord(null)} onConfirm={(assignedToId) => changeStatus(assignRecord, { nextStatus: assignedStatus, assignedToId })} />}
    {transitRecord && <ClientStorageTransitDialog record={transitRecord} options={options} saving={saving} error={error} onClose={() => setTransitRecord(null)} onSubmit={(payload) => changeStatus(transitRecord, payload)} />}
  </section>;
}
