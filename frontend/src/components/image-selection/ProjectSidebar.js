"use client";
import Add from "@mui/icons-material/Add";
import ChevronLeft from "@mui/icons-material/ChevronLeft";
import AccountTree from "@mui/icons-material/AccountTree";
import ChevronRight from "@mui/icons-material/ChevronRight";
import FilterList from "@mui/icons-material/FilterList";
import MoreVert from "@mui/icons-material/MoreVert";
import Search from "@mui/icons-material/Search";
import { useEffect, useRef, useState } from "react";
import { PROGRESS_COLORS } from "@/lib/progressStatus.mjs";
import { ATTENTION_BY_KEY } from "@/lib/imageSelectionDashboard.mjs";
import useMenuDismiss from "@/components/shared/useMenuDismiss";

/**
 * A project's name, saying the whole of itself on hover only when the sidebar has actually cut it
 * off. A studio names a gallery after the WhatsApp group it came from — "WED 3t3 Erode TN groom &
 * Bride" — and the sidebar is narrow enough that several of those end in an ellipsis, with the
 * part that tells them apart being the part that went.
 *
 * `title` rather than a tooltip of our own, which is what the mark beside it and the gallery's
 * filenames already use. Conditional because a name that fits needs no explaining, and a tooltip
 * repeating a label already fully on screen is noise on every row.
 *
 * Measured through a `ResizeObserver` rather than once on mount: the observer reports the first
 * size as soon as it starts watching, and reports again when the sidebar is collapsed, reopened
 * or dragged — all of which change whether this name still fits. `name` re-runs it for a rename,
 * which can change the answer without changing the element's own width.
 */
function ProjectName({ name }) {
  const nameRef = useRef(null);
  const [clipped, setClipped] = useState(false);
  useEffect(() => {
    const node = nameRef.current;
    if (!node) return undefined;
    const observer = new ResizeObserver(() => setClipped(node.scrollWidth > node.clientWidth));
    observer.observe(node);
    return () => observer.disconnect();
  }, [name]);
  return <span ref={nameRef} title={clipped ? name : undefined} className="block truncate">{name}</span>;
}

// The dot's color is the project's place on the product-wide progress ladder, served by the
// list API: unpublished bronze, published blue, client selecting amber, everything submitted
// green. A row missing the field (an older cached response) falls back to not-started.
const PROGRESS_TITLES = {
  notStarted: "Gallery not published yet",
  inProgress: "Gallery published — selection not started",
  partiallyCompleted: "Client selection in progress",
  completed: "Every selection item submitted",
};

// The filter offers exactly the four rungs of the progress ladder — nothing else — plus All to
// clear it. Each option wears its own dot so the menu reads like the sidebar it filters.
const PROGRESS_FILTERS = [
  ["notStarted", "Yet to Start"],
  ["inProgress", "In Progress"],
  ["partiallyCompleted", "Partially Completed"],
  ["completed", "Completed"],
];

// Photo Selection's statuses: the progress ladder above, read from each row's own field.
const SELECTION_STATUSES = {
  filters: PROGRESS_FILTERS.map(([value, label]) => [value, label, PROGRESS_COLORS[value]]),
  of: (project) => project.selectionProgress || "notStarted",
  titleOf: (project) => PROGRESS_TITLES[project.selectionProgress] || PROGRESS_TITLES.notStarted,
};

