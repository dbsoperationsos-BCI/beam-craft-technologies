"use client";

import { useEffect, useRef, useState } from "react";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import SwapVertIcon from "@mui/icons-material/SwapVert";
import OptionsMenu from "@/components/ui/OptionsMenu";
import { useEdgeScroll } from "@/components/shared/SortableList";
import { dropIndex, moveInList } from "@/lib/sidebarLayout.mjs";

/**
 * A leading column that lets a person set the order of a `DataTable`'s rows.
 *
 * The same rules `SortableList` reorders by, for rows that live in a table rather than a list: a
 * native HTML5 drag (`moveInList` / `dropIndex` decide where it lands, so the two cannot disagree),
 * a 2px line in the gap the row will drop into, the same scroll while a row is held near the edge
 * of its pane (`useEdgeScroll`), and a Move up / Move down menu for a finger, since a touch fires no
 * HTML5 drag. Unlike `SortableList` the row itself is *not* the handle - these rows are full of
 * inputs and dropdowns, which must stay usable - so only the grip starts a drag. With a mouse the
 * grip is shown, and it also answers ArrowUp / ArrowDown; on a touch screen (`pointer-coarse`) one
 * full-size button opening Move up / Move down takes its place.
 *
 * The table is untouched: the grip's cell makes its own row a place to drop, so every row of the
 * table is a target without `DataTable` knowing a drag exists.
 *
 * `listOf(row)` names the list a row belongs to - `{ key, ids }`, the ids in their current order -
 * so one set of columns can serve several lists (a quotation's shoots each order their own lines),
 * and a row can only be dropped among rows of its own list. `onReorder(key, ids)` receives the new
 * order of that list. `labelOf(row)` names the row for the buttons' accessible names.
 */
export const ROW_REORDER_COLUMN_ID = "__row-reorder";

// The row being carried, and the list it came from. One drag happens at a time, so one holder.
let carried = null;

const LINE = "#2563eb";

/**
 * Draws - or clears - the line in the gap above or below a row. On the cells, since a row draws no
 * shadow; whatever shadow a cell had of its own (a frozen column's divider) is kept and put back.
 */
function markRow(tr, side) {
  for (const cell of tr?.children || []) {
    if (cell.dataset.reorderShadow === undefined) cell.dataset.reorderShadow = cell.style.boxShadow || "";
    const own = cell.dataset.reorderShadow;
    if (!side) {
      cell.style.boxShadow = own;
      delete cell.dataset.reorderShadow;
      continue;
    }
    const line = `inset 0 ${side === "before" ? 2 : -2}px 0 ${LINE}`;
    cell.style.boxShadow = own ? `${line}, ${own}` : line;
  }
}

/** Every row of the table back as it was: not faded, no line. */
function resetRows(body) {
  for (const row of body?.children || []) {
    row.style.opacity = "";
    markRow(row, null);
  }
}

