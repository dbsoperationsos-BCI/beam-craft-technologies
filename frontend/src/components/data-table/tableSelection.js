/*
 * Which rows of a table are ticked, as three rules with no React in them.
 *
 * Split out of `DataTable` for the reason `tableLayout` was: these are the parts worth being sure
 * of, and they can be checked without rendering a table or standing up a browser.
 *
 * ── Why this is not `lib/leadSelection.js` ──
 *
 * The CRM board holds only the pages scrolled into view, so its select-all cannot be a list of ids:
 * it is an `allMatching` flag with the un-ticked rows as exceptions, and resolving it into ids means
 * asking the server. That inversion is right for a board of forty thousand leads fetched a page at a
 * time, and it is the wrong shape for every table that already holds all of its rows - which is what
 * `DataTable` is. Here the ticked set is simply a set of ids, and "select all" means the rows the
 * table is *currently showing*: the tab, the filters and the search the reader has applied.
 *
 * That is also why the visible ids are passed in rather than the whole data array. `DataTable` knows
 * which rows survived its own column filters; the page above it does not.
 */

/**
 * The header box's state, read against the rows on screen.
 *
 * Ticked only when every visible row is in, mixed while any of them is. A table showing nothing -
 * a filter that matched no rows - is neither: a box offering to select all of nothing would tick
 * itself and select nothing, which reads as the table having lost the selection.
 */
export function selectionHeaderState(selectedIds, visibleIds) {
  const ids = Array.isArray(visibleIds) ? visibleIds : [];
  const selected = ids.filter((id) => selectedIds?.has(id)).length;
  const checked = ids.length > 0 && selected === ids.length;
  return { checked, indeterminate: !checked && selected > 0, count: selected };
}

/**
 * The header box, pressed: everything on screen ticked, or - if anything already is - cleared.
 *
 * Clearing on a partial selection rather than completing it is the CRM board's own rule, and the one
 * a second press is asking for: somebody who has ticked three rows and presses the header wants to
 * start again far more often than they want the other forty added.
 *
 * Rows **not** on screen keep whatever they had. A stage filtered out of view is not a stage the
 * reader has just decided about, and dropping its ticks would quietly shrink a selection made before
 * the filter was typed.
 */
export function toggleAllIds(selectedIds, visibleIds) {
  const ids = Array.isArray(visibleIds) ? visibleIds : [];
  const next = new Set(selectedIds || []);
  const { count } = selectionHeaderState(next, ids);
  if (count > 0) ids.forEach((id) => next.delete(id));
  else ids.forEach((id) => next.add(id));
  return next;
}

/** One row's box, pressed. */
export function toggleId(selectedIds, id) {
  const next = new Set(selectedIds || []);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * The ticked ids that are still rows of this table, in the order the table holds them.
 *
 * What an action over a selection actually runs against. A selection survives a re-read of the
 * register - the rows come back with the same ids - but not a row that has since been deleted, and
 * handing those to a bulk route would count refusals nobody caused.
 */
export function selectedFrom(selectedIds, rows, rowId) {
  return (Array.isArray(rows) ? rows : []).filter((row) => selectedIds?.has(rowId(row)));
}
