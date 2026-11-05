/**
 * How a CRM-style table reads, filters and sorts a column.
 *
 * A column is a plain object: `value` is what the cell shows and what the CSV carries, `match`
 * is what a filter is tested against, and `sort` is what the arrows order by. Only `value` is
 * required - the other two fall back to it, which is right for a plain text column.
 *
 * `filter` picks the control the filter row puts under the heading: "choice" for a column
 * whose values come from a known list, "date" for one the calendar can pick, and a plain text
 * box for everything else. A choice column names its list in `options`, derives it from the
 * rows with `optionsFrom`, or does both with `includeRowValues`.
 *
 * Shared so every table built on the CRM's components behaves the same way, rather than each
 * page reimplementing the same four functions slightly differently.
 */

export function columnValue(column, row) {
  return column.value(row) || "";
}

export function columnMatchText(column, row) {
  return String(column.match ? column.match(row) : columnValue(column, row)).toLowerCase();
}

export function columnSortKey(column, row) {
  return column.sort ? column.sort(row) : columnValue(column, row).toLowerCase();
}

/**
 * The list a choice filter offers.
 *
 * A named list is used as it stands. `includeRowValues` appends anything a row holds that the
 * named list does not, so a value that has since been retired can still be picked off a row
 * that carries it. `optionsFrom` builds the list from the rows alone, for a column like
 * Project Name where there is no fixed set to name.
 *
 * The rows passed in should be the page's rows *before* the column filters run - a filter
 * that narrowed its own list would lose every option the moment one was picked.
 */
export function columnFilterOptions(column, rows) {
  const named = column.options || [];
  if (!column.optionsFrom && !column.includeRowValues) return named;

  const seen = new Set(named);
  const fromRows = [];
  for (const row of rows) {
    const value = columnValue(column, row);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    fromRows.push(value);
  }
  return [...named, ...fromRows.sort((left, right) => left.localeCompare(right))];
}

// Every choice column's list, keyed by column id, so a filter row can look one up per cell
// without rebuilding it each time.
export function buildFilterOptions(columns, rows) {
  return Object.fromEntries(
    columns
      .filter((column) => column.filter === "choice")
      .map((column) => [column.id, columnFilterOptions(column, rows)]),
  );
}

/**
 * Rows narrowed by the active column filters and put in the sorted order.
 *
 * A filter matches on a substring, case-insensitively, which is what makes a typed partial
 * like "2026-08" work the same as a value picked off a list.
 */
export function applyFiltersAndSort(rows, columns, filters, sort) {
  const active = Object.entries(filters || {}).filter(([, value]) => String(value || "").trim());
  const filtered = rows.filter((row) => active.every(([columnId, value]) => {
    const column = columns.find((item) => item.id === columnId);
    if (!column) return true;
    return columnMatchText(column, row).includes(String(value).trim().toLowerCase());
  }));

  const column = columns.find((item) => item.id === sort?.id);
  if (!column) return filtered;
  const direction = sort.direction === "asc" ? 1 : -1;
  return filtered.slice().sort((left, right) => {
    const a = columnSortKey(column, left);
    const b = columnSortKey(column, right);
    if (a === b) return 0;
    return (a > b ? 1 : -1) * direction;
  });
}
