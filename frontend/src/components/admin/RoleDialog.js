"use client";

import { useMemo, useState } from "react";
import Dropdown from "@/components/shared/Dropdown";
import IconButton from "@/components/shared/IconButton";
import MultiSelectField from "@/components/shared/MultiSelectField";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import SelectableOption from "@/components/shared/SelectableOption";
import { featureLabel, moduleLabel, sortFeaturesForMenu, sortModulesForMenu } from "@/constants/modulePermissions";
import { branchLabel } from "@/lib/branchName";

// What a single sub-module may be set to. These three are the whole vocabulary the server stores.
// The sub-module rows say "No access" where the module dropdown says "Disabled": on a row it is an
// answer about that feature, and "no access" is what it means.
const ACCESS_LEVELS = [
  { value: "DISABLED", label: "Disabled", rowLabel: "No access" },
  { value: "READ", label: "Read", rowLabel: "Read" },
  { value: "READ_WRITE", label: "Read / Write", rowLabel: "Read & Write" },
];
  
// The order of the three levels, for the merge that Branch Admin does. The server ranks them
// the same way in `IAMService._mergeMostPermissive`; a disagreement here would show a role one set
// of permissions and resolve it to another.
const ACCESS_LEVEL_RANK = { DISABLED: 0, READ: 1, READ_WRITE: 2 };

// What a module may be set to. The first three settle every sub-module at once; Custom hands the
// choice back per sub-module. Custom is a state of the form, never of the data - what reaches the
// server is always the three levels above.
const MODULE_LEVELS = [...ACCESS_LEVELS, { value: "CUSTOM", label: "Custom" }];

// One form field per module, holding everything chosen inside it. Keeping a module's state under a
// single name is what lets the schema panel drive a control this nested: the panel reports the
// edit, the block below decides what the edit meant.
export const moduleField = (key) => `module__${key}`;

export const emptyModule = () => ({ level: "DISABLED", grants: {} });

/**
 * Create and edit a role, on the same panel every full-screen form in the app uses.
 *
 * A module is set in one move: Read or Read / Write settles every sub-module under it and shows
 * them as read-only, so the common case is one choice rather than one per feature. **Custom** is
 * there for the case that is not common, and hands each sub-module its own row of radios.
 */
