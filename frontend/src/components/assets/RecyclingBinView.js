"use client";

import { useCallback, useEffect, useState } from "react";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import DataTable from "@/components/data-table/DataTable";
import DataTableShell from "@/components/data-table/DataTableShell";
import TableFooter from "@/components/data-table/TableFooter";
import { ACTIONS_COLUMN } from "@/components/data-table/tableCells";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import HelpTip from "@/components/shared/HelpTip";
import useCompactView from "@/components/shared/useCompactView";
import OptionsMenu from "@/components/ui/OptionsMenu";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import RecordViewPanel from "@/components/data-table/RecordViewPanel";
import { commonProjectInfoSections } from "@/constants/infoPanelConfig";
import { useRouteAccess } from "@/components/auth/PermissionsProvider";
import { formatDateTime } from "@/lib/formatDateTime.mjs";
import { deleteRecycledProjectPermanently, getRecycledProject, getRecycledProjects, restoreRecycledProject } from "@/services/assets/recycling-bin.service";

/*
 * Resource Management → Recycling Bin. A deleted project waits here - nothing of it erased - until
 * somebody restores it or deletes it permanently. READ lists the bin; Restore and Delete permanently
 * need READ_WRITE on `ASSET / Recycling Bin`, and without it the row menu is absent, not refused.
 */

const PAGE_HELP = "Deleted projects wait here. Restore brings the whole project back; Delete permanently erases it and its photos.";

/*
 * The read-only view a row opens: the project as the project screens describe it, and when and by
 * whom it was deleted. Nothing in it changes anything - Restore and Delete permanently stay in the ⋮.
 */
const VIEW_SECTIONS = [
  { title: "Project Vault", fields: [["deletedByName", "Deleted By"], ["deletedAt", "Deleted On", "date"]] },
  ...commonProjectInfoSections,
];

const text = (field) => ({ row }) => row.original[field] || "—";

const COLUMNS = [
  { accessorKey: "eventId", header: "Event ID", cell: text("eventId"), meta: { help: "The project's Event ID. It comes back unchanged on Restore." } },
  { accessorKey: "whatsappGroupName", header: "Project / WhatsApp Group", cell: text("whatsappGroupName"), meta: { help: "The project's WhatsApp group name, as it was when it was deleted." } },
  { accessorKey: "vertical", header: "Vertical", cell: text("vertical"), meta: { help: "The vertical the project was booked under." } },
  { accessorKey: "clientMainNumber", header: "Client Main Number", cell: text("clientMainNumber"), meta: { help: "The client's main number. Their app login is switched off while the project is here, and back on after Restore." } },
  { id: "deletedBy", header: "Deleted By", accessorFn: (row) => row.deletedBy?.name || "", cell: ({ row }) => row.original.deletedBy?.name || "—", meta: { help: "Who deleted the project. Blank for a project deleted before the Project Vault existed." } },
  { id: "deletedAt", header: "Deleted On", accessorFn: (row) => row.deletedAt || "", cell: ({ row }) => formatDateTime(row.original.deletedAt), meta: { type: "date", help: "When the project was moved to the Project Vault." } },
];

const CONFIRM = {
  restore: {
    title: "Restore project?",
    message: (project) => `${project.eventId} comes back exactly as it was before it was deleted - on every project screen, with its Image Selection gallery, its client's app login and its client storage records.`,
    confirmLabel: "Restore",
    busyLabel: "Restoring...",
    tone: "primary",
  },
  purge: {
    title: "Delete project permanently?",
    message: (project) => `${project.eventId} is erased for good, with its shoots, pre production, production, deliverables, post production and its Image Selection photos. This cannot be undone. Payments and client storage discs stay, with no project; an Album Proofing gallery is unlinked, not erased.`,
    confirmLabel: "Delete permanently",
    busyLabel: "Deleting...",
    tone: "danger",
  },
};

