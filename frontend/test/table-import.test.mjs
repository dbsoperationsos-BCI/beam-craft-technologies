import test from "node:test";
import assert from "node:assert/strict";

import {
  IMPORT_CHUNK_ROWS,
  importChunks,
  importSummaryText,
  inspectImportFile,
  mergeImportResults,
  normalizeHeader,
  parseCsv,
  templateCsv,
} from "../src/lib/tableImport.mjs";

/*
 * Reading a spreadsheet into a module's table.
 *
 * The deciding all lives in the module under test and none of it in the dialog, which is what lets
 * these run without rendering anything. What is worth pinning down is the handful of things a real
 * file does that a made-up one does not: Excel's byte-order mark, `\r\n`, a quoted comma, a
 * trailing newline, and columns in whatever order somebody last dragged them into.
 */

const COLUMNS = [
  { field: "vendorName", label: "Vendor Name", required: true },
  { field: "vendorType", label: "Vendor Type", required: true },
  { field: "city", label: "City" },
];

/* ─────────────────────────────────────────────────────────────────── reading the file ── */

test("a file saved out of Excel is read as its rows", () => {
  // The byte-order mark, CRLF endings, and a trailing newline: all three arrive on a real export
  // and all three would otherwise turn into a heading that matches nothing or a row of nothing.
  const csv = "﻿Vendor Name,Vendor Type,City\r\nRavi Studio,Freelancer,Erode\r\n";
  assert.deepEqual(parseCsv(csv), [
    ["Vendor Name", "Vendor Type", "City"],
    ["Ravi Studio", "Freelancer", "Erode"],
  ]);
});

test("a quoted value keeps its commas, newlines and quotes", () => {
  const csv = 'Vendor Name,Remarks\n"Ravi, Studio","He said ""yes"" on the\ncall"\n';
  assert.deepEqual(parseCsv(csv), [
    ["Vendor Name", "Remarks"],
    ["Ravi, Studio", 'He said "yes" on the\ncall'],
  ]);
});

test("a quote that is never closed is refused rather than read as one long value", () => {
  assert.throws(() => parseCsv('Name\n"Ravi\n'), /quote that is never closed/);
});

test("blank rows are not rows", () => {
  assert.deepEqual(parseCsv("Name\n\nRavi\n\n\n"), [["Name"], ["Ravi"]]);
});

/* ────────────────────────────────────────────────────────────────── judging the file ── */

test("a file carrying the required columns is accepted, in any order", () => {
  // Somebody rearranges columns in a spreadsheet without thinking about it; matching on position
  // instead of heading would silently file the city as the vendor's name.
  const seen = inspectImportFile(COLUMNS, [
    ["City", "Vendor Type", "Vendor Name"],
    ["Erode", "Freelancer", "Ravi Studio"],
  ]);
  assert.equal(seen.ok, true);
  assert.deepEqual(seen.rows, [["Erode", "Freelancer", "Ravi Studio"]]);
  assert.deepEqual(seen.matched.sort(), ["City", "Vendor Name", "Vendor Type"]);
});

test("a heading is matched however it is punctuated or cased", () => {
  assert.equal(normalizeHeader("IH/OH"), normalizeHeader("Ih Oh"));
  const seen = inspectImportFile(COLUMNS, [["vendor name", "VENDOR_TYPE"], ["Ravi", "Freelancer"]]);
  assert.equal(seen.ok, true);
});

test("a file missing a required column is refused, and the column is named", () => {
  const seen = inspectImportFile(COLUMNS, [["Vendor Name", "City"], ["Ravi", "Erode"]]);
  assert.equal(seen.ok, false);
  assert.deepEqual(seen.missing, ["Vendor Type"]);
  assert.match(seen.reason, /Vendor Type/);
  // Said with what to do about it, because the answer is always the same: get the template.
  assert.match(seen.reason, /template/);
});

test("columns the table does not have are reported but do not refuse the file", () => {
  // A studio's own spreadsheet carries notes columns. They are ignored on import, but a misspelled
  // heading looks exactly like a lost column, so the dialog is given the chance to say so.
  const seen = inspectImportFile(COLUMNS, [
    ["Vendor Name", "Vendor Type", "Notes", "Vendr Nmae"],
    ["Ravi", "Freelancer", "call back", "typo"],
  ]);
  assert.equal(seen.ok, true);
  assert.deepEqual(seen.unknown, ["Notes", "Vendr Nmae"]);
});

