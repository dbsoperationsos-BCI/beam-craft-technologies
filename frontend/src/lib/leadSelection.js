/**
 * Selection state for a table that only holds the pages scrolled into view.
 *
 * `allMatching` means every lead the current branch, tab and filters match is selected, and
 * `ids` then holds the exceptions the user has un-ticked. That inversion is what lets a row
 * fetched later arrive already ticked, and it keeps the state small: selecting a branch of
 * 40,000 leads is one boolean, not 40,000 strings.
 *
 * With `allMatching` false, `ids` is the ordinary set of picked leads.
 */

export function emptySelection() {
  return { allMatching: false, ids: new Set() };
}

export function isSelected(selection, id) {
  return selection.allMatching ? !selection.ids.has(id) : selection.ids.has(id);
}

// `total` is the number of leads the current filters match on the server, not the number
// loaded, so the count covers rows that have never been rendered.
export function countSelected(selection, total) {
  return selection.allMatching ? Math.max(0, total - selection.ids.size) : selection.ids.size;
}

// Selects everything the filters match, or clears when anything is already selected.
export function toggleAll(selection, total) {
  return countSelected(selection, total) > 0 ? emptySelection() : { allMatching: true, ids: new Set() };
}

// Adds to the picked set, or to the exception set when everything is selected - one toggle
// serves both, because `ids` means the opposite thing in each mode.
export function toggleOne(selection, id) {
  const ids = new Set(selection.ids);
  if (ids.has(id)) ids.delete(id);
  else ids.add(id);
  return { ...selection, ids };
}

// Ticked only when the whole matching set is in; mixed while any subset is.
export function headerState(selection, total) {
  const count = countSelected(selection, total);
  const checked = selection.allMatching && selection.ids.size === 0;
  return { checked, indeterminate: !checked && count > 0, count };
}