export default function RoleDialog({ title, values, onChange, permissions, branches = [], adminPermissions = [], readOnly = false, isEdit = false, saving = false, error, onClose, onSubmit }) {
  /*
   * Branches, which the panel cannot judge for itself.
   *
   * `requiredProblems` skips `type: "custom"` on purpose - a custom field's answer need not live
   * under its own name at all - so the `required` mark on this one was decoration: the form asked
   * for a branch and saved the role without one, and a role reaching no branch grants nothing
   * anywhere. The panel's own contract for this is that a caller marks such a field itself and
   * passes the mark down in `errors`, which is what this does. The server refuses it too
   * (`readBranchIds`); this is so the answer arrives on the field rather than as a failed save.
   */
  const [refused, setRefused] = useState(false);
  const branchesMissing = !(values.branchIds || []).length;
  const branchError = refused && branchesMissing ? "Select at least one branch." : "";

  /*
   * The event is taken and passed on, which is not decoration.
   *
   * The panel is a real `<form>` and its footer button is a plain `<button>`, so it submits
   * natively; `SchemaFormPanel.handleSubmit` only calls `preventDefault` on the paths where it
   * refuses, and leaves the passing one to whoever it hands the event to. Dropping the argument
   * here meant nothing ever called it: refusing a save let the browser submit the form anyway and
   * the whole page navigated - which reads exactly like the save going through and the panel
   * closing - and allowing one reached `RoleManagement.save(undefined)`, whose own
   * `event?.preventDefault?.()` then did nothing, so a successful save reloaded the page too.
   */
  function submit(event) {
    if (branchesMissing) {
      event?.preventDefault?.();
      setRefused(true);
      return;
    }
    setRefused(false);
    onSubmit(event);
  }

  // Both in sidebar order, so the blocks and the rows inside them read the way the menu does. The
  // catalogue's own order is an implementation detail of the seed and had Resource Management above
  // HRM; somebody handing out permissions is thinking in screens, and looks for them where the menu
  // puts them.
  const moduleKeys = sortModulesForMenu(new Set(permissions.map((permission) => permission.module)));
  const featuresOf = (key) => sortFeaturesForMenu(permissions.filter((permission) => permission.module === key));

  /*
   * Ticking Branch Admin writes the shared set **into the matrix below** rather than hiding it
   * behind a flag.
   *
   * A tick that silently granted eleven permissions with nothing on screen to show for it is a
   * screen that cannot answer "what does this role actually do" - which is the one question the
   * role editor exists to answer. So the set is merged in, most-permissive, exactly as the server
   * merges it: what you see below is what the role resolves to.
   *
   * And because it is really there, **editing any module detaches the role from the set**: the tick
   * clears, and what is on screen stays as this role's own grants. That is the honest reading of
   * the edit - the moment somebody's permissions differ from the shared set they are not carrying
   * the shared set any more, they are a person with their own list. Unticking by hand does the
   * same thing, and for the same reason: the permissions stay, the sharing stops.
   */
  const adminRows = permissionRows(permissionValues(adminPermissions, permissions), permissions);

  function mergeIntoMatrix(rows) {
    const byId = new Map(permissions.map((permission) => [permission.id, permission]));
    const strongest = new Map();
    for (const row of [...permissionRows(values, permissions), ...rows]) {
      const held = strongest.get(row.permissionId);
      if (!held || ACCESS_LEVEL_RANK[row.accessLevel] > ACCESS_LEVEL_RANK[held.accessLevel]) strongest.set(row.permissionId, row);
    }
    const merged = [...strongest.values()]
      .filter((row) => byId.has(row.permissionId))
      .map((row) => ({ ...row, permission: byId.get(row.permissionId) }));
    const next = permissionValues(merged, permissions);
    for (const key of moduleKeys) onChange(moduleField(key), next[moduleField(key)] || emptyModule());
  }

  function setBranchAdmin(checked) {
    if (checked) mergeIntoMatrix(adminRows);
    onChange("isBranchManager", checked === true);
  }

  /*
   * Branch Admin: this role carries the studio's **Admin Permission** set on top of whatever it
   * grants below.
   *
   * Stored rather than derived, unlike the tick above it. Administrator is a description of the
   * matrix and can be read back off it; this is a decision about the role that nothing in the
   * matrix implies - a role granting every module is not thereby a branch administrator, and one
   * granting nothing still can be.
   *
   * The set itself is edited once, from **Admin Permission** in the Roles page, and every role
   * ticked here follows it. That is said on the tick rather than left to be discovered, because
   * "where did this role get that permission from" is otherwise unanswerable from this screen.
   */
  const branchAdminField = {
    name: "isBranchManager",
    type: "custom",
    colSpan: 2,
    render: ({ values: current, onChange: set }) => <div className="rounded-md border border-slate-300 bg-slate-50 px-3 py-2.5">
      <SelectableOption
        label="Branch Admin — also carries the shared Admin Permission set"
        checked={current.isBranchManager === true}
        disabled={readOnly}
        onCheckedChange={setBranchAdmin}
      />
      <p className="mt-1 pl-6 text-xs font-normal text-slate-500">
        Edited once in <span className="font-medium">Admin Permission</span> on the Roles page and shared by
        every role ticked here — change it there and every branch admin changes with it. Ticking it fills
        the modules below with that set; editing any of them afterwards unticks this and keeps the
        permissions as this role&apos;s own.
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
      onChange={(next) => {
        set(next);
        // Touching the matrix is what ends the sharing. Checked here rather than in `ModuleBlock`
        // so the block stays a control that knows nothing about roles.
        if (current.isBranchManager === true) onChange("isBranchManager", false);
      }}
      readOnly={readOnly}
    />,
  }));

  // Two sections rather than lead fields plus one, so the panel draws its rail: it hides the rail
  // for a single-section form, and what a role is called is a different question from what it may
  // do - worth being able to jump between once the permission list runs long.
  const sections = [
    {
      id: "identification",
      title: "Identification",
      fields: [
        // Half width each, so the two short answers share a row and the description gets the full
        // width it actually needs.
        { name: "name", label: "Role name", type: "text", required: true, props: { readOnly } },
        {
          name: "branchIds",
          type: "custom",
          // Above the description, beside the name: what a role is called and where it applies are
          // the two things that identify it, and the description explains them.
          render: ({ values: current, onChange: set }) => <MultiSelectField
            label="Branches"
            required
            error={branchError}
            searchable
            placeholder="Select branches"
            helperText="Everything this role grants applies in every branch selected here."
            readOnly={readOnly}
            options={branches.map((branch) => ({ value: branch.id, label: branchLabel(branch.name) }))}
            values={current.branchIds || []}
            onChange={(next) => set(next)}
          />,
        },
        { name: "description", label: "Description", type: "textarea", colSpan: 2, props: { rows: 2, readOnly } },
      ],
    },
    { id: "permissions", title: "Action permissions", fields: [branchAdminField, ...fields] },
  ];

  return <SchemaFormPanel
    title={title}
    // Belt and braces with the per-field `disabled` below: the panel disables the whole form in one
    // move, so a field added here later cannot quietly become editable in the view-only case.
    readOnly={readOnly}
    readOnlyReason="You have read-only access to Role Management."
    sections={sections}
    values={values}
    onChange={onChange}
    error={branchError ? "Complete required fields: Branches" : error}
    saving={saving}
    // An existing role is updated, a new one saved. The caller knows which, because it is the
    // same answer its title is built from.
    submitLabel={readOnly ? undefined : isEdit ? "Update" : "Save"}
    savingLabel="Saving..."
    cancelLabel={readOnly ? "Close" : "Cancel"}
    onClose={onClose}
    onSubmit={readOnly ? undefined : submit}
    closeAriaLabel={`Close ${title}`}
    sidebarAriaLabel="Role sections"
  />;
}

