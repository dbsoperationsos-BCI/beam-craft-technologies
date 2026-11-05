"use client";

import { flexRender, getCoreRowModel, getExpandedRowModel, getFilteredRowModel, getSortedRowModel, useReactTable } from "@tanstack/react-table";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import DataTableMoreMenu from "./DataTableMoreMenu";
import ImportDialog from "./ImportDialog";
import ManageColumnsDialog from "./ManageColumnsDialog";
import { useSelectionActions } from "./TableSelectionActions";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import TextAreaField from "@/components/shared/TextAreaField";
import useFormErrors from "@/components/shared/useFormErrors";
import ChevronIcon from "@/components/ui/ChevronIcon";
import Loader from "@/components/shared/Loader";
import useCompactView from "@/components/shared/useCompactView";
import { usePreference } from "@/components/preferences/PreferencesProvider";
import { createExportFileName, exportToCsv } from "@/lib/tableExport";
import { createDoubleTap } from "@/lib/doubleTap.mjs";
import { edgeScrollSpeed } from "@/lib/dragEdgeScroll.mjs";
import { CELL_CLIP, EXPAND_COLUMN_ID, FILTER_CLIP, HEADER_CLIP, SELECT_COLUMN_ID, effectiveFreezeCount as resolveFreezeCount, reorderColumnOrder, slugify, tableLayoutKey, weaveColumnOrder } from "./tableLayout";
import { selectionHeaderState, toggleAllIds, toggleId } from "./tableSelection";
import Checkbox from "@/components/shared/Checkbox";
import HelpTip from "@/components/shared/HelpTip";
import { importTableRows } from "@/services/api/tableImport.service";
import FilterMultiSelect from "@/components/shared/FilterMultiSelect";
import FilterCombobox from "@/components/shared/FilterCombobox";
import FilterDateInput from "@/components/shared/FilterDateInput";
import FilterTimeInput from "@/components/shared/FilterTimeInput";
import { distinctFilterValues, knownFilterValues, knownListFor } from "./tableCells";
import useKnownFilterLists from "./useKnownFilterLists";
import { matchesWordChunks } from "@/lib/wordChunks.mjs";

const DEFAULT_PAGE_SIZE = 50;

/*
 * The chevron column, for a table whose rows carry rows of their own.
 *
 * It is a real leaf column rather than something drawn inside the first cell, so the header, the
 * filter row and every frozen-column offset count it like any other column and stay in line. Fixed
 * in Manage Columns: hiding the only way to open a row would leave what is under it unreachable.
 *
 * A row with nothing beneath it renders an empty cell rather than a dead chevron - the control is
 * there to say "there is more here", so drawing it where there is not would be a lie.
 */
function expandColumn(expandLabel) {
  return {
    id: EXPAND_COLUMN_ID,
    header: "",
    label: "Expand",
    sortable: false,
    filterable: false,
    resizable: false,
    fixed: true,
    size: 34,
    width: 34,
    minWidth: 34,
    maxWidth: 34,
    exportable: false,
    cell: ({ row }) => row.getCanExpand() ? <button
      type="button"
      // The row underneath answers to a click as well, so opening a row must not also select it.
      onClick={(event) => { event.stopPropagation(); row.getToggleExpandedHandler()(); }}
      onDoubleClick={(event) => event.stopPropagation()}
      aria-expanded={row.getIsExpanded()}
      aria-label={`${row.getIsExpanded() ? "Hide" : "Show"} ${expandLabel}`}
      /*
       * Stepped in by depth, within the 34px the column actually has.
       *
       * The column used to take the same horizontal padding as a cell of text - 12px a side - which
       * left 10px for a 24px button. A top-level chevron overflowed that by a little and looked
       * centred; a nested one, indented as well, was cut off six pixels into the glyph. The column
       * takes no padding now, so the whole width is the control's: 4px in at the top level, so it is
       * not flush against the table's edge, and 10px nested - the same place a nested rule sits, so
       * a brand's chevron and a pricing line's rule read at the same depth.
       */
      className={`flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 ${row.depth > 0 ? "ml-2.5" : "ml-1"}`}
    >
      {/* Down to open, up to close - the pair every other disclosure in the application uses, and
          the one that reads as "there is more below" rather than as a direction to travel in. */}
      <ChevronIcon direction={row.getIsExpanded() ? "up" : "down"} size={16} />
    </button> : null,
  };
}

/*
 * The tick-box column, for a table whose rows can be acted on as a set.
 *
 * A real leaf column in front of everything else, for the reason the chevron beside it is one: the
 * header, the filter row and every frozen-column offset count it like any other column and stay in
 * line. Fixed in Manage Columns and never dragged - hiding the boxes would leave a selection nobody
 * could see or clear - and never exported, because a tick is not a value of the row.
 *
 * **Every press is stopped at the cell.** The row underneath answers to a click by opening the
 * record beside the table and to a double-click by opening it in full, so ticking a box would do
 * both as well - and a reader ticking their way down a stage would have a panel open on whichever
 * row they touched last. The double-click is stopped separately from the click: they are two events,
 * and stopping one does not stop the other.
 */
/*
 * How a table decides what is ticked, and what ticking does.
 *
 * The default is the plain set of ids every client-side table uses: it holds every row, so "every
 * row shown" and "every row there is" are the same thing.
 *
 * A **paged** table cannot say that. It has only rendered what was scrolled into view, so a header
 * box that ticked the rows on screen would quietly mean "the first hundred" - which is what the
 * Interview register did. Such a table passes its own `model`, and then the set of ids is not the
 * selection at all: the selection is "everything the tab matches, less these exceptions", and only
 * the page holding it can say so.
 */
const setSelectionModel = ({ selectedIds, onSelectionChange }) => ({
  isSelected: (id) => Boolean(selectedIds?.has(id)),
  headerState: (ids) => selectionHeaderState(selectedIds, ids),
  toggleAll: (ids) => onSelectionChange(toggleAllIds(selectedIds, ids)),
  toggleRow: (id) => onSelectionChange(toggleId(selectedIds, id)),
  // No `count`: the table counts the drawn rows that are ticked, which for a table holding all of
  // them is the whole answer. A paged model supplies its own.
  clear: () => onSelectionChange(new Set()),
});

/*
 * `subRows`: the rows under a row are records of this register too - Accounts Manager's cash entries
 * under their project - so each gets its own box, the row above them a box that ticks or clears all of
 * them (showing part-ticked when some are), and "select all" takes them in. Off by default: on most
 * expandable tables a sub-row is part of the row above it (a project's shoot), not a record of its own.
 */
function selectColumn({ model, rowId, rowLabel, canSelectRow, width = 40, headerLabel, subRows = false }) {
  const selectableIds = (rows) => rows.filter((row) => !canSelectRow || canSelectRow(row.original)).map((row) => rowId(row));
  return {
    id: SELECT_COLUMN_ID,
    header: ({ table }) => {
      /*
       * Every row the table is currently *showing*, which is what "select all" means here: the tab,
       * the column filters and the sort the reader has applied. Read off the filtered row model at
       * render rather than off the data the page passed, because the page does not know which rows
       * survived this table's own filter row.
       *
       * Depth 0 only. A sub-row belongs to the row above it and is not a record of this register, so
       * a selection of ten rows must not answer forty because some of them opened.
       */
      const topRows = table.getRowModel().rows.filter((row) => row.depth === 0);
      const ids = subRows
        ? [...new Set(topRows.flatMap((row) => [...selectableIds([row]), ...selectableIds(row.subRows || [])]))]
        : selectableIds(topRows);
      const { checked, indeterminate } = model.headerState(ids);
      // A paged table can say what "all" means - "Select all 5,769 leads in Dum Dum" - where a
      // table holding every row can only say "every row shown". The page passes the words.
      const label = headerLabel ? headerLabel(checked) : checked ? "Clear the selection" : "Select every row shown";
      return <span className="flex items-center" onClick={(event) => event.stopPropagation()}>
        <Checkbox
          ariaLabel={label}
          title={headerLabel ? label : undefined}
          checked={checked}
          indeterminate={indeterminate}
          onChange={() => model.toggleAll(ids)}
        />
      </span>;
    },
    label: "Select",
    sortable: false,
    filterable: false,
    enableColumnFilter: false,
    resizable: false,
    fixed: true,
    // 40px unless the table says otherwise: the CRM board has always drawn its boxes in 48.
    size: width,
    width,
    minWidth: width,
    maxWidth: width,
    exportable: false,
    cell: ({ row }) => {
      /*
       * No box at all on a row this table cannot act on, rather than one that ticks and is then
       * refused. The Employee Repository is the case it was written for: its tabs list onboarding
       * invites beside employees, and an invite is not a row of the employee register - ticking one
       * would send an id the bulk route can only reject.
       */
      if (canSelectRow && !canSelectRow(row.original)) {
        // A row standing for the records under it: its box ticks or clears all of them.
        const childIds = subRows ? selectableIds(row.subRows || []) : [];
        if (!childIds.length) return null;
        const { checked, indeterminate } = model.headerState(childIds);
        return <span className="flex items-center" onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
          <Checkbox
            ariaLabel={`${checked ? "Clear" : "Select"} the ${childIds.length} under ${rowLabel?.(row.original) || "this row"}`}
            checked={checked}
            indeterminate={indeterminate}
            onChange={() => model.toggleAll(childIds)}
          />
        </span>;
      }
      const id = rowId(row);
      return <span className="flex items-center" onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
        <Checkbox
          ariaLabel={`Select ${rowLabel?.(row.original) || "this row"}`}
          checked={model.isSelected(id)}
          onChange={() => model.toggleRow(id)}
        />
      </span>;
    },
  };
}

// Every table carries the Table Options menu in its Actions header. A table that declares no
// Actions column of its own gets this structural one so the menu still has a home: fixed, never
// exported, drawing nothing in its cells, and as narrow as the menu button needs.
// A stable empty array, so a table with no selection does not hand a new one to a memo each render.
const EMPTY_ROWS = [];

const MENU_COLUMN = { id: "actions", header: "", label: "Actions", fixed: true, sortable: false, filterable: false, resizable: false, exportable: false, width: 48, minWidth: 48, size: 48, cell: () => null };

function columnId(definition) {
  return definition.id || definition.accessorKey;
}

/**
 * The columns that hold values, under any headings that group them. A table may lay its columns
 * out under group headings - `{ id, header, columns: [...] }`, a band over the columns it names, as
 * on Payroll's sheet - and everything that asks about *columns* (what is configured, what can be
 * hidden, what is visible) asks about these, never about the headings.
 */
function leafDefinitions(columns) {
  return columns.flatMap((column) => (Array.isArray(column.columns) ? leafDefinitions(column.columns) : [column]));
}

/** The control a column asked for under its heading, if it asked: `date`, `time` or `combobox`. */
function filterKindFor(definition) {
  return definition.filter || definition.meta?.filter || "";
}

function columnLabel(definition) {
  return String(definition.label || definition.header || columnId(definition));
}

// One object, so the `usePreference` fallback is stable across renders rather than a fresh `{}`
// each time - which would make every memo below it recompute on every render.
const EMPTY_LAYOUT = {};

/*
 * How narrow a column may be pulled - a column dragged to nothing is a column nobody can find again.
 */
const MIN_RESIZE_PX = 60;

/*
 * TanStack hands a state setter either the next value or a function to derive it, and this table
 * has to store what was chosen rather than pass it along - so the function has to be resolved here.
 * Reading `next` as if it were always a value stored a function, and the table came back from the
 * next reload with no columns at all.
 */
const resolveUpdater = (next, current) => (typeof next === "function" ? next(current) : next);

function humanizeFieldName(field) {
  // A person's name sent beside a user id reads as the person: `createdByName` is "Created By".
  const shown = /ByName$/.test(field) ? String(field).replace(/Name$/, "") : field;
  return String(shown).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()).replace(/\bId\b/g, "ID");
}

/*
 * A field holding a user id - `createdBy`, `updatedByUserId`, `decidedById` - is never offered as a
 * column: a number is nobody. The server sends the person's name beside it (`createdByName`, from the
 * user's linked employee - `services/userNames`), and that is the column.
 */
const USER_ID_FIELD = /(?:By|ByUserId|ById)$/;
const isUserIdField = (field, rows) => USER_ID_FIELD.test(field) && rows.every((row) => row?.[field] === null || row?.[field] === undefined || typeof row[field] === "number");

function displayBackendValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map(displayBackendValue).join(", ");
  if (typeof value === "object") return String(value.name || value.label || value.title || value.employeeName || value.vendorName || value.assetName || JSON.stringify(value));
  return String(value);
}

/**
 * The filter a column runs, for both shapes a filter value now takes.
 *
 * A header's filter used to be a box somebody typed into, so every column that declared nothing fell
 * to TanStack's own guess - `includesString` for a column of text. The header picks from a list now
 * where the column's values are a set (`distinctFilterValues`), and a picker hands back an **array**.
 * `includesString` stringifies that, so ticking two options searched for the literal `"a,b"` and
 * matched nothing: the column simply stopped filtering, in every table that had not written a
 * filter of its own - User Management, Role Management, Employee Attendance among them.
 *
 * One value behaves exactly as it always did: contained, ignoring case. A list matches a row whose
 * value is any of the ticked ones - equal first, since that is what picking from a list means, and
 * contained as a fallback so a column whose options are drawn from a formatted value still matches.
 * An empty list is not a filter and keeps every row. Typed text is a word-chunk search
 * (`matchesWordChunks`): a row is kept when every chunk typed is found in it, each anywhere - inside
 * a word too - in any order: "we ot" keeps "WED other", not "WED second". One chunk is as it always was.
 */
