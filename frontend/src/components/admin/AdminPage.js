"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import AdministrationSwitch from "@/components/shared/AdministrationSwitch";
import { permissionForRoute } from "@/constants/modulePermissions";
import PermissionGuard from "@/components/shared/PermissionGuard";
import Button from "@/components/shared/Button";
import Loader from "@/components/shared/Loader";
import { usePermissions } from "@/components/auth/PermissionsProvider";
import { getMasterData } from "@/services/hrm/master-data.service";
import useBranchRegistry from "@/components/shared/useBranchRegistry";
import UserManagement from "./UserManagement";
import RoleManagement from "./RoleManagement";



// Branches are loaded once here and handed to the tabs that need them: Roles, where a role names
// the branches it reaches, and Groups, which is a per-branch list and so picks its own.
export default function AdminPage({ tab = "users" }) {
  const { error: permissionsError, reload: reloadPermissions, hasPermission } = usePermissions();
  /*
   * The permission this screen answers to, which is the tab's and not the page's.
   *
   * Both tabs used to be guarded on `ADMIN / User Management`, so a role granted **Role Management**
   * alone was shown "you do not have access to the admin panel" on the one screen it had been given
   * - the route guard let it through, having read `/admin/roles` from the route map, and the page
   * then refused it on a permission nobody had said anything about. Read from the same table, so
   * there is one answer to which permission opens which route.
   */
  const guard = useMemo(() => permissionForRoute(`/admin/${tab}`) || { module: "ADMIN", feature: "User Management" }, [tab]);
  // The header owns the create button for whichever tab is showing, and reaches into that tab to
  // open its form. The alternative - lifting each form's state up here - would mean the header knew
  // what a user, a group and a role each need to start from, which is the tab's business.
  //
  // Three refs rather than one object of them: a ref must be handed straight to the child, and an
  // object rebuilt on every render reads to the linter as a ref being dereferenced mid-render.
  const rolesRef = useRef(null);
  const [branches, setBranches] = useState([]);
  // Bumped when Settings → Organization → Branches saves, which re-runs the load below.
  const branchRegistryRevision = useBranchRegistry();
  const [loadingBranches, setLoadingBranches] = useState(true);
  const [branchError, setBranchError] = useState("");

  useEffect(() => {
    let cancelled = false;
    // Branches are the branches master data, so this is the same list the HRM screens pick from.
    getMasterData("branches", { active: true })
      .then((response) => {
        if (cancelled) return;
        const list = response?.data || [];
        setBranches(list);
        setBranchError("");
      })
      .catch((error) => { if (!cancelled) setBranchError(error.message); })
      .finally(() => { if (!cancelled) setLoadingBranches(false); });
    return () => { cancelled = true; };
    // Nothing here but the branch list, so the whole effect is what a change to the register wants
    // run again - a user's home branch picker offers what the register holds now.
  }, [branchRegistryRevision]);

  // Named per tab rather than "Add": a header button is read on its own, away from the table it
  // acts on. Absent entirely without the permission to use it, rather than present and refused.
  // Only Roles offers a create: a user account is made in the Employee Repository along with the
  // person it belongs to, so an "Add User" here would be a second, competing way in.
  const createAction = tab === "roles" && hasPermission("ADMIN", "Role Management", "READ_WRITE") && "Add Role";

  /*
   * Admin Permission: the one matrix every role marked Branch Admin carries.
   *
   * Offered to anybody who may open this screen rather than to writers alone, because the set is
   * the answer to "why can that branch admin do this" - a question a reader of Role Management has
   * every reason to ask and no other way to answer. The dialog opens read-only without
   * `READ_WRITE`, and the server refuses the save regardless.
   */
  const adminPermissionAction = tab === "roles" && hasPermission("ADMIN", "Role Management", "READ");

  return <PermissionGuard
    module={guard.module}
    feature={guard.feature}
    level="READ"
    // A permission set that could not be fetched is not a permission set of none. Saying "you do not
    // have access" when the API was simply unreachable sends people to ask an administrator for
    // access they already hold, so the two cases are told apart and the fixable one offers a retry.
    fallback={<section className="flex min-h-64 items-center justify-center p-6">
      {permissionsError
        ? <div className="max-w-sm text-center">
          <p className="text-sm leading-6 text-slate-700">Your permissions could not be loaded, so this page cannot tell what you are allowed to see.</p>
          <p className="mt-1 text-xs text-slate-500">{permissionsError.message}</p>
          <Button className="mt-3" variant="primary" onClick={reloadPermissions}>Try again</Button>
        </div>
        : <p className="max-w-sm text-center text-sm leading-6 text-slate-600">You do not have access to this screen. Ask an administrator to grant you {guard.feature} access.</p>}
    </section>}
  >
    <div className="flex min-h-0 flex-1 flex-col">
      <ModulePageHeader
        // Employee Repository on the left across all three screens, so the heading names where you
        // are in the app and only the control beside it changes as you move between them.
        title="Employee Repository"
        titleAccessory={<AdministrationSwitch current={`/admin/${tab}`} />}
        actions={(adminPermissionAction || createAction) && <div className="flex flex-wrap items-center gap-2">
          {adminPermissionAction && <Button variant="secondary" onClick={() => rolesRef.current?.openAdminPermission()}>Admin Permission</Button>}
          {createAction && <Button variant="primary" onClick={() => rolesRef.current?.create()}>{createAction}</Button>}
        </div>}
      />

      {/* No wrapper padding: the table meets the tab bar the way it does in every other module, and
          the tables scroll inside themselves rather than the pane scrolling around them. */}
      <div className="flex min-h-0 flex-1 flex-col">
        {loadingBranches
          ? <div className="p-4"><Loader label="Loading branches..." /></div>
          : branchError
            ? <p className="p-4 text-sm text-red-600">{branchError}</p>
            : <>
              {tab === "users" && <UserManagement />}
              {tab === "roles" && <RoleManagement ref={rolesRef} branches={branches} />}
            </>}
      </div>
    </div>
  </PermissionGuard>;
}
