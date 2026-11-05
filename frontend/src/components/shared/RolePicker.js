"use client";

import { useState } from "react";
import Button from "@/components/shared/Button";
import MultiSelectField from "@/components/shared/MultiSelectField";
import { branchLabel } from "@/lib/branchName";

/** What a role reaches is as much a part of it as its name, so the row carries both. */
const branchesOf = (role) => (role.branches || []).map((entry) => branchLabel(entry.branch?.name)).filter(Boolean).join(", ");

/**
 * The roles an account carries, and the control for adding more. Used wherever access is decided:
 * the admin screen's Roles dialog, and the form that creates an employee's login.
 *
 * Roles are chosen several at a time. An account is usually given the whole set that describes a
 * job, and a one-at-a-time picker made that several trips through the same menu. What is ticked is
 * only staged in the picker — pressing Add is what hands it over, so `onAdd` receives the whole
 * list and the caller decides whether that means an API call or a change to a form it will submit
 * later.
 *
 * `fill` is for the picker that owns a fixed-height surface of its own — the admin screen's Roles
 * dialog. The default grows with the roles held, which is right inside a form that scrolls as a
 * whole; in a dialog it resized the card every time a role was added. Filling instead keeps the
 * Add row in place and scrolls the list under it, so the card is one size whatever it holds.
 * Requires a flex-column parent with a height to divide.
 */
export default function RolePicker({
  roles = [],
  selected = [],
  onAdd,
  onRemove,
  busy = false,
  fill = false,
  emptyText = "No roles yet, so this account can sign in and do nothing.",
}) {
  const [pending, setPending] = useState([]);
  const heldIds = selected.map((role) => role.id);
  const held = new Set(heldIds);

  /*
   * Every role is listed, and the ones already held show ticked.
   *
   * They used to be filtered out of the menu entirely, which said the wrong thing: a role missing
   * from a list of roles reads as one that does not exist or cannot be given, not as one this
   * account already has.
   *
   * Unticking one gives it up, the same as Remove on the row below — a tick that will not untick is
   * a control that does not work. Both are immediate and both are undoable, so the menu is not a
   * quieter way to do something the row would have asked about first.
   */
  const options = roles.map((role) => ({ value: role.id, label: role.name }));
  // Held first, so a tick and a staged choice are never mistaken for one another on save.
  const shownValues = [...heldIds, ...pending.filter((id) => !held.has(id))];

  function change(next) {
    const chosen = new Set(next);
    // A held role that has just been unticked is a removal, and goes straight to the caller.
    for (const role of selected) if (!chosen.has(role.id)) onRemove(role.id, role.name);
    setPending(next.filter((id) => !held.has(id)));
  }

  function add() {
    if (!pending.length) return;
    onAdd(pending);
    setPending([]);
  }

  return <div className={fill ? "flex min-h-0 flex-1 flex-col gap-4" : "space-y-4"}>
    {options.length > 0 && <div className="flex shrink-0 flex-wrap items-end gap-2">
      {/* `searchable`: a studio carries a role per job, so this list is long by the time it matters,
          and both places it opens from are dialogs — the more awkward of the two places to scroll a
          menu. It matches on the role's name, which is all the row shows. */}
      <MultiSelectField
        className="min-w-[12rem] flex-1"
        label="Add Role"
        placeholder="Select one or more roles"
        values={shownValues}
        onChange={change}
        disabled={busy}
        searchable
        options={options}
      />
      {/* Explicitly a button: this sits inside a form panel, where an untyped one would submit it. */}
      <Button type="button" size="sm" variant="primary" disabled={busy || pending.length === 0} onClick={add}>Add</Button>
    </div>}

    {/* `pb-0.5` keeps the last row's border off the scroll edge, and `pr-0.5` off the scrollbar. */}
    <ul className={`flex flex-col gap-1 ${fill ? "min-h-0 flex-1 overflow-y-auto overscroll-contain pb-0.5 pr-0.5" : ""}`}>
      {selected.length === 0 && <li className="rounded-md border border-dashed border-slate-300 px-3 py-5 text-center text-sm text-slate-500">{emptyText}</li>}
      {selected.map((role) => <li key={role.id} className="flex shrink-0 items-center justify-between gap-2 rounded-md border border-slate-200 px-3 py-2">
        <span className="min-w-0">
          <span className="block truncate text-sm text-slate-800">{role.name}</span>
          <span className="block truncate text-xs text-slate-500">{branchesOf(role) || "No branches"}</span>
        </span>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => onRemove(role.id, role.name)}>Remove</Button>
      </li>)}
    </ul>
  </div>;
}