// `canWrite` is passed in rather than read here: this sidebar lists projects for a page that knows
// which permission governs it, and searching and sorting stay whatever the answer is.
// `statuses` is the module's own reading of a project - `{ filters: [[key, label, color]], of,
// titleOf }` - so AI Culling, AI Editing and Signature Album list the same projects with their own
// dot and filter; Photo Selection's progress ladder is the default.
export default function ProjectSidebar({ projects, selectedProjectId, search, loading, error, onSearch, onSelect, onNew, onAction, collapsed, onToggleCollapsed, canWrite = true, progressFilter: controlledFilter, onProgressFilterChange, attentionFilter = null, onClearAttention, onOpenExpand, statuses = SELECTION_STATUSES }) {
  const [openMenu, setOpenMenu] = useState(null);
  // The filter menu's Sort: closed each time the menu opens, its four rungs one press away.
  const [sortOpen, setSortOpen] = useState(false);
  // Filtering by progress happens here, on the rows already listed: every row carries its
  // selectionProgress, so the filter needs no extra request and clears with one click on All.
  // The page may hold the filter instead - a dashboard card opens the list already filtered -
  // and left alone the sidebar keeps it itself, as it always did.
  const [ownFilter, setOwnFilter] = useState("all");
  const progressFilter = controlledFilter ?? ownFilter;
  const setProgressFilter = (value) => { setOwnFilter(value); onProgressFilterChange?.(value); };
  // One menu is open at a time, so one pair of refs — the open panel and its trigger — is enough.
  // Dismissal is scoped to those, not the whole sidebar: clicking a project row, the search box,
  // or anywhere else on the screen closes whatever menu is open.
  const menuRef = useRef(null); const triggerRef = useRef(null);
  useMenuDismiss([menuRef, triggerRef], () => setOpenMenu(null), openMenu !== null);
  const action = (name, project) => { setOpenMenu(null); onAction(name, project); };
  const visibleProjects = progressFilter === "all" ? projects : projects.filter((project) => statuses.of(project) === progressFilter);
  const colorOf = (project) => statuses.filters.find(([value]) => value === statuses.of(project))?.[2] || PROGRESS_COLORS.notStarted;
  /*
   * Closed, the rail carries two things, and only one of them is a control.
   *
   * The tree sits *inside* the rail at the top, where a heading would be, and does nothing: it is
   * a label for a column too narrow to hold a word, saying what comes back when the panel does. It
   * is drawn in the muted grey the application gives text that is not to be acted on, and it is
   * not in the tab order - a second button that opens the same panel would only be the handle said
   * twice, and a mark nobody can press is not a control that failed.
   *
   * The chevron is the control, straddling the edge exactly where every other collapsed panel in
   * this application puts its handle. Open, neither is needed: the panel names itself.
   */
  if (collapsed) return <aside className="relative flex min-h-0 flex-col items-center border-b border-slate-200 bg-white pt-3 md:border-b-0 md:border-r">
    <AccountTree aria-hidden="true" style={{ fontSize: 18 }} className="text-slate-300" />
    <button type="button" onClick={onToggleCollapsed} aria-label="Open project sidebar" className="absolute -right-3 top-1/2 z-30 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm transition duration-200 hover:scale-110 hover:bg-slate-100 active:scale-95"><ChevronRight style={{ fontSize: 16 }} /></button>
  </aside>;
  // Open, the close handle shows itself only while the pointer is over the sidebar (the handle is
  // a child, so its own hover counts) or it has keyboard focus - the same manners as the info
  // panel's collapse handle, so at rest the disc is not straddling a quiet edge. Below `md` the
  // sidebar is a strip across the top of a touch screen, which has no hover to summon it with, so
  // there it stays on show. Shut, the handle above is always visible: it is the one way back in.
  return <aside className="group relative flex min-h-0 flex-col border-b border-slate-200 bg-white md:border-b-0 md:border-r"><button type="button" onClick={onToggleCollapsed} aria-label="Close project sidebar" className="absolute -right-3 top-1/2 z-30 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm transition duration-200 hover:scale-110 hover:bg-slate-100 focus-visible:opacity-100 active:scale-95 md:opacity-0 md:group-hover:opacity-100"><ChevronLeft style={{ fontSize: 16 }} /></button><div className="border-b border-slate-100 p-3"><div className="flex gap-2"><label className="relative min-w-0 flex-1"><span className="sr-only">Search projects</span><Search style={{ fontSize: 14 }} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => onSearch(event.target.value)} type="search" placeholder="Search projects..." className="h-8 w-full rounded-md border border-slate-300 bg-white pl-8 pr-2 text-xs" /></label>{/* No sort menu any more — the status filter is the sidebar's one control beside search, and
        the list keeps the page's default order. */}
    <div className="relative"><button type="button" ref={openMenu === "filter" ? triggerRef : null} onClick={() => { setOpenMenu(openMenu === "filter" ? null : "filter"); setSortOpen(false); }} aria-label="Filter projects by status" aria-haspopup="menu" aria-expanded={openMenu === "filter"} className={`inline-flex h-8 w-8 items-center justify-center rounded-md border ${progressFilter !== "all" ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}><FilterList fontSize="small" /></button>{openMenu === "filter" && <div ref={menuRef} className="absolute right-0 z-40 mt-1 w-52 rounded-md border border-slate-200 bg-white p-1 shadow-lg">{/* Expand first, above a rule: it is not a filter on this list but the reader's own
        dashboard, opened over this page (`onOpenExpand`), so choosing it leaves the status filter,
        the search and the open project exactly as they were. */}
    {onOpenExpand && <><button type="button" onClick={() => { setOpenMenu(null); onOpenExpand(); }} aria-haspopup="dialog" className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50"><span className="flex-1">Expand</span></button><div role="separator" className="my-1 border-t border-slate-200" /></>}{/* Sort: the four rungs - Yet to Start, In Progress, Partially Completed, Completed - under one
        entry, opened in place; the rung chosen is named beside it while the menu is closed to it. */}
    <button type="button" onClick={() => setSortOpen((open) => !open)} aria-expanded={sortOpen} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50"><span className="flex-1">Sort</span>{progressFilter !== "all" && !sortOpen && <span className="max-w-24 truncate text-[10px] font-normal text-blue-700">{statuses.filters.find(([value]) => value === progressFilter)?.[1]}</span>}<span aria-hidden="true" className={`inline-flex text-slate-400 transition-transform ${sortOpen ? "rotate-90" : ""}`}><ChevronRight style={{ fontSize: 14 }} /></span></button>
    {sortOpen && <div role="group" aria-label="Sort projects by status" className="ml-3 border-l border-slate-200 pl-1"><button type="button" onClick={() => { setProgressFilter("all"); setOpenMenu(null); }} className={`block w-full rounded-md px-3 py-2 text-left text-xs ${progressFilter === "all" ? "bg-blue-50 font-medium text-blue-700" : ""}`}>All</button>{statuses.filters.map(([value, label, color]) => <button key={value} type="button" onClick={() => { setProgressFilter(value); setOpenMenu(null); }} className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs ${progressFilter === value ? "bg-blue-50 font-medium text-blue-700" : ""}`}><span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />{label}</button>)}</div>}</div>}</div></div>{canWrite && <button type="button" onClick={onNew} className="mt-2 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-blue-600 px-3 text-xs font-semibold text-white"><Add style={{ fontSize: 15 }} />New Project</button>}{/* A dashboard card or Needs Attention row narrows this list; the chip says which, and × lets it go. */}
    {attentionFilter && <div className="mt-2 flex items-center gap-1 rounded-md border border-blue-300 bg-blue-50 px-2 py-1 text-[11px] text-blue-700"><span className="min-w-0 flex-1 truncate">Showing: {ATTENTION_BY_KEY[attentionFilter]?.label || attentionFilter}</span><button type="button" onClick={onClearAttention} aria-label="Clear the needs-attention filter" className="shrink-0 rounded px-1 leading-none hover:bg-blue-100">×</button></div>}</div><div className="min-h-0 flex-1 overflow-y-auto p-2">{loading && <p className="py-8 text-center text-xs text-slate-500">Loading projects...</p>}{error && <p role="alert" className="m-1 rounded-md bg-red-50 px-2 py-2 text-xs text-red-700">{error}</p>}{!loading && !error && visibleProjects.length === 0 && <p className="px-2 py-8 text-center text-xs text-slate-500">{projects.length === 0 ? (attentionFilter ? "No projects on this list right now." : "No projects found.") : "No projects match this status."}</p>}{visibleProjects.map((project) => <div key={project.id} className="group relative mb-1 flex items-center gap-1"><button type="button" onClick={() => onSelect(project)} className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-left text-xs ${selectedProjectId === project.id ? "bg-blue-50 font-medium text-blue-700" : "text-slate-700 hover:bg-slate-50"}`}>{/* The one mark that says where a project came from: ◆ typed by hand, ● assigned through the
        allocation workflow — different shapes, not just different colors. `salesProjectId` is the
        existing source of truth for that split. */}
    <span title={`${project.salesProjectId ? "Assigned through allocation" : "Created directly"} · ${statuses.titleOf(project)}`} className="shrink-0 text-[12px] leading-none" style={{ color: colorOf(project) }}>{project.salesProjectId ? "●" : "◆"}</span><span className="min-w-0 flex-1 truncate"><ProjectName name={project.projectName} />{/* The identifier the studio calls this gallery by - DBS-VCIS-000001 - under the name
        rather than beside it, so a long client name still gets the whole line. Absent on the
        handful of projects created before galleries were given one. */}
      {project.projectCode && <span className="block truncate text-[10px] font-normal text-slate-400">{project.projectCode}</span>}{/* Disabled from Expand: still listed and searchable, marked so,
        and opened read-only for anything that would reach the client. */}
      {project.disabledAt && <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-slate-100 px-1.5 py-px text-[10px] font-medium text-slate-500"><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-slate-400" />Disabled</span>}</span></button>{/* A project created from a saved group name is named and deleted from Sales Manager, so its
        row offers no actions at all; only a manual (or duplicated) project can be renamed or
        deleted here. */}
    {/* The ⋮ appears on hover (or keyboard focus) and stays while its menu is open — the
        desktop sidebar's exact behavior, so the rows read clean until pointed at. */}
    {canWrite && !project.salesProjectId && <><button type="button" ref={openMenu === project.id ? triggerRef : null} onClick={() => setOpenMenu(openMenu === project.id ? null : project.id)} aria-label={`Project actions for ${project.projectName}`} className={`h-7 w-7 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-100 ${openMenu === project.id ? "inline-flex" : "hidden group-focus-within:inline-flex group-hover:inline-flex"}`}><MoreVert style={{ fontSize: 15 }} /></button>{openMenu === project.id && <div ref={menuRef} className="absolute right-0 top-7 z-40 w-36 rounded-md border border-slate-200 bg-white py-1 shadow-lg"><button type="button" onClick={() => action("edit", project)} className="block w-full px-3 py-2 text-left text-xs hover:bg-slate-50">Edit</button><button type="button" onClick={() => action("delete", project)} className="block w-full px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50">Delete</button></div>}</>}</div>)}</div></aside>;
}
