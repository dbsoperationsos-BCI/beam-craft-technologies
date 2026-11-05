"use client";

import { useState } from "react";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import SearchField from "@/components/shared/SearchField";

/**
 * One rail entry. `disabled` - `true`, or the reason as text - is a section that is not open yet: it
 * stays listed, so the reader sees what is coming, but greyed and doing nothing when pressed - the
 * label alone, with nothing added to it on screen, by the studio's choice.
 *
 * `aria-disabled` rather than the native attribute, so it can still be reached with the keyboard and
 * is announced with its reason; the reason is the tooltip as well.
 */
function SectionButton({ id, label, activeId, onSelect, mobile = false, nested = false, disabled = false }) {
  const active = !disabled && activeId === id;
  const reason = typeof disabled === "string" ? disabled : "";
  return <button
    type="button"
    onClick={disabled ? undefined : () => onSelect(id)}
    aria-disabled={disabled ? true : undefined}
    title={reason || undefined}
    aria-label={reason ? `${label}. ${reason}` : undefined}
    className={`rounded-md text-left text-sm transition-colors ${mobile ? "shrink-0 px-3 py-1.5" : `w-full py-2 ${nested ? "pl-3 pr-3" : "px-3"}`} ${disabled ? "cursor-not-allowed text-slate-400" : active ? "bg-blue-50 font-medium text-blue-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}
  >
    {label}
  </button>;
}

/** Every screen id inside an entry, however deep - what a group asks to know where the reader is. */
function idsWithin([id, , children]) {
  return children?.length ? children.flatMap(idsWithin) : [id];
}

/**
 * A group: an entry that owns sub-entries rather than a screen of its own, so pressing it opens the
 * list under it instead of moving the reader.
 *
 * A sub-entry may be a group in its turn - Settings has one, "Overall", whose Project entry owns
 * three screens of its own. Which is why `holdsActive` looks all the way down rather than only at
 * its own children: opening Services from outside the rail has to open both the group holding it
 * and the group holding that, or the reader is shown a rail with no sign of where they are.
 *
 * Pressing it always works, including while one of its own children is the screen on show. Deriving
 * `open` as "the reader asked for it *or* it holds the active child" made it impossible to shut: the
 * held child kept it open however many times it was pressed. So the press owns the state, and a
 * child arrived at from outside the rail opens the group holding it.
 */
function SectionGroup({ label, childLinks, activeId, onSelect }) {
  const holdsActive = childLinks.some((child) => idsWithin(child).includes(activeId));
  const [open, setOpen] = useState(holdsActive);
  // A child can become the active screen without the rail being touched - returning from Google
  // consent lands on one - and the group holding it has to open to show where the reader now is.
  // Adjusted while rendering rather than in an effect, the same way the panel clears a dismissed
  // error, so it costs no second render and trips no rule about setting state from an effect.
  const [heldActive, setHeldActive] = useState(holdsActive);
  if (holdsActive !== heldActive) {
    setHeldActive(holdsActive);
    if (holdsActive) setOpen(true);
  }

  return <div className="space-y-1">
    <button
      type="button"
      onClick={() => setOpen((current) => !current)}
      aria-expanded={open}
      className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
    >
      <span className="min-w-0 truncate">{label}</span>
      <ExpandMoreIcon aria-hidden="true" fontSize="small" className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
    </button>
    {/* The indent and the rule are the wrapper's, so a group nested in here is stepped in again by
        its own copy of this - the depth reads off the page rather than out of a prop. */}
    {open && <div className="ml-3 space-y-1 border-l border-slate-200 pl-1">
      {childLinks.map(([childId, childLabel, grandChildren, childDisabled]) => (grandChildren?.length
        ? <SectionGroup key={childId} label={childLabel} childLinks={grandChildren} activeId={activeId} onSelect={onSelect} />
        : <SectionButton key={childId} id={childId} label={childLabel} activeId={activeId} onSelect={onSelect} nested disabled={childDisabled} />
      ))}
    </div>}
  </div>;
}

/** The screens an entry holds, flattened - what the narrow strip lists in place of the groups. */
function leavesOf(section) {
  return section[2]?.length ? section[2].flatMap(leavesOf) : [section];
}

/**
 * What a search leaves of the rail: each result as one row - the setting or screen, with where it sits
 * under it - or "No settings found". `results` are `{ key, title, path, field }`.
 */
function SearchResults({ search, mobile = false }) {
  if (!search.results.length) return <p role="status" className={mobile ? "shrink-0 px-3 py-1.5 text-sm text-slate-500" : "px-3 py-2 text-sm text-slate-500"}>{search.emptyMessage || "Nothing found"}</p>;
  return search.results.map((result) => <button
    key={result.key}
    type="button"
    onClick={() => search.onResultSelect(result)}
    className={`rounded-md text-left text-sm text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 ${mobile ? "shrink-0 px-3 py-1.5" : "block w-full px-3 py-2"}`}
  >
    <span className="block truncate font-medium">{result.field || result.title}</span>
    {!mobile && <span className="block truncate text-xs text-slate-500">{[result.path, result.field ? result.title : ""].filter(Boolean).join(" › ") || "Settings"}</span>}
  </button>);
}

/**
 * The rail of a schema form. Each entry is `[id, label]`, or `[id, label, children]` for a group
 * whose children are entries of the same shape, nested as deep as the form needs. Most forms are
 * flat and a few are one level deep; Settings is two, so that "Overall" can hold Project and
 * Project can hold its own three screens.
 *
 * `search`, optional - `{ query, onQueryChange, results, onResultSelect, placeholder, ariaLabel,
 * emptyMessage }` - puts a search box at the top of the rail (Role Management's `SearchField`). While
 * something is typed the rail lists the caller's results in place of its sections; cleared, the
 * sections come back as they were, groups opened and closed as they were left. A rail without it is
 * unchanged.
 */
export default function SchemaFormSidebar({ sections, activeId, onSelect, ariaLabel = "Form sections", phoneNav = true, search = null }) {
  const searching = Boolean(search && String(search.query || "").trim());
  const searchBox = search && <SearchField value={search.query} onChange={search.onQueryChange} ariaLabel={search.ariaLabel || "Search"} placeholder={search.placeholder || "Search..."} preventSubmit />;
  const entry = ([id, label, children, disabled], mobile) => (children?.length
    // On a narrow screen the rail is a single scrolling strip, so a group is flattened to the
    // screens inside it, however deep they sit: there is no room for a row that only opens another
    // row, and a row that opened a row that opened a row would be worse.
    ? (mobile
      ? leavesOf([id, label, children]).map(([leafId, leafLabel, , leafDisabled]) => <SectionButton key={leafId} id={leafId} label={leafLabel} activeId={activeId} onSelect={onSelect} mobile disabled={leafDisabled} />)
      : <SectionGroup key={id} label={label} childLinks={children} activeId={activeId} onSelect={onSelect} />)
    : <SectionButton key={id} id={id} label={label} activeId={activeId} onSelect={onSelect} mobile={mobile} disabled={disabled} />);

  return <>
    {/*
     * The rail scrolls inside itself, which is what makes a long one usable at all.
     *
     * It is a flex child of a row that is exactly the panel's height and carries `overflow-hidden`,
     * so it is handed a fixed height whatever it holds. Without a scroll container of its own,
     * everything past that height was simply clipped: Settings grew past a laptop's viewport and
     * Login Slide and Application Monitoring could not be reached from the rail at all — not
     * scrolled past, *absent*, with nothing on screen to say a rail entry had been cut off. The
     * page behind it cannot scroll to them either; the app shell never scrolls as a page.
     *
     * `overflow-y-auto` so a rail that fits still shows no scrollbar, and `overscroll-contain` so
     * reaching the end of the list does not start scrolling whatever is behind the panel — the same
     * pair the form's own `<main>` beside it uses.
     *
     * The nav inside it dropped a `sticky top-0` that had never done anything: the aside did not
     * scroll, so there was nothing for it to stick against, and now that the aside does scroll the
     * nav fills it exactly and still has nowhere to move. A rule that cannot fire reads as a
     * decision somebody made, so it goes rather than staying as one more thing to work out.
     */}
    <aside className="relative z-10 hidden w-60 shrink-0 overflow-y-auto overscroll-contain border-r border-slate-200 bg-slate-50 p-3 lg:block">
      {searchBox && <div className="mb-2">{searchBox}</div>}
      {/* Kept mounted under a search, only hidden, so every group stays opened or closed as it was left. */}
      {searching && <div className="space-y-1" role="region" aria-label={`${ariaLabel} search results`}><SearchResults search={search} /></div>}
      <nav className={`space-y-1 ${searching ? "hidden" : ""}`} aria-label={ariaLabel}>
        {sections.map((section) => entry(section, false))}
      </nav>
    </aside>
    {phoneNav && searchBox && <div className="shrink-0 border-b border-slate-200 bg-white px-3 pt-2 lg:hidden">{searchBox}</div>}
    {phoneNav && <nav className="z-30 flex w-full shrink-0 gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2 lg:hidden" aria-label={ariaLabel}>
      {searching ? <SearchResults search={search} mobile /> : sections.map((section) => entry(section, true))}
    </nav>}
  </>;
}
