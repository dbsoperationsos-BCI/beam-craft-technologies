"use client";

import { useState } from "react";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

function SectionButton({ id, label, activeId, onSelect, mobile = false, nested = false }) {
  const active = activeId === id;
  return <button
    type="button"
    onClick={() => onSelect(id)}
    className={`rounded-md text-left text-sm transition-colors ${mobile ? "shrink-0 px-3 py-1.5" : `w-full py-2 ${nested ? "pl-3 pr-3" : "px-3"}`} ${active ? "bg-blue-50 font-medium text-blue-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}
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
      {childLinks.map(([childId, childLabel, grandChildren]) => (grandChildren?.length
        ? <SectionGroup key={childId} label={childLabel} childLinks={grandChildren} activeId={activeId} onSelect={onSelect} />
        : <SectionButton key={childId} id={childId} label={childLabel} activeId={activeId} onSelect={onSelect} nested />
      ))}
    </div>}
  </div>;
}

/** The screens an entry holds, flattened - what the narrow strip lists in place of the groups. */
function leavesOf(section) {
  return section[2]?.length ? section[2].flatMap(leavesOf) : [section];
}

/**
 * The rail of a schema form. Each entry is `[id, label]`, or `[id, label, children]` for a group
 * whose children are entries of the same shape, nested as deep as the form needs. Most forms are
 * flat and a few are one level deep; Settings is two, so that "Overall" can hold Project and
 * Project can hold its own three screens.
 */
export default function SchemaFormSidebar({ sections, activeId, onSelect, ariaLabel = "Form sections" }) {
  const entry = ([id, label, children], mobile) => (children?.length
    // On a narrow screen the rail is a single scrolling strip, so a group is flattened to the
    // screens inside it, however deep they sit: there is no room for a row that only opens another
    // row, and a row that opened a row that opened a row would be worse.
    ? (mobile
      ? leavesOf([id, label, children]).map(([leafId, leafLabel]) => <SectionButton key={leafId} id={leafId} label={leafLabel} activeId={activeId} onSelect={onSelect} mobile />)
      : <SectionGroup key={id} label={label} childLinks={children} activeId={activeId} onSelect={onSelect} />)
    : <SectionButton key={id} id={id} label={label} activeId={activeId} onSelect={onSelect} mobile={mobile} />);

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
      <nav className="space-y-1" aria-label={ariaLabel}>
        {sections.map((section) => entry(section, false))}
      </nav>
    </aside>
    <nav className="z-30 flex w-full shrink-0 gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2 lg:hidden" aria-label={ariaLabel}>
      {sections.map((section) => entry(section, true))}
    </nav>
  </>;
}
