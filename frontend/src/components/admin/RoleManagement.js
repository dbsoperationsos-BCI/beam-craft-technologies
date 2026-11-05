"use client";

import { useCallback, useEffect, useImperativeHandle, useState } from "react";
import DataTable from "@/components/data-table/DataTable";
import useTableSelection from "@/components/data-table/useTableSelection";
import DataTableInfoPanel from "@/components/data-table/DataTableInfoPanel";
import DataTableShell from "@/components/data-table/DataTableShell";
import TableFooter from "@/components/data-table/TableFooter";
import { ACTIONS_COLUMN } from "@/components/data-table/tableCells";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import { usePermissions } from "@/components/auth/PermissionsProvider";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import OptionsMenu from "@/components/ui/OptionsMenu";
import RoleDialog, { emptyRoleValues, toPayload, toValues } from "./RoleDialog";
import AdminPermissionDialog, { adminPermissionPayload, adminPermissionValues } from "./AdminPermissionDialog";
import { moduleLabel } from "@/constants/modulePermissions";
import { branchLabel } from "@/lib/branchName";
import {
  createRole,
  deleteRole,
  duplicateRole,
  getBranchAdminPermissions,
  getPermissions,
  getRoles,
  saveBranchAdminPermissions,
  updateRole,
} from "@/services/admin/admin.service";

// What the panel shows about the selected role. Same shape every other module's panel uses.
const roleInfoSections = [
  { title: "Identification", fields: [["name", "Name"], ["description", "Description"], ["typeLabel", "Type"], ["userCount", "Users carrying it"]] },
  { title: "Reach", fields: [["branchNames", "Branches"], ["moduleNames", "Modules"]] },
  { title: "Action permissions", fields: [["readWrite", "Read / Write"], ["readOnly", "Read"]] },
];

/** The modules a role reaches, as text — so the column sorts, filters and exports like any other. */
const modulesOf = (role) => [...new Set((role.permissions || []).map((grant) => grant.permission?.module).filter(Boolean))]
  .map(moduleLabel)
  .sort()
  .join(", ");

// `ref` exposes this tab's create control to the page header; everything else stays in here.
// The role as the panel wants it: what it grants, split by level, so the panel answers "what can
// somebody with this role do" without anyone reading the matrix back out of the edit form.
function roleForInfo(role) {
  if (!role) return null;
  const named = (level) => (role.permissions || [])
    .filter((grant) => grant.accessLevel === level)
    .map((grant) => grant.permission?.displayName || grant.permission?.feature)
    .filter(Boolean)
    .sort()
    .join(", ");

  return {
    ...role,
    typeLabel: role.isSystem ? "Locked" : "Custom",
    // Answers "may I delete this one" before the delete is attempted, which is the question a role
    // sitting beside its own copy actually raises.
    userCount: String(role._count?.users ?? 0),
    branchNames: (role.branches || []).map((entry) => branchLabel(entry.branch?.name)).filter(Boolean).sort().join(", ") || "None",
    moduleNames: modulesOf(role) || "None",
    readWrite: named("READ_WRITE") || "None",
    readOnly: named("READ") || "None",
  };
}

