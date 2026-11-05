"use client";

import Image from "next/image";
import { ViewableImage } from "@/components/shared/ImageViewer";
import { matchesWordChunks } from "@/lib/wordChunks.mjs";

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
// Typed text is Word Chunk Search (`matchesWordChunks`, every chunk typed), except on a date or day: "12 Oct"
// there means that date, not every 12th and every October, so it stays one phrase.
export const filterFnFor = (type) => (row, columnId, query) => {
  const shown = displayValue(row.getValue(columnId), type);
  if (Array.isArray(query)) return query.length === 0 || query.includes(shown) || listParts(shown).some((part) => query.includes(part));
  return matchesWordChunks(shown, query);
  if (type === "date" || type === "day") return shown.toLowerCase().includes(String(query || "").toLowerCase());
};

/**
 * The separate answers in a cell that holds several - "Management, Sales" is two departments, not
 * a third one called that. The dropdown lists each once, and ticking "Management" finds everybody
 * whose cell names it, alone or beside others. Split on a comma **and a space**, as a list is
 * written (`displayBackendValue` joins an array that way), so "1,000" stays one number.
 */
export const listParts = (shown) => String(shown).split(/,\s+/).map((part) => part.trim()).filter((part) => part && part !== "—");

/**
 * The rows a column needs before its values are evidence of anything.
 *
 * Under this, every value trivially differs - three employees in three departments - and the test
 * below would take a real category column for an identifier. Eight is enough to tell the two apart
 * and small enough that a list of eight is no hardship either way.
 */
const IDENTITY_MIN_ROWS = 8;
/**
 * How nearly one-per-row a column has to be to read as an identifier rather than a set. Nine in ten
 * rather than every one: two people sharing a surname, or one duplicated phone number, must not turn
 * a column of names back into a menu of names.
 */
const IDENTITY_SHARE = 0.9;

/**
 * The distinct values a column holds, for the filter row to offer - or `null` where a list is not
 * the right control.
 *
 * Two reasons it answers `null`. **Too many** - more than `limit` - and bailing out there rather
 * than counting them all is what keeps this cheap on a board of ten thousand leads: a Name column is
 * abandoned after 40 rows, not read to the end and then discarded.
 *
 * And **one value per row**, which is an identifier, not a set: an Employee ID, an Event ID, a phone
 * number, an email address, an account number. A list of those is a list of every row, which answers
 * nothing somebody would ask it - what they want is to type the one they are looking for. Judged on
 * the rows loaded, so it holds whatever the table is, and that is the point: the cap alone made the
 * control depend on how big the studio had grown. A column of 20 employee IDs was offered as a menu
 * of 20 IDs in a studio of 20 and as a text box in a studio of 41 - the same screen, the same code,
 * a different shape, flipping silently at the 41st hire.
 *
 * `null` is the answer the filter row reads as "keep the text box". A column that knows better than
 * either rule says so itself - `filter: "text"`, or the `listFilters` allow-list in
 * `buildTableColumns` - and this is never asked.
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
  // Rows that actually hold something: a column twelve people filled in is judged on those twelve,
  // not on the three hundred who left it empty.
  let filled = 0;
  for (const row of rows || []) {
    const shown = displayValue(row?.[accessorKey], type);
    if (shown === "—") continue;
    filled += 1;
    for (const part of listParts(shown)) seen.add(part);
    if (seen.size > limit) return null;
  }
  if (!seen.size) return null;
  if (filled >= IDENTITY_MIN_ROWS && seen.size >= filled * IDENTITY_SHARE) return null;
  return [...seen].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/**
 * **Known-value columns** - a column whose answers come from a list the studio already keeps, so its
 * filter is always a dropdown of that list, whatever the rows on screen happen to hold.
 *
 * `distinctFilterValues` above judges a column by its loaded rows, and a known column fails it in
 * exactly the cases somebody filters most: an empty or nearly empty table (nothing to list), a
 * big one (past the cap), or few rows each in a different branch (read as an identifier). Its
 * answers are known regardless, so it does not guess.
 *
 * A column is known when it says so - `meta.filterOptions`, a list of the values it can hold (a
 * status column built by `buildTableColumns` carries its module's statuses) - or when its key or
 * heading names one of the studio's reference lists (`KNOWN_LISTS`): a branch, a department or a
 * vertical, whose names come from master data (`useKnownFilterLists`). `filter: "text"` still
 * keeps the typed box.
 */
export const KNOWN_LISTS = [
  { kind: "branches", pattern: /branch/i },
  { kind: "departments", pattern: /department/i },
  { kind: "verticals", pattern: /vertical/i },
];

/** Which reference list a column's values come from, if any - read off its key, then its heading. */
export function knownListFor(column) {
  if (column?.meta?.knownList) return column.meta.knownList;
  const names = [column?.accessorKey, typeof column?.header === "string" ? column.header : ""].filter(Boolean);
  return KNOWN_LISTS.find((entry) => names.some((name) => entry.pattern.test(name)))?.kind || null;
}

