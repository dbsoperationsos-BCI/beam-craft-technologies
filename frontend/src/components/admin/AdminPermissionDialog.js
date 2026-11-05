"use client";

import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import { ModuleBlock, emptyModule, moduleField, permissionRows, permissionValues } from "./RoleDialog";
import { moduleLabel, sortFeaturesForMenu, sortModulesForMenu } from "@/constants/modulePermissions";

/**
 * The **Admin Permission** set: the one matrix every role marked Branch Admin carries.
 *
 * The same module and sub-module control the role editor uses, with the role taken away - no name,
 * no description, no branches, because none of those are being decided here. A branch administrator
 * in Erode and one in Bangalore do the same job in two places; the branches are on their own roles
 * and the job is this.
 *
 * `ModuleBlock` and the two value helpers are imported from `RoleDialog` rather than copied. Two
 * implementations of "what does Custom mean" is two chances for this screen and the role editor to
 * disagree about a matrix they both write into the same `permission` table.
 */
export default function AdminPermissionDialog({ values, onChange, permissions, roleCount = 0, readOnly = false, saving = false, error, onClose, onSubmit }) {
  const moduleKeys = sortModulesForMenu(new Set(permissions.map((permission) => permission.module)));
  const featuresOf = (key) => sortFeaturesForMenu(permissions.filter((permission) => permission.module === key));

  /*
   * What saving actually does, said before it is done rather than after.
   *
   * Every other form on this screen changes one role. This one changes what every branch
   * administrator may do, in every branch, without any of those roles being opened - which is the
   * point of having it, and exactly the thing somebody needs to know before they press Save. The
   * count is read from the roles already loaded, so it is the studio's real number rather than a
   * warning phrased in the abstract.
   */
  const notice = {
    name: "__notice",
    type: "custom",
    colSpan: 2,
    render: () => <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
      <p className="font-medium">Shared by every Branch Admin role.</p>
      <p className="mt-1 font-normal">
        {roleCount === 0
          ? "No role is marked Branch Admin yet, so this grants nobody anything until one is."
          : `${roleCount} ${roleCount === 1 ? "role is" : "roles are"} marked Branch Admin. Saving changes what each of them may do, in the branches that role reaches.`}
        {" "}It adds to what those roles already grant and never takes anything away.
      </p>
    </div>,
  };

  const fields = moduleKeys.map((key) => ({
    name: moduleField(key),
    type: "custom",
    colSpan: 2,
    render: ({ values: current, onChange: set }) => <ModuleBlock
      label={moduleLabel(key)}
      features={featuresOf(key)}
      value={current[moduleField(key)] || emptyModule()}
      onChange={set}
      readOnly={readOnly}
    />,
  }));

  // One section, so the panel draws no rail: there is nothing to jump between when the whole form
  // is the matrix.
  return <SchemaFormPanel
    title="Admin Permission"
    readOnly={readOnly}
    readOnlyReason="You have read-only access to Role Management."
    sections={[{ id: "permissions", title: "Action permissions", fields: [notice, ...fields] }]}
    values={values}
    onChange={onChange}
    error={error}
    saving={saving}
    submitLabel={readOnly ? undefined : "Save"}
    savingLabel="Saving..."
    cancelLabel={readOnly ? "Close" : "Cancel"}
    onClose={onClose}
    onSubmit={readOnly ? undefined : onSubmit}
    closeAriaLabel="Close Admin Permission"
    sidebarAriaLabel="Admin permission sections"
  />;
}

/** The form's values, read back from the set the server holds. */
export const adminPermissionValues = (grants, permissions) => permissionValues(grants, permissions);

/** What the server is sent: the grant rows the matrix means, and nothing else. */
export const adminPermissionPayload = (values, permissions) => ({ permissions: permissionRows(values, permissions) });
