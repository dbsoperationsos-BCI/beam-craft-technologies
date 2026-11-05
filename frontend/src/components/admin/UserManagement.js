"use client";

import { useCallback, useEffect, useState } from "react";
import DataTable from "@/components/data-table/DataTable";
import useTableSelection from "@/components/data-table/useTableSelection";
import DataTableInfoPanel from "@/components/data-table/DataTableInfoPanel";
import DataTableShell from "@/components/data-table/DataTableShell";
import TableFooter from "@/components/data-table/TableFooter";
import RecordViewPanel from "@/components/data-table/RecordViewPanel";
import { ACTIONS_COLUMN } from "@/components/data-table/tableCells";
import RolePicker from "@/components/shared/RolePicker";
import Button from "@/components/shared/Button";
import Dropdown from "@/components/shared/Dropdown";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import { usePermissions } from "@/components/auth/PermissionsProvider";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Dialog from "@/components/ui/Dialog";
import OptionsMenu from "@/components/ui/OptionsMenu";
import { branchLabel } from "@/lib/branchName";
import {
  assignRoleToUser,
  deleteUser,
  getLinkableEmployees,
  getRoles,
  getUserRoles,
  getUsers,
  removeRoleFromUser,
  setUserEmployeeLink,
} from "@/services/admin/admin.service";

// What the info panel shows about the row that is selected. Same shape every other module's panel
// uses, so it reads and formats identically.
const userInfoSections = [
  { title: "Account", fields: [["name", "Name"], ["email", "Email"], ["statusLabel", "Status"], ["employeeLabel", "Employee record"]] },
  { title: "Access", fields: [["branchLabel", "Home branch"], ["roleNames", "Roles"], ["branchNames", "Branches reached"]] },
];

// How an employee reads wherever this screen names one: the code as well as the name, because two
// people share a name often enough and the code is what the repository is searched by.
const employeeLabel = (employee) => (employee ? `${employee.employeeName}${employee.employeeId ? ` (${employee.employeeId})` : ""}` : "");

// The row as the panel wants it: a role's branches are what decide where its permissions apply, so
// the panel answers "where can this person work" rather than making anyone add it up.
function userForInfo(user, roles) {
  if (!user) return null;
  const branchNames = [...new Set((roles || []).flatMap((role) => (role.branches || []).map((entry) => branchLabel(entry.branch?.name))).filter(Boolean))].sort();
  return {
    ...user,
    statusLabel: user.status || "ACTIVE",
    branchLabel: branchLabel(user.branch?.name) || "All branches",
    // "Not linked" rather than a dash: an account with no employee behind it cannot mark attendance,
    // raise a payment request or appear on the org chart, and that is worth reading as a fact.
    employeeLabel: employeeLabel(user.linkedEmployee) || "Not linked",
    roleNames: (roles || []).map((role) => role.name).sort().join(", ") || "None",
    branchNames: branchNames.join(", ") || (branchLabel(user.branch?.name) || "All branches"),
  };
}

// Who is listed: every account still in use, whether or not it carries a role yet. One carrying none
// is precisely the account that needs this screen — it is the only place a role can be given, so
// hiding it would strand it. Asked of the server rather than filtered here, so the row count is the
// count of what is listed.
//
// `limit` is the server's own maximum. This screen shows one page, and the population it lists is
// the studio's staff with a login, not everyone who ever had one.
const LISTED_USERS = { status: "ACTIVE", limit: 200 };

