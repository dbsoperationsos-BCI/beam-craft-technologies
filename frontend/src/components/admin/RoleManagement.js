"use client";

import { avatarOf } from "@/lib/employeeAvatar.mjs";
import { useCallback, useEffect, useImperativeHandle, useState } from "react";
import DataTable from "@/components/data-table/DataTable";
import useTableSelection from "@/components/data-table/useTableSelection";
import DataTableInfoPanel from "@/components/data-table/DataTableInfoPanel";
import DataTableShell from "@/components/data-table/DataTableShell";
import TableFooter from "@/components/data-table/TableFooter";
import KanbanBoard from "@/components/data-table/KanbanBoard";
import { ACTIONS_COLUMN } from "@/components/data-table/tableCells";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import { usePermissions } from "@/components/auth/PermissionsProvider";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import OptionsMenu from "@/components/ui/OptionsMenu";
import RoleDialog, { emptyRoleValues, roleUserChanges, toPayload, toValues } from "./RoleDialog";
import { moduleLabel } from "@/constants/modulePermissions";
import { branchLabel } from "@/lib/branchName";
import { columnSumText } from "@/lib/kanbanSummary.mjs";
import {
  assignRoleToUser,
  createRole,
  deleteRole,
  duplicateRole,
  getPermissions,
  getRoleUsers,
  getRoles,
  getUsers,
  removeRoleFromUser,
  updateRole,
} from "@/services/admin/admin.service";

// What the panel shows about the selected role. Same shape every other module's panel uses.
const roleInfoSections = [
  { title: "Identification", fields: [["name", "Name"], ["description", "Description"], ["typeLabel", "Type"], ["userCount", "Users carrying it"]] },
  { title: "Reach", fields: [["branchNames", "Branches"], ["moduleNames", "Modules"]] },
  { title: "Action permissions", fields: [["readWrite", "Read / Write"], ["readOnly", "Read"]] },
];

const ROLE_BOARD_COLUMNS = [
  { value: "Locked", className: "bg-slate-700 text-white" },
  { value: "Custom", className: "bg-blue-600 text-white" },
];

/** The modules a role reaches, as text — so the column sorts, filters and exports like any other. */
const modulesOf = (role) => [...new Set((role.permissions || []).map((grant) => grant.permission?.module).filter(Boolean))]
  .map(moduleLabel)
  .sort()
  .join(", ");

// How an account reads in the role form's Manage Users section — the employee it is linked to where there is
// one, since that is the name an admin actually recognises somebody by, and the login's own name
// or email for the accounts that predate a link (the first Super Admin, a service account).
const userOption = (user) => ({
  id: user.id,
  name: userLabel(user),
  avatar: avatarOf({ id: user.id, name: user.linkedEmployee?.employeeName || user.name || user.email, profilePhotoUrl: user.profilePhotoUrl ?? user.linkedEmployee?.profilePhotoUrl }),
});
const userLabel = (user) => (user.linkedEmployee
  ? `${user.linkedEmployee.employeeName}${user.linkedEmployee.employeeId ? ` (${user.linkedEmployee.employeeId})` : ""}`
  : (user.name || user.email));

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