export function ModuleBlock({ label, features, value, onChange, readOnly }) {
  // Whether the sub-modules are on screen is a separate question from whether the module grants
  // anything. Editing a role that touches five modules used to open all five at once, because the
  // two were the same flag; now every section starts closed and is opened by asking for it.
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const granting = value.level !== "DISABLED";
  const open = expanded && granting;
  const custom = value.level === "CUSTOM";

  // Opening and shutting the section goes through here so the search cannot outlive it: a module
  // reopened a minute later should show everything it has, not still be filtered by something typed
  // and forgotten.
  const showSection = (next) => {
    setExpanded(next);
    if (!next) setQuery("");
  };

  /**
   * The sub-modules the search leaves on screen.
   *
   * Matched on both the name a person reads and the key it is stored under, because the row shows
   * the two and either is a reasonable thing to type. A module of one sub-module is not offered a
   * search: there is nothing to narrow.
   */
  const searchable = features.length > 1;
  const shownFeatures = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    if (!term) return features;
    return features.filter((permission) => [featureLabel(permission), permission.displayName, permission.feature]
      .filter(Boolean)
      .some((text) => String(text).toLocaleLowerCase().includes(term)));
  }, [features, query]);

  const setModuleLevel = (level) => {
    // Moving to Custom keeps whatever the module was already granting as the starting point, so
    // "Read, except one feature" is two moves rather than a fresh list of choices.
    if (level === "CUSTOM") {
      const grants = Object.keys(value.grants).length
        ? value.grants
        : Object.fromEntries(features.map((permission) => [permission.id, value.level === "DISABLED" ? "DISABLED" : value.level]));
      onChange({ ...value, level, grants });
      return;
    }
    // Read and Read / Write settle every sub-module, so the per-feature map is not consulted while
    // one of them is chosen - it is cleared to keep the state honest about what is in force.
    onChange({ ...value, level, grants: {} });
  };

  // Choosing a level opens the section: it is the answer to what was just asked, so showing it is
  // not the same as having been open all along. Disabling closes it again.
  const chooseLevel = (level) => {
    showSection(level !== "DISABLED");
    setModuleLevel(level);
  };

  const setFeatureLevel = (permissionId, accessLevel) => onChange({
    ...value,
    grants: { ...value.grants, [permissionId]: accessLevel },
  });

  /**
   * The column head's radio: every sub-module on screen, set to that level in one move.
   *
   * On screen is the operative word. With a search narrowing the list this sets what the search
   * left, not what it hid — reaching past the filter would change rows the reader cannot see, and
   * a row set out of sight is exactly the kind of grant nobody can account for later.
   */
  const setAllLevels = (accessLevel) => onChange({
    ...value,
    grants: { ...value.grants, ...Object.fromEntries(shownFeatures.map((permission) => [permission.id, accessLevel])) },
  });

  // Checked only when the whole column agrees. A mixed set leaves all three empty, which is what a
  // radio group with no answer looks like and is the truth: there is no one level here.
  const everyRowAt = (accessLevel) => shownFeatures.length > 0
    && shownFeatures.every((permission) => levelOf(permission.id) === accessLevel);

  // Putting the section away and taking its access away are different things: this is the former,
  // and the dropdown's Disabled is the latter. A module left granting stays granting whether or not
  // its sub-modules are on screen.

  const levelOf = (permissionId) => (custom ? value.grants[permissionId] || "DISABLED" : value.level);
  const granted = custom
    ? features.filter((permission) => levelOf(permission.id) !== "DISABLED").length
    : granting ? features.length : 0;

  return <section className="rounded-lg border border-slate-200">
    <header className="flex flex-wrap items-center gap-2 bg-slate-50 px-3 py-2">
      {/* The module name grows when its sub-modules are on screen: a list of seven closed rows reads
          as a list, and the one that is open reads as the heading of what is under it. `text-base`
          rather than `text-md`, which is not a class Tailwind defines and was quietly doing
          nothing. */}
      {granting
        ? <button
          type="button"
          onClick={() => showSection(!expanded)}
          aria-expanded={expanded}
          className={`min-w-0 flex-1 truncate rounded text-left text-slate-900 ${open ? "text-base" : "text-sm"}`}
        >
          {label}
        </button>
        : <span className="min-w-0 flex-1 truncate text-sm text-slate-900">{label}</span>}
      <span className="shrink-0 text-sm text-slate-500 max-sm:hidden">{granting ? `${granted} of ${features.length}` : ""}</span>
      <div className="w-full shrink-0 sm:w-44">
        <Dropdown
          ariaLabel={`${label} access`}
          readOnly={readOnly}
          value={value.level}
          onChange={chooseLevel}
          options={MODULE_LEVELS}
          sorted={false}
        />
      </div>
      {/* Only while the section is open, to put it away. Opening it again is done by pressing the
          module name, so a closed row carries no control of its own - just a space of the same
          width, so the dropdowns still line up down the column. */}
      {open
        ? <IconButton
          onClick={() => showSection(false)}
          label={`Hide ${label} sub-modules`}
          className="shrink-0 text-slate-500 hover:bg-slate-200 hover:text-slate-800"
        >
          <span aria-hidden="true" className="text-lg leading-none">−</span>
        </IconButton>
        : <span aria-hidden="true" className="h-10 w-10 shrink-0" />}
    </header>

    {open && <div>
      {/* One row across the top of the open module: what is being looked for on the left, and the
          three columns the rows answer in on the right, over the columns they belong to.
          
          The search narrows the rows below and nothing else — what a module grants is untouched by
          what is being looked at, so a sub-module filtered out of sight keeps whatever it was set
          to. Below `sm` the columns have no room for a header, so they drop out and each row's
          radios carry their own labels instead; the search stays, full width. */}
      <div className="border-b border-slate-200 px-3 py-2 sm:grid sm:grid-cols-[minmax(0,1fr)_repeat(3,6rem)] sm:items-end sm:gap-2">
        {searchable
          ? <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={`Search ${label} sub-modules`}
            placeholder="Search sub-modules"
            className="min-h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 sm:w-1/2"
          />
          : <span className="hidden text-xs font-medium text-slate-500 sm:block">Sub-module</span>}
        {/* The column name, and under it the radio that sets the whole column. It sits in the head
            because that is what it acts on — a column — rather than beside the rows it would then
            look like one of. */}
        {ACCESS_LEVELS.map((level) => <label
          key={level.value}
          className={`hidden flex-col items-center gap-1 text-center text-xs font-medium text-slate-500 sm:flex ${custom && !readOnly ? "cursor-pointer" : "cursor-default"}`}
        >
          <span>{level.rowLabel}</span>
          <input
            type="radio"
            name={`access-all-${label}`}
            value={level.value}
            checked={everyRowAt(level.value)}
            disabled={readOnly || !custom || shownFeatures.length === 0}
            onChange={() => setAllLevels(level.value)}
            aria-label={query.trim()
              ? `Set the ${shownFeatures.length} matching ${label} sub-modules to ${level.rowLabel}`
              : `Set every ${label} sub-module to ${level.rowLabel}`}
            className="h-4 w-4 shrink-0 accent-blue-600 disabled:opacity-60"
          />
        </label>)}
      </div>

      {shownFeatures.length === 0 && <p className="px-3 py-4 text-sm text-slate-500">No sub-module of {label} matches “{query.trim()}”.</p>}

      <ul className="divide-y divide-slate-100">
        {shownFeatures.map((permission) => <li key={permission.id} className="px-3 py-2 sm:grid sm:grid-cols-[minmax(0,1fr)_repeat(3,6rem)] sm:items-center sm:gap-2">
          <span className="min-w-0">
            <span className="block truncate text-sm text-slate-900">{featureLabel(permission)}</span>
            <span className="block truncate text-xs text-slate-500">{permission.feature}</span>
          </span>

          {/* One group per sub-module: the three are mutually exclusive, which is what a radio says
              and a set of checkboxes does not. Under Read or Read / Write the module has already
              answered for every row, so they show the answer without taking a new one. */}
          <div role="radiogroup" aria-label={`${permission.feature} access`} className="mt-2 flex gap-4 sm:col-span-3 sm:mt-0 sm:grid sm:grid-cols-3 sm:gap-2">
            {ACCESS_LEVELS.map((level) => <label key={level.value} className={`flex items-center gap-1.5 text-xs text-slate-700 sm:justify-center ${custom && !readOnly ? "cursor-pointer" : "cursor-default"}`}>
              <input
                type="radio"
                name={`access-${permission.id}`}
                value={level.value}
                checked={levelOf(permission.id) === level.value}
                disabled={readOnly || !custom}
                onChange={() => setFeatureLevel(permission.id, level.value)}
                className="h-4 w-4 shrink-0 accent-blue-600 disabled:opacity-60"
              />
              <span className="sm:hidden">{level.rowLabel}</span>
            </label>)}
          </div>
        </li>)}
      </ul>
    </div>}

  </section>;
}