/**
 * The options a known column's dropdown offers: its own list, the reference list it names, and any
 * value the rows hold beyond both (a branch since renamed, a status from before a rename) - so
 * nothing on screen is ever unreachable from its own filter. A cell naming several ("Management,
 * Sales") offers each on its own (`listParts`). Sorted, without repeats.
 */
export function knownFilterValues(rows, accessorKey, type, lists = []) {
  const seen = new Set();
  for (const list of lists) for (const value of list || []) if (String(value || "").trim()) seen.add(String(value).trim());
  for (const row of rows || []) {
    const shown = displayValue(row?.[accessorKey], type);
    if (shown !== "—") for (const part of listParts(shown)) seen.add(part);
  }
  return [...seen].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
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
 * different per module; everything else looks the same everywhere. `statusLabel` words a status
 * differently from the value its colour is keyed by - "Active (Serving Notice)" in Active's colour.
 */
export function TableCellValue({ value, type, statusStyles = {}, linkLabel = "", statusLabel = "" }) {
  if (type === "status") return <span className="flex min-w-0 items-center gap-2"><span className={`h-2 w-2 shrink-0 rounded-full ${statusStyles[value] || "bg-slate-400"}`} /><span className="truncate">{statusLabel || displayValue(value)}</span></span>;
  // A link to a picture says nothing in a cell, so the cell shows the picture. The link is still
  // what a filter matches on and what the CSV export carries.
  // A press on the thumbnail opens it in the viewer and does not also open the row.
  if (type === "image") return value ? <ViewableImage images={[value]} label="View image" className="rounded"><Image src={value} alt="" width={28} height={28} unoptimized className="h-7 w-7 rounded border border-slate-200 object-cover" /></ViewableImage> : "—";
  // A stored file: the cell offers the file rather than printing the URL that reaches it, which is
  // 200 characters of bucket path nobody reads. The name is the file's own where the URL carries
  // one. `noreferrer` as well as `noopener`, since the target is a bucket rather than our own page.
  // `linkLabel` names a link that is not a file - "View on map" rather than a host and a query.
  // Blue rather than sky: the dark themes lift `text-blue-*` to their light accent (globals.css), so
  // a link reads on a dark table as it does on a light one.
  if (type === "link") return value
    ? <a href={value} target="_blank" rel="noopener noreferrer" className="truncate font-medium text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-800" onClick={(event) => event.stopPropagation()}>{linkLabel || fileLabelFor(value)}</a>
    : "—";
  return displayValue(value, type);
}

/**
 * The columns a module table is made of: one per field, and the row menu. `fields` are
 * `[key, header, type, size, minSize]` tuples. No table carries a serial number: it counts positions
 * on a page rather than describing the row, and renumbers itself whenever the table is sorted or
 * filtered - each record's own ID is the number people quote.
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
 * Deliberately takes **no rows**: a `columns` memo that depended on its data rebuilt every column
 * definition on every page a scrolling screen appended, and the table rebuilt itself around them.
 */
/**
 * `listFilters`, when given, names the columns whose filter is a multi-select list of their values;
 * every other column gets the typed box. Without it, any column holding few enough distinct values
 * is offered the list (`distinctFilterValues`).
 *
 * A field may carry its own list as a sixth element - `["category", "Category", undefined, 190, 160,
 * SPENT_CATEGORIES]` - for a column whose answers come from a list the studio keeps rather than from
 * whatever is on screen. Without it such a column is guessed at from the rows loaded, and the guess
 * is wrong in exactly the case somebody filters in: the cash book offered the three spend categories
 * that already had an entry and not the other six, so a category nobody had used yet could not be
 * filtered for, and the first entry under it was unfindable until the page was read again. See
 * `knownFilterValues`, which adds whatever the rows hold beyond the list so a since-renamed value is
 * still reachable from its own filter.
 */
export function buildTableColumns({ fields, statusStyles, renderActions, actionsAriaLabel, listFilters }) {
  const listed = listFilters ? new Set(listFilters) : null;
  return [
    ...fields.map(([accessorKey, header, type, size, minSize, filterOptions]) => ({
      accessorKey,
      header,
      size: size || 190,
      minSize: minSize || 130,
      meta: {
        type,
        exportKey: accessorKey,
        ...(listed && !listed.has(accessorKey) ? { filter: "text" } : {}),
        // A status column's answers are its module's statuses, so its filter always lists them all.
        ...(type === "status" && statusStyles && Object.keys(statusStyles).length ? { filterOptions: Object.keys(statusStyles) } : {}),
        // Last, so a field naming its own list wins over the statuses derived above.
        ...(Array.isArray(filterOptions) && filterOptions.length ? { filterOptions } : {}),
      },
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
export const defaultVisibilityFor = (fields) => Object.fromEntries([...fields.map(([id]) => [id, true]), ["actions", true]]);
