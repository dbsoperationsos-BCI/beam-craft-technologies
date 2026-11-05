import test from "node:test";
import assert from "node:assert/strict";

import { parseCsvRows } from "../src/lib/csv.js";
import { excludedNumberKey, isUsableNumber, parseExcludedNumbersCsv, usableCount, TEMPLATE_CSV } from "../src/lib/excludedNumbers.js";

/*
 * Reading the numbers somebody wants kept out of the lead sheet.
 *
 * The list is what stops staff calls, family calls and suppliers becoming enquiries, so the two
 * rules it rests on are worth pinning down: what counts as the same number, and what an uploaded
 * file means. Both are decided again on the server - these are what let the screen say how many
 * rows a file will add before it is sent, and refuse an Import that would add nothing.
 */

/* -------------------------------------------------------------- the same number */

test("a number is matched on its last ten digits, however it was written", () => {
  // The same rule the backend uses, so a number this screen accepts is one the server accepts.
  assert.equal(excludedNumberKey("+91 63027 67567"), "6302767567");
  assert.equal(excludedNumberKey("+91-6302767567"), "6302767567");
  assert.equal(excludedNumberKey("06302767567"), "6302767567");
  assert.equal(excludedNumberKey("916302767567"), "6302767567");
});

test("too little of a number is nobody in particular", () => {
  assert.equal(excludedNumberKey("123"), "", "a typo, not a phone number");
  assert.equal(excludedNumberKey(""), "");
  assert.equal(excludedNumberKey("not a number"), "");
  assert.equal(isUsableNumber("123"), false);
  assert.equal(isUsableNumber("+91 63027 67567"), true);
});

/* ------------------------------------------------------------------- the CSV */

test("the template names the two columns the import reads", () => {
  assert.equal(TEMPLATE_CSV, "Name,Number\n");
  // And a file made from the template round-trips, which is the whole point of handing it over.
  assert.deepEqual(parseExcludedNumbersCsv("Name,Number\nHelan,+91-7530054449"), [
    { name: "Helan", number: "+91-7530054449" },
  ]);
});

test("a Callyzer export is read by its own column names", () => {
  assert.deepEqual(parseExcludedNumbersCsv("Contact Name,Contact Number\nManjula D - Husband,+91-6302767567"), [
    { name: "Manjula D - Husband", number: "+91-6302767567" },
  ]);
});

/*
 * Headings decide which column is which, so a file saved with them the other way round is still
 * read correctly. Reading by position alone is what would put the number in the name column.
 */
test("the columns may be in either order when they are named", () => {
  assert.deepEqual(parseExcludedNumbersCsv("Number,Name\n7530098674,Indra"), [
    { name: "Indra", number: "7530098674" },
  ]);
});

test("a file with no headings is read as name then number", () => {
  assert.deepEqual(parseExcludedNumbersCsv("kavya,9500713005\nkuzhali,7022218192"), [
    { name: "kavya", number: "9500713005" },
    { name: "kuzhali", number: "7022218192" },
  ]);
});

test("a single column with no headings is numbers", () => {
  assert.deepEqual(parseExcludedNumbersCsv("9500713005\n7022218192"), [
    { name: "", number: "9500713005" },
    { name: "", number: "7022218192" },
  ]);
});

/*
 * The row this exists for. A name with a comma in it is a quoted field, and reading it as two
 * columns would put "Accounts" in the number column and lose the number entirely.
 */
test("a quoted name containing a comma stays one field", () => {
  assert.deepEqual(parseExcludedNumbersCsv('Name,Number\n"Rajeswari, Accounts",7530098675'), [
    { name: "Rajeswari, Accounts", number: "7530098675" },
  ]);
});

test("a file saved out of Excel is read despite its byte-order mark and line endings", () => {
  // Without stripping the mark the first heading reads as "﻿Name" and matches no column,
  // so the heading row would be imported as if it were a number.
  const excel = "﻿Name,Number\r\nHelan,7530054449\r\n";
  assert.deepEqual(parseExcludedNumbersCsv(excel), [{ name: "Helan", number: "7530054449" }]);
});

test("blank rows and an empty file come back as nothing", () => {
  assert.deepEqual(parseExcludedNumbersCsv("Name,Number\n\n\n"), []);
  assert.deepEqual(parseExcludedNumbersCsv(""), []);
  assert.deepEqual(parseExcludedNumbersCsv(null), []);
});

/*
 * A row whose number will not do still comes back. Dropping it here would have somebody believe a
 * file imported whole when a row of it was silently thrown away - the screen counts these instead,
 * and the server names the row that failed.
 */
test("unusable rows are kept, and counted separately", () => {
  const entries = parseExcludedNumbersCsv("Name,Number\nHelan,7530054449\nIndra,ask her\nkavya,9500713005");
  assert.equal(entries.length, 3);
  assert.equal(usableCount(entries), 2);
});

test("nothing usable means there is nothing to import", () => {
  assert.equal(usableCount(parseExcludedNumbersCsv("Name,Number\nIndra,ask her")), 0);
  assert.equal(usableCount([]), 0);
});

test("a CSV that cannot be parsed says so rather than reading as empty", () => {
  assert.throws(() => parseExcludedNumbersCsv('Name,Number\n"Helan,7530054449'), /unterminated quoted value/);
});

/* ---------------------------------------------------------------- the reader */

test("the shared reader honours quotes, escaped quotes and both line endings", () => {
  assert.deepEqual(parseCsvRows('a,"b,c"\r\n"say ""hi""",d\n'), [["a", "b,c"], ['say "hi"', "d"]]);
});
