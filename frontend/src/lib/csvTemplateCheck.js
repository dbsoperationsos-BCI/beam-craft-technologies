// Decides whether a CSV belongs in the system table chosen on the Import dialog.
//
// The tables are passed in rather than imported so this stays a pure module over whatever
// column definitions the caller owns - the same definitions the Download CSV Template
// button writes, which is what makes the check and the template impossible to disagree.

// Case and punctuation are dropped, so "IH/OH" and "Ih Oh" match while a Qua Qua export
// picked as Dum Dum still does not.
export function normalizeHeaderKey(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Columns belonging to exactly one table, derived from the definitions themselves so they
// can never drift from the templates.
export function signatureColumnsFor(tables, vertical) {
  const elsewhere = new Set(
    Object.keys(tables)
      .filter((name) => name !== vertical)
      .flatMap((name) => tables[name].map((column) => normalizeHeaderKey(column.label))),
  );
  return (tables[vertical] || [])
    .map((column) => normalizeHeaderKey(column.label))
    .filter((key) => !elsewhere.has(key));
}

// The columns a lead cannot be made without. Everything else a table lists may be absent
// from the file and is imported empty - a column nobody filled in and a column nobody
// included are the same lead either way. All three tables share both of these.
export const REQUIRED_HEADERS = ["Enquiry Name", "Phone Number"];

/**
 * A file may only be imported into the table selected in the dialog.
 *
 * It used to have to carry that table's **full** set of columns, which was too strong a
 * rule for what it protects against: adding a column to a table invalidated every template
 * already downloaded, and a file built by hand with the columns a studio actually keeps was
 * refused outright. A missing column now imports empty, exactly as a blank one does.
 *
 * What the rule is for is the wrong table - the three share sixteen columns, so a Qua Qua
 * export picked as Dum Dum would put sixteen columns of real data into the wrong vertical.
 * That is still refused and named, because the fix is to change the dropdown, not the file.
 *
 * Mirrors `assertHeadersMatchVertical` in backend/src/modules/sales/crm-leads/csvImportService.js,
 * which is the copy that decides.
 */
export function validateCsvHeaders(tables, headers, vertical) {
  const present = new Set((headers || []).map(normalizeHeaderKey).filter(Boolean));
  if (!present.size) return { ok: false, message: "This file has no column headings to read." };
  if (!tables[vertical]) return { ok: false, message: "Choose a system table first." };

  /*
   * "and none of this table's" is what keeps this from firing on a good file: a studio that
   * keeps one spreadsheet for everything can carry another table's columns alongside this
   * table's own, and that file does belong here. Only a file with another table's columns
   * and none of this one's is positively somebody else's export.
   */
  const ownSignature = signatureColumnsFor(tables, vertical).some((key) => present.has(key));
  const looksLike = ownSignature
    ? null
    : Object.keys(tables).find(
        (name) => name !== vertical && signatureColumnsFor(tables, name).some((key) => present.has(key)),
      );
  if (looksLike) {
    return {
      ok: false,
      looksLike,
      message: `This file looks like a ${looksLike} export but ${vertical} is selected. Pick ${looksLike} above, or attach a ${vertical} file.`,
    };
  }

  const missingRequired = REQUIRED_HEADERS.filter((label) => !present.has(normalizeHeaderKey(label)));
  if (missingRequired.length) {
    return {
      ok: false,
      missing: missingRequired,
      message: `This file has no ${missingRequired.join(" and no ")} column, so there is no lead in a row to import. Download the ${vertical} template and use its headings.`,
    };
  }

  /*
   * Worth saying, not worth refusing over: which of this table's columns the file does not
   * carry. They import empty, and a reader who did not mean to leave them out can say so
   * before pressing Import rather than after.
   */
  const absent = tables[vertical]
    .filter((column) => !present.has(normalizeHeaderKey(column.label)))
    .map((column) => column.label);
  if (!absent.length) return { ok: true };
  const shown = absent.slice(0, 4).join(", ");
  return {
    ok: true,
    absent,
    notice: `${absent.length} column${absent.length === 1 ? "" : "s"} not in this file will import empty: ${shown}${absent.length > 4 ? `, and ${absent.length - 4} more` : ""}.`,
  };
}

/**
 * Reads only the first row. `readRows` is the caller's CSV row generator; the generator is
 * abandoned straight after the header, and each call opens its own stream, so this never
 * competes with the import that follows.
 */
export async function readCsvHeaderRow(readRows, file) {
  for await (const row of readRows(file)) {
    return row.map((cell) => String(cell || "").trim());
  }
  return null;
}

export async function checkCsvAgainstTable(readRows, tables, file, vertical) {
  try {
    const headers = await readCsvHeaderRow(readRows, file);
    if (!headers) return { ok: false, message: "This file is empty." };
    return validateCsvHeaders(tables, headers, vertical);
  } catch {
    return { ok: false, message: "This file could not be read as a CSV." };
  }
}
