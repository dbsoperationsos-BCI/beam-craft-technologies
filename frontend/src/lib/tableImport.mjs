/**
 * Reading a spreadsheet into a module's table.
 *
 * Leads & Followups has had a CSV import for a while and every other table had none. This is the
 * browser's half of the one that now serves them all: it turns a file into rows, says whether those
 * rows belong in the table the studio is looking at, and writes the template they can fill in.
 *
 * The deciding is deliberately all here and none of it in the dialog, so `node --test` can hold the
 * rules to account without rendering anything. What the dialog does is ask for a file, show what
 * this module says about it, and post it.
 *
 * `.mjs` and no imports beyond a sibling, the way `identifiers.mjs` is, so the test resolves no
 * alias and needs no bundler.
 */

/** Case and punctuation dropped, so "IH/OH" and "Ih Oh" are the same heading. */
export function normalizeHeader(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * A CSV file read into rows.
 *
 * Quoted values are honoured, including the doubled quote that escapes one inside a quoted field,
 * and both line endings are accepted - a file saved out of Excel on Windows arrives with `\r\n`.
 * The leading byte-order mark Excel writes is stripped, or the first heading would come back as
 * `﻿Name` and match nothing.
 *
 * Blank rows are dropped: a trailing newline is how every CSV ends and is not a row.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  const input = String(text || "").replace(/^﻿/, "");

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '"') {
      if (quoted && input[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(value.trim()); value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = []; value = "";
    } else value += character;
  }
  if (quoted) throw new Error(`Row ${rows.length + 1} has a quote that is never closed.`);
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

/** One value as a CSV field: quoted only where it has to be, which keeps a template readable. */
function csvField(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The template a studio downloads to fill in: the column headings, and nothing else.
 *
 * One row rather than a row of examples. An example row is a row somebody forgets to delete, and it
 * imports as a record named "e.g. Ravi Studio".
 */
/**
 * Every heading a column answers to: the one the template prints, and the ones it used to.
 *
 * A column renamed is a column the studio's saved spreadsheets no longer carry, and headings are
 * matched by name - so without this a rename turns last month's file into one with an unknown column
 * and a field silently left empty. The server's own importer reads the same `aliases`
 * (`services/tableImport.js`), because an inspection that accepts a file the server then ignores is
 * worse than refusing it.
 */
const headingsOf = (column) => [column.label, ...(column.aliases || [])].map(normalizeHeader).filter(Boolean);

export function templateCsv(columns = []) {
  return `${columns.map((column) => csvField(column.label ?? column)).join(",")}\n`;
}

/**
 * What this module makes of the file: whether it can be imported, and what it is about to do.
 *
 * Answered before anything is sent, so the dialog can say "this file has no Vendor Name column"
 * rather than the studio pressing Import and being told by the server. The server checks the same
 * thing again on arrival - this is the courtesy, not the guard.
 */
export function inspectImportFile(columns = [], rows = []) {
  if (!rows.length) return { ok: false, reason: "This file is empty.", headers: [], rows: [], missing: [], unknown: [] };

  const [headers, ...body] = rows;
  const present = new Set(headers.map(normalizeHeader).filter(Boolean));
  const claimed = new Set(columns.flatMap(headingsOf));

  const carried = (column) => headingsOf(column).some((heading) => present.has(heading));
  const missing = columns.filter((column) => column.required && !carried(column)).map((column) => column.label);
  const unknown = headers.filter((heading) => normalizeHeader(heading) && !claimed.has(normalizeHeader(heading)));
  const matched = columns.filter(carried).map((column) => column.label);

  if (missing.length) {
    return {
      ok: false,
      reason: `This file is missing ${missing.length === 1 ? "a column" : "columns"}: ${missing.join(", ")}. Download the template to see what it should carry.`,
      headers, rows: body, missing, unknown, matched,
    };
  }
  if (!matched.length) {
    return { ok: false, reason: "None of this file's columns match this table.", headers, rows: body, missing, unknown, matched };
  }
  if (!body.length) {
    return { ok: false, reason: "This file has headings but no rows under them.", headers, rows: body, missing, unknown, matched };
  }
  return { ok: true, reason: "", headers, rows: body, missing, unknown, matched };
}

// Rows per request. Large enough that a thousand-row file is a handful of round trips, small enough
// that each one returns quickly and the progress bar moves rather than sitting still.
export const IMPORT_CHUNK_ROWS = 200;

/** The file's rows in the batches they will be posted in, each remembering where it started. */
export function importChunks(rows = [], size = IMPORT_CHUNK_ROWS) {
  const chunks = [];
  for (let offset = 0; offset < rows.length; offset += size) {
    // +2: the header row is row 1, so the first data row is row 2 in the studio's own spreadsheet.
    chunks.push({ rows: rows.slice(offset, offset + size), startRow: offset + 2 });
  }
  return chunks;
}

/** Two results added together, so a file posted in batches reports as one import. */
export function mergeImportResults(left, right) {
  return {
    received: (left?.received || 0) + (right?.received || 0),
    imported: (left?.imported || 0) + (right?.imported || 0),
    skipped: (left?.skipped || 0) + (right?.skipped || 0),
    // Capped the way the server caps its own: a file whose every row fails would otherwise build a
    // list as long as itself in the browser's memory.
    errors: [...(left?.errors || []), ...(right?.errors || [])].slice(0, 50),
    // The projects an import with Replace deleted, or would delete - one entry per project, though a
    // project's shoots can arrive in different batches.
    replaced: [...(left?.replaced || []), ...(right?.replaced || [])].filter((item, index, all) => all.findIndex((other) => other.eventId === item.eventId) === index),
    // The deleted projects and shoots an import with Restore brought back, once each.
    restored: [...(left?.restored || []), ...(right?.restored || [])].filter((item, index, all) => all.findIndex((other) => other.kind === item.kind && other.id === item.id) === index),
  };
}

/** What the dialog says when it is over. */
export function importSummaryText(result) {
  const imported = result?.imported || 0;
  const skipped = result?.skipped || 0;
  const rows = `${imported.toLocaleString()} ${imported === 1 ? "row" : "rows"}`;
  if (!skipped) return `${rows} imported.`;
  return `${rows} imported, ${skipped.toLocaleString()} skipped.`;
}
