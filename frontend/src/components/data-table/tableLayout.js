/*
 * How a table's arrangement is named and how it is applied - the parts with no React in them.
 *
 * Split out of `DataTable` for the same reason `dragEdgeScroll` was: these are the rules worth
 * being sure of, and they can be checked here without rendering a table or standing up a browser.
 */

// A table's aria label doubles as the name of what it exports and as the key its arrangement is
// remembered under: the same words that name it to a screen reader name its CSV file when the
// table gives no file name of its own, and name the preference `tableLayoutKey` builds below.
// `columnOrderKey` overrides the second use for the rare table sharing a label with another, or
// one page reusing a single DataTable for two logically different tables.
export const slugify = (text) => String(text || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "table";

/*
 * Where a table remembers how it was arranged: the order its columns were dragged into, which of
 * them were hidden, how many were frozen, and how wide they were pulled.
 *
 * All four used to be separate - the order in `localStorage`, the other three in component state
 * that did not survive a reload at all. They are one value under one key now because they are one
 * decision: somebody arranging a table moves a column, hides two more and freezes the first, and
 * losing three quarters of that on refresh made the other quarter not worth doing.
 *
 * The key is namespaced so `PreferencesProvider` can keep it beside the density and the remembered
 * tabs, and so it travels with the login rather than the browser - the arrangement built at the
 * desk is waiting on the laptop. See that file for how it is cached and saved.
 */
export const tableLayoutKey = (slug) => `table:${slug}`;

/**
 * The order actually drawn: the stored order laid over whatever columns the table has right now.
 *
 * A fixed column - the row's expand chevron, its own ⋮ actions - never moves, so its slot in the
 * table's own column list is left alone here and only the columns around it are put in the order
 * last dragged. One the stored order does not name - added to the table since the reader last
 * arranged it - lands after the ones it does name, rather than at the front of a layout chosen on
 * purpose or being silently dropped.
 */
export function weaveColumnOrder(tableColumns, storedOrder) {
  const baseIds = tableColumns.map((column) => column.id);
  if (!storedOrder?.length) return baseIds;
  const fixedIds = new Set(tableColumns.filter((column) => column.meta?.fixed).map((column) => column.id));
  const draggableIds = baseIds.filter((id) => !fixedIds.has(id));
  // Deduplicated, not just filtered. A repeated id draws that column twice and, because the slots
  // are filled in order, silently drops the last column of the table - which reads as data missing
  // from the screen rather than as a layout fault. It could not happen while this was written and
  // read by the same browser; it can now, because the order arrives from the server and may have
  // been saved by an older release or left in a stale cache.
  const known = [...new Set(storedOrder.filter((id) => draggableIds.includes(id)))];
  const missing = draggableIds.filter((id) => !known.includes(id));
  const ordered = [...known, ...missing];
  let cursor = 0;
  return baseIds.map((id) => fixedIds.has(id) ? id : ordered[cursor++]);
}

/**
 * One column moved to either side of another, as a drag does it.
 *
 * Here rather than in `DataTable` because the stored order it produces is read back by
 * `weaveColumnOrder` directly above - a rule and its inverse belong together. (Two tables used to
 * write this array - `DataTable` through TanStack's column order and the CRM board through a hook
 * of its own - which is why it was worth naming once; the board draws through `DataTable` now.)
 *
 * `side` is which edge of `targetId` the pointer was nearer when it was released, so a drop reads
 * as "before this column" or "after it" rather than as a swap - dropping A after B and dropping B
 * before A are different arrangements, and a swap can express neither.
 *
 * The source is removed *before* the target is located, so dragging a column rightwards lands it
 * where the reader saw the drop bar: with the source still in place every index beyond it is one
 * too high, and the column arrives one short of where it was dropped.
 */
export function reorderColumnOrder(order, sourceId, targetId, side) {
  const current = Array.isArray(order) ? order : [];
  if (!sourceId || sourceId === targetId) return current;
  const next = current.filter((id) => id !== sourceId);
  let index = next.indexOf(targetId);
  // A target the order does not name is not a drop this can honour, and guessing at a position
  // would rearrange columns the reader never touched.
  if (index === -1) return current;
  if (side === "after") index += 1;
  next.splice(index, 0, sourceId);
  return next;
}

/**
 * The id of the chevron column a table with sub-rows carries in front of everything else.
 *
 * Declared here rather than only in `DataTable` because the freeze arithmetic below is about it,
 * and a string two modules compare on belongs where both can read it.
 */
export const EXPAND_COLUMN_ID = "__expand";

/**
 * The id of the tick-box column a table with a selection carries in front of everything else.
 *
 * Here beside the chevron's for the same two reasons: the freeze arithmetic below is about both, and
 * a string two files compare on belongs where both can read it.
 */
export const SELECT_COLUMN_ID = "__select";

/*
 * The structural columns that lead a table: the tick box first, then the chevron. Neither is a
 * column of the data - they are the row's own controls - so neither is counted by Freeze Columns,
 * dragged, hidden or exported.
 */
export const LEADING_COLUMN_IDS = [SELECT_COLUMN_ID, EXPAND_COLUMN_ID];

/**
 * How many leaf columns to actually pin, for a reader who asked to pin `freezeCount` of them.
 *
 * **The chevron is not one of them, and neither is the tick box.** `DataTable` puts a real 34px
 * expand column at index 0 of every expandable table and a 40px tick-box column in front of every
 * selectable one, so a count taken straight off the leaf columns froze one of those and called it a
 * column - and the first column anybody can read only pinned on the second notch. Both are still
 * always frozen when anything is, because each belongs to its row: a chevron that scrolled away from
 * the row it opens is worse than one that never pinned, and a tick box that scrolled away from the
 * row it selects is the same fault with a bulk delete behind it. They are frozen *with* the first
 * column rather than *as* it.
 *
 * Structural leading columns are counted from the front and stop at the first real one - see
 * `LEADING_COLUMN_IDS` - so a table with neither is unaffected, a table with both counts both, and
 * this stays correct if another ever leads.
 */
export function effectiveFreezeCount(columns, freezeCount) {
  const total = Array.isArray(columns) ? columns.length : 0;
  const wanted = Math.max(0, Number(freezeCount) || 0);
  if (!wanted || !total) return 0;
  let leading = 0;
  while (leading < total && LEADING_COLUMN_IDS.includes(columns[leading]?.id)) leading += 1;
  return Math.min(wanted + leading, total);
}

/*
 * ── What keeps a cell's content inside its column ─────────────────────────────────────────────
 *
 * Three utilities that only work as a set, which is exactly why they are named here rather than
 * typed out at each table: `whitespace-nowrap` stops the text wrapping, and once it cannot wrap it
 * has to be clipped, or it simply draws over whatever is beside it.
 *
 * The Leads & Followups board had the first without the other two. On a table whose columns have
 * been resized - `table-fixed`, so a column is the width it was pulled to rather than the width of
 * its contents - a long remark ran straight across the Source column and out past the right-hand
 * edge of the table. It read as data belonging to the wrong row, which is the worst way for a table
 * to be wrong, and it only appeared once somebody had dragged a column, so most people never saw it.
 *
 * `DataTable` had it right and the board was a second copy that did not. Naming the rule in one
 * place is what stops that particular divergence happening again: the two tables are still separate
 * components, but they can no longer disagree about this.
 *
 * `text-ellipsis` earns its place by saying so - a clipped cell ends in "..." rather than in a word
 * cut in half, which is the difference between "there is more here" and "this is the value".
 * Whatever is clipped should also be readable, so both tables put the full text in the cell's
 * `title`.
 */
export const CELL_CLIP = "overflow-hidden text-ellipsis whitespace-nowrap";

/*
 * A heading is clipped the same way but never ellipsised: it is a label the reader already knows,
 * and it carries the sort control and the resize grip, which must stay put at any column width.
 */
export const HEADER_CLIP = "overflow-hidden whitespace-nowrap";

/*
 * The filter row clips without touching wrapping - each cell holds one input that is already
 * `w-full`, so there is nothing to wrap, and the clip is what keeps a date picker's button inside a
 * column narrower than it is.
 */
export const FILTER_CLIP = "overflow-hidden";
