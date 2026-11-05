"use client";

import HelpTip from "./HelpTip";
import { useRef, useState } from "react";
import TextField from "./TextField";
import { matchesWordChunks } from "@/lib/wordChunks.mjs";

/**
 * A long list of tick boxes with a search over it, for the choices that are too many to sit in a
 * dropdown and too many to read through — a vendor's skills, the languages someone speaks.
 *
 * The list is either flat, through `options`, or divided under headings, through `groups` of
 * `{ group, options }`. Both hold plain strings and the value is the list of chosen strings.
 *
 * `chips` puts what is chosen **inside the search box**, as chips with their own ×, the way
 * `EmailChipsField` and `MultiSelectField` show theirs - so the answer is read where it is typed,
 * not counted in a line under a list of three hundred. Off by default: the forms that do not ask for
 * it keep the plain search box.
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
  helperText = "",
  chips = false,
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef(null);
  const allGroups = groups || [{ group: "", options: options || [] }];
  const search = query.trim().toLocaleLowerCase();
  const visibleGroups = allGroups
    .map((group) => ({ ...group, options: group.options.filter((option) => matchesWordChunks(option, search)) }))
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
    {chips
      ? <div className="block text-xs font-semibold text-slate-600">
        <span>{label}{required && <span aria-hidden="true" className="ml-0.5 text-rose-500">*</span>}<HelpTip text={helperText} /></span>
        {/* The box `EmailChipsField` draws: chips and the search side by side, clicking anywhere
            in it focusing the search, capped in height and scrolling its own chips rather than
            pushing the list down with every pick. */}
        <div
          onClick={() => inputRef.current?.focus()}
          className={`mt-1.5 flex max-h-[4.5rem] min-h-9 w-full flex-wrap items-center gap-1.5 overflow-y-auto rounded-lg border bg-white px-2 py-1 transition focus-within:ring-2 ${
            error ? "border-rose-400 focus-within:border-rose-500 focus-within:ring-rose-100" : "border-slate-300 focus-within:border-blue-500 focus-within:ring-blue-100"
          }`}
        >
          {value.map((item) => <span key={item} className="inline-flex max-w-full items-center gap-1 rounded-full border border-blue-200 bg-blue-50 py-0.5 pl-2 pr-1 text-xs font-medium text-blue-700">
            <span className="truncate">{item}</span>
            <button
              type="button"
              onClick={(event) => { event.stopPropagation(); toggle(item); inputRef.current?.focus(); }}
              aria-label={`Remove ${item}`}
              className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-sm leading-none text-blue-600 transition hover:text-blue-900"
            >
              ×
            </button>
          </span>)}
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            // An empty search and Backspace takes the last chip off, as the email field does.
            onKeyDown={(event) => { if (event.key === "Backspace" && !query && value.length) onChange(value.slice(0, -1)); }}
            placeholder={value.length ? "" : placeholder}
            aria-label={label}
            className="min-w-[7rem] flex-1 border-0 bg-transparent px-1 py-0.5 text-sm font-normal text-slate-700 outline-none placeholder:text-slate-400"
          />
        </div>
        {error && <p role="alert" className="mt-1 text-xs font-normal text-rose-600">{error}</p>}
      </div>
      : <TextField label={label} required={required} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} error={error} helperText={helperText} />}
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