// No create here: an account belongs to a person, and a person is added in the Employee Repository.
// This screen is about what an existing account may do.
export default function UserManagement() {
  const { hasPermission } = usePermissions();
  const { notice, showSuccess, showError, showUndo, clearNotice } = useNotice();
  const canWrite = hasPermission("ADMIN", "User Management", "READ_WRITE");
  const canAssignRoles = hasPermission("ADMIN", "Role Management", "READ_WRITE");

  const [users, setUsers] = useState([]);
  const [allRoles, setAllRoles] = useState([]);
  const [rolesByUser, setRolesByUser] = useState({});
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [infoPanelState, setInfoPanelState] = useState("collapsed");
  // Double-click reads the account in full; changing it is the ⋮ menu's own entry.
  const [viewing, setViewing] = useState(null);
  const [managing, setManaging] = useState(null);
  const [linking, setLinking] = useState(null);
  // Loaded once the first time the link dialog is opened, not on every page load: most visits to
  // this screen are about roles, and the repository is the larger list of the two.
  const [employees, setEmployees] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [busy, setBusy] = useState(false);

  const [reloadToken, setReloadToken] = useState(0);
  // Stamped when a load finishes, so the footer says how fresh the list is rather than when the page opened.
  const [lastUpdated, setLastUpdated] = useState(null);
  const updatedText = lastUpdated ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(lastUpdated) : "—";
  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getUsers(LISTED_USERS), getRoles()])
      .then(async ([userResponse, roleResponse]) => {
        if (cancelled) return;
        const list = userResponse?.data || [];
        setUsers(list);
        setAllRoles(roleResponse?.data || []);
        // One call per user, so the table can show what each carries without a second endpoint.
        // A branch's staff is a short list; if it ever is not, this becomes one batched call.
        const held = await Promise.all(list.map((user) => getUserRoles(user.id).then((r) => [user.id, r?.data || []]).catch(() => [user.id, []])));
        if (!cancelled) setRolesByUser(Object.fromEntries(held));
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

  const rolesOf = (user) => rolesByUser[user.id] || [];

  // Taking a role away is one click and silently changes what somebody can do, so it is offered
  // back for as long as the notice is up rather than guarded by a dialog nobody reads.
  const removeRole = async (id, roleId, roleName) => {
    setBusy(true);
    try {
      await removeRoleFromUser(id, roleId);
      reload();
      showUndo(`${roleName} removed.`, async () => {
        try {
          await assignRoleToUser(id, roleId);
          reload();
        } catch (error) {
          showError(error.message);
        }
      });
    } catch (error) {
      showError(error.message);
    } finally {
      setBusy(false);
    }
  };

  // The repository is fetched on the way into the dialog rather than kept in step with the table:
  // it changes when somebody is hired, which is not while this screen is open.
  const openLink = async (user) => {
    setLinking(user);
    if (employees) return;
    try {
      const response = await getLinkableEmployees();
      setEmployees(response?.data || []);
    } catch (error) {
      setEmployees([]);
      showError(error.message);
    }
  };

  const columns = [
    { id: "name", accessorKey: "name", header: "Name" },
    { id: "email", accessorKey: "email", header: "Email" },
    { id: "employee", header: "Employee record", accessorFn: (row) => employeeLabel(row.linkedEmployee) || "Not linked" },
    { id: "branch", header: "Home branch", accessorFn: (row) => branchLabel(row.branch?.name) || "All branches" },
    { id: "roles", header: "Roles", accessorFn: (row) => rolesOf(row).map((role) => role.name).sort().join(", ") || "—" },
    { id: "status", accessorKey: "status", header: "Status" },
    { ...ACTIONS_COLUMN },
  ];

  // This module's own action first, a red Delete last - the shape every table in the OS uses. There
  // is no Edit: an account's details belong to the person, and the person is edited in the Employee
  // Repository.
  const menuFor = (user) => [
    // Reaches the record view without a double-click, which a touch screen cannot give.
    { label: "View", onSelect: () => setViewing(user) },
    ...(canAssignRoles ? [{ label: "Manage roles", onSelect: () => setManaging(user) }] : []),
    // Absent rather than disabled for a reader: linking is a write, and a control somebody may not
    // use is not shown to them.
    ...(canWrite ? [{ label: user.linkedEmployeeId ? "Change employee link" : "Link employee", onSelect: () => openLink(user) }] : []),
    ...(canWrite ? [{ label: "Delete", tone: "danger", onSelect: () => setPendingDelete(user) }] : []),
  ];

  /*
   * The tick boxes, for a role holding `ADMIN / Table Select All`.
   *
   * Two refusals still stand per account, and the server is what applies them: nobody deletes their
   * own account, and the last Super Admin cannot go. A selection that ticks the whole screen loses
   * everything else and leaves those two ticked with the sentence saying so.
   */
  const bulk = useTableSelection({
    prefix: "/api/admin/users",
    rows: users,
    rowId: (row) => String(row.id),
    noun: "user",
    canDelete: canWrite,
    showSuccess,
    showError,
    onDeleted: () => reload(),
  });

  const selected = users.find((user) => user.id === selectedId) || null;

  return <>
    <DataTableShell className="min-h-0 flex-1 rounded-none border-0" footer={<TableFooter spread><span className="text-xs sm:text-sm">Last updated: {updatedText}</span><span className="shrink-0 text-xs sm:text-sm">Total rows: {users.length}</span></TableFooter>}>
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <DataTable
          columns={columns}
          data={users}
          loading={loading}
          loadingMessage="Loading users..."
          emptyMessage="No users yet."
          getRowId={(row) => String(row.id)}
          selectedRowId={selected ? String(selected.id) : undefined}
          onRowClick={(user) => { setSelectedId(user.id); setInfoPanelState("expanded"); }}
          onRowDoubleClick={setViewing}
          ariaLabel="Users"
          features={{ selection: bulk.selection }}
          renderActions={(user) => <OptionsMenu ariaLabel={`Actions for ${user.name}`} items={menuFor(user)} />}
        />
        <DataTableInfoPanel
          title="User Details"
          entity={userForInfo(selected, selected ? rolesOf(selected) : [])}
          sections={userInfoSections}
          emptyText="Select a user row to view details."
          state={infoPanelState}
          onToggle={() => setInfoPanelState((current) => current === "expanded" ? "collapsed" : "expanded")}
        />
      </div>
    </DataTableShell>

    {viewing && <RecordViewPanel title={viewing.name || "User"} entity={userForInfo(viewing, rolesOf(viewing))} sections={userInfoSections} sidebarAriaLabel="User sections" onClose={() => setViewing(null)} />}

    {managing && <UserRolesDialog
      user={managing}
      held={rolesOf(managing)}
      allRoles={allRoles}
      busy={busy}
      // Several roles can be ticked before Add is pressed, so the assignment is a run of calls
      // reported as one outcome rather than a notice per role.
      onAssign={(roleIds) => run(async () => { for (const roleId of roleIds) await assignRoleToUser(managing.id, roleId); }, roleIds.length > 1 ? "Roles assigned." : "Role assigned.")}
      onRemove={(roleId, roleName) => removeRole(managing.id, roleId, roleName)}
      onClose={() => setManaging(null)}
    />}

    {linking && <EmployeeLinkDialog
      user={linking}
      employees={employees}
      busy={busy}
      onSave={(employeeId) => run(
        () => setUserEmployeeLink(linking.id, employeeId),
        employeeId ? "Employee linked." : "Employee link cleared.",
      ).then(() => setLinking(null))}
      onClose={() => setLinking(null)}
    />}

    {pendingDelete && <ConfirmDialog
      title="Delete user"
      message={`Delete ${pendingDelete.name}? They lose access immediately and this cannot be undone.`}
      confirmLabel="Delete"
      busyLabel="Deleting..."
      loading={busy}
      onConfirm={() => run(() => deleteUser(pendingDelete.id), "User deleted.").then(() => setPendingDelete(null))}
      onCancel={() => setPendingDelete(null)}
    />}

    <FloatingNotice notice={notice} onClose={clearNotice} />
  </>;
}

// Where somebody's access is actually decided: the roles they carry, and nothing else.
function UserRolesDialog({ user, held, allRoles, busy, onAssign, onRemove, onClose }) {
  // One height whatever it holds: roles are added and removed from here, and a card that resized on
  // every one of those moved the Add control out from under the pointer that had just used it. The
  // list inside scrolls instead; `bodyClassName` makes the body the column the picker fills.
  return <Dialog
    title={`Roles — ${user.name}`}
    description="Everything this person may do comes from the roles below, in the branches those roles name."
    size="lg"
    height="mid"
    bodyClassName="flex flex-col"
    busy={busy}
    onClose={onClose}
    footer={<Button type="button" onClick={onClose}>Close</Button>}
  >
    <RolePicker fill roles={allRoles} selected={held} busy={busy} onAdd={onAssign} onRemove={onRemove} emptyText="No roles yet, so this person can do nothing." />
  </Dialog>;
}


/**
 * Which person a login belongs to.
 *
 * `User` and `Employee` are separate records joined only by `User.linkedEmployeeId`, and that link
 * is what Employee Attendance reads to decide whose day is being marked, what Payment Requests
 * matches a requester on, and how Tasks and the org chart find the person behind a login. An
 * account raised from the Employee Repository arrives linked; one created any other way — the first
 * Super Admin, an account added here — did not, and had no way to become linked at all. This is
 * that way.
 *
 * The list is a searchable `Dropdown` rather than a picker of its own: it is one value chosen from
 * a closed set, which is what that control is.
 */
function EmployeeLinkDialog({ user, employees, busy, onSave, onClose }) {
  const loading = employees === null;
  const [choice, setChoice] = useState(user.linkedEmployeeId ? String(user.linkedEmployeeId) : "none");

  // Somebody already linked to this account is not "taken" from its own point of view, and the row
  // for anybody else's login says so rather than being dropped — a name missing from the list gives
  // no way to tell "not in the repository" from "already spoken for".
  const options = [
    { label: "Not linked", value: "none" },
    ...(employees || []).map((employee) => ({
      value: String(employee.id),
      label: [
        employeeLabel(employee),
        employee.designation || employee.department || null,
        employee.linkedToUserId && employee.linkedToUserId !== user.id ? "already linked" : null,
      ].filter(Boolean).join(" · "),
      disabled: Boolean(employee.linkedToUserId) && employee.linkedToUserId !== user.id,
    })),
  ];

  const current = user.linkedEmployee ? employeeLabel(user.linkedEmployee) : "Not linked";
  const unchanged = choice === (user.linkedEmployeeId ? String(user.linkedEmployeeId) : "none");

  return <Dialog
    title={`Employee record — ${user.name}`}
    description="Attendance, payment requests, tasks and the org chart all find the person behind a login through this link. Without one, this account cannot mark a day or raise a request."
    size="md"
    busy={busy}
    onClose={onClose}
    footer={<>
      <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
      <Button type="button" variant="primary" disabled={busy || loading || unchanged} onClick={() => onSave(choice === "none" ? null : Number(choice))}>
        {busy ? "Saving..." : "Save"}
      </Button>
    </>}
  >
    <div className="flex flex-col gap-4">
      <p className="text-sm text-slate-600">Currently linked to <span className="font-medium text-slate-900">{current}</span>.</p>
      <Dropdown
        searchable
        label="Employee"
        placeholder={loading ? "Loading the repository..." : "Search by name or employee code"}
        disabled={loading || busy}
        // The list names its own "Not linked" row first and is otherwise the repository in the
        // order the server sent it, which is already by name.
        sorted={false}
        options={options}
        value={choice}
        onChange={setChoice}
      />
      {!loading && !employees.length && <p className="text-sm text-slate-500">No employees on the repository yet. Add one in HRM &rarr; Employee Repository first.</p>}
    </div>
  </Dialog>;
}