export default function RecyclingBinView() {
  const { canWrite } = useRouteAccess();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // `{ kind: "restore" | "purge", project }` while a confirmation is open.
  const [action, setAction] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  // The deleted project open in the read-only view, read in full from the bin's own endpoint.
  const [viewing, setViewing] = useState(null);
  const { notice, showSuccess, showError, clearNotice } = useNotice();
  const { density } = useCompactView();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getRecycledProjects();
      setRows(result.data || []);
      setLastUpdated(new Date());
    } catch (requestError) {
      showError(requestError.message || "Unable to load the Project Vault.");
    } finally {
      setLoading(false);
    }
  }, [showError]);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);

  async function openView(row) {
    try {
      const result = await getRecycledProject(row.id);
      const project = result.data || row;
      setViewing({ ...project, deletedByName: project.deletedBy?.name || "" });
    } catch (requestError) {
      showError(requestError.message || "Unable to open the project.");
    }
  }

  async function confirm() {
    if (!action) return;
    setSaving(true);
    try {
      const result = action.kind === "restore"
        ? await restoreRecycledProject(action.project.id)
        : await deleteRecycledProjectPermanently(action.project.id, action.project.eventId);
      setAction(null);
      showSuccess(result?.message || (action.kind === "restore" ? "Project restored." : "Project deleted permanently."));
      await load();
    } catch (requestError) {
      setAction(null);
      showError(requestError.message || (action.kind === "restore" ? "Unable to restore the project." : "Unable to delete the project permanently."));
    } finally {
      setSaving(false);
    }
  }

  // Every entry needs READ_WRITE, so a reader gets no menu column at all.
  const columns = canWrite ? [...COLUMNS, { ...ACTIONS_COLUMN, cell: ({ row }) => <OptionsMenu ariaLabel={`Actions for ${row.original.eventId}`} items={[
    { label: "Restore", onSelect: () => setAction({ kind: "restore", project: row.original }) },
    { label: "Delete permanently", tone: "danger", onSelect: () => setAction({ kind: "purge", project: row.original }) },
  ]} /> }] : COLUMNS;
  const dialog = action ? CONFIRM[action.kind] : null;

  return <section className="flex h-full min-h-0 flex-col">
    <ModulePageHeader title="Project Vault" titleAccessory={<HelpTip text={PAGE_HELP} />} />
    <FloatingNotice notice={notice} onClose={clearNotice} />
    <DataTableShell className="min-h-0 flex-1 rounded-none border-0" footer={<TableFooter spread><span className="text-xs sm:text-sm">Last updated: {lastUpdated ? formatDateTime(lastUpdated) : "—"}</span><span className="shrink-0 text-xs sm:text-sm">Total rows: {rows.length}</span></TableFooter>}>
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <DataTable
          columns={columns}
          data={rows}
          density={density}
          loading={loading}
          emptyMessage="The Project Vault is empty. Deleted projects appear here."
          noMatchMessage="No deleted projects match."
          ariaLabel="Project Vault table"
          tableClassName="min-w-max"
          getRowId={(row) => String(row.id)}
          // One click (or a double-click, which begins with one) opens the read-only view.
          onRowClick={(row) => { if (viewing?.id !== row.id) void openView(row); }}
          features={{ filtering: true, sorting: true, columnVisibility: true }}
        />
      </div>
    </DataTableShell>
    {viewing && <RecordViewPanel title={viewing.whatsappGroupName || viewing.eventId || "Deleted project"} description={`${viewing.eventId} is in the Project Vault. Nothing here can be changed.`} entity={viewing} sections={VIEW_SECTIONS} sidebarAriaLabel="Deleted project sections" onClose={() => setViewing(null)} />}
    {dialog && <ConfirmDialog
      title={dialog.title}
      message={dialog.message(action.project)}
      confirmLabel={dialog.confirmLabel}
      busyLabel={dialog.busyLabel}
      tone={dialog.tone}
      loading={saving}
      onCancel={() => { if (!saving) setAction(null); }}
      onConfirm={() => void confirm()}
    />}
  </section>;
}