export default function RoleManagement({ branches = [], ref }) {
  const { hasPermission } = usePermissions();
  const { notice, showSuccess, showError, clearNotice } = useNotice();
  const canWrite = hasPermission("ADMIN", "Role Management", "READ_WRITE");

  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);
  // Stamped when a load finishes, so the footer says how fresh the list is rather than when the page opened.
  const [lastUpdated, setLastUpdated] = useState(null);
  const updatedText = lastUpdated ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(lastUpdated) : "—";
  const [selectedId, setSelectedId] = useState(null);
  const [infoPanelState, setInfoPanelState] = useState("collapsed");
  const [editing, setEditing] = useState(null);
  // The shared Admin Permission set: held here because two things need it - the editor that
  // changes it, and every role dialog, which fills its matrix from it when Branch Admin is ticked.
  const [adminPermissions, setAdminPermissions] = useState([]);
  const [adminEditing, setAdminEditing] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getRoles(), getPermissions(), getBranchAdminPermissions()])
      .then(([roleResponse, permissionResponse, adminResponse]) => {
        if (cancelled) return;
        setRoles(roleResponse?.data || []);
        setPermissions(permissionResponse?.data || []);
        setAdminPermissions(adminResponse?.data || []);
      })
      .catch((error) => { if (!cancelled) showError(error.message); })
      .finally(() => { if (!cancelled) { setLoading(false); setLastUpdated(new Date()); } });
    return () => { cancelled = true; };
  }, [reloadToken, showError]);

  const run = async (action, message) => {
    setBusy(true);
    try {
      await action();
      showSuccess(message);
      reload();
    } catch (error) {
      showError(error.message);
    } finally {
      setBusy(false);
    }
  };

  const save = async (event) => {
    event?.preventDefault?.();
    setBusy(true);
    try {
      const payload = toPayload(editing.values, permissions);
      if (editing.id) await updateRole(editing.id, payload);
      else await createRole(payload);
      setEditing(null);
      showSuccess(editing.id ? "Role saved." : "Role created.");
      reload();
    } catch (error) {
      showError(error.message);
    } finally {
      setBusy(false);
    }
  };

  const openRole = (role, editable) => setEditing({
    id: editable ? role.id : undefined,
    readOnly: !editable,
    name: role.name,
    values: toValues(role, permissions),
  });

  // Edit first, this module's own action between, a red Delete last - the shape every table in the
  // OS uses. A locked role can be looked at and copied but not changed, so its menu says View and
  // drops Delete rather than offering entries the server would refuse.
  const menuFor = (role) => {
    const editable = canWrite && !role.isSystem;
    return [
      { label: editable ? "Edit" : "View", onSelect: () => openRole(role, editable) },
      ...(canWrite ? [{ label: "Duplicate", onSelect: () => run(() => duplicateRole(role.id), "Role duplicated.") }] : []),
      ...(editable ? [{ label: "Delete", tone: "danger", onSelect: () => setPendingDelete(role) }] : []),
    ];
  };

  // Depends on `permissions`, because a blank role is built from the permission list - opening the
  // form before that has loaded would give a form with no modules in it.
  const saveAdminPermissions = async (event) => {
    event?.preventDefault?.();
    setBusy(true);
    try {
      const response = await saveBranchAdminPermissions(adminPermissionPayload(adminEditing.values, permissions).permissions);
      setAdminPermissions(response?.data || []);
      setAdminEditing(null);
      showSuccess("Admin Permission saved. Every Branch Admin role now carries it.");
      // The roles list is reloaded because a role's resolved permissions have just changed without
      // that role being touched - which is the whole point of the set, and would otherwise leave
      // the table showing what it counted a moment ago.
      reload();
    } catch (error) {
      showError(error.message);
    } finally {
      setBusy(false);
    }
  };

  useImperativeHandle(ref, () => ({
    create: () => { if (permissions.length) setEditing({ values: emptyRoleValues(permissions) }); },
    openAdminPermission: () => {
      if (!permissions.length) return;
      setAdminEditing({ values: adminPermissionValues(adminPermissions, permissions) });
    },
  }), [permissions, adminPermissions]);

  const selected = roles.find((role) => role.id === selectedId) || null;

  const columns = [
    { id: "name", accessorKey: "name", header: "Role" },
    { id: "description", header: "Description", accessorFn: (row) => row.description || "—" },
    // What the role covers, rather than the whole grant list: the detail is one click away in the
    // role's own dialog, and a row that tried to hold it would be unreadable.
    { id: "modules", header: "Modules", accessorFn: (row) => modulesOf(row) || "—" },
    // Where the role reaches. A role naming several branches grants in all of them, so this is the
    // column that says how far its permissions actually travel.
    { id: "branches", header: "Branches", accessorFn: (row) => (row.branches || []).map((entry) => branchLabel(entry.branch?.name)).filter(Boolean).sort().join(", ") || "—" },
    { id: "permissions", header: "Permissions", accessorFn: (row) => row.permissions?.length ?? 0, meta: { type: "number" } },
    // Who carries it. Without this a role and its "(copy)" read identically, and which of the two is
    // actually in use only shows when a delete is refused - which reads as the wrong role being
    // checked rather than as the copy genuinely being held by somebody.
    { id: "users", header: "Users", accessorFn: (row) => row._count?.users ?? 0, meta: { type: "number" } },
    { id: "type", header: "Type", accessorFn: (row) => (row.isSystem ? "Locked" : "Custom") },
    { ...ACTIONS_COLUMN },
  ];

  /*
   * The tick boxes, for a role holding `ADMIN / Table Select All`.
   *
   * The two refusals stay with the server and are asked per role: a system role is never deletable,
   * and a role somebody active still carries takes their access with it if it goes. Both leave the
   * row ticked and name what stopped it, which matters more here than on any other table - a
   * selection over this one is the studio's own IAM.
   */
  const bulk = useTableSelection({
    prefix: "/api/admin/roles",
    rows: roles,
    noun: "role",
    canDelete: canWrite,
    showSuccess,
    showError,
    onDeleted: () => reload(),
  });

  return <>
    <DataTableShell className="min-h-0 flex-1 rounded-none border-0" footer={<TableFooter spread><span className="text-xs sm:text-sm">Last updated: {updatedText}</span><span className="shrink-0 text-xs sm:text-sm">Total rows: {roles.length}</span></TableFooter>}>
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <DataTable
          columns={columns}
          data={roles}
          loading={loading}
          loadingMessage="Loading roles..."
          emptyMessage="No roles yet."
          getRowId={(row) => row.id}
          selectedRowId={selected ? selected.id : undefined}
          onRowClick={(role) => { setSelectedId(role.id); setInfoPanelState("expanded"); }}
          ariaLabel="Roles"
          features={{ selection: bulk.selection }}
          // Double-click reads; it never edits. A gesture that easy to trigger by accident should
          // not open a permission matrix in a state where it can be changed — editing is the ⋮ menu's
          // Edit, which has to be asked for by name. Read-only for every role, including ones this
          // person could edit.
          onRowDoubleClick={(role) => openRole(role, false)}
          renderActions={(role) => <OptionsMenu ariaLabel={`Actions for ${role.name}`} items={menuFor(role)} />}
        />
        <DataTableInfoPanel
          title="Role Details"
          entity={roleForInfo(selected)}
          sections={roleInfoSections}
          emptyText="Select a role row to view details."
          state={infoPanelState}
          onToggle={() => setInfoPanelState((current) => current === "expanded" ? "collapsed" : "expanded")}
        />
      </div>
    </DataTableShell>

    {editing && <RoleDialog
      title={editing.readOnly ? editing.name : editing.id ? `Edit role — ${editing.name}` : "Create role"}
      isEdit={Boolean(editing.id)}
      values={editing.values}
      onChange={(name, value) => setEditing((current) => ({ ...current, values: { ...current.values, [name]: value } }))}
      permissions={permissions}
      branches={branches}
      adminPermissions={adminPermissions}
      readOnly={Boolean(editing.readOnly)}
      saving={busy}
      onClose={() => setEditing(null)}
      onSubmit={save}
    />}

    {adminEditing && <AdminPermissionDialog
      values={adminEditing.values}
      onChange={(name, value) => setAdminEditing((current) => ({ ...current, values: { ...current.values, [name]: value } }))}
      permissions={permissions}
      roleCount={roles.filter((role) => role.isBranchManager).length}
      readOnly={!canWrite}
      saving={busy}
      onClose={() => setAdminEditing(null)}
      onSubmit={saveAdminPermissions}
    />}

    {pendingDelete && <ConfirmDialog
      title="Delete role"
      message={`Delete ${pendingDelete.name}? Any group still using it must be detached first.`}
      confirmLabel="Delete"
      busyLabel="Deleting..."
      loading={busy}
      onConfirm={() => run(() => deleteRole(pendingDelete.id), "Role deleted.").then(() => setPendingDelete(null))}
      onCancel={() => setPendingDelete(null)}
    />}

    <FloatingNotice notice={notice} onClose={clearNotice} />
  </>;
}
