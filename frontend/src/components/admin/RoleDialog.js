"use client";

import { useId, useState } from "react";
import Dropdown from "@/components/shared/Dropdown";
import IconButton from "@/components/shared/IconButton";
import MultiSelectField from "@/components/shared/MultiSelectField";
import ChevronIcon from "@/components/ui/ChevronIcon";
import RolePicker from "@/components/shared/RolePicker";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import SelectableOption from "@/components/shared/SelectableOption";
import SearchField from "@/components/shared/SearchField";
import { featureLabel, moduleLabel, sortFeaturesForMenu, sortModulesForMenu } from "@/constants/modulePermissions";
import { branchLabel } from "@/lib/branchName";
import { markedFieldsMessage } from "@/lib/formErrors.mjs";
import { matchesWordChunks } from "../../lib/wordChunks.mjs";

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
export default function RoleDialog({ title, values, onChange, permissions, branches = [], users = [], usersAccess = null, readOnly = false, isEdit = false, saving = false, error, onClose, onSubmit }) {
  /*
   * Two separate answers to "may this be changed", because they answer to two permissions: what the
   * role grants is Role Management's, and who carries it is User Management's - the endpoints that
   * assign and remove it say so. A locked role is read-only in the first sense and still has to be
   * handed to somebody, so the form can be saved with only its Manage Users section open.
   */
  const usersEditable = usersAccess === "READ_WRITE";
  const formReadOnly = readOnly && !usersEditable;

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
  // One search over every module and sub-module in the matrix. Held here rather than on the form's
  // values: it is how the matrix is being looked at, not part of the role.
  const [permissionQuery, setPermissionQuery] = useState("");
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
    // Only asked of a form whose branches can be changed: a locked role saved for its users alone
    // is not being asked where it applies.
    if (!readOnly && branchesMissing) {
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
   * Ticking Branch Admin fills the matrix below with **everything**, to be cut back from there.
   *
   * An administrator starts from "all of it" and the studio takes away what this particular one
   * has no business in - which is the opposite of building the job up permission by permission,
   * and the way the studio actually describes the role. Every grant is on screen, so the editor
   * still answers the one question it exists for: what does this role do.
   *
   * The tick **survives the editing**. It used to clear the moment any module was touched, on the
   * reading that a role differing from the shared set was no longer carrying it; there is no
   * shared set now, so there is nothing to differ from. Branch Admin is a fact about the role -
   * it carries `ADMIN / Branch Administration`, which is what lets the holder see every record in
   * the branches the role reaches - and cutting a permission out of the matrix does not stop them
   * administering the branch. Only unticking it does.
   */
  const everyPermissionRow = permissions.map((permission) => ({ permissionId: permission.id, accessLevel: "READ_WRITE", permission }));

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
    // Filled on the tick, and left exactly as it is on the untick: taking the title away is not
    // taking the work away, and whoever unticked it can clear what they mean to clear.
    if (checked) mergeIntoMatrix(everyPermissionRow);
    onChange("isBranchManager", checked === true);
  }

  /*
   * Branch Admin: this role sees every record in the branches it reaches.
   *
   * Stored rather than derived, unlike the tick above it. Administrator is a description of the
   * matrix and can be read back off it; this is a decision about the role that nothing in the
   * matrix implies - a role granting every module is not thereby a branch administrator, and one
   * granting little still can be. What it carries is `ADMIN / Branch Administration`, which is the
   * one permission that widens somebody past the work their own name is on (`dataScope`).
   */
  const branchAdminField = {
    name: "isBranchManager",
    type: "custom",
    colSpan: 2,
    render: ({ values: current, onChange: set }) => <div className="rounded-md border border-slate-300 bg-slate-50 px-3 py-2.5">
      <SelectableOption
        label="Branch Admin — sees every record in this role's branches"
        checked={current.isBranchManager === true}
        disabled={readOnly}
        onCheckedChange={setBranchAdmin}
        helperText="Lets them see every record in the branches listed above, not only the work their own name is on. Ticking it fills every module below at Read / Write — take away whatever this administrator has no business in."
      />
    </div>,
  };

  // The modules the search leaves something of; with no search, all of them.
  const fields = moduleKeys.filter((key) => searchModule(moduleLabel(key), featuresOf(key), permissionQuery)).map((key) => ({
    name: moduleField(key),
    type: "custom",
    colSpan: 2,
    render: ({ values: current, onChange: set }) => <ModuleBlock
      label={moduleLabel(key)}
      features={featuresOf(key)}
      value={current[moduleField(key)] || emptyModule()}
      onChange={set}
      readOnly={readOnly}
      query={permissionQuery}
    />,
  }));

  /*
   * The search, under Branch Admin and above the modules it narrows. Not locked for a viewer who may only look: finding a
   * permission changes nothing about the role, and it is the one thing a long matrix is hard to do
   * without.
   */
  const permissionSearchField = {
    name: "permissionSearch",
    type: "custom",
    colSpan: 2,
    render: () => <div>
      <SearchField
        ariaLabel="Search modules and permissions"
        placeholder="Search modules and permissions"
        value={permissionQuery}
        onChange={setPermissionQuery}
        // Enter in a text box submits the form around it, which here would save the role.
        preventSubmit
      />
      {permissionQuery.trim() && fields.length === 0 && <p className="mt-3 text-sm text-slate-500">No module or permission matches “{permissionQuery.trim()}”.</p>}
    </div>,
  };

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
    { id: "permissions", title: "Action permissions", fields: [branchAdminField, permissionSearchField, ...fields] },
    /*
     * Who carries the role, held on the form like every other answer and handed over when it is
     * saved - a new role has no id to assign anybody to until then. Left out entirely for a viewer
     * without User Management, rather than shown and then refused.
     */
    ...(usersAccess ? [{
      id: "users",
      title: "Manage Users",
      fields: [{
        name: "userIds",
        type: "custom",
        colSpan: 2,
        render: ({ values: current, onChange: set }) => {
          const heldIds = new Set(current.userIds || []);
          return <RolePicker
            roles={users}
            selected={users.filter((user) => heldIds.has(user.id))}
            onChange={(next) => set(next)}
            readOnly={!usersEditable}
            label="Users"
            placeholder="Select one or more users"
            subtitleOf={null}
            emptyText="Nobody carries this role yet."
          />;
        },
      }],
    }] : []),
  ];

  return <SchemaFormPanel
    title={title}
    // Not the panel's own `readOnly`: that disables every control in one fieldset, the search and
    // the module chevrons with them, and a viewer who may only look still has to find a permission
    // and open a module to read it. Every field that changes the role takes `readOnly` itself
    // instead - the name, branches, description, Branch Admin, each module's level and each row's
    // radios, and Manage Users - so a field added here must do the same.
    sections={sections}
    values={values}
    onChange={onChange}
    // The message is under the Branches box; the top says only that one field is marked.
    error={branchError ? markedFieldsMessage(1) : error}
    saving={saving}
    // An existing role is updated, a new one saved. The caller knows which, because it is the
    // same answer its title is built from.
    submitLabel={formReadOnly ? undefined : isEdit ? "Update" : "Save"}
    savingLabel="Saving..."
    cancelLabel={formReadOnly ? "Close" : "Cancel"}
    onClose={onClose}
    onSubmit={formReadOnly ? undefined : submit}
    closeAriaLabel={`Close ${title}`}
    sidebarAriaLabel="Role sections"
  />;
}

