// Relative, with its extension, so this module loads under plain Node as well as through the
// bundler - the `@/` alias is the bundler's and the test runner does not know it.
import { parseCsvRows } from "./csv.js";

/**
 * Reading the numbers somebody wants excluded from the lead sheet.
 *
 * Pure, and here rather than in the panel, because these are rules rather than rendering: what
 * counts as the same number, and what an uploaded file means. The server decides both again on its
 * own side - this is what lets the screen say how many rows a file will actually add before it is
 * sent, and refuse an Import that would add nothing.
 */

/** The headings the template carries, and the file the Download CSV Template link hands over. */
export const TEMPLATE_HEADERS = ["Name", "Number"];
export const TEMPLATE_CSV = `${TEMPLATE_HEADERS.join(",")}\n`;

/*
 * The headings a file might use for each column.
 *
 * People rename the template's columns and export from Callyzer, which calls them "Contact Name" and
 * "Contact Number". Matching on a normalised form means a file is read by what its columns say
 * rather than by the order somebody happened to save them in.
 */
const NAME_HEADERS = new Set(["name", "contactname", "clientname", "contact"]);
const NUMBER_HEADERS = new Set(["number", "contactnumber", "phone", "phonenumber", "mobile", "mobilenumber"]);

function normalizeHeader(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The key two numbers are the same person by: the last ten digits.
 *
 * The same rule the backend's `phoneKey` uses, so a number this screen accepts is a number the
 * server accepts. Below five digits there is not enough left to be anyone in particular, which is a
 * typo or a blank rather than a phone number.
 */
export function excludedNumberKey(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length >= 10) return digits.slice(-10);
  return digits.length >= 5 ? digits : "";
}

/** Whether a typed number is one the exclude list can actually match against. */
export function isUsableNumber(value) {
  return Boolean(excludedNumberKey(value));
}

/**
 * An uploaded CSV read into `{ name, number }` rows.
 *
 * The file the template describes - `Name,Number` - and the ones people actually have: a Callyzer
 * export whose columns are "Contact Name" and "Contact Number", a file whose two columns are the
 * other way round, and a single column of bare numbers with no headings at all.
 *
 * The heading row decides which column is which where there is one. Without headings the last
 * column is the number, which is the same rule a pasted line follows and the one that survives a
 * name containing a comma. A single column is numbers.
 *
 * Nothing is validated here. A row whose number will not do still comes back, so the screen can
 * count what will not import and the server can name the line that failed - dropping them silently
 * would have somebody believe a file imported whole when it did not.
 */
export function parseExcludedNumbersCsv(text) {
  const rows = parseCsvRows(text);
  if (!rows.length) return [];

  const headings = rows[0].map(normalizeHeader);
  let nameIndex = headings.findIndex((heading) => NAME_HEADERS.has(heading));
  let numberIndex = headings.findIndex((heading) => NUMBER_HEADERS.has(heading));
  // A heading row is one that names at least the number column; anything else is data.
  const body = numberIndex >= 0 ? rows.slice(1) : rows;
  if (numberIndex < 0) {
    numberIndex = rows[0].length > 1 ? rows[0].length - 1 : 0;
    nameIndex = rows[0].length > 1 ? 0 : -1;
  }

  const entries = [];
  for (const row of body) {
    const number = String(row[numberIndex] ?? "").trim();
    const name = nameIndex >= 0 ? String(row[nameIndex] ?? "").trim() : "";
    // A row with neither is the blank line at the end of a file, not an entry.
    if (!number && !name) continue;
    entries.push({ name, number });
  }
  return entries;
}

/** How many rows of a file would actually be excluded. What the Import button counts. */
export function usableCount(entries = []) {
  return entries.filter((entry) => isUsableNumber(entry?.number)).length;
}

/** The template file, as the bytes the Download CSV Template link hands over. */
export function csvTemplateBlob() {
  return new Blob([TEMPLATE_CSV], { type: "text/csv;charset=utf-8;" });
}