/** The API's role as the panel's field values. */
/**
 * The `module__*` half of a form's values, read back from a list of grants.
 *
 * Lifted out of `toValues` because the Admin Permission set is the same matrix without a role
 * around it - no name, no description, no branches - and two readings of "what does this grant"
 * would be two chances to disagree about what Custom means.
 */
export function permissionValues(grants, permissions) {
  const values = {};

  for (const key of new Set(permissions.map((permission) => permission.module))) {
    const features = permissions.filter((permission) => permission.module === key);
    const held = (grants || []).filter((grant) => grant.permission?.module === key);

    if (held.length === 0) {
      values[moduleField(key)] = emptyModule();
      continue;
    }

    // A module whose every sub-module is held at one level reads back as that level rather than as
    // Custom - otherwise a role saved as "Sales: Read" would reopen as a custom list saying the
    // same thing, and the simple choice would be lost the moment it was edited.
    const levels = new Set(held.map((grant) => grant.accessLevel));
    const uniform = held.length === features.length && levels.size === 1 ? [...levels][0] : null;

    values[moduleField(key)] = uniform
      ? { level: uniform, grants: {} }
      : { level: "CUSTOM", grants: Object.fromEntries(held.map((grant) => [grant.permissionId, grant.accessLevel])) };
  }

  return values;
}

