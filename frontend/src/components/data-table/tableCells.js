"use client";

import Image from "next/image";

/**
 * How a table cell reads, and how it sorts, decided once for every module table rather than copied
 * into each of them. A column says what `type` it is and these do the rest.
 *
 * Types: `date`, `boolean`, `amount` for money, `number` for a plain figure, `round` for a count read
 * as "Round 2", `image` for a link to a picture, `status` for a coloured dot beside the label, and
 * anything else for plain text.
 */

export const formatTableDate = (value) => value ? new Intl.DateTimeFormat("en-GB").format(new Date(value)) : "—";

export const formatAmount = (value) => value === null || value === undefined || value === ""
  ? "—"
  : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Number(value));

/** The text of a cell — also what a filter matches on and what the CSV export carries. */
export function displayValue(value, type) {
  if (type === "date") return formatTableDate(value);
  /*
   * A **day**, as the record wrote it down.
   *
   * `date` is an instant - a `created_at` - and is reformatted for reading. A day is not: it is
   * already text in the register's own shape, put there by a form, a sheet or an import, and
   * passing it through `new Date()` to print it again is how a day west of Greenwich becomes the
   * day before. So it is shown exactly as stored; what the type is *for* is the two questions
   * below - a day is never a set to pick from, and it sorts as a date rather than as a word.
   */
  if (type === "day") return value === null || value === undefined || value === "" ? "—" : String(value);
  if (type === "boolean") return value == null ? "—" : value ? "Yes" : "No";
  if (type === "amount") return formatAmount(value);
  /*
   * A count of rounds, read as the round it makes: 2 is "Round 2", and **nothing** is "—" rather
   * than "Round 0", because a candidate nobody has called yet is not on a round.
   *
   * Here rather than in the cell, so the word, what a filter matches on and what the CSV carries
   * are the one answer - a column reading "Round 2" that a search for "round" could not find would
   * be the cell and the filter disagreeing about what the column says.
   */
  if (type === "round") return Number(value) > 0 ? `Round ${value}` : "—";
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

export function sortableValue(value, type) {
  if (value === null || value === undefined || value === "") return "";
  if (type === "date") { const date = new Date(value); return Number.isNaN(date.getTime()) ? 0 : date.getTime(); }
  // `YYYY-MM-DD` already sorts correctly as text, and anything else a register holds sorts beside
  // it rather than being thrown to 0 by a parse that was never going to succeed.
  if (type === "day") return String(value);
  if (type === "number" || type === "amount" || type === "round") return Number(value) || 0;
  return String(value).toLocaleLowerCase();
}

/** Sorts numerically when both sides are numbers and alphabetically otherwise. */
export const sortingFnFor = (type) => (first, second, columnId) => {
  const a = sortableValue(first.getValue(columnId), type);
  const b = sortableValue(second.getValue(columnId), type);
  return typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true });
};

/**
 * How a column filters, by what the filter is holding.
 *
 * A **string** is the question the filter row has always asked - "show me the rows that contain
 * this" - which is right for a name or a number somebody is typing part of.
 *
 * A **list** is the other question, and it is an exact match on any of them rather than a substring
 * of each: the list is built from the values the column actually holds, so "Bala" chosen from it
 * means that value and not every value containing "Bala". Matching on `displayValue` for both, so
 * what a filter compares is what the cell shows - a date filters as "01/09/2026" the way it reads.
 */
export const filterFnFor = (type) => (row, columnId, query) => {
  const shown = displayValue(row.getValue(columnId), type);
  if (Array.isArray(query)) return query.length === 0 || query.includes(shown);
  return shown.toLowerCase().includes(String(query || "").toLowerCase());
};

/**
 * The distinct values a column holds, for the filter row to offer - or `null` where there are too
 * many for a list to be the right control.
 *
 * Bailing out at `limit` rather than counting them all is what keeps this cheap on a board of ten
 * thousand leads: a Name column is abandoned after 40 rows, not read to the end and then discarded.
 * `null` is the answer the filter row reads as "keep the text box", which is the honest control for
 * a column whose values are unbounded.
 */
export function distinctFilterValues(rows, accessorKey, type, limit = 40) {
  // A date, a day, a link and a picture are not a set anybody picks from: the first two are a
  // range, the others are one per row by their nature.
  //
  // A day used to have no type at all, so a column of them was offered as a **dropdown** wherever a
  // page happened to hold fewer than forty distinct dates - a menu of days to tick, where what
  // anybody wants is to type one.
  if (type === "date" || type === "day" || type === "link" || type === "image") return null;
  const seen = new Set();
  for (const row of rows || []) {
    const shown = displayValue(row?.[accessorKey], type);
    if (shown === "—") continue;
    seen.add(shown);
    if (seen.size > limit) return null;
  }
  return seen.size ? [...seen].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) : null;
}

