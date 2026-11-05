const archiver = require("archiver");
const { PassThrough } = require("node:stream");
const { statusTextFor } = require("../../../services/activityLog");

/**
 * The User Activity Logs as a file - CSV or Excel - for Administration → User Activity Logs' Table
 * Options menu.
 *
 * Written by the server rather than by the screen because the screen holds only the lines scrolled
 * in so far: an export of those would read as the log and be a page of it. The rows here are every
 * line the reader's filters, period, sort and branch reach select, up to `EXPORT_LIMIT`.
 *
 * The Excel file is a real `.xlsx` - the few XML parts of an Office Open XML workbook zipped with
 * `archiver`, which the backend already carries for the image downloads - so no spreadsheet library
 * is added for one table. Every cell is an inline string except the duration, which is a number.
 */

/** The most lines one export carries; past it the reader narrows the period or the filters. */
const EXPORT_LIMIT = 100000;

/*
 * The columns of the file: the grid's seven, then what the details panel shows. Log time is written
 * in the reader's own time zone (the screen sends it), as the grid shows it.
 */
const COLUMNS = [
  { label: "Log time", value: (row, format) => format(row.createdAt) },
  { label: "Username", value: (row) => row.username },
  { label: "Full name", value: (row) => row.user?.name },
  { label: "Branch", value: (row) => row.branch?.name },
  { label: "Utility name", value: (row) => row.module },
  { label: "Action name", value: (row) => row.action },
  { label: "HTTP method", value: (row) => row.method },
  { label: "Route path", value: (row) => row.path },
  { label: "Status code", value: (row) => row.statusCode, number: true },
  { label: "Response status", value: (row) => statusTextFor(row.statusCode) },
  { label: "Client host", value: (row) => row.clientIp },
  { label: "User agent", value: (row) => row.userAgent },
  { label: "Duration (ms)", value: (row) => row.durationMs, number: true },
];

/** `2026/10/20 03:04:05 PM` in `timeZone`, the log screen's own format. */
function logTimeFormatter(timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true,
  });
  return (value) => {
    if (!value) return "";
    const part = Object.fromEntries(parts.formatToParts(new Date(value)).map((entry) => [entry.type, entry.value]));
    return `${part.year}/${part.month}/${part.day} ${part.hour}:${part.minute}:${part.second} ${String(part.dayPeriod || "").toUpperCase()}`;
  };
}

/** A time zone the runtime knows, or UTC. */
function safeTimeZone(timeZone) {
  try {
    if (timeZone) return new Intl.DateTimeFormat("en-US", { timeZone }).resolvedOptions().timeZone;
  } catch { /* not a zone this runtime knows */ }
  return "UTC";
}

/*
 * A cell a spreadsheet would run as a formula - starting =, +, -, @, a tab or a return - is written
 * with a leading apostrophe, so a username or a user agent somebody typed cannot become a formula in
 * whoever opens the file.
 */
const FORMULA_START = /^[=+\-@\t\r]/;
const safeText = (value) => {
  const text = value === null || value === undefined ? "" : String(value);
  return FORMULA_START.test(text) ? `'${text}` : text;
};

function toCsv(rows, format) {
  const escape = (value) => {
    const text = safeText(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [COLUMNS.map((column) => escape(column.label)).join(",")];
  for (const row of rows) lines.push(COLUMNS.map((column) => (column.number ? String(column.value(row, format) ?? "") : escape(column.value(row, format)))).join(","));
  // The byte-order mark makes Excel read the file as UTF-8, so "Project Management · Production" stays whole.
  return Buffer.from(`﻿${lines.join("\r\n")}`, "utf8");
}

// ─── Excel (.xlsx) ───────────────────────────────────────────────────────────────────────────────

// XML 1.0 refuses control characters other than tab, newline and return, even escaped.
const xml = (value) => String(value)
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A column letter: 0 → A, 25 → Z, 26 → AA. */
const columnLetter = (index) => {
  let letter = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) letter = String.fromCharCode(65 + ((n - 1) % 26)) + letter;
  return letter;
};

function sheetXml(rows, format) {
  const cell = (columnIndex, rowNumber, value, { number = false, header = false } = {}) => {
    const ref = `${columnLetter(columnIndex)}${rowNumber}`;
    if (value === null || value === undefined || value === "") return "";
    if (number && Number.isFinite(Number(value))) return `<c r="${ref}"><v>${Number(value)}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${header ? ' s="1"' : ""}><is><t xml:space="preserve">${xml(safeText(value))}</t></is></c>`;
  };
  const header = `<row r="1">${COLUMNS.map((column, index) => cell(index, 1, column.label, { header: true })).join("")}</row>`;
  const body = rows.map((row, rowIndex) => {
    const number = rowIndex + 2;
    return `<row r="${number}">${COLUMNS.map((column, index) => cell(index, number, column.value(row, format), { number: column.number })).join("")}</row>`;
  }).join("");
  const widths = [24, 22, 24, 20, 32, 30, 12, 50, 12, 18, 18, 60, 14];
  const cols = widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${header}${body}</sheetData></worksheet>`;
}

const XLSX_PARTS = {
  "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
  "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Activity log" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  // Two cell styles: the default, and the bold header row (s="1").
  "xl/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
};

function toXlsx(rows, format) {
  return new Promise((resolve, reject) => {
    const zip = archiver("zip", { zlib: { level: 6 } });
    const out = new PassThrough();
    const chunks = [];
    out.on("data", (chunk) => chunks.push(chunk));
    out.on("end", () => resolve(Buffer.concat(chunks)));
    zip.on("error", reject);
    zip.pipe(out);
    for (const [name, content] of Object.entries(XLSX_PARTS)) zip.append(content, { name });
    zip.append(sheetXml(rows, format), { name: "xl/worksheets/sheet1.xml" });
    zip.finalize();
  });
}

const FORMATS = {
  csv: { build: async (rows, format) => toCsv(rows, format), type: "text/csv; charset=utf-8", extension: "csv" },
  xlsx: { build: toXlsx, type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", extension: "xlsx" },
};

/** The file for `rows` in `formatName`, with the type and name to send it under. */
async function buildExport(rows, formatName, timeZone, now = new Date()) {
  const format = FORMATS[formatName];
  const formatTime = logTimeFormatter(safeTimeZone(timeZone));
  const day = formatTime(now).slice(0, 10).replace(/\//g, "-");
  return { body: await format.build(rows, formatTime), type: format.type, fileName: `user-activity-logs-${day}.${format.extension}` };
}

module.exports = { EXPORT_LIMIT, COLUMNS, FORMATS, buildExport, safeText, safeTimeZone, logTimeFormatter, toCsv, sheetXml, columnLetter };