function ReorderHandle({ listKey, id, ids, label, disabled, disabledHint, onReorder }) {
  const ref = useRef(null);
  const edgeScroll = useEdgeScroll();
  // The latest answer for this row, read by listeners attached once; kept current after each render.
  const latest = useRef({ listKey, id, ids, disabled, onReorder });
  useEffect(() => { latest.current = { listKey, id, ids, disabled, onReorder }; });

  // Said to a screen reader after a move by key: the row stays where focus is, so it is told where.
  const [announcement, setAnnouncement] = useState("");
  const move = (toIndex) => {
    const from = ids.indexOf(id);
    const next = moveInList(ids, from, toIndex);
    if (next === ids) return;
    onReorder(listKey, next);
    setAnnouncement(`Moved ${label} to position ${toIndex + 1} of ${ids.length}.`);
  };

  useEffect(() => {
    const row = ref.current?.closest("tr");
    if (!row) return undefined;
    const sideOf = (event) => {
      const rect = row.getBoundingClientRect();
      return event.clientY - rect.top < rect.height / 2 ? "before" : "after";
    };
    // Only a row of the same list answers a drag; anything else dragged over it is left alone.
    const ours = () => carried && carried.listKey === latest.current.listKey && !latest.current.disabled;
    const over = (event) => {
      if (!ours()) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      markRow(row, sideOf(event));
    };
    const leave = (event) => { if (!row.contains(event.relatedTarget)) markRow(row, null); };
    const drop = (event) => {
      /*
       * Put right *before* the order changes, not only on `dragend`: the new order moves the carried
       * row in the page, and a row moved mid-drag may never receive its `dragend` - which left it
       * faded for good.
       */
      resetRows(row.parentElement);
      if (!ours()) return;
      event.preventDefault();
      const current = latest.current;
      const from = current.ids.indexOf(carried.id);
      const target = current.ids.indexOf(current.id);
      carried = null;
      if (from < 0 || target < 0) return;
      const next = moveInList(current.ids, from, dropIndex(from, target, sideOf(event)));
      if (next !== current.ids) current.onReorder(current.listKey, next);
    };
    row.addEventListener("dragover", over);
    row.addEventListener("dragleave", leave);
    row.addEventListener("drop", drop);
    return () => {
      row.removeEventListener("dragover", over);
      row.removeEventListener("dragleave", leave);
      row.removeEventListener("drop", drop);
      markRow(row, null);
    };
  }, []);

  const index = ids.indexOf(id);
  // Pulled into the cell's own padding, so a 40px column holds the 24px grip - or, on a touch screen,
  // the 32px Move button - without clipping either at either table density.
  return <span ref={ref} className="-mx-2 flex items-center justify-center">
    <span role="status" className="sr-only">{announcement}</span>
    <span
      role="button"
      tabIndex={disabled ? -1 : 0}
      draggable={!disabled}
      aria-label={`Move ${label}. Drag, or press the up and down arrow keys.`}
      aria-disabled={disabled || undefined}
      title={disabled ? disabledHint : undefined}
      onDragStart={(event) => {
        carried = { listKey, id };
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", String(id));
        // The row, not just the grip, is what is seen being carried.
        const row = ref.current?.closest("tr");
        if (row) {
          event.dataTransfer.setDragImage(row, 16, row.offsetHeight / 2);
          // Faded only while it is still being carried - a drop can land before the next frame.
          requestAnimationFrame(() => { if (carried?.id === id) row.style.opacity = "0.4"; });
          edgeScroll.begin(row);
        }
      }}
      onDragEnd={() => {
        carried = null;
        edgeScroll.end();
        resetRows(ref.current?.closest("tr")?.parentElement);
      }}
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key === "ArrowUp" && index > 0) { event.preventDefault(); move(index - 1); }
        if (event.key === "ArrowDown" && index < ids.length - 1) { event.preventDefault(); move(index + 1); }
      }}
      className={`inline-flex h-8 w-6 items-center justify-center rounded text-slate-400 outline-none hover:bg-slate-100 hover:text-slate-600 focus-visible:ring-2 focus-visible:ring-blue-500 pointer-coarse:hidden ${disabled ? "cursor-not-allowed opacity-40" : "cursor-grab active:cursor-grabbing"}`}
    >
      <DragIndicatorIcon style={{ fontSize: 18 }} aria-hidden="true" />
    </span>
    {/* A finger's way: one full-size button, the same menu the rest of the app opens. */}
    <span className="hidden pointer-coarse:inline-flex">
      <OptionsMenu
        ariaLabel={`Move ${label}`}
        triggerContent={<SwapVertIcon style={{ fontSize: 20 }} aria-hidden="true" />}
        menuZIndexClassName="z-[160]"
        items={[
          { label: "Move up", disabled: disabled || index <= 0, onSelect: () => move(index - 1) },
          { label: "Move down", disabled: disabled || index < 0 || index >= ids.length - 1, onSelect: () => move(index + 1) },
        ]}
      />
    </span>
  </span>;
}

/** The column definition, for the front of a `DataTable`'s `columns`. */
// `idOf(row, index)` is the key the list's `ids` are in - the row's `id` unless the table keys otherwise.
// `disabledHint` is what a shut grip says on hover, where the reason is not on screen already.
export function rowReorderColumn({ listOf, onReorder, labelOf = () => "row", idOf = (row) => row.id, disabled = false, disabledHint }) {
  return {
    id: ROW_REORDER_COLUMN_ID,
    header: "",
    sortable: false,
    filterable: false,
    fixed: true,
    resizable: false,
    exportable: false,
    /*
     * Both ways a table sizes a column, as its own built-in columns name them: `width` for a table
     * laid out by the browser, `size` for one sized from a saved layout - which otherwise gives a
     * column with no `size` TanStack's default 150px, a wide empty strip in front of every row.
     */
    width: 40,
    minWidth: 40,
    maxWidth: 40,
    size: 40,
    minSize: 40,
    maxSize: 40,
    cell: ({ row }) => {
      const list = listOf(row.original);
      // One line has no order to set: the grip is absent rather than shown shut with no reason.
      if (list.ids.length < 2) return null;
      return <ReorderHandle listKey={list.key} id={idOf(row.original, row.index)} ids={list.ids} label={labelOf(row.original)} disabled={disabled} disabledHint={disabledHint} onReorder={onReorder} />;
    },
  };
}