function defaultFilterFn(row, columnId, filterValue) {
  const text = String(row.getValue(columnId) ?? "").trim().toLowerCase();
  if (Array.isArray(filterValue)) {
    if (!filterValue.length) return true;
    return filterValue.some((value) => {
      const wanted = String(value ?? "").trim().toLowerCase();
      return wanted === text || (Boolean(wanted) && text.includes(wanted));
    });
  }
  return matchesWordChunks(text, filterValue);
}

/*
 * Filtering a table of projects with their shoots under them, where either can be what is being
 * looked for. A shoot is kept when **it** matches or when its project does: searching a project
 * brings the whole project, shoots and all, and searching a shoot id brings that shoot alone. The
 * table filters from the leaves up (`filterFromLeafRows`), so a project kept only by a shoot of its
 * own stays listed and the rest of its shoots do not.
 *
 * The parent is read from the **core** rows, never `row.getParentRow()`: that reads the model being
 * built and hangs the table.
 */
const keepingSubRows = (filterFn, tableRef) => {
  const wrapped = (row, columnId, filterValue, addMeta) => {
    if (filterFn(row, columnId, filterValue, addMeta)) return true;
    const parent = row.depth > 0 && row.parentId ? tableRef.current?.getCoreRowModel().rowsById[row.parentId] : null;
    return Boolean(parent) && filterFn(parent, columnId, filterValue, addMeta);
  };
  if (filterFn.autoRemove) wrapped.autoRemove = filterFn.autoRemove;
  if (filterFn.resolveFilterValue) wrapped.resolveFilterValue = filterFn.resolveFilterValue;
  return wrapped;
};

function normalizeColumns(columns, renderActions, tableRef = null) {
  return columns.map((column) => {
    const id = columnId(column);
    // A group heading: its columns normalised in turn, and the heading itself a label - nothing to
    // sort, filter, resize, drag or hide on its own (`fixed`).
    if (Array.isArray(column.columns)) {
      return {
        ...column,
        id,
        header: column.header ?? column.label ?? id,
        columns: normalizeColumns(column.columns, renderActions, tableRef),
        enableSorting: false,
        enableColumnFilter: false,
        enableResizing: false,
        meta: { ...column.meta, group: true, fixed: true },
      };
    }
    const accessorFn = column.accessorFn
      || column.value
      || (column.accessorKey ? (row) => row?.[column.accessorKey] : undefined);
    const cell = column.cell || (column.render ? ({ row }) => column.render(row.original) : undefined);
    /*
     * A column that wrote its own filter keeps it - those are deliberate, and the ones that exist
     * already understand a list. Everything else, including a column that named one of TanStack's
     * by string, takes the one above, which handles a typed value and a picked list alike.
     */
    const filterFn = typeof column.filterFn === "function" ? column.filterFn : defaultFilterFn;
    return {
      ...column,
      id,
      header: column.header ?? column.label ?? id,
      filterFn: tableRef ? keepingSubRows(filterFn, tableRef) : filterFn,
      ...(accessorFn ? { accessorFn } : {}),
      // Only set when there is one to set. Passing `cell: undefined` does not mean "no opinion" -
      // it overwrites the table's own default renderer, and the column then draws nothing at all.
      // A column that gives an accessor and no cell means "just show the value", so it has to fall
      // through to that default rather than be handed an empty one.
      ...(id === "actions" && renderActions
        ? { cell: ({ row }) => renderActions(row.original) }
        : cell ? { cell } : {}),
      enableSorting: column.enableSorting ?? column.sortable !== false,
      enableColumnFilter: column.enableColumnFilter ?? column.filterable !== false,
      enableResizing: column.enableResizing ?? column.resizable !== false,
      // `baseFilterFn` is the column's own filter, before the wrapper above: what a row matching on
      // its own means, which is how `openedByFilter` knows a project was kept by a shoot of its own.
      meta: { ...column.meta, fixed: column.meta?.fixed ?? column.fixed, exportKey: column.meta?.exportKey ?? column.exportKey, baseFilterFn: filterFn },
    };
  });
}

/**
 * How tightly a table is drawn. Compact takes the padding, the type and the default column width
 * down together, so more rows and more columns fit on screen at once without anything reflowing.
 *
 * `filterRowTop` is the height of the header row above it, which the filter row sticks under. It
 * belongs with the rest of the scale because changing the header's padding moves it.
 */
// Exported for anything outside this file that draws to the table's scale. The two tables that
// were drawn by hand - the CRM board, the Schedule - draw through here now and no longer need it.
export const TABLE_DENSITIES = {
  // The table as it has always been drawn. Nothing here may change without changing the look of
  // every table in the app, so compact is defined as a step down from these rather than the other
  // way round.
  comfortable: {
    table: "text-[11px] sm:text-xs",
    headerY: "py-2.5",
    headerX: "px-3",
    filterY: "py-1.5",
    filterX: "px-2",
    filterInput: "px-2 py-1 text-[10px] sm:text-[11px]",
    cellY: "py-1.5",
    cellX: "px-2 sm:px-3",
    sortToggle: "text-sm",
    minColumnWidth: 160,
    filterRowTop: 41,
  },
  compact: {
    table: "text-[10px] sm:text-[11px]",
    headerY: "py-1.5",
    headerX: "px-2",
    filterY: "py-1",
    filterX: "px-1.5",
    filterInput: "px-1.5 py-0.5 text-[10px]",
    cellY: "py-0.5",
    cellX: "px-1.5 sm:px-2",
    sortToggle: "text-xs",
    minColumnWidth: 120,
    filterRowTop: 29,
  },
};

/*
 * One row, memoised.
 *
 * This is the whole of why a long table stays usable while it is being scrolled. A table that
 * appends a page of a hundred rows to eleven hundred re-rendered all twelve hundred - and every
 * cell in them, which is tens of thousands of nodes - because the rows were drawn inline in the
 * body's `map` and nothing told React that the ones above had not changed. The CRM lead board has
 * never had that problem for exactly one reason: its `LeadTableRow` is `memo()`d and its handlers
 * are held at a stable identity so the memo actually holds.
 *
 * `row` is TanStack's, and its identity changes whenever the data array does - so comparing it
 * would make the memo useless on the very render that matters, the append. The comparison is on
 * `original` instead, which is the record itself and keeps its identity when a page is concatenated
 * on; everything else a row draws from is folded into `renderKey` by the table.
 */
/*
 * How many rows either side of the viewport are drawn anyway, and the size a table has to reach
 * before it is worth windowing at all. Below that the spacers cost more than the rows saved.
 */
const WINDOW_OVERSCAN = 20;
const WINDOW_MIN_ROWS = 120;

/*
 * A row that opens on double click has to open on a phone too, where two taps rarely arrive as a
 * `dblclick` (iOS Safari zooms instead). The taps are counted by hand; a native `dblclick` that
 * does follow them (Chrome on Android) is then ignored, so the record is not opened twice.
 */
const rowTaps = createDoubleTap();
let tapOpenedAt = 0;

const DataTableRow = memo(function DataTableRow({ row, original, selected, nested, scale, sizedStyle, stickyStyle, onRowClick, onRowDoubleClick, onRowContextMenu, hoverClassName, focusable }) {
  return <tr
    // Marks a real record row, so the measurer can find one to take a height from without
    // catching a spacer, the loader or the empty-state line.
    data-row=""
    onClick={() => onRowClick?.(original)}
    /*
     * A row that is the only way into its record (`focusableRows`) is reachable by Tab and opened
     * by Enter or Space, the way a button would be - without being one: a `<tr>` cannot hold a
     * button, and a button inside every cell would be a nested control inside a clickable row. A
     * key pressed on a control inside the row (a checkbox, a menu) is that control's own.
     */
    tabIndex={focusable && onRowClick ? 0 : undefined}
    onKeyDown={focusable && onRowClick ? (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (event.target !== event.currentTarget) return;
      event.preventDefault();
      onRowClick(original);
    } : undefined}
    onDoubleClick={() => {
      if (Date.now() - tapOpenedAt < 600) return;
      onRowDoubleClick?.(original);
    }}
    onTouchStart={onRowDoubleClick ? (event) => rowTaps.start(event.changedTouches[0].clientX, event.changedTouches[0].clientY) : undefined}
    onTouchEnd={onRowDoubleClick ? (event) => {
      // A tap on the ⋮ menu or a checkbox belongs to that control, not to the row.
      if (event.target.closest?.("button, a, input, label, [role='menu']")) return;
      const touch = event.changedTouches[0];
      if (!rowTaps.end(touch.clientX, touch.clientY, original, Date.now())) return;
      tapOpenedAt = Date.now();
      event.preventDefault();
      onRowDoubleClick(original);
    } : undefined}
    // A right-click, for a table whose rows carry a menu of their own - the CRM board's. The page
    // decides what it does, including whether the browser's own menu is suppressed.
    onContextMenu={onRowContextMenu ? (event) => onRowContextMenu(original, event) : undefined}
    className={`group border-b border-slate-100 ${onRowClick || onRowDoubleClick ? "cursor-pointer" : ""} ${onRowDoubleClick ? "touch-manipulation" : ""} ${focusable && onRowClick ? "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500" : ""} ${selected ? "bg-blue-50" : nested ? "data-table-subrow" : hoverClassName}`}
  >{row.getVisibleCells().map((cell, index) => <td
    key={cell.id}
    /*
     * The chevron column takes no horizontal padding, as the ⋮ column does not.
     *
     * It used to take a text cell's 12px a side, which left 10px of a 34px column for a 24px
     * button: a top-level chevron overflowed it and merely looked centred, and a nested one,
     * indented as well, was clipped six pixels into the glyph. The whole width is the control's
     * now, and `expandColumn` does the stepping in.
     */
    className={`${CELL_CLIP} border-b border-slate-100 ${scale.cellY} ${cell.column.id === "actions" ? "px-0 text-center" : cell.column.id === EXPAND_COLUMN_ID ? "px-0" : scale.cellX}${nested && index === 1 ? " pl-5 sm:pl-6" : ""}`}
    style={{ ...sizedStyle(cell.column), ...stickyStyle(index, cell.column, false, selected, nested) }}
    title={cell.column.id === "actions" ? undefined : cell.column.columnDef.title?.(original)}
    // The ⋮ already stops a click from reaching the row; a double click on it has to be stopped
    // too, or reaching for Approve twice opens the record behind the menu.
    onDoubleClick={cell.column.id === "actions" ? (event) => event.stopPropagation() : undefined}
  >{
    /*
     * A nested row draws a rule down its chevron cell instead of a chevron of its own: it belongs
     * to the row above it, and it says so where the row above says "open me".
     *
     * Unless something hangs under it in turn - a deliverable opens into companies and each company
     * into variants - so the rule is for a nested row that is a leaf.
     */
    nested && cell.column.id === EXPAND_COLUMN_ID && !row.getCanExpand()
      ? <span aria-hidden="true" className={`block h-5 w-0.5 rounded bg-blue-400 ${row.depth > 1 ? "ml-5" : "ml-2.5"}`} />
      : flexRender(cell.column.columnDef.cell, cell.getContext())
  }</td>)}</tr>;
}, (prev, next) => prev.original === next.original
  && prev.selected === next.selected
  && prev.nested === next.nested
  && prev.renderKey === next.renderKey
  // The handlers are compared rather than ignored: a page that rebuilds them each render gets a
  // correct row that is simply not saved any work, which is the right way round to be wrong.
  && prev.onRowClick === next.onRowClick
  && prev.onRowDoubleClick === next.onRowDoubleClick
  && prev.onRowContextMenu === next.onRowContextMenu
  && prev.hoverClassName === next.hoverClassName
  && prev.focusable === next.focusable
  && prev.scale === next.scale
  && prev.sizedStyle === next.sizedStyle
  && prev.stickyStyle === next.stickyStyle);