/**
 * The sub-modules a search leaves of one module, or `null` when the module has nothing to show.
 *
 * A module whose own name matches keeps every sub-module - somebody looking for "CRM" wants the
 * module, not the few rows that happen to spell it. Otherwise the rows are matched on both the name
 * a person reads and the key it is stored under, because the row shows the two and either is a
 * reasonable thing to type. No search leaves everything.
 */
export function searchModule(label, features, query) {
  const term = String(query || "").trim().toLocaleLowerCase();
  if (!term) return features;
  const has = (text) => matchesWordChunks(text, term);
  if (has(label)) return features;
  const rows = features.filter((permission) => [featureLabel(permission), permission.displayName, permission.feature].some(has));
  return rows.length ? rows : null;
}

/**
 * A module's value from what each of its rows is set to: every row at one level is that level on
 * the module's dropdown - Read, Read / Write, or Disabled when none of them grants anything - and
 * anything mixed is Custom, holding the rows. What is saved is the same either way; this is what
 * the dropdown says.
 */
export function settleModule(grants, features) {
  const levels = new Set(features.map((permission) => grants[permission.id] || "DISABLED"));
  if (features.length > 0 && levels.size === 1) return { level: [...levels][0], grants: {} };
  return { level: "CUSTOM", grants };
}