// `layout` is the Table / Board switch in AdminPage's header (screen key "admin-roles").
export default function RoleManagement({ branches = [], layout = "table", ref }) {
  const { hasPermission } = usePermissions();
  const { notice, showSuccess, showError, clearNotice } = useNotice();
  const canWrite = hasPermission("ADMIN", "Role Management", "READ_WRITE");
  // Who carries a role is read and changed through User Management's endpoints, so the form's
  // Manage Users section answers to that permission, not this screen's.
  const usersAccess = hasPermission("ADMIN", "User Management", "READ_WRITE") ? "READ_WRITE"
    : hasPermission("ADMIN", "User Management", "READ") ? "READ" : null;

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
  const [pendingDelete, setPendingDelete] = useState(null);
  const [busy, setBusy] = useState(false);

  // The accounts the Manage Users section picks from. Loaded once, the first time a role form opens
  // - most visits to this screen are about the roles themselves. `usersLoaded` rather than
  // `users.length`, since a studio with no accounts yet is a real, already-loaded answer.
  const [users, setUsers] = useState([]);
  const [usersLoaded, setUsersLoaded] = useState(false);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getRoles(), getPermissions()])
      .then(([roleResponse, permissionResponse]) => {
        if (cancelled) return;
        setRoles(roleResponse?.data || []);
        setPermissions(permissionResponse?.data || []);
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
    let roleId = editing.roleId;
    try {
      if (!editing.readOnly) {
        const payload = toPayload(editing.values, permissions);
        if (roleId) await updateRole(roleId, payload);
        else roleId = (await createRole(payload))?.data?.id;
      }
    } catch (error) {
      showError(error.message);
      setBusy(false);
      return;
    }

    /*
     * Who carries the role, handed over once the role itself is saved - a new one had no id until
     * a moment ago. A failure here still closes the form: the role is saved, and saving the form
     * again would try to create it a second time.
     */
    try {
      if (editing.usersEditable && roleId) {
        const { add, remove } = roleUserChanges(editing.heldUserIds, editing.values.userIds);
        for (const userId of add) await assignRoleToUser(userId, roleId);
        for (const userId of remove) await removeRoleFromUser(userId, roleId);
      }
      showSuccess(editing.readOnly ? "Users updated." : editing.roleId ? "Role saved." : "Role created.");
    } catch (error) {
      showError(`The role was saved, but its users were not all updated: ${error.message}`);
    } finally {
      setEditing(null);
      reload();
      setBusy(false);
    }
  };

  /**
   * Opens the role form, with the Manage Users section filled first when the viewer may see it:
   * the accounts to pick from, fetched once, and the ones already carrying this role, which are
   * also the ones saving compares against.
   *
   * `manageUsers` is whether that section may be changed. A locked role's View from the menu is
   * still where it is handed to somebody; a double-click only looks.
   */
  const openRole = async (role, editable, { manageUsers = editable } = {}) => {
    const values = role ? toValues(role, permissions) : emptyRoleValues(permissions);
    const form = { roleId: role?.id, readOnly: !editable, name: role?.name, usersEditable: usersAccess === "READ_WRITE" && manageUsers };
    if (!usersAccess) { setEditing({ ...form, values }); return; }

    setBusy(true);
    try {
      const [listed, holders] = await Promise.all([
        usersLoaded ? users : getUsers({ status: "ACTIVE", limit: 200 }).then((response) => response?.data || []),
        role ? getRoleUsers(role.id).then((response) => response?.data || []) : [],
      ]);
      if (!usersLoaded) { setUsers(listed); setUsersLoaded(true); }
      // Holders are listed even when they fall outside the first 200 accounts, so nobody carrying
      // the role goes missing from its own list.
      const known = new Set(listed.map((user) => user.id));
      const heldUserIds = holders.map((user) => user.id);
      setEditing({
        ...form,
        userOptions: [...listed, ...holders.filter((user) => !known.has(user.id))].map(userOption),
        heldUserIds,
        values: { ...values, userIds: heldUserIds },
      });
    } catch (error) {
      showError(error.message);
    } finally {
      setBusy(false);
    }
  };

  // Edit first, this module's own action between, a red Delete last - the shape every table in the
  // OS uses. A locked role can be looked at and copied but not changed, so its menu says View and
  // drops Delete rather than offering entries the server would refuse.
  const menuFor = (role) => {
    const editable = canWrite && !role.isSystem;
    return [
      // A locked role's View still opens Manage Users for changing: assigning who carries it is a
      // different decision from changing what it grants, and Super Admin itself still has to be
      // handed to somebody.
      { label: editable ? "Edit" : "View", onSelect: () => openRole(role, editable, { manageUsers: true }) },
      ...(canWrite ? [{ label: "Duplicate", onSelect: () => run(() => duplicateRole(role.id), "Role duplicated.") }] : []),
      ...(editable ? [{ label: "Delete", tone: "danger", onSelect: () => setPendingDelete(role) }] : []),
    ];
  };

  // No dependency list: `create` goes through `openRole`, which reads the users already loaded, so
  // the handle is rebuilt each render rather than holding an out-of-date copy of them.
  useImperativeHandle(ref, () => ({
    // Depends on `permissions`: a blank role is built from the permission list, and opening the
    // form before it has loaded would give a form with no modules in it.
    create: () => { if (permissions.length) openRole(null, true); },
  }));

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
    {/* The Board: a role has no status, so roles stand under their type - Locked, then Custom. A
        view only; a card opens the role read-only, as a double click does. */}
    {layout === "board" ? <KanbanBoard
      rows={roles}
      columns={ROLE_BOARD_COLUMNS}
      statusOf={(role) => (role.isSystem ? "Locked" : "Custom")}
      // Under each column, the active users carrying its roles, from the same count each card shows.
      columnAmount={(rows) => columnSumText(rows, (role) => role._count?.users ?? 0, "Users", String)}
      card={{
        title: (role) => role.name,
        subtitle: (role) => role.description || "",
        meta: (role) => `${role._count?.users ?? 0} users · ${role.permissions?.length ?? 0} permissions${modulesOf(role) ? ` · ${modulesOf(role)}` : ""}`,
      }}
      getRowId={(role) => String(role.id)}
      onOpen={(role) => openRole(role, false)}
      // The card's ⋮ is the row's ⋮.
      cardActions={menuFor}
      viewOnly="Built-in roles stay locked and custom roles stay custom. Duplicate a built-in role to make a custom one."
      loading={loading}
      noun="roles"
      ariaLabel="Roles board"
    /> : <DataTableShell className="min-h-0 flex-1 rounded-none border-0" footer={<TableFooter spread><span className="text-xs sm:text-sm">Last updated: {updatedText}</span><span className="shrink-0 text-xs sm:text-sm">Total rows: {roles.length}</span></TableFooter>}>
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
    </DataTableShell>}

    {editing && <RoleDialog
      title={editing.readOnly ? (editing.usersEditable ? `Manage users — ${editing.name}` : editing.name) : editing.roleId ? `Edit role — ${editing.name}` : "Create role"}
      isEdit={Boolean(editing.roleId)}
      values={editing.values}
      onChange={(name, value) => setEditing((current) => ({ ...current, values: { ...current.values, [name]: value } }))}
      permissions={permissions}
      branches={branches}
      users={editing.userOptions || []}
      usersAccess={usersAccess && (editing.usersEditable ? "READ_WRITE" : "READ")}
      readOnly={Boolean(editing.readOnly)}
      saving={busy}
      onClose={() => setEditing(null)}
      onSubmit={save}
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