test("a file with headings and nothing under them is refused", () => {
  const seen = inspectImportFile(COLUMNS, [["Vendor Name", "Vendor Type"]]);
  assert.equal(seen.ok, false);
  assert.match(seen.reason, /no rows/);
});

test("an empty file is refused rather than read as an import of nothing", () => {
  assert.equal(inspectImportFile(COLUMNS, []).ok, false);
});

/* ──────────────────────────────────────────────────────────────────── the template ── */

test("the template is the headings and no example row", () => {
  // An example row is a row somebody forgets to delete, and it imports as a record called
  // "e.g. Ravi Studio".
  assert.equal(templateCsv(COLUMNS), "Vendor Name,Vendor Type,City\n");
});

test("a heading with a comma in it survives the template", () => {
  assert.equal(templateCsv([{ label: 'Name, Legal' }]), '"Name, Legal"\n');
});

test("the template a module downloads reads back as its own columns", () => {
  // The round trip that matters: fill the template in, and the file it produces must be one this
  // same module accepts. A template the importer would refuse is worse than no template.
  const filled = `${templateCsv(COLUMNS)}Ravi Studio,Freelancer,Erode\n`;
  assert.equal(inspectImportFile(COLUMNS, parseCsv(filled)).ok, true);
});

/* ─────────────────────────────────────────────────────────────────────── sending it ── */

test("rows are posted in batches that remember where they started", () => {
  /*
   * The row number is what a per-row error is reported against, and it is the number in the
   * studio's own spreadsheet - so the header row is 1 and the first row of data is 2. Off by one
   * here sends somebody to the wrong line of a two-hundred-row file.
   */
  const rows = Array.from({ length: 450 }, (unused, index) => [`row ${index}`]);
  const chunks = importChunks(rows);
  assert.equal(chunks.length, Math.ceil(450 / IMPORT_CHUNK_ROWS));
  assert.equal(chunks[0].startRow, 2);
  assert.equal(chunks[1].startRow, 2 + IMPORT_CHUNK_ROWS);
  assert.equal(chunks.reduce((total, chunk) => total + chunk.rows.length, 0), 450);
});

test("a file posted in batches reports as one import", () => {
  const merged = [
    { received: 200, imported: 198, skipped: 2, errors: [{ row: 5, message: "a" }] },
    { received: 100, imported: 100, skipped: 0, errors: [] },
  ].reduce(mergeImportResults, undefined);
  assert.deepEqual(merged, { received: 300, imported: 298, skipped: 2, errors: [{ row: 5, message: "a" }], replaced: [], restored: [] });
});

test("a project or shoot restored across two batches is listed once", () => {
  const project = { kind: "Project", id: "DBS-EVT-1" };
  const merged = mergeImportResults({ restored: [project] }, { restored: [project, { kind: "Shoot", id: "DBS-EVT-1" }] });
  assert.deepEqual(merged.restored.map((item) => `${item.kind}:${item.id}`), ["Project:DBS-EVT-1", "Shoot:DBS-EVT-1"]);
});

test("a project replaced across two batches is listed once", () => {
  // A booking's shoots can be split between batches, and each batch reports the project it replaced.
  const project = { eventId: "DBS-EVT-DD-ERD-000001", clientName: "WED ERD A & B" };
  const merged = mergeImportResults({ replaced: [project] }, { replaced: [project, { eventId: "DBS-EVT-DD-ERD-000002" }] });
  assert.deepEqual(merged.replaced.map((item) => item.eventId), ["DBS-EVT-DD-ERD-000001", "DBS-EVT-DD-ERD-000002"]);
});

test("the error list is capped, so a wholly bad file does not build one as long as itself", () => {
  const many = { received: 0, imported: 0, skipped: 0, errors: Array.from({ length: 80 }, (u, i) => ({ row: i, message: "no" })) };
  assert.equal(mergeImportResults(many, many).errors.length, 50);
});

test("the summary counts what happened, in words", () => {
  assert.equal(importSummaryText({ imported: 1, skipped: 0 }), "1 row imported.");
  assert.equal(importSummaryText({ imported: 198, skipped: 2 }), "198 rows imported, 2 skipped.");
  assert.equal(importSummaryText({ imported: 0, skipped: 3 }), "0 rows imported, 3 skipped.");
});
