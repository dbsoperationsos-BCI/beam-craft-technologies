const { z } = require("zod");

/*
 * ── Importing a CSV into any module's table ────────────────────────────────────────────────────
 *
 * Leads & Followups has had a CSV import for a while; every other table in the application had
 * none, so a studio moving its records in typed them one at a time. This is that import, written
 * once for all of them.
 *
 * ── What it deliberately does not do ──
 *
 * It does not validate. It does not know what a valid asset is, or a vendor, or a cash entry - each
 * module already says so in a zod schema, and each already has one function that writes a record
 * and does everything writing one entails: minting the identifier, stamping the actor, raising the
 * rows that hang off it. An importer with its own idea of any of that is a second way into the
 * table that drifts from the first, and the drift shows up as records that could not have been
 * created through the form.
 *
 * So a module hands over the two things it already has - its schema and its creator - plus the list
 * of columns a file may carry, and this walks the rows.
 *
 * ── What it does do ──
 *
 * Reads the file's own header row rather than trusting column order, so a file with its columns
 * rearranged still imports and one missing a required column is refused with the column named.
 * Reports per row: a file of two hundred with three bad rows imports a hundred and ninety-seven and
 * says which three failed and why, rather than refusing the lot or silently dropping them.
 */

/** Case and punctuation dropped, so "IH/OH" and "Ih Oh" are the same heading. */
function normalizeHeader(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * A column a file may carry.
 *
 * `field` is what the module's schema calls it, `label` is the heading the studio reads and the one
 * the downloadable template writes. `required` refuses a file that does not carry the column at
 * all - not a row that leaves it blank, which is the schema's business.
 *
 * `parse` is for the handful of shapes a spreadsheet cell cannot hold directly: a list of skills in
 * one cell, a yes/no that means a boolean. Everything else arrives as the trimmed string and is
 * left to the schema to coerce, which is what keeps this from having opinions of its own.
 */
const columnSchema = z.object({
  field: z.string().min(1),
  label: z.string().min(1),
  required: z.boolean().optional(),
  parse: z.function().optional(),
});

/** A comma- or semicolon-separated cell read as a list, for the columns that hold one. */
const asList = (value) => String(value ?? "").split(/[;,]/).map((part) => part.trim()).filter(Boolean);

/**
 * Where each column's values sit in this file, by reading its header row.
 *
 * A column the file does not carry is simply absent from the map, and its field is left off every
 * record - which is not the same as sending it empty. A schema with a default, or a field the
 * module fills in itself, must not be overwritten with "" just because the file was silent about it.
 */
function mapHeaders(columns, headerRow = []) {
  const seen = new Map();
  headerRow.forEach((heading, index) => {
    const key = normalizeHeader(heading);
    // First occurrence wins: a file with the column twice is a mistake, not two columns.
    if (key && !seen.has(key)) seen.set(key, index);
  });

  const mapped = [];
  const missing = [];
  for (const column of columns) {
    const index = seen.get(normalizeHeader(column.label));
    if (index === undefined) {
      if (column.required) missing.push(column.label);
      continue;
    }
    mapped.push({ ...column, index });
  }
  // Headings the file carries that no column claims. Not an error - a studio's own spreadsheet
  // carries notes columns - but worth saying, because a misspelled heading looks like a lost column.
  const claimed = new Set(columns.map((column) => normalizeHeader(column.label)));
  const unknown = headerRow.filter((heading) => normalizeHeader(heading) && !claimed.has(normalizeHeader(heading)));
  return { mapped, missing, unknown };
}

/** One row as the module's schema expects to receive it. */
function rowToRecord(mapped, row) {
  const record = {};
  for (const column of mapped) {
    const raw = String(row[column.index] ?? "").trim();
    // A blank cell leaves the field off entirely rather than sending "": see `mapHeaders`.
    if (!raw) continue;
    record[column.field] = column.parse ? column.parse(raw) : raw;
  }
  return record;
}

/**
 * What a row was refused for, in the studio's own words.
 *
 * Named by the *column heading* rather than the schema's field, because the person fixing the file
 * is looking at a spreadsheet: "Vendor Name is required" sends them to the right cell, where
 * "vendorName: Invalid input: expected string, received undefined" does not.
 *
 * A blank cell leaves its field off the record entirely - see `rowToRecord` - so a required field
 * that was left empty arrives at zod as missing. That is the common case by far, and it is worth
 * saying plainly rather than passing zod's wording through.
 */
function firstIssue(error, labels) {
  const issue = error?.issues?.[0];
  if (!issue) return "This row could not be read.";
  const field = Array.isArray(issue.path) && issue.path.length ? issue.path[0] : "";
  const label = labels.get(field) || field;
  if (!label) return issue.message;
  const missing = issue.code === "invalid_type" && /undefined/.test(issue.message || "");
  return missing ? `${label} is required.` : `${label}: ${issue.message}`;
}

// Rows per pass. Large enough that a thousand-row file is a handful of passes, small enough that a
// failure part-way through has not held a transaction open across the whole file.
const IMPORT_SLICE = 200;

/**
 * Walks the rows of one file into one module's table.
 *
 * `create(record, index)` is the module's own creator, awaited one row at a time. Deliberately not
 * in parallel: several of these mint an identifier from a shared counter and read the row they just
 * wrote, and the ordering is what makes a file import in the order it was written.
 *
 * A row that throws is counted and described rather than ending the run - a file is usually right
 * apart from a few rows, and refusing all of it means finding them by bisection.
 */
async function importTableRows({ headers = [], rows = [], columns = [], schema, create, startRow = 2 } = {}) {
  const definitions = z.array(columnSchema).parse(columns);
  const { mapped, missing, unknown } = mapHeaders(definitions, headers);

  if (missing.length) {
    const error = new Error(`This file is missing ${missing.length === 1 ? "a column" : "columns"}: ${missing.join(", ")}.`);
    error.status = 400;
    throw error;
  }
  if (!mapped.length) {
    const error = new Error("None of this file's columns match this table.");
    error.status = 400;
    throw error;
  }

  // Field -> the heading the studio reads, so a refusal names the column rather than the field.
  const labels = new Map(definitions.map((column) => [column.field, column.label]));
  const result = { received: rows.length, imported: 0, skipped: 0, errors: [], unknownColumns: unknown };

  for (let offset = 0; offset < rows.length; offset += IMPORT_SLICE) {
    for (const [position, row] of rows.slice(offset, offset + IMPORT_SLICE).entries()) {
      const rowNumber = startRow + offset + position;
      // A row of nothing is what a trailing newline looks like, not a record.
      if (!Array.isArray(row) || !row.some((cell) => String(cell ?? "").trim())) {
        result.skipped += 1;
        continue;
      }

      // Async, because a schema may ask the database - the cash-entry one checks the payment mode
      // against the studio's own list. A synchronous parse of such a schema does not fail the row,
      // it throws, outside the per-row catch below, and every import answered 500 on its first row.
      const parsed = await schema.safeParseAsync(rowToRecord(mapped, row));
      if (!parsed.success) {
        result.skipped += 1;
        // Capped: a file whose every row fails would otherwise return a response as long as itself.
        if (result.errors.length < 50) result.errors.push({ row: rowNumber, message: firstIssue(parsed.error, labels) });
        continue;
      }

      try {
        await create(parsed.data, rowNumber);
        result.imported += 1;
      } catch (error) {
        result.skipped += 1;
        if (result.errors.length < 50) result.errors.push({ row: rowNumber, message: error?.message || "This row could not be saved." });
      }
    }
  }

  return result;
}

/** The template a module offers for download: its columns' labels, in order, as one CSV row. */
function templateHeaders(columns) {
  return columns.map((column) => column.label);
}

module.exports = { importTableRows, templateHeaders, mapHeaders, normalizeHeader, asList, IMPORT_SLICE };