export function ModuleBlock({ label, features, value, onChange, readOnly, query = "" }) {
  // Whether the sub-modules are on screen is a separate question from whether the module grants
  // anything. Editing a role that touches five modules used to open all five at once, because the
  // two were the same flag; now every section starts closed and is opened by asking for it.
  const [expanded, setExpanded] = useState(false);
  // A search opens every module it leaves on screen, so its answer can be read without a click per
  // module. One can still be put away while that search stands: remembered against the search it
  // was put away under, so the next thing typed - or clearing it - brings the ordinary state back
  // without anything having to reset it.
  const [closedUnder, setClosedUnder] = useState(null);
  // The page-wide search decides which modules are worth opening; this one narrows the rows inside
  // one already-open module, for the module with too many sub-modules to read by eye - CRM Leads,
  // Asset Management. Its own state, cleared the moment the module is put away, so reopening it
  // starts from every row again rather than a filter chosen for a different look.
  const [localQuery, setLocalQuery] = useState("");
  const searching = query.trim() !== "";
  // Ties the chevron to the panel it opens, so a screen reader can say what the button controls.
  const panelId = useId();
  const granting = value.level !== "DISABLED";
  const open = searching ? closedUnder !== query : expanded && granting;
  const custom = value.level === "CUSTOM";

  const showSection = (next) => {
    setExpanded(next);
    if (!next) setLocalQuery("");
  };
  const toggle = () => {
    if (searching) { setClosedUnder(open ? query : null); return; }
    showSection(!expanded);
  };

  // The rows the page-wide search leaves on screen; the parent has already left out a module it
  // leaves nothing of.
  const pageFilteredFeatures = searchModule(label, features, query) || [];
  // Narrowed again by this module's own search - row-level only, since the "the module's name
  // matches, so keep everything" shortcut that makes sense for finding a module in a long list
  // would defeat the point of a search meant to shorten the list once it is already open.
  const localTerm = localQuery.trim().toLocaleLowerCase();
  const shownFeatures = localTerm
    ? pageFilteredFeatures.filter((permission) => [featureLabel(permission), permission.displayName, permission.feature]
      .some((text) => matchesWordChunks(text, localTerm)))
    : pageFilteredFeatures;

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

  /*
   * A row is changed whatever the module is set to. Under Read or Read / Write the module answered
   * for every row, so that answer is written out per row first and the change made on top of it -
   * which is Custom - and then `settleModule` reads the result back: every row at one level is
   * that level on the dropdown, Disabled included.
   */
  const setRows = (levels) => {
    const grants = Object.fromEntries(features.map((permission) => [permission.id, levelOf(permission.id)]));
    onChange(settleModule({ ...grants, ...levels }, features));
  };
  const setFeatureLevel = (permissionId, accessLevel) => setRows({ [permissionId]: accessLevel });

  /**
   * The column head's radio: every sub-module on screen, set to that level in one move.
   *
   * On screen is the operative word. With a search narrowing the list this sets what the search
   * left, not what it hid — reaching past the filter would change rows the reader cannot see, and
   * a row set out of sight is exactly the kind of grant nobody can account for later.
   */
  const setAllLevels = (accessLevel) => setRows(Object.fromEntries(shownFeatures.map((permission) => [permission.id, accessLevel])));

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
      {/* The accordion's one toggle, at the left end where the eye starts the row: pointing down
          while the sub-modules are put away and up while they are on screen. A module set to
          Disabled has nothing to open outside a search, so it gets no chevron then - just a space
          of the same width, so the module names still line up down the column. */}
      {granting || searching
        ? <IconButton
          size="sm"
          onClick={toggle}
          aria-expanded={open}
          // Only while the panel exists: pointing at an id that is not in the page names nothing.
          aria-controls={open ? panelId : undefined}
          label={`${open ? "Hide" : "Show"} ${label} sub-modules`}
          className="text-slate-500 hover:bg-transparent hover:text-slate-800"
        >
          <ChevronIcon direction={open ? "up" : "down"} size={20} />
        </IconButton>
        : <span aria-hidden="true" className="h-8 w-8 shrink-0" />}
      {/* The module name grows when its sub-modules are on screen: a list of seven closed rows reads
          as a list, and the one that is open reads as the heading of what is under it. */}
      <span id={`${panelId}-label`} className={`min-w-0 flex-1 truncate text-slate-900 ${open ? "text-base" : "text-sm"}`}>{label}</span>
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
    </header>

    {open && <div id={panelId} role="region" aria-labelledby={`${panelId}-label`}>
      {/* One row across the top of the open module: the search, smaller and on the left where a
          module has enough sub-modules that finding one by eye is the slower way - the page-wide
          search above already narrows which modules are worth opening at all - and the three
          columns the rows answer in on the right, each with the radio that sets the whole column.
          Below `sm` the columns have no room for a header, so they drop out and each row's radios
          carry their own labels instead; the search stays. */}
      <div className={`flex-wrap items-end justify-between gap-3 border-b border-slate-200 px-3 py-2 ${features.length > 8 ? "flex" : "hidden sm:flex"}`}>
        {features.length > 8
          ? <div className="w-full sm:w-80">
            <SearchField
              value={localQuery}
              onChange={setLocalQuery}
              preventSubmit
              ariaLabel={`Search ${label} sub-modules`}
              placeholder={`Search ${label} sub-modules`}
            />
          </div>
          : <span className="text-xs font-medium text-slate-500">Sub-module</span>}
        {/* The column name, and under it the radio that sets the whole column. It sits in the head
            because that is what it acts on — a column — rather than beside the rows it would then
            look like one of. */}
        <div className="hidden shrink-0 gap-2 sm:grid sm:grid-cols-3">
          {ACCESS_LEVELS.map((level) => <label
            key={level.value}
            className={`flex w-24 flex-col items-center gap-1 text-center text-xs font-medium text-slate-500 ${!readOnly ? "cursor-pointer" : "cursor-default"}`}
          >
            <span>{level.rowLabel}</span>
            <input
              type="radio"
              name={`access-all-${label}`}
              value={level.value}
              checked={everyRowAt(level.value)}
              disabled={readOnly || shownFeatures.length === 0}
              onChange={() => setAllLevels(level.value)}
              aria-label={searching || localTerm
                ? `Set the ${shownFeatures.length} matching ${label} sub-modules to ${level.rowLabel}`
                : `Set every ${label} sub-module to ${level.rowLabel}`}
              className="h-4 w-4 shrink-0 accent-blue-600 disabled:opacity-60"
            />
          </label>)}
        </div>
      </div>

      {localTerm && shownFeatures.length === 0 && (
        <p className="px-3 py-3 text-sm text-slate-500">No {label} sub-modules match &ldquo;{localQuery.trim()}&rdquo;.</p>
      )}
      <ul className="divide-y divide-slate-100">
        {shownFeatures.map((permission) => <li key={permission.id} className="px-3 py-2 sm:grid sm:grid-cols-[minmax(0,1fr)_repeat(3,6rem)] sm:items-center sm:gap-2">
          <span className="min-w-0">
            <span className="block truncate text-sm text-slate-900">{featureLabel(permission)}</span>
            <span className="block truncate text-xs text-slate-500">{permission.feature}</span>
          </span>

          {/* One group per sub-module: the three are mutually exclusive, which is what a radio says
              and a set of checkboxes does not. Under Read or Read / Write they show the module's
              answer, and changing one turns the module Custom - see `setRows`. */}
          <div role="radiogroup" aria-label={`${permission.feature} access`} className="mt-2 flex gap-4 sm:col-span-3 sm:mt-0 sm:grid sm:grid-cols-3 sm:gap-2">
            {ACCESS_LEVELS.map((level) => <label key={level.value} className={`flex items-center gap-1.5 text-xs text-slate-700 sm:justify-center ${!readOnly ? "cursor-pointer" : "cursor-default"}`}>
              <input
                type="radio"
                name={`access-${permission.id}`}
                value={level.value}
                checked={levelOf(permission.id) === level.value}
                disabled={readOnly}
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
 * Lifted out of `toValues` because a role's matrix is read in two places
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
/** The grant rows a matrix of `module__*` values means. */
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

/**
 * What saving the Manage Users section has to do: the accounts ticked since the form opened, and
 * the ones unticked. Everybody else is left alone, so a save that changed nobody makes no calls.
 */
export function roleUserChanges(before = [], after = []) {
  const was = new Set(before);
  const now = new Set(after);
  return {
    add: after.filter((id) => !was.has(id)),
    remove: before.filter((id) => !now.has(id)),
  };
}
