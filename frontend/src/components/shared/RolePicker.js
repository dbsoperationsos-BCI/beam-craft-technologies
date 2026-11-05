"use client";

import { useState } from "react";
import Button from "@/components/shared/Button";
import MultiSelectField from "@/components/shared/MultiSelectField";
import { branchLabel } from "@/lib/branchName";

/** What a role reaches is as much a part of it as its name, so the row carries both. */
const branchesOf = (role) => (role.branches || []).map((entry) => branchLabel(entry.branch?.name)).filter(Boolean).join(", ");

/**
 * The roles an account carries, and the control for adding more — or, read the other way round, the
 * accounts a role carries. Used wherever access is decided: the admin screen's own Roles dialog, the
 * form that creates an employee's login, and a role's own Manage Users, which is this same control
 * asking the identical question from its other side.
 *
 * Roles (or accounts) are chosen several at a time. One is usually given the whole set that
 * describes a job, and a one-at-a-time picker made that several trips through the same menu. What
 * is ticked is only staged in the picker — pressing Add is what hands it over, so `onAdd` receives
 * the whole list and the caller decides whether that means an API call or a change to a form it
 * will submit later.
 *
 * `fill` is for the picker that owns a fixed-height surface of its own — a dialog. The default
 * grows with what is held, which is right inside a form that scrolls as a whole; in a dialog it
 * resized the card every time an entry was added. Filling instead keeps the Add row in place and
 * scrolls the list under it, so the card is one size whatever it holds. Requires a flex-column
 * parent with a height to divide.
 *
 * `label`, `placeholder` and `subtitleOf` are what let the same control read either direction: a
 * role's list reads by the branches it reaches, and an account's by nothing this component already
 * knows how to ask for, so the caller names its own second line — or leaves the row with the name
 * alone. Left unset, `label` also answers whether staging or `onChange` is in charge — "Roles" for
 * the form below, "Add Role" everywhere it is still Add that hands a tick over.
 *
 * `onChange` is for a picker inside a form that is saved as a whole - the Login Credentials page.
 * There the staged-then-Add step was a trap: a role ticked in the menu showed ticked, the form's
 * own Save Changes was pressed, and the account was saved with no roles and "Changes saved" - the
 * tick had never been handed over, because only Add does that. With `onChange` there is nothing to
 * stage: a tick is the role on the form, the form's save is the one save, and there is no Add
 * button to miss. `onAdd` / `onRemove` stay for the admin dialogs, where each press is its own call.
 *
 * `readOnly` shows the list alone: no picker and no Remove, rather than both disabled, for a viewer
 * who may see who holds what but not change it.
 */
export default function RolePicker({
  roles = [],
  selected = [],
  onAdd,
  onRemove,
  onChange,
  busy = false,
  fill = false,
  emptyText = "No roles yet, so this account can sign in and do nothing.",
  label,
  placeholder = "Select one or more roles",
  subtitleOf = branchesOf,
  noSubtitleText = "No branches",
  readOnly = false,
}) {
  const [pending, setPending] = useState([]);
  const heldIds = selected.map((role) => role.id);
  const held = new Set(heldIds);
  const immediate = typeof onChange === "function";
  // A caller naming its own label always wins; left unset, the label itself is what tells the two
  // modes apart, since nothing else on screen does.
  const effectiveLabel = label ?? (immediate ? "Roles" : "Add Role");

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
  const options = roles.map((role) => ({ value: role.id, label: role.name, avatar: role.avatar }));
  // Held first, so a tick and a staged choice are never mistaken for one another on save.
  const shownValues = immediate ? heldIds : [...heldIds, ...pending.filter((id) => !held.has(id))];

  function change(next) {
    // One list handed over whole, so a tick and an untick in the same change cannot overwrite each other.
    if (immediate) { onChange(next); return; }
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
    {!readOnly && options.length > 0 && <div className="flex shrink-0 flex-wrap items-end gap-2">
      {/* `searchable`: a studio carries a role per job, so this list is long by the time it matters,
          and both places it opens from are dialogs — the more awkward of the two places to scroll a
          menu. It matches on the role's name, which is all the row shows. */}
      <MultiSelectField
        className="min-w-[12rem] flex-1"
        label={effectiveLabel}
        placeholder={placeholder}
        values={shownValues}
        onChange={change}
        disabled={busy}
        searchable
        options={options}
      />
      {/* Explicitly a button: this sits inside a form panel, where an untyped one would submit it. */}
      {!immediate && <Button type="button" size="sm" variant="primary" disabled={busy || pending.length === 0} onClick={add}>Add</Button>}
    </div>}

    {/* `pb-0.5` keeps the last row's border off the scroll edge, and `pr-0.5` off the scrollbar. */}
    <ul className={`flex flex-col gap-1 ${fill ? "min-h-0 flex-1 overflow-y-auto overscroll-contain pb-0.5 pr-0.5" : ""}`}>
      {selected.length === 0 && <li className="rounded-md border border-dashed border-slate-300 px-3 py-5 text-center text-sm text-slate-500">{emptyText}</li>}
      {selected.map((role) => {
        // A caller with nothing of its own to say on the second line — an account has no branches
        // of its own — passes no `subtitleOf` at all, and gets one line rather than an empty one.
        const subtitle = subtitleOf ? (subtitleOf(role) || noSubtitleText) : "";
        return <li key={role.id} className="flex shrink-0 items-center justify-between gap-2 rounded-md border border-slate-200 px-3 py-2">
          <span className="min-w-0">
            <span className="block truncate text-sm text-slate-800">{role.name}</span>
            {subtitle && <span className="block truncate text-xs text-slate-500">{subtitle}</span>}
          </span>
          {!readOnly && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => (immediate ? onChange(heldIds.filter((id) => id !== role.id)) : onRemove(role.id, role.name))}>Remove</Button>}
        </li>;
      })}
    </ul>
  </div>;
}
