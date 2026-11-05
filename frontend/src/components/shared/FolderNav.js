"use client";

import { memo, useState } from "react";
import Add from "@mui/icons-material/Add";
import ExpandLess from "@mui/icons-material/ExpandLess";
import ExpandMore from "@mui/icons-material/ExpandMore";
import Folder from "@mui/icons-material/Folder";
import PhotoLibrary from "@mui/icons-material/PhotoLibrary";
import OptionsMenu from "@/components/ui/OptionsMenu";
import Button from "@/components/shared/Button";

/**
 * The left-hand folder panel, as Image Selection draws it: a small FOLDERS label and a
 * full-width New Folder button that stay put, then the folder list scrolling on its own under
 * them. Rows are the Photo Selection folder tree's rows - amber folder, blue-50 when selected,
 * the ⋮ revealed on hover (always there on a touch screen), a chevron only where a folder has
 * children - so a folder list anywhere in the app reads the same. The ⋮ is the app's own
 * `OptionsMenu`, which positions its menu in a portal, so it opens cleanly from the last row of
 * a scrolling list and carries the keyboard and dismissal rules every menu has; its column is
 * always reserved, so a hover changes what is visible and never where the name ends.
 *
 * Purely presentational and data-agnostic. `items` are `{ id, name, count?, system?, children? }`;
 * a `system` item (All Photos) draws a library icon instead of a folder and is never offered
 * actions. `actionsFor(item)` answers the ⋮ entries for one item - `[{ label, tone, onSelect }]` -
 * or nothing, and the ⋮ is then not drawn at all. Expansion is local state and never reaches the
 * caller; opening a menu, expanding a branch or scrolling the list re-renders nothing outside
 * this panel. Image Selection keeps its own FolderTree untouched; this is the same visual
 * language extracted for the modules that come after it.
 */
export const THIN_SCROLLBAR = "[scrollbar-width:thin] [scrollbar-color:#cbd5e1_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300";

const Row = memo(function Row({ item, depth, selectedId, expandedIds, showChevrons, onSelect, onToggle, actionsFor }) {
  const selected = selectedId === item.id;
  const children = item.children || [];
  const hasChildren = children.length > 0;
  const expanded = expandedIds.has(item.id);
  const actions = item.system ? null : actionsFor?.(item);
  const Glyph = item.system ? PhotoLibrary : Folder;
  return <li>
    <div className={`group relative flex min-h-10 items-center rounded-md py-1 text-xs md:min-h-0 ${selected ? "bg-blue-50 font-medium text-blue-700" : "text-slate-700 hover:bg-slate-50"}`} style={{ paddingLeft: `${depth * 14 + 4}px` }}>
      {/* The chevron only ever opens or closes the branch; the name is what selects. */}
      {showChevrons && <button type="button" aria-label={`${expanded ? "Collapse" : "Expand"} ${item.name}`} disabled={!hasChildren} onClick={(event) => { event.stopPropagation(); onToggle(item.id); }} className="inline-flex h-10 w-7 shrink-0 items-center justify-center text-slate-500 disabled:opacity-0 md:h-6 md:w-5">
        {expanded ? <ExpandLess style={{ fontSize: 14 }} aria-hidden="true" /> : <ExpandMore style={{ fontSize: 14 }} aria-hidden="true" />}
      </button>}
      <button type="button" onClick={() => onSelect(item.id)} aria-current={selected ? "true" : undefined} title={item.name} className="flex min-w-0 flex-1 items-center gap-2 py-1 pl-1 pr-1 text-left">
        <Glyph style={{ fontSize: 15 }} aria-hidden="true" className={`shrink-0 ${selected ? "text-blue-600" : item.system ? "text-slate-500" : "text-amber-500"}`} />
        <span className="min-w-0 flex-1 truncate">{item.name}</span>
        {item.count != null && <span className={`shrink-0 tabular-nums ${selected ? "text-blue-700" : "text-slate-500"}`}>{item.count}</span>}
      </button>
      {/* Always laid out, shown on hover or keyboard focus where there is a pointer that hovers
          and always on a touch screen (a tablet in landscape is wider than md and still cannot
          hover), so revealing it never moves the count or the name's ellipsis. */}
      {actions?.length > 0 && <span data-folder-actions className="mr-0.5 flex shrink-0 items-center [@media(hover:hover)]:md:invisible md:group-focus-within:visible md:group-hover:visible md:has-aria-expanded:visible">
        <OptionsMenu ariaLabel={`Folder actions for ${item.name}`} items={actions.map((action) => ({ label: action.label, tone: action.tone, onSelect: () => action.onSelect(item) }))} />
      </span>}
    </div>
    {expanded && hasChildren && <ul>{children.map((child) => <Row key={child.id} item={child} depth={depth + 1} selectedId={selectedId} expandedIds={expandedIds} showChevrons={showChevrons} onSelect={onSelect} onToggle={onToggle} actionsFor={actionsFor} />)}</ul>}
  </li>;
});

const idsWithChildren = (items, out = new Set()) => { for (const item of items || []) { if (item.children?.length) { out.add(item.id); idsWithChildren(item.children, out); } } return out; };

export default function FolderNav({ heading = "Folders", items = [], selectedId, onSelect, onCreate, createLabel = "New Folder", actionsFor, emptyMessage, className = "", listClassName = "" }) {
  // Branches start open, as Photo Selection's do, and the answer is kept here for as long as
  // the panel lives - browsing media never folds a branch the person opened.
  const [expandedIds, setExpandedIds] = useState(() => idsWithChildren(items));
  const showChevrons = items.some((item) => item.children?.length);
  const toggle = (id) => setExpandedIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const systemItems = items.filter((item) => item.system);
  const folderItems = items.filter((item) => !item.system);
  const rowProps = { selectedId, expandedIds, showChevrons, onSelect, onToggle: toggle, actionsFor };

  return <nav aria-label={heading} className={`flex min-h-0 flex-col ${className}`}>
    <div className="shrink-0">
      {/* A label for the panel, not a heading in the page's outline: the gallery's title is the
          heading that follows the event's. */}
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{heading}</p>
      {onCreate && <Button type="button" variant="primary" onClick={onCreate} className="mb-2 w-full gap-1.5 md:min-h-8 md:py-1"><Add style={{ fontSize: 15 }} aria-hidden="true" />{createLabel}</Button>}
    </div>
    <ul className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden ${THIN_SCROLLBAR} ${listClassName}`}>
      {systemItems.map((item) => <Row key={item.id} item={item} depth={0} {...rowProps} />)}
      {systemItems.length > 0 && folderItems.length > 0 && <li aria-hidden="true" className="my-1 border-t border-slate-100" />}
      {folderItems.map((item) => <Row key={item.id} item={item} depth={0} {...rowProps} />)}
      {folderItems.length === 0 && emptyMessage && <li className="px-2 py-3 text-xs text-slate-500">{emptyMessage}</li>}
    </ul>
  </nav>;
}