export function toValues(role, permissions) {
  return {
    name: role?.name || "",
    description: role?.description || "",
    branchIds: (role?.branches || []).map((entry) => entry.branchId),
    // Whether this role is one of the studio's branch administrators. Stored on the role rather
    // than derived, unlike the Administrator tick beside it: Administrator is a *description* of
    // the permissions chosen below and so can be read back off them, while this one is a choice
    // that cannot be - a role granting every module is not thereby a branch administrator.
    isBranchManager: role?.isBranchManager === true,
    ...permissionValues(role?.permissions, permissions),
  };
}

/** And back: what each module settles on, flattened, minus the rows that grant nothing. */
/** The grant rows a matrix of `module__*` values means, for a role or for the Admin Permission set. */
export function permissionRows(values, permissions) {
  const permissionRows = [];

  for (const key of new Set(permissions.map((permission) => permission.module))) {
    const block = values[moduleField(key)];
    if (!block || block.level === "DISABLED") continue;
    const features = permissions.filter((permission) => permission.module === key);

    if (block.level === "CUSTOM") {
      for (const permission of features) {
        const accessLevel = block.grants[permission.id];
        if (!accessLevel || accessLevel === "DISABLED") continue;
        permissionRows.push({ permissionId: permission.id, accessLevel });
      }
      continue;
    }

    // Read and Read / Write mean every sub-module, so the rows are written out here rather than
    // stored per feature while the form is open.
    for (const permission of features) permissionRows.push({ permissionId: permission.id, accessLevel: block.level });
  }

  return permissionRows;
}

export function toPayload(values, permissions) {
  // Derived from what is actually granted rather than read off a checkbox, so the stored flag and
  // the permission rows are the same fact told twice and cannot disagree.
  const moduleKeys = [...new Set(permissions.map((permission) => permission.module))];
  const isAdmin = moduleKeys.length > 0
    && moduleKeys.every((key) => (values[moduleField(key)] || {}).level === "READ_WRITE");

  return {
    name: values.name,
    description: values.description,
    branchIds: values.branchIds || [],
    isAdmin,
    isBranchManager: values.isBranchManager === true,
    permissions: permissionRows(values, permissions),
  };
}

export const emptyRoleValues = (permissions) => toValues(null, permissions);