export default function DataTable({
  columns,
  data,
  /*
   * What this table's Import does, or nothing where it does not offer one.
   *
   * `{ prefix, columns, templateName, title, onImported }` - the API prefix the module mounts under
   * (`/api/vendors`), the columns a file may carry, and what to do once rows have landed. The two
   * endpoints beneath a prefix are the same shape for every module by construction, so a table wires
   * an import with one prop rather than a dialog, a service call and a menu item of its own.
   *
   * A table that passes nothing shows no Import at all - better than an item that opens a dialog
   * and then refuses.
   */
  importConfig,
  /*
   * The density the application reads its tables at; see `useCompactView`, which is the one place
   * that decides it. Callers pass what they read from that hook, so this default only covers the
   * few tables that never asked.
   */
  density,
  onToggleCompact,
  loading = false,
  loadingMessage = "Loading records...",
  emptyMessage = "No records found.",
  noMatchMessage = "No matching records found.",
  selectedRowId,
  /*
   * One filter to put in the row of filter boxes, when this changes.
   *
   * For arriving from somewhere else: a "Navigate to" from another board names its project, and the
   * board answers by filtering to it - the row stands alone on screen, the filter box says why, and
   * clearing it gives the whole board back. Scrolling to the row instead was the first attempt and
   * a poor one: on a board of hundreds it moved a highlight somewhere below the fold, which is
   * exactly the hunting it was meant to spare the reader.
   */
  filterPreset,
  onRowClick,
  onRowDoubleClick,
  /*
   * A right-click on a row, as `(record, event)`. For a table whose rows carry a menu of their own
   * at the pointer - the CRM board's - and absent everywhere else, where the browser's own menu is
   * the right answer to a right-click.
   */
  onRowContextMenu,
  /*
   * What a row does under the pointer. Slate by default, which is every table in the app; the two
   * boards that were drawn by hand have always tinted blue, and keep it rather than change under
   * the reader's hand on the day they moved here.
   */
  rowHoverClassName = "hover:bg-slate-50",
  // Rows reachable by Tab and opened by Enter or Space, for a table where the row click is the only
  // way into a record. Off by default: a table whose rows also carry a ⋮ menu or a double-click
  // already has a keyboard path through those.
  focusableRows = false,
  renderActions,
  getRowId,
  /*
   * The page's own handle on the scroll container, for a page that has to read or restore the
   * scroll position itself - the CRM board puts the reader back where they were after a silent
   * reload. The table keeps its own ref regardless; this is a second name for the same node.
   */
  scrollerRef,
  // An `id` on the `<table>` itself, for a table something else has to find by name.
  tableId,
  features = {},
  defaultColumnVisibility,
  onVisibleRowsChange,
  className = "",
  tableClassName = "",
  /*
   * Where the header's ⋮ menu sits in the stack.
   *
   * It is portalled to `body`, so it competes with whatever surface the table is drawn on rather
   * than stacking inside it: a table inside a full-screen form has to say so, or Manage Columns and
   * Export open behind the form and pressing ⋮ appears to do nothing. The page default is right for
   * a table on a page.
   */
  menuZIndexClassName,
  ariaLabel = "Data table",
  // Overrides the storage key column order is remembered under; see `weaveColumnOrder`. Only a
  // table sharing its `ariaLabel` with another, or a page reusing one DataTable for two logically
  // different tables, needs to pass this.
  columnOrderKey,
  /*
   * Told the table's own sort whenever a header changes it - `[{ id, desc }]`, or `[]` once it is
   * back to the order the rows came in. Only for a page that needs to know the rows on screen are no
   * longer in their own order (a row-reorder grip, which would move rows the reader cannot see
   * move); a page that sorts the rows itself passes `features.sorting.onChange` instead.
   */
  onSortChange,
}) {
  const filtering = features.filtering !== false;
  const sortingEnabled = features.sorting !== false;
  /*
   * ── Who sorts ─────────────────────────────────────────────────────────────────────────────────
   *
   * `sorting: true` (or nothing) is the table sorting the rows it holds, which is the whole answer
   * for a table that holds all of them. `sorting: { sort, onChange }` is the **page** sorting: it
   * owns the order - the CRM board asks its server, the Schedule sorts its own rows by rules of its
   * own - and the table only draws the arrows and reports a press.
   *
   * `sort` is `{ id, direction }` or null, the shape both of those pages have always held, and
   * `onChange(next, columnId)` is handed what a press would make of it. The column id travels
   * beside it because the third press proposes "no sort" - and a page whose own cycle never rests
   * there needs to know which column was pressed to answer with its own.
   */
  const controlledSort = features.sorting && typeof features.sorting === "object" && features.sorting.onChange ? features.sorting : null;
  /*
   * ── How columns take their width ──────────────────────────────────────────────────────────────
   *
   * `layout: "auto"` sizes every column to its contents until somebody pulls one, which is how the
   * CRM board has always been drawn - thirty columns of which most are narrow, and none declares a
   * width. The default lays a server-paged table out fixed from the start (see `fixedWidth`), and
   * a column that declares no width is then TanStack's 150px, which on that board would be a
   * different board.
   *
   * What auto costs is the re-measure on every change of rows - the board pins its widths on the
   * first filter to stop exactly that shake (see `pinCurrentWidths`), and lives with it on append.
   */
  const autoLayout = features.layout === "auto";
  /*
   * `layout: "fill"` is the fixed layout stretched to the pane: the columns keep the widths they
   * declare as their minimum, and a pane wider than their sum shares the spare width out in
   * proportion to them rather than leaving a blank strip beside the last column. For a paged table
   * of a few columns - User Activity Logs - on a wide screen. A pulled column still fixes widths.
   */
  const fillLayout = features.layout === "fill";
  /*
   * On unless a table says otherwise, which is how `filtering`, `sorting` and `columnReorder` above
   * already read. It was opt-in and almost nothing opted in - and the reason was the layout switch
   * described at `fixedWidth` below, not a decision that these tables should not be resizable.
   * With that fixed there is nothing left to opt in to.
   */
  const resizeEnabled = features.columnResize !== false;
  // On everywhere, like sorting and filtering, rather than something every one of the app's tables
  // has to ask for by name - the same reasoning that put a `!== false` on those two.
  const reorderEnabled = features.columnReorder !== false;
  /*
   * ── Paging is the standard, like reordering and resizing ──────────────────────────────────────
   *
   * On unless a table says `infiniteScroll: false`. It was opt-in, and eleven tables had not opted
   * in - so a register of four hundred rows drew four hundred rows at once while the one beside it
   * revealed fifty at a time. A table that is handed every row reveals them a page at a time; one
   * that passes `onEndReached` is fetching them a page at a time and every row it holds is drawn.
   *
   * A table inside a panel that does not scroll - Project Settings draws its forty services with no
   * height cap, and the panel is what scrolls - can never ask for the next page by scrolling. The
   * reveal below keeps going on its own until the table actually overflows its scroller, so such a
   * table still ends up drawing every row it has, a page at a time, rather than stopping at fifty.
   */
  const infiniteScroll = features.infiniteScroll === false ? null : (features.infiniteScroll || EMPTY_LAYOUT);
  const pageSize = infiniteScroll?.pageSize || DEFAULT_PAGE_SIZE;
  /*
   * How this reader last left this table. Keyed off the table's own name, so a page that swaps
   * `ariaLabel` to reuse one DataTable for two tables (Asset Requests / Asset Management) reads the
   * right arrangement for each without remounting - the value follows the key rather than being
   * copied into state that would have to be told the key had changed.
   */
  const layoutKey = tableLayoutKey(slugify(columnOrderKey || ariaLabel));
  const [layout, setLayout, resetLayout] = usePreference(layoutKey, EMPTY_LAYOUT);
  // Merged rather than replaced: arranging one part of a table must not forget the other three.
  const saveLayout = (change) => setLayout({ ...layout, ...change });

  const storedOrder = Array.isArray(layout.columnOrder) ? layout.columnOrder : null;
  const storedFreezeCount = Number.isInteger(layout.freezeCount) ? layout.freezeCount : Math.max(0, features.frozenColumns?.count || 0);
  const columnSizing = layout.columnSizing || EMPTY_LAYOUT;
  /*
   * The widths while a column's edge is being dragged: drawn at most once a frame and saved to the
   * stored layout once, when the edge is let go (`startResize`). Saved on every pixel, the drag wrote
   * the preference every screen reading preferences re-renders on, dozens of times a second.
   */
  const [draftSizing, setDraftSizing] = useState(null);
  const [resizingId, setResizingId] = useState(null);
  const shownSizing = draftSizing || columnSizing;
  /*
   * What the table ships with, with the reader's own choices laid over it. Derived rather than held
   * in state: the stored answer is the only copy, so there is no second one to fall out of step
   * with it - and a column the table hides by default can still be shown, because a stored `true`
   * outranks the default the same way a stored `false` does.
   */
  const columnVisibility = { ...(defaultColumnVisibility || {}), ...(layout.columnVisibility || EMPTY_LAYOUT) };
  /*
   * The Table Options menu - Export CSV, Export Excel, Freeze Columns, Manage Columns, Compact
   * view - is the standard every table ships with, the way Employee Repository always has. Each
   * part is on unless the table turns it off in `features` (`csvExport: false`,
   * `columnVisibility: false`, `frozenColumns: false`, `compactView: false`, or
   * `tableOptions: false` for the whole menu), rather than something a page remembers to ask for.
   *
   * The freeze count is controlled when the page owns it - Employee Repository keeps it in page
   * state - and otherwise lives here. Compact view is the application's one density setting
   * (`useCompactView`): the table reads it directly, so a page need not pass `density` at all,
   * and a page that does passes the same answer. Choosing the tick in any table moves every table.
   */
  const menuEnabled = features.tableOptions !== false;
  const csv = features.csvExport && typeof features.csvExport === "object" ? features.csvExport : {};
  const csvEnabled = menuEnabled && features.csvExport !== false && csv.enabled !== false;
  /*
   * Excel is offered only where a table hands over its own exporter (`features.excelExport.onExport`)
   * - the table has no workbook writer of its own, so everywhere else the menu keeps showing it as
   * not yet available. The User Activity Logs export theirs from the server.
   */
  const excel = features.excelExport && typeof features.excelExport === "object" ? features.excelExport : null;
  const excelEnabled = menuEnabled && typeof excel?.onExport === "function";
  const visibilityEnabled = menuEnabled && features.columnVisibility !== false;
  const freezeEnabled = menuEnabled && features.frozenColumns !== false;
  const freezeControlled = Boolean(features.frozenColumns?.onChange);
  // A page that owns the count keeps owning it; only the tables that leave the decision to the
  // table itself have it remembered, because only those have anywhere to remember it.
  const freezeCount = !freezeEnabled
    ? 0
    : Math.max(0, freezeControlled ? features.frozenColumns.count || 0 : storedFreezeCount);
  const onFreezeChange = !freezeEnabled
    ? undefined
    : freezeControlled ? features.frozenColumns.onChange : (count) => saveLayout({ freezeCount: Math.max(0, Number(count) || 0) });
  const compactEnabled = menuEnabled && features.compactView !== false;
  const compactView = useCompactView();
  const compactControlled = Boolean(onToggleCompact);
  const resolvedDensity = density || (compactEnabled && !compactControlled ? compactView.density : "comfortable");
  const toggleCompact = !compactEnabled ? undefined : compactControlled ? onToggleCompact : compactView.toggleCompact;
  const scale = TABLE_DENSITIES[resolvedDensity] || TABLE_DENSITIES.comfortable;
  /*
   * `expandable` is `{ getSubRows, canExpand?, label? }`. A table that does not pass it is built
   * exactly as before - no column, no expanded row model, no state.
   */
  const expandable = features.expandable || null;
  /*
   * `selection` is `{ selectedIds, onChange, rowLabel? }` - the ids ticked, and what to do when that
   * changes. A table that does not pass it is built exactly as before: no column, no header box, no
   * state, and nothing on any other table moves.
   *
   * The selection itself is **the page's**, not this table's. A page acts on it - a bulk delete, a
   * stage moved across a set - clears it afterwards, and has to count it in its own action bar, so
   * holding a second copy here would be two answers to the same question. This draws the boxes and
   * applies the three rules in `tableSelection.js`.
   *
   * Read apart rather than as one object, because these are what the column below is rebuilt for:
   * a page passing an inline `{ ... }` would otherwise rebuild every column on every render.
   */
  const selectedIds = features.selection?.selectedIds;
  const onSelectionChange = features.selection?.onChange;
  const selectionRowLabel = features.selection?.rowLabel;
  // Which rows may be ticked at all, where a table mixes records it can act on with rows it cannot.
  // Absent on almost every table, which means every row.
  const canSelectRow = features.selection?.canSelectRow;
  // Whether the rows under a row are records to tick as well - see `selectColumn`.
  const selectSubRows = Boolean(features.selection?.subRows);
  // How wide the column of boxes is, and what its header box calls itself - see `selectColumn`.
  const selectionWidth = features.selection?.width;
  const selectionHeaderLabel = features.selection?.headerLabel;
  /*
   * Whether the table hands the header its Export / Delete / Clear over the selection.
   *
   * On by default, which is how every module table's selection reaches the header. A page that
   * draws its **own** actions over a selection - the CRM board's Update Details - passes
   * `publish: false`, or the header would replace those with these the moment a row was ticked.
   */
  const publishSelectionActions = features.selection?.publish !== false;
  // What the module itself does with a selection, drawn before Export - see `TableSelectionActions`.
  const selectionActions = features.selection?.actions;
  // `exportable: false` leaves Export off the selection's actions - the table's own Export stays.
  const selectionExportable = features.selection?.exportable !== false;
  /*
   * A paged table's own answer to "what is ticked", where the set of ids is not the selection.
   * Absent on every table that holds all its rows, which is all but the Interview register.
   */
  /*
   * A paged table's own answer to "what values does this column hold" - `{ get, onOpen, loading }`.
   * Absent on every table that holds all its rows, which is all but the Interview register.
   */
  const filterValues = features.filterValues;
  /*
   * A page that filters its own rows, because the table cannot.
   *
   * Filtering in the browser filters the rows the browser **has**, which for a table read a page at
   * a time is the page scrolled into view - so picking a value the column holds but that page does
   * not answered "no records found" over a register that had plenty. Such a page passes
   * `onColumnFilters` and asks its server instead; the table then reports the filters and draws
   * whatever comes back.
   */
  const onColumnFilters = features.onColumnFilters;
  const serverFiltered = Boolean(onColumnFilters);
  /*
   * The page's own filters, where the page holds them - `{ columnId: value }`, the shape
   * `onColumnFilters` reports in. Given, they are what the boxes show, so a page that clears its
   * filters when the tab changes clears the boxes with them; without it the table keeps a copy of
   * its own, which the Interview register resets by remounting the table per tab.
   */
  const controlledFilters = serverFiltered && features.filters && typeof features.filters === "object" ? features.filters : null;
  const selectionModel = features.selection?.model;
  const selectable = Boolean((selectedIds && onSelectionChange) || selectionModel);
  /*
   * The model every reader below asks, rather than the set three of them used to reach into.
   *
   * There are four questions - is this row ticked, what does the header box show, what do the two
   * toggles do, and how many are selected - and a paged table answers the last one differently: its
   * count is what the **stage** holds, not what has been drawn. Resolved once here so the column,
   * the count and Clear cannot answer from different places, which is how the page crashed on a
   * table that passes a model and no set.
   */
  const resolvedSelection = useMemo(
    () => selectionModel || setSelectionModel({ selectedIds, onSelectionChange }),
    [selectionModel, selectedIds, onSelectionChange],
  );
  /*
   * The other half of `selection`: what the ticked rows can be *done* with, which the bar below the
   * table offers and this table carries out.
   *
   * Here rather than in the page for the reason the boxes themselves are here - twenty-odd tables
   * would otherwise each grow their own row of buttons, in twenty-odd differently shaped headers.
   * Exporting is this table's own job either way: only it knows which columns survived Manage
   * Columns and what each one's cell actually says, which is exactly what an export has to write.
   *
   * These are read apart from the object for the same reason the three above are: a page passing an
   * inline `{ ... }` would otherwise rebuild every column on every render.
   */
  const onSelectionDelete = features.selection?.onDelete;
  const selectionDeleting = Boolean(features.selection?.deleting);
  const selectionNoun = features.selection?.noun || "record";
  const selectionPlural = features.selection?.plural;
  // A vendor and a client storage record are removed *with a reason* - their `deleteInput` refuses a
  // body without one, and the reason is what the audit row then carries. Asked once for the whole
  // selection rather than per row, because it is one decision.
  const selectionRequiresReason = Boolean(features.selection?.requireReason);
  const selectionReasonLabel = features.selection?.reasonLabel || "Reason";
  const selectionDeleteMessage = features.selection?.deleteMessage || "This cannot be undone. Anything that cannot be deleted is left alone and stays ticked.";
  const [pendingSelectionDelete, setPendingSelectionDelete] = useState(false);
  const [selectionReason, setSelectionReason] = useState("");
  const selectionReasonFields = useFormErrors();
  const [exportingSelection, setExportingSelection] = useState(false);
  const [localColumnFilters, setLocalColumnFilters] = useState([]);
  /*
   * A filter the caller asks for - a "Navigate to" naming its project - put in the filter row as if it
   * had been typed. Only when it changes, so the reader can clear it or type over it afterwards;
   * and only on a table that holds its own filters, since a page holding them sets its own.
   */
  const presetKey = filterPreset ? `${filterPreset.id}\u0000${filterPreset.value}` : "";
  useEffect(() => {
    if (!presetKey || controlledFilters) return;
    const [id, value] = presetKey.split("\u0000");
    setLocalColumnFilters([{ id, value }]);
  }, [controlledFilters, presetKey]);
  // TanStack's shape, from the page's where the page holds them. A blank is no filter, the way
  // TanStack itself drops one - so the two readings of "nothing typed here" cannot differ.
  const columnFilters = useMemo(() => (controlledFilters
    ? Object.entries(controlledFilters)
      .filter(([, value]) => !(value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length)))
      .map(([id, value]) => ({ id, value }))
    : localColumnFilters), [controlledFilters, localColumnFilters]);

  /*
   * Which columns offer a list, and what is on it.
   *
   * Worked out from the rows actually loaded rather than declared per module, so a column becomes a
   * picker the day its values become a set and stops being one the day they do not - and nothing has
   * to be kept in step by hand across a dozen tables.
   *
   * `distinctFilterValues` abandons a column as soon as it passes the cap, so a Name column on ten
   * thousand rows costs forty reads rather than ten thousand. Memoised on the data, because that is
   * the only thing it depends on: typing in one filter must not recount every column.
   */
  /*
   * Which columns offer a list, and what is on it.
   *
   * Worked out from the rows actually loaded - which is the whole answer for a table that holds all
   * of them, and **not** for one read a page at a time. A paged table's menu built this way offers
   * the values of the hundred rows scrolled into view: it grows as you scroll, and it hides the
   * rows you opened it to find. Such a table passes `filterValues`, and then the menu asks the
   * server what the column holds and this derivation is skipped for it entirely.
   *
   * `distinctFilterValues` abandons a column as soon as it passes the cap, so a Name column on ten
   * thousand rows costs forty reads rather than ten thousand. Memoised on the data, because that is
   * the only thing it depends on: typing in one filter must not recount every column.
   */
  // The reference lists this table's known columns name (branches, departments, verticals), fetched
  // once for every table on the page - see `knownListFor` in `tableCells.js`.
  const knownKinds = useMemo(() => (filtering && !filterValues
    ? columns.filter((column) => column.accessorKey && column.enableColumnFilter !== false && filterKindFor(column) !== "text").map(knownListFor).filter(Boolean)
    : []), [columns, filterValues, filtering]);
  const knownLists = useKnownFilterLists(knownKinds);
  const filterChoices = useMemo(() => {
    if (!filtering || filterValues) return {};
    const choices = {};
    for (const column of columns) {
      const key = column.accessorKey;
      // `filter: "text"` keeps the typed box whatever the column holds: an ID, an amount or a note is
      // looked up, not picked from a list, however few of them a page happens to hold.
      if (!key || column.enableColumnFilter === false || filterKindFor(column) === "text") continue;
      // A known-value column always lists its answers, whatever the rows on screen hold.
      const ownList = Array.isArray(column.meta?.filterOptions) ? column.meta.filterOptions : null;
      const listKind = knownListFor(column);
      if (ownList || listKind) {
        choices[key] = knownFilterValues(data, key, column.meta?.type, [ownList, knownLists[listKind]]);
        continue;
      }
      const values = distinctFilterValues(data, key, column.meta?.type);
      if (values) choices[key] = values;
    }
    return choices;
  }, [columns, data, filtering, filterValues, knownLists]);
  const [expanded, setExpanded] = useState({});
  // The table itself, for the filters that need to read a sub-row's parent (`keepingSubRows`).
  const tableRef = useRef(null);
  const [localSorting, setLocalSorting] = useState([]);
  // Every change to the table's own sort goes through here, so `onSortChange` hears all of them.
  const setOwnSorting = (next) => { setLocalSorting(next); onSortChange?.(next); };
  // TanStack's shape, derived from the page's where the page owns the order - so the arrows read
  // the one order there is rather than a copy of it.
  const sorting = controlledSort
    ? (controlledSort.sort?.id ? [{ id: controlledSort.sort.id, desc: controlledSort.sort.direction === "desc" }] : [])
    : localSorting;
  const [manageColumnsOpen, setManageColumnsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(pageSize);
  /*
   * ── Drawing only the rows on screen ───────────────────────────────────────────────────────
   *
   * Memoising the rows stopped a long table re-rendering itself on every append, but it could not
   * make the rows cost nothing: a thousand of them at thirty columns is thirty thousand cells in
   * the document, most carrying a sticky position, and a browser asked to paint that while
   * somebody flicks the scrollbar gives up and shows blank space until it catches up.
   *
   * So the rows outside the viewport are not drawn at all. Two spacer rows stand in for them, one
   * above and one below, sized to the height the missing rows would have taken - the scrollbar
   * therefore behaves exactly as if every row were there, which is the whole trick.
   *
   * Scroll position and viewport height have to be state rather than refs: the window has to be
   * recomputed while rendering, which is the one place a ref may not be read.
   */
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  // The scroller's visible width, so a message drawn across every column - loading, nothing to show -
  // can be held to the part of the table on screen rather than centred across all of it.
  const [viewportWidth, setViewportWidth] = useState(0);
  const [rowHeight, setRowHeight] = useState(0);
  const [bodyTop, setBodyTop] = useState(0);
  const bodyRef = useRef(null);

  const [draggingColumnId, setDraggingColumnId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const scrollRef = useRef(null);
  /*
   * The edge scroll that runs while a column is being dragged: the frame it has queued, and how far
   * it moves the table on each one. A ref rather than state - it is read and written many times a
   * second by an animation frame, and re-rendering the whole table on each would make the drag
   * stutter exactly when it needs to be smooth.
   */
  const edgeScrollRef = useRef({ frame: 0, speed: 0 });

  function stopEdgeScroll() {
    if (edgeScrollRef.current.frame) cancelAnimationFrame(edgeScrollRef.current.frame);
    edgeScrollRef.current = { frame: 0, speed: 0 };
  }

  /** One frame of the edge scroll, queueing the next until the speed drops or the table runs out. */
  function stepEdgeScroll() {
    const element = scrollRef.current;
    const { speed } = edgeScrollRef.current;
    if (!element || !speed) return stopEdgeScroll();
    const before = element.scrollLeft;
    element.scrollLeft = before + speed;
    // The end of the table. Stopping here rather than queueing frames that move nothing means a
    // pointer parked against the edge costs nothing once there is nothing left to reveal.
    if (element.scrollLeft === before) return stopEdgeScroll();
    edgeScrollRef.current.frame = requestAnimationFrame(stepEdgeScroll);
    return undefined;
  }

  /** Reads the pointer against the table's edges and runs the scroll `dragEdgeScroll` asks for. */
  function edgeScrollFromPointer(clientX, clientY) {
    const element = scrollRef.current;
    if (!element) return stopEdgeScroll();
    const speed = edgeScrollSpeed(element.getBoundingClientRect(), clientX, clientY);
    if (!speed) return stopEdgeScroll();
    const running = edgeScrollRef.current.speed !== 0;
    edgeScrollRef.current.speed = speed;
    // Only one loop, whatever the speed becomes: the running one reads the new speed on its next
    // frame, and starting a second would scroll the table at the sum of the two.
    if (!running) edgeScrollRef.current.frame = requestAnimationFrame(stepEdgeScroll);
    return undefined;
  }

  /*
   * Listened for on the document rather than on the table, because the pointer is regularly outside
   * the table at the moment it most needs to scroll - held a little past the right-hand edge, which
   * is where somebody pushes when they want more table. `dragover` on the container alone stops
   * firing there, which would freeze the scroll at the exact point the gesture is asking for it.
   *
   * Bound only while a column is actually being dragged, and torn down with the scroll it drives,
   * so a table sitting still listens for nothing.
   */
  useEffect(() => {
    if (!draggingColumnId) return undefined;
    const onDocumentDragOver = (event) => edgeScrollFromPointer(event.clientX, event.clientY);
    document.addEventListener("dragover", onDocumentDragOver);
    return () => {
      document.removeEventListener("dragover", onDocumentDragOver);
      stopEdgeScroll();
    };
    // Rebound per drag, not per render: the handler only reads the pointer and the DOM.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draggingColumnId]);
  /*
   * One row's identity, as everything that has to name a row reads it: which row is selected, which
   * rows are ticked, and the key React draws them under. Declared here rather than beside the render
   * because the tick-box column is built above it and has to agree with it exactly - two answers to
   * "which row is this" would tick one row and act on another.
   */
  const rowKey = (row) => getRowId?.(row.original) ?? row.original?.id ?? row.id;

  const backendColumns = useMemo(() => {
    const configured = new Set(leafDefinitions(columns).map(columnId));
    const fields = [...new Set(data.flatMap((row) => row && typeof row === "object" ? Object.keys(row) : []))];
    return fields.filter((field) => !configured.has(field) && !isUserIdField(field, data)).map((field) => ({ id: field, header: humanizeFieldName(field), accessorFn: (row) => displayBackendValue(row?.[field]), cell: ({ row }) => displayBackendValue(row.original?.[field]), meta: { backendDynamic: true } }));
  }, [columns, data]);
  const tableColumns = useMemo(() => {
    const actionIndex = columns.findIndex((column) => columnId(column) === "actions");
    const merged = actionIndex < 0 ? [...columns, ...backendColumns] : [...columns.slice(0, actionIndex), ...backendColumns, ...columns.slice(actionIndex)];
    // The expand chevron leads, when there is one; the structural menu column - only for a table
    // that declared no Actions column of its own - trails, the way "actions" always sits last.
    const withExpand = expandable ? [expandColumn(expandable.label || "the rows under this one"), ...merged] : merged;
    // The tick box leads even the chevron: it belongs to the row itself, where the chevron belongs to
    // what hangs under it, and a reader ticking down a stage should not have to aim past a control
    // about something else.
    const withSelect = selectable
      ? [selectColumn({ model: resolvedSelection, rowId: rowKey, rowLabel: selectionRowLabel, canSelectRow, width: selectionWidth, headerLabel: selectionHeaderLabel, subRows: selectSubRows }), ...withExpand]
      : withExpand;
    const withMenuColumn = actionIndex < 0 && menuEnabled ? [...withSelect, MENU_COLUMN] : withSelect;
    return normalizeColumns(withMenuColumn, renderActions, expandable ? tableRef : null);
    // `rowKey` is a plain closure over `getRowId`, which is what it actually depends on; listing it
    // would rebuild every column on every render for a page that passes an inline function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendColumns, columns, expandable, menuEnabled, renderActions, selectable, resolvedSelection, selectionRowLabel, canSelectRow, selectionWidth, selectionHeaderLabel, selectSubRows, getRowId]);
  const effectiveColumnVisibility = { ...Object.fromEntries(backendColumns.map((column) => [column.id, false])), ...columnVisibility };
  // The value columns, under any group headings - the order, the visibility and the column chooser
  // are about these; a heading is a label, not a column to move or hide.
  const tableLeaves = useMemo(() => leafDefinitions(tableColumns), [tableColumns]);
  const columnOrder = useMemo(() => weaveColumnOrder(tableLeaves, storedOrder), [tableLeaves, storedOrder]);

  /** Where `sourceId` lands relative to `targetId`, remembered and drawn from immediately. */
  function reorderColumns(sourceId, targetId, side) {
    const next = reorderColumnOrder(columnOrder, sourceId, targetId, side);
    if (next !== columnOrder) saveLayout({ columnOrder: next });
  }

  /**
   * The drag handlers for one header, or none at all for a fixed column - the row's expand chevron,
   * its own ⋮ actions - which never moves and so is never a drag source or a drop target.
   *
   * Native HTML5 drag and drop rather than a pointer-tracked one: every table in the app gets this
   * for free the moment it renders through here, at the cost of the gesture not answering to touch
   * on a phone the way the resize handle beside it does - a table is reordered from a desk, where a
   * mouse already drives it, far more often than from a thumb.
   */
  function dragHandlersFor(column) {
    if (!reorderEnabled || column.columnDef.meta?.fixed) return {};
    return {
      draggable: true,
      // A press on the column's resize edge is a resize, never a move.
      onDragStart: (event) => { if (resizeCleanupRef.current) { event.preventDefault(); return; } setDraggingColumnId(column.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", column.id); },
      onDragOver: (event) => {
        if (!draggingColumnId || draggingColumnId === column.id) return;
        // A column moves within its own group heading: carried into another, the band would split
        // in two under the same label.
        if ((table.getColumn(draggingColumnId)?.parent?.id ?? null) !== (column.parent?.id ?? null)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const rect = event.currentTarget.getBoundingClientRect();
        const side = event.clientX - rect.left < rect.width / 2 ? "before" : "after";
        setDropTarget((current) => current?.id === column.id && current.side === side ? current : { id: column.id, side });
      },
      onDrop: (event) => {
        event.preventDefault();
        stopEdgeScroll();
        const rect = event.currentTarget.getBoundingClientRect();
        const side = event.clientX - rect.left < rect.width / 2 ? "before" : "after";
        reorderColumns(draggingColumnId, column.id, side);
        setDraggingColumnId(null);
        setDropTarget(null);
      },
      // Stopped here as well as in the effect's cleanup: the drop lands on the column under the
      // pointer, and a frame of scrolling queued between the release and the re-render would move
      // the table out from under the drop that was just made.
      onDragEnd: () => { stopEdgeScroll(); setDraggingColumnId(null); setDropTarget(null); },
    };
  }

  /*
   * Every header cell, in column order. Read by two things: the frozen-column measurement below,
   * and the first column pull - which has to know how wide the other columns currently are.
   *
   * Declared above the table rather than beside its other reader, because `onColumnSizingChange`
   * needs it and lives in the configuration object.
   */
  const headerCellRefs = useRef([]);
  // Ends a resize in progress - its listeners, its frame and its save - or null when there is none.
  const resizeCleanupRef = useRef(null);
  useEffect(() => () => resizeCleanupRef.current?.(), []);

  /** Every visible column's width as the browser drew it, by column id. */
  function measureHeaderWidths() {
    const measured = {};
    table.getVisibleLeafColumns().forEach((column, index) => {
      const node = headerCellRefs.current[index];
      if (node) measured[column.id] = Math.round(node.getBoundingClientRect().width);
    });
    return measured;
  }

  /*
   * ── Dragging a column's edge ─────────────────────────────────────────────────────────────────
   *
   * Tracked here from the pointer rather than by TanStack's resize handler, which had three faults:
   *
   * - **It started from the wrong width.** Before any width is stored TanStack counts every column
   *   as 150px, so the first pull on a 400px column snapped it to about 150 as the pointer moved.
   *   The drag here starts from the width actually on screen and adds only the distance dragged.
   * - **The header's own drag took it over.** The header cell is draggable (column reordering), so
   *   a press on its edge could start the browser's drag of the whole column, which swallows the
   *   pointer moves - the edge stopped following the mouse. The press here is a resize only.
   * - **It saved on every pixel.** The widths are stored once, on release.
   *
   * **While dragging, React draws nothing.** A width change reaches every row (`rowRenderKey`), so
   * redrawing per frame re-rendered every visible row of a thirty-column table sixty times a second
   * and the edge stuttered behind the pointer. Instead the drag writes the new width straight onto
   * the column's `<col>`, its header cell and the table's own width - under `table-layout: fixed`
   * the browser lays the rows out from those alone - and React draws the stored answer once, on
   * release. Dragging a frozen column moves the columns frozen after it the same way: their cells'
   * `left` is shifted by the distance dragged, straight onto the cells, and the frozen widths are
   * not re-measured until the drag ends (the measuring below re-rendered the table every frame).
   *
   * The first pull also freezes the whole row, not just the column pulled: a browser laying a table
   * out automatically shares the rest out again the moment one column is given a width, so every
   * column keeps the width it already had, the pulled one takes its new width, and nothing else
   * moves. From then on the stored widths are the whole answer.
   */
  function startResize(column, event) {
    const touch = event.type === "touchstart";
    if (touch ? event.touches.length !== 1 : event.button !== 0) return;
    // No text selection and no browser drag of the header cell from a mouse press.
    if (!touch) event.preventDefault();
    event.stopPropagation();
    resizeCleanupRef.current?.();
    const measured = measureHeaderWidths();
    const base = Object.keys(columnSizing).length ? { ...measured, ...columnSizing } : measured;
    // From the width on screen: a stored width under the column's `minSize` is drawn at the minimum,
    // and starting from the stored number would make the edge lag the pointer by the difference.
    const from = measured[column.id] ?? base[column.id] ?? column.getSize();
    const narrowest = Math.max(MIN_RESIZE_PX, column.columnDef.minSize ?? 0);
    const widest = column.columnDef.maxSize ?? Number.POSITIVE_INFINITY;
    const startX = touch ? event.touches[0].clientX : event.clientX;
    const index = leafColumns.findIndex((leaf) => leaf.id === column.id);
    // The frozen columns after this one, each with where it is pinned now: they move with the edge.
    const pinnedAfter = index < effectiveFreezeCount
      ? leafColumns.slice(index + 1, effectiveFreezeCount).map((_, offset) => ({ at: index + 1 + offset, left: frozenOffsets[index + 1 + offset] }))
      : [];
    // A table still on the automatic layout is drawn fixed at the widths on screen first - one render,
    // which changes nothing visible - so there is a `<col>` for the drag to move.
    if (!Object.keys(shownSizing).length) setDraftSizing(base);
    let latest = null;
    let frame = 0;
    const paint = () => {
      frame = 0;
      const tableNode = scrollRef.current?.querySelector(":scope > table");
      const col = tableNode?.querySelectorAll(":scope > colgroup > col")[index];
      const header = headerCellRefs.current[index];
      if (!tableNode || !col || !header) { setDraftSizing(latest); return; }
      const width = `${latest[column.id]}px`;
      col.style.width = width;
      Object.assign(header.style, { width, minWidth: width, maxWidth: width });
      const total = `${leafColumns.reduce((sum, leaf) => sum + (latest[leaf.id] ?? leaf.getSize()), 0)}px`;
      tableNode.style.minWidth = total;
      if (!fillLayout) tableNode.style.width = total;
      if (pinnedAfter.length) {
        const shift = latest[column.id] - from;
        // Every row drawing one cell per column: the header, the filters and the body.
        for (const row of tableNode.rows) {
          if (row.cells.length !== leafColumns.length) continue;
          for (const pinned of pinnedAfter) row.cells[pinned.at].style.left = `${pinned.left + shift}px`;
        }
      }
    };
    const move = (moveEvent) => {
      const x = moveEvent.touches ? moveEvent.touches[0]?.clientX : moveEvent.clientX;
      if (typeof x !== "number") return;
      latest = { ...base, [column.id]: Math.min(widest, Math.max(narrowest, Math.round(from + x - startX))) };
      if (!frame) frame = window.requestAnimationFrame(paint);
    };
    const body = document.body.style;
    const before = { cursor: body.cursor, userSelect: body.userSelect };
    const finish = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", finish);
      document.removeEventListener("touchmove", move);
      document.removeEventListener("touchend", finish);
      document.removeEventListener("touchcancel", finish);
      // The last move is put on screen even if its frame had not come yet: when the width saved is
      // the one React last drew, React writes nothing, and what is on screen has to be it already.
      if (frame) { window.cancelAnimationFrame(frame); paint(); }
      body.cursor = before.cursor;
      body.userSelect = before.userSelect;
      resizeCleanupRef.current = null;
      setResizingId(null);
      setDraftSizing(null);
      if (latest) saveLayout({ columnSizing: latest });
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", finish);
    document.addEventListener("touchmove", move);
    document.addEventListener("touchend", finish);
    document.addEventListener("touchcancel", finish);
    // The resize cursor stays while the pointer outruns the edge, and the drag selects no text.
    body.cursor = "col-resize";
    body.userSelect = "none";
    resizeCleanupRef.current = finish;
    setResizingId(column.id);
  }

  // TanStack Table intentionally exposes dynamic instance methods.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns: tableColumns,
    state: { columnFilters, sorting, columnVisibility: effectiveColumnVisibility, columnOrder, columnSizing: shownSizing, ...(expandable ? { expanded } : {}) },
    onColumnFiltersChange: (next) => {
      const resolved = typeof next === "function" ? next(columnFilters) : next;
      /*
       * Pin the columns before the rows change under them.
       *
       * A table laid out automatically sizes every column to its **contents**, so each keystroke
       * and each tick re-measures the whole table and the columns jump - a shake that has nothing
       * to do with the answer arriving. Freezing them at the widths already on screen changes
       * nothing visible and stops it. Does nothing once widths are stored, so it costs one branch.
       */
      if (autoLayout) pinCurrentWidths();
      if (!controlledFilters) setLocalColumnFilters(resolved);
      setVisibleCount(pageSize);
      // The page re-reads from its server; the table keeps the state only so the boxes show it.
      onColumnFilters?.(Object.fromEntries(resolved.map((entry) => [entry.id, entry.value])));
    },
    onSortingChange: (next) => {
      const resolved = resolveUpdater(next, sorting);
      setVisibleCount(pageSize);
      if (!controlledSort) { setOwnSorting(resolved); return; }
      /*
       * Reported in the page's own shape, with the column that was pressed. TanStack proposes
       * the next state from the current one - asc, desc, then none - and on "none" the proposal
       * names no column at all; the page's cycle may not rest there, so it is told which column
       * the press was on and answers as it sees fit.
       */
      const pressed = resolved[0]?.id || sorting[0]?.id || null;
      controlledSort.onChange(resolved[0] ? { id: resolved[0].id, direction: resolved[0].desc ? "desc" : "asc" } : null, pressed);
    },
    manualSorting: Boolean(controlledSort),
    /*
     * Both of these are remembered, so both have to resolve the updater TanStack may hand them
     * rather than pass it on: what is stored has to be the arrangement, not the function that
     * would have produced it.
     *
     * `effectiveColumnVisibility` is what the table was drawn with, which is the right base to
     * derive from - it is what the dialog's tickboxes were showing when they were clicked.
     */
    onColumnVisibilityChange: (next) => {
      saveLayout({ columnVisibility: resolveUpdater(next, effectiveColumnVisibility) });
      setVisibleCount(pageSize);
    },
    // Widths are changed by `startResize` above; anything else asking TanStack for a change is stored.
    onColumnSizingChange: (next) => saveLayout({ columnSizing: resolveUpdater(next, shownSizing) }),
    enableColumnFilters: filtering,
    enableSorting: sortingEnabled,
    enableColumnResizing: resizeEnabled,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    // Not filtered here where the page does it: running both would narrow the server's answer a
    // second time, against the one page of it the browser is holding.
    getFilteredRowModel: filtering && !serverFiltered ? getFilteredRowModel() : undefined,
    // Not sorted here where the page does it, for the reason the filter above is not.
    getSortedRowModel: sortingEnabled && !controlledSort ? getSortedRowModel() : undefined,
    ...(expandable ? {
      onExpandedChange: setExpanded,
      getSubRows: (row) => expandable.getSubRows?.(row),
      // Only a row that says it has more under it can be opened. Without this every row would
      // offer a chevron, because "has sub-rows" is asked of the array and an empty array is one.
      getRowCanExpand: (row) => (expandable.canExpand ? expandable.canExpand(row.original) : (expandable.getSubRows?.(row.original) || []).length > 0),
      getExpandedRowModel: getExpandedRowModel(),
      // From the leaves up, so a project kept only by a shoot of its own stays listed with that
      // shoot alone. `keepingSubRows` is what keeps the whole project when the project is the match.
      filterFromLeafRows: true,
    } : {}),
  });

  tableRef.current = table;

  /*
   * A project kept by a shoot of its own is opened on it. Searching a shoot id leaves the project
   * closed otherwise, with the one row that answered the search hidden inside it. A project that
   * matched the search itself is left as the reader left it, open or shut.
   *
   * The ids are joined into a string so the effect below runs when the set changes and not on every
   * render; the filtered rows are read, never the expanded ones, so opening a row cannot feed back.
   */
  const openedByFilter = useMemo(() => {
    if (!expandable || !columnFilters.length || serverFiltered || !filtering) return "";
    const matchesItself = (row) => columnFilters.every(({ id, value }) => {
      const own = table.getColumn(id)?.columnDef.meta?.baseFilterFn;
      return !own || own(row, id, value);
    });
    return table.getFilteredRowModel().rows.filter((row) => row.subRows?.length && !matchesItself(row)).map((row) => row.id).join("\u0000");
    // `table` is the one instance; `data` is what its rows are built from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandable, columnFilters, serverFiltered, filtering, table, data]);
  useEffect(() => {
    if (!openedByFilter) return;
    setExpanded((previous) => {
      if (previous === true) return previous;
      const ids = openedByFilter.split("\u0000");
      if (ids.every((id) => previous[id])) return previous;
      return { ...previous, ...Object.fromEntries(ids.map((id) => [id, true])) };
    });
  }, [openedByFilter]);

  const leafColumns = table.getVisibleLeafColumns();
  // The rows of headings: one, unless the columns sit under group headings.
  const headerGroups = table.getHeaderGroups();
  const allRows = table.getRowModel().rows;

  /*
   * The ticked rows, counted against every row the table *holds* rather than the ones surviving its
   * column filters.
   *
   * Which is the same question `useTableSelection` answers in the page, and it has to be the same
   * answer: a tick is not dropped by a filter typed after it (`toggleAllIds` is deliberate about
   * that), so counting the filtered set would show "3 selected" over a bar that then deleted seven.
   * The core model is the page's own `data`, which is exactly what the hook filters.
   */
  const selectedTableRows = useMemo(
    () => (selectable
      // The records under a row count too where they are records of their own (`subRows`).
      ? (selectSubRows ? table.getCoreRowModel().flatRows : table.getCoreRowModel().rows).filter((row) => resolvedSelection.isSelected(rowKey(row)) && (!canSelectRow || canSelectRow(row.original)))
      : EMPTY_ROWS),
    /*
     * `data` stands in for the row model, which TanStack rebuilds behind a `table` that is itself
     * new every render - and `rowKey` is a plain closure over `getRowId`, which is what it actually
     * depends on. Listing either would defeat the memo entirely for any page that passes `getRowId`
     * inline, which is most of them; this is the same reasoning as the `tableColumns` memo above.
     *
     * The memo has to hold, because scrolling sets state here: without it, every scroll frame would
     * walk every row of the table to count the ticked ones.
     */
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectable, resolvedSelection, data, canSelectRow, selectSubRows],
  );
  /*
   * What the footer counts, and what "no matching records" is decided against: the records, not the
   * lines drawn. Opening a row shows what is already inside it and must not read as the register
   * having grown.
   */
  const recordCount = expandable ? allRows.filter((row) => row.depth === 0).length : allRows.length;
  /*
   * ── Who owns the paging ───────────────────────────────────────────────────────────────────────
   *
   * Two arrangements, and a table is in exactly one of them.
   *
   * **The table pages** (`infiniteScroll` with no `onEndReached`): it was handed every row and
   * reveals them a page at a time, so a register of four hundred draws fifty and grows as it is
   * scrolled. Right for anything small enough to load whole.
   *
   * **The page pages** (`onEndReached` given): the rows in hand are a page fetched from a server,
   * and every one of them is drawn. Revealing them a second time would mean two independent
   * counters over the same rows - which is what made the Interview footer read "500" over a table
   * showing three hundred, because a fetch triggered near the bottom ran ahead of a reveal that
   * only advanced on a later scroll.
   */
  const serverPaged = Boolean(infiniteScroll?.onEndReached);
  const renderedRows = infiniteScroll && !serverPaged ? allRows.slice(0, visibleCount) : allRows;

  /*
   * Which of those rows are actually drawn.
   *
   * Only for a server-paged table, which is the one that grows past what a document can hold, and
   * only once a row has been measured. An **expandable** table is excluded outright: its rows are
   * not all the same height, and the spacers are sized by multiplying one height by a count.
   *
   * The overscan is deliberately generous. It costs a few dozen rows and it is what stands between
   * a fast flick and the blank band this exists to remove - and it absorbs the small error in
   * `bodyTop`, which is measured once rather than tracked.
   */
  // Any table that has grown past what a document paints comfortably, not only a server-paged one.
  const windowed = !expandable && rowHeight > 0 && viewportHeight > 0 && renderedRows.length > WINDOW_MIN_ROWS;
  const firstVisible = windowed ? Math.floor(Math.max(0, scrollTop - bodyTop) / rowHeight) : 0;
  const windowStart = windowed ? Math.max(0, firstVisible - WINDOW_OVERSCAN) : 0;
  const windowEnd = windowed
    ? Math.min(renderedRows.length, firstVisible + Math.ceil(viewportHeight / rowHeight) + WINDOW_OVERSCAN)
    : renderedRows.length;
  const windowRows = windowed ? renderedRows.slice(windowStart, windowEnd) : renderedRows;
  const padTop = windowed ? windowStart * rowHeight : 0;
  const padBottom = windowed ? (renderedRows.length - windowEnd) * rowHeight : 0;
  /*
   * Fixed widths only once a column has actually been pulled.
   *
   * It used to be `resizeEnabled` alone, which switched the table to `table-layout: fixed` the
   * moment the feature was turned on - and since no column in this application declares a `size`,
   * every column became TanStack's default 150px. That is why resizing was left off nearly
   * everywhere: turning it on made the table worse until somebody had dragged every column back.
   *
   * With no stored widths the browser sizes the columns to their contents exactly as before, the
   * handles are there to be pulled, and the first pull stores every column's measured width - so
   * switching to a fixed layout changes nothing on screen except the column that was pulled.
   */
  /*
   * A server-paged table is fixed from the start, whether or not anybody has pulled a column.
   *
   * `table-auto` asks the browser to size the columns from their contents, which means measuring
   * every cell in every row - and re-measuring all of them each time rows are appended. At a
   * hundred rows that is free; at eleven hundred it is the jolt a reader feels every time the next
   * page lands, and it gets worse with each one because the work grows with the table.
   *
   * Fixed widths make an append cost only the rows appended: the columns are already decided, so
   * the new rows are laid out against them and nothing above is touched. The widths are the ones
   * each field declares, and pulling a column still overrides them as it always did.
   */
  // Unless the table asked to size to its contents - see `autoLayout` - in which case a pull is
  // still the only thing that fixes it, exactly as on a table that pages nothing.
  const fixedWidth = (resizeEnabled && Object.keys(shownSizing).length > 0) || (serverPaged && !autoLayout);

  /**
   * Freeze the columns at the widths they have on screen right now.
   *
   * The same measurement the first resize makes, taken before **which rows** are drawn changes
   * rather than which column is wide. Pinning what is already there changes nothing on screen, and
   * the table stops resizing itself as its contents narrow. Nothing once widths are stored, and
   * nothing before the header has been drawn.
   */
  function pinCurrentWidths() {
    if (Object.keys(shownSizing).length) return;
    const measured = measureHeaderWidths();
    if (Object.keys(measured).length) saveLayout({ columnSizing: measured });
  }

  /*
   * ── What "freeze 2 columns" counts ────────────────────────────────────────────────────────────
   *
   * Not the chevron. `expandColumn` is a real leaf column at index 0 of every expandable table, so
   * a count taken straight off the leaf columns froze the 34px chevron and called it one column -
   * and the first column anybody can actually read only pinned on the second notch.
   *
   * It is still always frozen when anything is: it belongs to its row, and a chevron that scrolled
   * away from the row it opens would be worse than one that never pinned. So it is frozen *with*
   * the first column rather than *as* it, and the menu keeps showing the number the reader chose.
   */
  const effectiveFreezeCount = resolveFreezeCount(leafColumns, freezeCount);

  /*
   * ── Where a frozen column is pinned ───────────────────────────────────────────────────────────
   *
   * Measured off the header cells rather than computed from `column.getSize()`, because outside the
   * resizing path `getSize()` is not what the browser drew. A table without `columnResize` renders
   * `w-full` with the default `table-layout: auto`: widths come from the content and are then
   * stretched to fill, while `getSize()` answers TanStack's default 150 for every column that
   * declares no `size` - which is most of them. The two drifted apart by whatever the difference
   * happened to be, so a frozen column sat on top of the one before it, or left a gap with the
   * unfrozen rows sliding through it.
   *
   * `offsetWidth` is the one number that is true under both layouts, so this measures instead of
   * predicting, and re-measures when the browser changes its mind - a resize, a density change, a
   * column shown or hidden. Only the frozen cells are observed; the rest are never asked.
   *
   * `getSize()` remains the fallback for the first paint, before any cell has been measured. It is
   * wrong by the same amount it always was, for exactly one frame.
   */
  const [measuredWidths, setMeasuredWidths] = useState(null);

  useLayoutEffect(() => {
    if (!effectiveFreezeCount) {
      setMeasuredWidths((current) => (current === null ? current : null));
      return undefined;
    }
    const cells = headerCellRefs.current.slice(0, effectiveFreezeCount).filter(Boolean);
    if (!cells.length) return undefined;
    // Compared before it is stored: ResizeObserver fires on every layout, and setting an identical
    // array would re-render the table on each one.
    // Not mid-drag: the drag moves the frozen cells itself, and a measurement per frame would
    // re-render the whole table on each one. The drag ending changes `shownSizing`, which measures.
    const measure = () => !resizeCleanupRef.current && setMeasuredWidths((current) => {
      const next = cells.map((cell) => cell.offsetWidth);
      return current && current.length === next.length && current.every((width, index) => width === next[index]) ? current : next;
    });
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    cells.forEach((cell) => observer.observe(cell));
    return () => observer.disconnect();
  }, [effectiveFreezeCount, resolvedDensity, leafColumns.length, shownSizing]);

  /*
   * Where each frozen column is pinned. Memoised so it keeps its identity between renders, which
   * `stickyStyle` needs: that is handed to every memo()d row, and a fresh array here would give it
   * a fresh identity and redraw the whole table on every render.
   */
  const frozenOffsets = useMemo(() => {
    const offsets = [];
    let width = 0;
    leafColumns.forEach((column, index) => {
      offsets[index] = width;
      if (index < effectiveFreezeCount) width += measuredWidths?.[index] ?? column.getSize();
    });
    return offsets;
  }, [leafColumns, effectiveFreezeCount, measuredWidths]);

  useEffect(() => {
    onVisibleRowsChange?.({ total: recordCount, showing: renderedRows.length });
  }, [onVisibleRowsChange, recordCount, renderedRows.length]);

  const stickyStyle = useCallback((index, column, header = false, selected = false, nested = false) => {
    const frozen = index < effectiveFreezeCount;
    const action = column.id === "actions";
    if (!frozen && !action) return {};
    return {
      position: "sticky",
      ...(frozen ? { left: frozenOffsets[index] } : { right: 0 }),
      zIndex: header ? 20 : action ? 15 : 10,
      /*
       * A frozen column has to paint itself - the rows it slides over must not show through - so
       * this fill is an inline style, and an inline style is a colour no stylesheet can reach.
       * Written as literal hexes it stayed white while the table behind it went dark, which is why
       * the frozen columns were a bright block down the left of every module's table.
       *
       * These four tokens are the ones globals.css already defines per theme; they were declared
       * for exactly this. The literals stay as fallbacks, so a table rendered where no theme sets
       * them looks precisely as it did before.
       */
      backgroundColor: selected
        ? "var(--employee-table-selected, #eff6ff)"
        : header
          ? "var(--employee-table-header, #f8fafc)"
          : nested
            // The row is a sub-row, so its frozen and action cells take the sub-row's fill rather
            // than the table's - otherwise the tint stops dead at the ⋮ column.
            ? "var(--employee-table-subrow, #eef2f7)"
            : "var(--employee-table-cell, #ffffff)",
      // The divider marks where frozen columns end. The tick box pinned on its own is not a frozen
      // column - it simply stays put - so it wears no divider and reads like any other column.
      // A hairline and a faint shade: the 2px line under a dark blur read as a thick blue bar.
      boxShadow: frozen && index === effectiveFreezeCount - 1 && column.id !== SELECT_COLUMN_ID ? "1px 0 0 var(--employee-table-divider, #e2e8f0), 6px 0 8px -6px rgba(15, 23, 42, 0.12)" : undefined,
    };
  }, [effectiveFreezeCount, frozenOffsets]);

  // `useCallback`, and that matters more than it looks: `DataTableRow` is memo()d and compares
  // these, so a new identity on every render would redraw every row on every render - which is the
  // exact fault the memo exists to remove. The CRM lead board holds its own handlers this way for
  // the same reason.
  // Under `autoLayout` a column that names no width takes none, not the density's floor: the point
  // of sizing to content is that a narrow column is narrow.
  const sizedStyle = useCallback((column) => fixedWidth ? { width: column.getSize(), minWidth: column.getSize(), maxWidth: column.getSize(), boxSizing: "border-box" } : { width: column.columnDef.width, minWidth: column.columnDef.minWidth || (autoLayout ? undefined : scale.minColumnWidth), maxWidth: column.columnDef.maxWidth }, [fixedWidth, autoLayout, scale.minColumnWidth]);

  // A group heading is as wide as the columns under it - the sum of their sizes, not a column's own -
  // and sits above the body's frozen cells (10) as they scroll up under it, below the sticky headers (20).
  const spanStyle = (header) => (fixedWidth ? { width: header.getSize(), minWidth: header.getSize(), maxWidth: header.getSize() } : { width: undefined, minWidth: undefined, maxWidth: undefined });
  /*
   * The sticky header's fill has to be an inline style - it scrolls under nothing and must stay
   * opaque - but a hardcoded hex is a colour no stylesheet can reach, so this header stayed white
   * in the dark themes while the table under it went dark.
   *
   * `--employee-table-header` is the token globals.css already defines per theme; it was declared
   * for exactly this and never wired up. The literal stays as the fallback, so nothing changes for
   * a page that never sets the token.
   */
  const headerStyle = (index, column, top) => ({ position: "sticky", top, zIndex: index < effectiveFreezeCount || column.id === "actions" ? 20 : 5, backgroundColor: "var(--employee-table-header, #f8fafc)", ...sizedStyle(column), ...stickyStyle(index, column, true) });

  /*
   * Everything outside a row that can change what the row draws, as one value.
   *
   * `DataTableRow` compares this rather than TanStack's cell objects, which are rebuilt on every
   * render and would make the memo useless on the one render that matters - the append. Columns are
   * in it because a page's `columns` is a memo of its own: that is how a screen pushes new state
   * into its cells (the Interview register's row menu reads the forms that way), so a new columns
   * identity has to redraw the rows.
   */
  /*
   * Built from a **signature** of the columns rather than from the array TanStack hands back.
   *
   * `getVisibleLeafColumns()` is memoised inside TanStack, but the row memo is worth nothing if
   * that ever returns a fresh array - every row would redraw on every render and the memo would
   * only have added a comparison. A string of the ids and widths cannot do that: it is equal
   * whenever the columns are, whoever built the array.
   *
   * `tableColumns` is in it as well, and that is what carries a *page's* changes into the cells:
   * a screen pushes new state into its rows by rebuilding its `columns` memo, which is how the
   * Interview register's row menu learns that the screening forms have been re-read.
   */
  const columnSignature = leafColumns.map((column) => `${column.id}:${column.getSize()}`).join("|");
  const rowRenderKey = useMemo(
    () => ({ columnSignature, tableColumns, fixedWidth, effectiveFreezeCount, resolvedDensity }),
    [columnSignature, tableColumns, fixedWidth, effectiveFreezeCount, resolvedDensity],
  );

  /*
   * `rowsToExport` is every row the table is showing, or - from the selection bar - only the ticked
   * ones. The same columns, the same cell values and the same file name either way: an export of a
   * selection is the table's export over fewer rows, not a second exporter with its own idea of
   * what a column says.
   */
  async function exportRows(rowsToExport) {
    const originals = (rowsToExport || allRows).map((row) => row.original);
    if (csv.onExport) return csv.onExport({ rows: originals, columns: leafColumns.map((column) => column.columnDef), table });
    const exportColumns = leafColumns.filter((column) => column.id !== "actions" && column.columnDef.exportable !== false).map((column) => ({
      key: column.columnDef.meta?.exportKey || column.id,
      label: columnLabel(column.columnDef),
      value: (row, index) => column.columnDef.exportValue?.(row, index) ?? column.columnDef.accessorFn?.(row, index) ?? row?.[column.columnDef.accessorKey || column.id],
    }));
    // `csv.projectName` files the export in that project's folder under the Target Download Path; a
    // table that belongs to no single project leaves it out and lands in that folder's own
    // Downloads folder.
    const exported = await exportToCsv({ fileName: createExportFileName(csv.fileName || slugify(ariaLabel)), columns: exportColumns, rows: originals, projectName: csv.projectName, folder: csv.folder });
    csv.onResult?.(exported);
  }

  function applyVisibility(next) {
    const fixed = Object.fromEntries(tableLeaves.filter((column) => column.meta?.fixed).map((column) => [column.id, true]));
    saveLayout({ columnVisibility: { ...next, ...fixed } });
    // A sort on a column just hidden is dropped. The page's own sort is the page's to drop.
    // A column hidden while it is the one sorted by stops sorting the rows.
    if (!controlledSort && localSorting.some((item) => next[item.id] === false)) setOwnSorting(localSorting.filter((item) => next[item.id] !== false));
    setVisibleCount(pageSize);
  }

  /*
   * Scrolling reveals the next page of what the table already holds, and - where the page says so -
   * asks for the next page from the server once it runs out.
   *
   * `infiniteScroll.onEndReached` is that ask. Without it a table can only page through rows it was
   * handed, which is right for a register the page loads whole and wrong for one too big to: the
   * Interview register is several thousand candidates, so the page keeps a hundred at a time and
   * fetches the next hundred here.
   *
   * Fired only once the reader has actually reached the end of the rows on screen - not merely the
   * end of the scroll area - or a table showing 100 of 400 held rows would ask the server for more
   * while it still had three pages to reveal for free.
   */
  /*
   * The height of the scroll area, and of one row.
   *
   * Measured rather than assumed: density, a wrapped cell or a theme's line height all move it, and
   * a wrong row height shows up as the window drifting away from what is on screen. Read from the
   * first drawn row, which is why it is taken after paint rather than during render.
   */
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return undefined;
    const measure = () => {
      setViewportHeight((current) => (current === element.clientHeight ? current : element.clientHeight));
      setViewportWidth((current) => (current === element.clientWidth ? current : element.clientWidth));
      const first = bodyRef.current?.querySelector("tr[data-row]");
      if (first) {
        const height = first.offsetHeight;
        setRowHeight((current) => (current === height || !height ? current : height));
        // Where the rows start inside the scroll area - the header sits above them, so scroll
        // position alone would put the window a row or two out.
        const top = bodyRef.current.offsetTop;
        setBodyTop((current) => (current === top ? current : top));
      }
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [resolvedDensity, leafColumns.length, renderedRows.length]);

  /*
   * The reveal that scrolling cannot ask for: a table whose scroller has nothing to scroll - the
   * rows fit, or the panel around it is what scrolls - reveals its next page here instead, until
   * it either overflows or has drawn everything. A layout effect, so a page of rows that still
   * does not overflow is followed by the next before anything is painted short.
   */
  useLayoutEffect(() => {
    if (!infiniteScroll || serverPaged || loading) return;
    const element = scrollRef.current;
    if (!element || renderedRows.length >= allRows.length) return;
    if (element.scrollHeight <= element.clientHeight + 1) setVisibleCount((count) => Math.min(count + pageSize, allRows.length));
  }, [infiniteScroll, serverPaged, loading, renderedRows.length, allRows.length, pageSize]);

  function onScroll(event) {
    const element = event.currentTarget;
    // Windowing reads this while rendering, so it has to be state. Set unconditionally rather than
    // behind `infiniteScroll`, or a table that windows without paging would never redraw.
    setScrollTop(element.scrollTop);
    if (!infiniteScroll) return;
    /*
     * 400px from the bottom, which is the CRM lead board's own trigger: the next page is asked for
     * while there is still most of a screen left to scroll, so it has usually arrived by the time
     * the reader gets there. Asking at the bottom instead is a stall on every page.
     *
     * Cheap to call more than once - the page ignores it while a read is in flight or the set is
     * exhausted, and an append that arrives twice is deduplicated by id.
     */
    if (serverPaged) {
      if (element.scrollHeight - element.scrollTop - element.clientHeight < 400) infiniteScroll.onEndReached();
      return;
    }
    if (element.scrollTop + element.clientHeight >= element.scrollHeight - 120) {
      setVisibleCount((count) => Math.min(count + pageSize, allRows.length));
    }
  }

  const manageableColumns = tableLeaves.filter((column) => !column.meta?.fixed).map((column) => ({ id: column.id, label: columnLabel(column) }));
  const resolvedVisibility = Object.fromEntries(tableLeaves.map((column) => [column.id, effectiveColumnVisibility[column.id] !== false]));
  const resolvedDefaultVisibility = Object.fromEntries(tableLeaves.map((column) => [column.id, column.meta?.backendDynamic ? false : defaultColumnVisibility?.[column.id] !== false]));
  /*
   * Whether this table has been arranged at all, which is what decides if there is anything to
   * undo. Any of the four counts: a table with two columns hidden and none moved still needs the
   * way back.
   */
  const hasCustomLayout = Object.keys(layout).length > 0;
  /*
   * `menuEnabled` answers this for every part of the menu that reads `features` - CSV, visibility,
   * freeze, compact. A custom arrangement is the one part that is not: a table opted fully out of
   * Table Options can still have been dragged into one, and still needs a way back from it.
   *
   * Unless it cannot be dragged either. A table that opts out of both - the small fixed lists
   * embedded in a form, where neither a column order nor an export is anything the reader came for
   * - has no way to *make* an arrangement, so the ⋮ offering to undo one is a control with nothing
   * behind it. A layout stored under that table's name from before it opted out would otherwise
   * bring the menu back for good, which is what it did.
   */
  const showMenu = menuEnabled || (hasCustomLayout && reorderEnabled);

  /*
   * What the selection can be done with, handed to the module header above this table.
   *
   * Held in a ref and called through three stable arrows, the same trick `useTableSelection` uses
   * for its own callbacks: what is published has to be the *same object* while it says the same
   * thing, or publishing it would be a state update on every render. The booleans in the list below
   * are there for that reason too - `onSelectionDelete` is only read for whether it exists.
   */
  const selectionHandlers = useRef(null);
  useEffect(() => {
    selectionHandlers.current = {
      clear: () => resolvedSelection.clear(),
      export: async () => {
        setExportingSelection(true);
        try { await exportRows(selectedTableRows); } finally { setExportingSelection(false); }
      },
      remove: () => { setSelectionReason(""); selectionReasonFields.clearAll(); setPendingSelectionDelete(true); },
    };
  });
  const clearSelection = useCallback(() => selectionHandlers.current?.clear(), []);
  const exportSelection = useCallback(() => selectionHandlers.current?.export(), []);
  const deleteSelection = useCallback(() => selectionHandlers.current?.remove(), []);

  /*
   * How many the bar says. The drawn-and-ticked rows for a table that holds all of them - and for a
   * paged one, what its model answers, because "everything this stage matches" is a number only the
   * page knows and is never the length of what has been scrolled into view.
   */
  const selectionCount = selectable ? (resolvedSelection.count?.() ?? selectedTableRows.length) : 0;
  const deletableSelection = Boolean(onSelectionDelete);
  useSelectionActions(useMemo(() => (selectionCount && publishSelectionActions ? {
    count: selectionCount,
    noun: selectionNoun,
    plural: selectionPlural,
    deleting: selectionDeleting,
    exporting: exportingSelection,
    onClear: clearSelection,
    onExport: csvEnabled && selectionExportable ? exportSelection : undefined,
    onDelete: deletableSelection ? deleteSelection : undefined,
    actions: selectionActions,
  } : null), [selectionCount, publishSelectionActions, selectionNoun, selectionPlural, selectionDeleting, exportingSelection, csvEnabled, selectionExportable, deletableSelection, clearSelection, exportSelection, deleteSelection, selectionActions]));

  return <>
    <div ref={(node) => { scrollRef.current = node; if (scrollerRef) scrollerRef.current = node; }} onScroll={onScroll} className={`h-full min-h-0 min-w-0 flex-1 overflow-auto ${className}`}>
      {/* `min-w-max` under auto layout, so thirty columns sized to their contents grow past the
          viewport and scroll rather than being squeezed into it. */}
      <table id={tableId} aria-label={ariaLabel} className={`border-separate border-spacing-0 text-left text-slate-600 ${scale.table} ${fixedWidth ? "" : autoLayout ? "min-w-max w-full" : "w-full"} ${tableClassName}`} style={fixedWidth ? { width: fillLayout ? "100%" : table.getTotalSize(), minWidth: table.getTotalSize(), tableLayout: "fixed" } : undefined}>
        {fixedWidth && <colgroup>{leafColumns.map((column) => <col key={column.id} style={{ width: column.getSize() }} />)}</colgroup>}
        <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500 sm:text-[11px]">
          {/*
            * One row per level of heading. With no group headings that is the one row of column names
            * it always was; with them, the group row sits above and every row sticks below the one
            * before it - each the height of a header row - so they stack rather than overlap. A group
            * heading spans its columns, centred, and is a label (`scope="colgroup"`, so a screen reader
            * ties the names under it to it): no drag, no resize, no sort, and it is not frozen with the
            * columns under it. The empty cell above an ungrouped column is that column's, and is frozen
            * or pinned right with it.
            */}
          {headerGroups.map((group, groupIndex) => { const leafRow = groupIndex === headerGroups.length - 1; return <tr key={group.id}>{group.headers.map((header, index) => { const heading = !leafRow; const band = heading && !header.isPlaceholder; return <th key={header.id} colSpan={header.colSpan} scope={band ? "colgroup" : undefined} title={band ? columnLabel(header.column.columnDef) : undefined} ref={leafRow ? (node) => { headerCellRefs.current[index] = node; } : undefined} {...(heading ? {} : dragHandlersFor(header.column))} className={`relative ${HEADER_CLIP} border-b border-slate-200 ${scale.headerY} ${heading ? `${scale.headerX} text-center ${band ? "border-x border-x-slate-200 font-semibold text-slate-700" : ""}` : header.column.id === "actions" ? "px-0 text-center text-base normal-case text-slate-400" : scale.headerX} ${!heading && reorderEnabled && !header.column.columnDef.meta?.fixed ? "cursor-grab active:cursor-grabbing" : ""} ${draggingColumnId === header.column.id ? "opacity-40" : ""}`} style={heading ? { ...headerStyle(band ? Number.MAX_SAFE_INTEGER : leafColumns.findIndex((leaf) => leaf.id === header.column.id), header.column, groupIndex * scale.filterRowTop), ...spanStyle(header), ...(band ? { zIndex: 19 } : {}) } : headerStyle(index, header.column, groupIndex * scale.filterRowTop)}>
            {header.isPlaceholder ? null : band ? <span className="block truncate">{flexRender(header.column.columnDef.header, header.getContext())}</span> : header.column.id === "actions" ? (showMenu ? <DataTableMoreMenu onImport={importConfig ? () => setImportOpen(true) : undefined} onExportCsv={csvEnabled ? exportRows : undefined} onExportExcel={excelEnabled ? () => excel.onExport({ table }) : undefined} excelEnabled={excelEnabled && allRows.length > 0} disableExport={!csvEnabled || allRows.length === 0} onManageColumns={visibilityEnabled ? () => setManageColumnsOpen(true) : undefined} onFreezeColumnsChange={onFreezeChange} freezeCount={freezeCount} onResetColumnOrder={hasCustomLayout ? resetLayout : undefined} onToggleCompact={toggleCompact} compact={resolvedDensity === "compact"} menuZIndexClassName={menuZIndexClassName} ariaLabel={`${ariaLabel} options`} /> : <span className="block">{flexRender(header.column.columnDef.header, header.getContext())}</span>) : <div className="flex items-center justify-between gap-1"><span className="flex min-w-0 items-center"><span className="block truncate">{flexRender(header.column.columnDef.header, header.getContext())}</span>{header.column.columnDef.meta?.help && <HelpTip text={header.column.columnDef.meta.help} />}</span>{header.column.getCanSort() && <button type="button" onClick={header.column.getToggleSortingHandler()} aria-label={`Sort ${columnLabel(header.column.columnDef)}`} className={`shrink-0 ${scale.sortToggle} ${header.column.getIsSorted() ? "text-blue-600" : "text-slate-400 hover:text-slate-700"}`}>{header.column.getIsSorted() === "asc" ? "↑" : header.column.getIsSorted() === "desc" ? "↓" : "↕\uFE0E"}</button>}</div>}
            {/* The drop indicator: a bar on whichever edge of the hovered header the pointer is
                closer to, so releasing there reads unambiguously as "before this column" or "after
                it" rather than as a swap. */}
            {dropTarget?.id === header.column.id && <span aria-hidden="true" className={`pointer-events-none absolute inset-y-0 z-40 w-0.5 bg-blue-500 ${dropTarget.side === "before" ? "left-0" : "right-0"}`} />}
            {resizeEnabled && !heading && header.column.getCanResize() && <div aria-hidden="true" draggable={false} onMouseDown={(event) => startResize(header.column, event)} onTouchStart={(event) => startResize(header.column, event)} onClick={(event) => event.stopPropagation()} className="group/resize absolute inset-y-0 right-0 z-30 flex w-3 cursor-col-resize touch-none select-none justify-end"><span className={`h-full w-px transition-colors duration-150 ${resizingId === header.column.id ? "bg-slate-500" : "bg-transparent group-hover/resize:bg-slate-300"}`} /></div>}
          </th>; })}</tr>; })}
          {/*
            * The filter row: a **list to pick from** where the column holds a closed set, and the
            * plain box everywhere else.
            *
            * A text box asks "show me the rows containing this", which is right for a name or a
            * number somebody is typing part of and wrong for a column of a dozen repeated values -
            * reading two people's rows meant filtering to one, reading them, then filtering to the
            * other, and the table could not put them side by side at all. `filterChoices` decides
            * which is which from the values actually loaded, so no module has to declare it and a
            * column stops being a picker by itself the day its values stop being a set.
            */}
          {filtering && <tr>{leafColumns.map((column, index) => <th key={column.id} className={`${FILTER_CLIP} border-b border-slate-200 ${scale.filterY} ${column.id === "actions" ? "px-0" : scale.filterX}`} style={headerStyle(index, column, headerGroups.length * scale.filterRowTop)}>
            {/*
              * What kind of control a column's filter is, where the column says: a calendar for a
              * `date`, a From and a To with their times for a `dateTimeRange` (the column hands it
              * how it writes and reads a time, and which text is not a range yet), a clock for a `time`, a list that still takes typing for a `combobox`. A
              * column that says nothing gets the list where its values are a set and the plain box
              * everywhere else, which is what every table here has always had.
              */}
            {column.getCanFilter() && filterKindFor(column.columnDef) === "dateTimeRange"
              ? <FilterDateInput
                range
                ariaLabel={`Filter ${columnLabel(column.columnDef)}`}
                placeholder={column.columnDef.filterPlaceholder || "From - To"}
                formatRangeEnd={column.columnDef.filterFormatRangeEnd}
                parseRangeEnd={column.columnDef.filterParseRangeEnd}
                invalid={Boolean(column.columnDef.filterIsInvalid?.(column.getFilterValue()))}
                value={typeof column.getFilterValue() === "string" ? column.getFilterValue() : ""}
                onChange={(next) => column.setFilterValue(next)}
              />
              : column.getCanFilter() && filterKindFor(column.columnDef) === "date"
              ? <FilterDateInput ariaLabel={`Filter ${columnLabel(column.columnDef)}`} value={typeof column.getFilterValue() === "string" ? column.getFilterValue() : ""} onChange={(next) => column.setFilterValue(next)} />
              : column.getCanFilter() && filterKindFor(column.columnDef) === "time"
              ? <FilterTimeInput ariaLabel={`Filter ${columnLabel(column.columnDef)}`} value={typeof column.getFilterValue() === "string" ? column.getFilterValue() : ""} onChange={(next) => column.setFilterValue(next)} />
              : column.getCanFilter() && filterKindFor(column.columnDef) === "combobox"
              ? <FilterCombobox
                ariaLabel={`Filter ${columnLabel(column.columnDef)}`}
                options={(filterValues ? filterValues.get(column.id) : filterChoices[column.id]) || column.columnDef.filterOptions || []}
                onOpen={filterValues?.onOpen ? () => filterValues.onOpen(column.id) : undefined}
                loading={filterValues ? filterValues.loading === column.id : false}
                value={typeof column.getFilterValue() === "string" ? column.getFilterValue() : ""}
                onChange={(next) => column.setFilterValue(next)}
              />
              : column.getCanFilter() && ((filterValues?.has?.(column.id) ?? Boolean(filterChoices[column.id]))
              ? <FilterMultiSelect
                ariaLabel={`Filter ${columnLabel(column.columnDef)}`}
                // The server's answer where the page supplies one, and the values derived from the
                // loaded rows otherwise - the two are the same thing on a table that holds them all.
                options={filterValues ? (filterValues.get(column.id) || []) : filterChoices[column.id]}
                // Asked when the menu opens rather than with the page: there is one of these per
                // column, and asking for every column up front would fill menus nobody opened.
                onOpen={filterValues?.onOpen ? () => filterValues.onOpen(column.id) : undefined}
                loading={filterValues ? filterValues.loading === column.id : false}
                values={Array.isArray(column.getFilterValue()) ? column.getFilterValue() : []}
                onChange={(next) => column.setFilterValue(next)}
                placeholder="Filter"
              />
              : <input value={typeof column.getFilterValue() === "string" ? column.getFilterValue() : ""} onChange={(event) => column.setFilterValue(event.target.value)} aria-label={`Filter ${columnLabel(column.columnDef)}`} placeholder="Filter" className={`w-full min-w-0 rounded border border-slate-200 bg-white font-normal text-slate-500 placeholder:text-slate-300 ${scale.filterInput}`} />)}
          </th>)}</tr>}
        </thead>
        <tbody ref={bodyRef}>
          {/* Loading and nothing-to-show span every column, so on a table wider than the screen they
              were centred across all of it - off to the side, found only by scrolling. Each is held
              to the visible width and pinned to the scroller's left edge, so it stays in view
              however far the table is scrolled across. */}
          {loading && <tr><td colSpan={leafColumns.length} className="p-0"><div className="sticky left-0 px-4" style={viewportWidth ? { width: viewportWidth } : undefined}><Loader label={loadingMessage} /></div></td></tr>}
          {!loading && recordCount === 0 && <tr><td colSpan={leafColumns.length} className="p-0"><div className="sticky left-0 px-4 py-10 text-center text-sm text-slate-500" style={viewportWidth ? { width: viewportWidth } : undefined}>{data.length === 0 ? emptyMessage : noMatchMessage}</div></td></tr>}
          {/* The rows above the window, as one spacer of their exact height - so the scrollbar is
              the length it would be if every row were drawn, and the reader's position in it means
              what it says. */}
          {!loading && padTop > 0 && <tr aria-hidden="true"><td colSpan={leafColumns.length} style={{ height: padTop, padding: 0, border: 0 }} /></tr>}
          {!loading && windowRows.map((row) => <DataTableRow
            key={row.id}
            row={row}
            original={row.original}
            selected={rowKey(row) === selectedRowId}
            nested={row.depth > 0}
            /*
             * Everything outside the row that can change what it draws, in one value.
             *
             * The memo below compares this instead of the cell objects, which TanStack rebuilds on
             * every render and which would therefore defeat it. A column added, hidden, resized,
             * reordered or re-created - which is how a page pushes new data into its cells, since
             * `columns` is a memo of its own - changes this and redraws the row.
             */
            renderKey={rowRenderKey}
            scale={scale}
            sizedStyle={sizedStyle}
            stickyStyle={stickyStyle}
            onRowClick={onRowClick}
            onRowDoubleClick={onRowDoubleClick}
            onRowContextMenu={onRowContextMenu}
            hoverClassName={rowHoverClassName}
            focusable={focusableRows}
          />)}
          {!loading && padBottom > 0 && <tr aria-hidden="true"><td colSpan={leafColumns.length} style={{ height: padBottom, padding: 0, border: 0 }} /></tr>}
          {!loading && renderedRows.length < allRows.length && <tr><td colSpan={leafColumns.length} className="px-4 py-2 text-center text-xs text-slate-400">Scroll to load more…</td></tr>}
        </tbody>
      </table>
    </div>

    {/* Asked once over the whole set rather than per row. `selectedTableRows` is read again at the
        moment of confirming, not captured when the dialog opened, so a row that arrived or left
        behind the dialog is counted as it actually is. */}
    {pendingSelectionDelete && <ConfirmDialog
      title={`Delete ${selectedTableRows.length} ${selectedTableRows.length === 1 ? selectionNoun : selectionPlural || `${selectionNoun}s`}?`}
      message={selectionDeleteMessage}
      confirmLabel="Delete"
      busyLabel="Deleting…"
      loading={selectionDeleting}
      onCancel={() => { if (!selectionDeleting) setPendingSelectionDelete(false); }}
      onConfirm={async () => {
        if (selectionRequiresReason && !selectionReasonFields.check({ reason: selectionReason.trim() ? "" : "Enter a reason." })) return;
        await onSelectionDelete(selectedTableRows.map((row) => row.original), selectionRequiresReason ? selectionReason.trim() : undefined);
        setPendingSelectionDelete(false);
      }}
    >
      {selectionRequiresReason && <TextAreaField
        required
        label={selectionReasonLabel}
        value={selectionReason}
        onChange={(event) => { setSelectionReason(event.target.value); selectionReasonFields.clear("reason"); }}
        error={selectionReasonFields.errors.reason}
        disabled={selectionDeleting}
        rows={4}
      />}
    </ConfirmDialog>}
    {visibilityEnabled && manageColumnsOpen && <ManageColumnsDialog open columns={manageableColumns} visibility={resolvedVisibility} defaultVisibility={resolvedDefaultVisibility} onClose={() => setManageColumnsOpen(false)} onApply={applyVisibility} />}
    {/* Rendered only while open, so a reopened dialog is a fresh mount and the last file's verdict
        does not greet the next import. */}
    {importConfig && importOpen && <ImportDialog
      onClose={() => setImportOpen(false)}
      title={importConfig.title || "Import"}
      columns={importConfig.columns || []}
      templateName={importConfig.templateName || "import-template"}
      hints={importConfig.hints || []}
      onImportChunk={(chunk) => importTableRows(importConfig.prefix, chunk).then((answer) => answer?.data || answer)}
      onImported={importConfig.onImported}
    />}
  </>;
}