/**
 * What to call a stored file in a cell: the name the URL ends with, or "Open" where it carries none
 * - a data URI from a local server with no bucket configured, for instance. Truncated in the cell by
 * CSS rather than here, so a filter still matches the whole name.
 */
function fileLabelFor(value) {
  const url = String(value || "");
  try {
    const name = decodeURIComponent(new URL(url, "https://example.invalid").pathname.split("/").filter(Boolean).pop() || "");
    return name || "Open";
  } catch {
    return "Open";
  }
}

/**
 * What a cell draws. A status carries its module's own colours, since "Active" means something
 * different per module; everything else looks the same everywhere.
 */
export function TableCellValue({ value, type, statusStyles = {} }) {
  if (type === "status") return <span className="flex min-w-0 items-center gap-2"><span className={`h-2 w-2 shrink-0 rounded-full ${statusStyles[value] || "bg-slate-400"}`} /><span className="truncate">{displayValue(value)}</span></span>;
  // A link to a picture says nothing in a cell, so the cell shows the picture. The link is still
  // what a filter matches on and what the CSV export carries.
  if (type === "image") return value ? <Image src={value} alt="" width={28} height={28} unoptimized className="h-7 w-7 rounded border border-slate-200 object-cover" /> : "—";
  // A stored file: the cell offers the file rather than printing the URL that reaches it, which is
  // 200 characters of bucket path nobody reads. The name is the file's own where the URL carries
  // one. `noreferrer` as well as `noopener`, since the target is a bucket rather than our own page.
  if (type === "link") return value
    ? <a href={value} target="_blank" rel="noopener noreferrer" className="truncate text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900" onClick={(event) => event.stopPropagation()}>{fileLabelFor(value)}</a>
    : "—";
  return displayValue(value, type);
}

/**
 * The columns a module table is made of: a serial number, one per field, and the row menu. `fields`
 * are `[key, header, type, size, minSize]` tuples.
 */
/**
 * The row-actions column every table ends with — 56px, the same width CRM's `w-14` actions cell
 * uses, and DataTable already draws this column with `px-0 text-center` so the ⋮ sits centred in
 * exactly that width.
 *
 * Both pairs of size keys are set on purpose. DataTable reads `size`/`minSize` only when column
 * resizing is on, and `width`/`minWidth`/`maxWidth` otherwise — and a column with neither falls
 * back to `minColumnWidth`, which is 160px and leaves the ⋮ adrift in a column three times wider
 * than it needs.
 *
 * Spread it and add a `cell`, or leave the cell to DataTable's `renderActions`.
 */
export const ACTIONS_COLUMN = {
  id: "actions",
  header: "⋮",
  size: 56,
  minSize: 56,
  width: 56,
  minWidth: 56,
  maxWidth: 56,
  enableResizing: false,
  enableSorting: false,
  enableColumnFilter: false,
  meta: { fixed: true },
};

/**
 * The columns a table draws, from a plain list of fields.
 *
 * Deliberately takes **no rows**. It used to, for one thing: the serial column's export value was
 * `rows.indexOf(row)`, which searched the list for the row it had just been handed. That cost twice
 * over - quadratic on export, and, far worse, it made every caller's `columns` memo depend on its
 * data. A screen that appends rows as it scrolls then rebuilt every column definition on every
 * page, and the table rebuilt itself around them; at six or seven hundred rows that is the lag a
 * reader feels as the scroll giving out. The exporter passes the index instead.
 */
export function buildTableColumns({ fields, startIndex = 0, statusStyles, renderActions, actionsAriaLabel }) {
  return [
    { id: "serial", accessorFn: (_, index) => startIndex + index + 1, header: "Sl. No.", size: 80, minSize: 80, meta: { type: "number", exportKey: "serial" }, exportValue: (_row, index) => startIndex + index + 1 },
    ...fields.map(([accessorKey, header, type, size, minSize]) => ({
      accessorKey,
      header,
      size: size || 190,
      minSize: minSize || 130,
      meta: { type, exportKey: accessorKey },
      exportValue: (row) => displayValue(row[accessorKey], type),
      filterFn: filterFnFor(type),
      sortingFn: sortingFnFor(type),
      cell: ({ getValue }) => <TableCellValue value={getValue()} type={type} statusStyles={statusStyles} />,
    })),
    // No `renderActions` means no actions column at all, rather than an empty ⋮ down the side or a
    // call into `undefined`. A table whose every row action needs READ_WRITE passes nothing here
    // when the viewer holds only READ.
    ...(renderActions ? [{ ...ACTIONS_COLUMN, cell: ({ row }) => renderActions(row.original, row.index, actionsAriaLabel) }] : []),
  ];
}

/** Every column visible until Manage Columns says otherwise. */
export const defaultVisibilityFor = (fields) => Object.fromEntries([["serial", true], ...fields.map(([id]) => [id, true]), ["actions", true]]);
