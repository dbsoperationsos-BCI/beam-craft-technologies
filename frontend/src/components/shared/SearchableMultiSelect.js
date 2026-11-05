"use client";

import { useState } from "react";
import TextField from "./TextField";

/**
 * A long list of tick boxes with a search over it, for the choices that are too many to sit in a
 * dropdown and too many to read through — a vendor's skills, the languages someone speaks.
 *
 * The list is either flat, through `options`, or divided under headings, through `groups` of
 * `{ group, options }`. Both hold plain strings and the value is the list of chosen strings.
 */
export default function SearchableMultiSelect({
  label,
  required = false,
  options,
  groups,
  value = [],
  onChange,
  className = "",
  placeholder = "Search...",
  emptyText = "No matches.",
  summary = (count) => count ? `${count} selected` : "Nothing selected",
  error = "",
}) {
  const [query, setQuery] = useState("");
  const allGroups = groups || [{ group: "", options: options || [] }];
  const search = query.trim().toLocaleLowerCase();
  const visibleGroups = allGroups
    .map((group) => ({ ...group, options: group.options.filter((option) => option.toLocaleLowerCase().includes(search)) }))
    .filter((group) => group.options.length);

  function toggle(option) {
    onChange(value.includes(option) ? value.filter((item) => item !== option) : [...value, option]);
  }

  /*
   * Select all takes **what is on screen**; Clear takes **everything**.
   *
   * The same asymmetry the other two multi-selects follow, and for the same reason. Selecting is
   * additive and has to respect the search above: a list somebody has narrowed on purpose means all
   * of those, not the whole catalogue from behind it. Clearing is the way out, so it reaches an
   * answer the search is hiding too - otherwise a control can hold a value with nothing on screen
   * that removes it.
   */
  const shownOptions = visibleGroups.flatMap((group) => group.options);
  const allShownChosen = shownOptions.length > 0 && shownOptions.every((option) => value.includes(option));
  const selectAllShown = () => onChange([...value, ...shownOptions.filter((option) => !value.includes(option))]);

  return <div className={className}>
    <TextField label={label} required={required} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} error={error} />
    {/* Above the list, so "all of these" means the options under it. Two controls rather than one
        toggle: Clear has to be reachable whenever anything is chosen, including what the search is
        hiding. */}
    {(shownOptions.length > 1 || value.length > 0) && <div className="mt-2 flex items-center justify-between gap-2 text-xs">
      {shownOptions.length > 1 && !allShownChosen
        ? <button type="button" onClick={selectAllShown} className="font-semibold text-slate-600 hover:text-slate-900">
          Select all{search && shownOptions.length !== allGroups.flatMap((group) => group.options).length ? ` (${shownOptions.length})` : ""}
        </button>
        : <span className="font-semibold text-slate-400">{allShownChosen ? "All selected" : ""}</span>}
      {value.length > 0 && <button type="button" onClick={() => onChange([])} className="font-medium text-blue-600 hover:text-blue-800">
        Clear{value.length > 1 ? ` (${value.length})` : ""}
      </button>}
    </div>}
    <div className="mt-2 max-h-60 overflow-y-auto rounded-lg border border-slate-300 bg-white p-2">
      {visibleGroups.length ? visibleGroups.map((group) => <section key={group.group} className="mb-3 last:mb-0">
        {group.group && <p className="px-2 py-1 text-xs font-semibold text-slate-500">{group.group}</p>}
        <div className="grid gap-1 sm:grid-cols-2">
          {group.options.map((option) => <label key={`${group.group}-${option}`} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs font-normal text-slate-700 hover:bg-slate-50 sm:text-sm">
            <input type="checkbox" checked={value.includes(option)} onChange={() => toggle(option)} className="accent-blue-600" />{option}
          </label>)}
        </div>
      </section>) : <p className="px-2 py-3 text-sm text-slate-500">{emptyText}</p>}
    </div>
    <p className="mt-2 text-xs text-slate-500">{summary(value.length)}</p>
  </div>;
}
