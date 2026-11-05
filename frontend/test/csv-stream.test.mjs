import test from "node:test";
import assert from "node:assert/strict";

import { streamCsvRows } from "../src/lib/csv.js";

/*
 * Streaming a CRM export into rows.
 *
 * The one thing this has to get right is the count: a file of N records has to import as N leads.
 * It did not, and it was wrong in both directions at once, because rule 2 - the recovery from a
 * quote that never closes - used to fire on a row-completeness test rather than on whether the
 * quote closed.
 *
 *   * Too eager. A remark typed over two lines, which is legal CSV and ordinary in a CRM, was cut at
 *     the line break as soon as the fields gathered plus the comma-pieces of the remark reached the
 *     header's column count. Remarks is the second-to-last column of all three templates, so one
 *     comma was enough, and a line break in the final column needed none.
 *   * Too slow. A quote that really never closed but held few commas failed that test at every line
 *     break, so it read on through the rows below and merged them into itself until the count
 *     happened to add up - and those rows were not imported at all.
 *
 * One 32,880-row export showed both: 33,569 leads in the table, each cut remark leaving a second
 * lead carrying its own tail for a name, while individual days came up short of the file.
 *
 * So the tests below pull against each other on purpose. A genuine multi-line value stays one row,
 * however many commas it holds and wherever in the row it sits; an unclosed quote still has to be
 * recovered from, and has to cost its own row and no other.
 */

/** A `File` as far as `streamCsvRows` is concerned, delivered in chunks of `chunkSize` bytes. */
function fakeFile(text, chunkSize = Infinity) {
  const bytes = new TextEncoder().encode(text);
  return {
    size: bytes.byteLength,
    stream() {
      let offset = 0;
      return {
        getReader: () => ({
          async read() {
            if (offset >= bytes.byteLength) return { done: true, value: undefined };
            const value = bytes.slice(offset, offset + Math.min(chunkSize, bytes.byteLength - offset));
            offset += value.byteLength;
            return { done: false, value };
          },
          releaseLock() {},
        }),
      };
    },
  };
}

async function readRows(text, chunkSize) {
  const rows = [];
  for await (const row of streamCsvRows(fakeFile(text, chunkSize), () => {})) rows.push(row);
  return rows;
}

/** One CSV field, quoted the way a spreadsheet writes one. */
const quoted = (value) => `"${String(value).replace(/"/g, '""')}"`;

// The tail of every CRM template: Remarks second-to-last, Source last. That position is the whole
// reason the old rule fired on good files, so the fixture keeps it.
const HEADER = ["Enquiry Name", "Phone Number", "City", "Remarks", "Source"];
const AFTER = ["Priya", "9876500000", "Salem", "ok", "Meta"];

/** A file of one header, one row under test, and one ordinary row to catch a row eaten or split. */
const file = (record) => `${[HEADER, record, AFTER].map((row) => row.join(",")).join("\n")}\n`;

test("a multi-line remark is one lead, not two", async () => {
  /*
   * The reported file, reduced. Comma **and** line break in the remark: row.length is 3 and the
   * remark splits into 2 pieces, which is exactly the 5 the old rule read as a finished row.
   */
  const rows = await readRows(file(["Ravi", "9876543210", "Erode", quoted("Called client, no answer\nWill try tomorrow"), "Meta"]));

  assert.equal(rows.length, 3, "the remark's second line was imported as a lead of its own");
  assert.deepEqual(rows[1], ["Ravi", "9876543210", "Erode", "Called client, no answer\nWill try tomorrow", "Meta"]);
  // The half the old rule lost: Source is after Remarks, so cutting the row took it with it.
  assert.deepEqual(rows[2], AFTER);
});

test("a multi-line value in the last column is one lead", async () => {
  // No comma needed for this one: row.length is already 4 of 5, so the old rule cut every line
  // break in the final column.
  const rows = await readRows(file(["Ravi", "9876543210", "Erode", "ok", quoted("Meta\nlead form")]));

  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1], ["Ravi", "9876543210", "Erode", "ok", "Meta\nlead form"]);
  assert.deepEqual(rows[2], AFTER);
});

test("a remark of several lines and several commas is still one lead", async () => {
  const remark = "a, b\nc, d\ne, f";
  const rows = await readRows(file(["Ravi", "9876543210", "Erode", quoted(remark), "Meta"]));

  assert.equal(rows.length, 3, "each line break made its own row");
  assert.deepEqual(rows[1], ["Ravi", "9876543210", "Erode", remark, "Meta"]);
});

test("the doubled quote inside a multi-line remark is not read as damage", async () => {
  // `""` is well-formed escaping, so it must not make the field suspect and re-open the old cut.
  const remark = 'she said ""yes"", call back\nMonday';
  const rows = await readRows(file(["Ravi", "9876543210", "Erode", `"${remark}"`, "Meta"]));

  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1], ["Ravi", "9876543210", "Erode", 'she said "yes", call back\nMonday', "Meta"]);
});

test("an unescaped quote mid-value never opens a quoted field", async () => {
  // Rule 1: `5" x 7"` is ordinary album text and has to survive unquoted.
  const rows = await readRows(file(["Ravi", "9876543210", "Erode", `5" x 7" album`, "Meta"]));

  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1], ["Ravi", "9876543210", "Erode", `5" x 7" album`, "Meta"]);
});

test("a quote that never closes loses its own row and no other", async () => {
  /*
   * Rule 2, which is what the leniency is for. The remark opens a quote and closes nothing, so
   * without recovery the rest of the file is one value. The row it damages is its own; the row
   * after it has to arrive intact.
   */
  const rows = await readRows(file(["Ravi", "9876543210", "Erode", `"Bad "quote here`, "Meta"]));

  assert.equal(rows.length, 3, "the unclosed quote swallowed the rest of the file");
  assert.deepEqual(rows[2], AFTER, "the row after an unclosed quote was lost with it");
});

test("a clean quote that never closes costs its own row and no other", async () => {
  /*
   * The half that was losing leads. This quote opens cleanly, holds no stray quote and never closes,
   * and it holds one comma - so the old completeness test failed at the line break and the reader
   * carried on into the rows below, merging them in until the commas added up. Every row it absorbed
   * was a lead that never arrived.
   */
  const tail = Array.from({ length: 20 }, (unused, n) => ["Lead", `98765${String(n).padStart(5, "0")}`, "Erode", "ok", "Meta"].join(","));
  const text = `${HEADER.join(",")}\n${["Ravi", "9876543210", "Erode", '"never, closed', "Meta"].join(",")}\n${tail.join("\n")}\n`;
  const rows = await readRows(text);

  assert.equal(rows.length, 22, "an unclosed quote swallowed the rows under it");
  // Its own row is damaged - the quote made the rest of that line ambiguous - but it ends there.
  assert.deepEqual(rows[1].slice(0, 3), ["Ravi", "9876543210", "Erode"]);
  // The row directly under it, which used to be absorbed, arrives whole.
  assert.deepEqual(rows[2], ["Lead", "9876500000", "Erode", "ok", "Meta"]);
  assert.deepEqual(rows[21], ["Lead", "9876500019", "Erode", "ok", "Meta"]);
});

test("a quote left open at the end of the file ends the file", async () => {
  // Nothing follows it, so there is nothing to lose - but the reader still has to stop rather than
  // wait for a close that is never coming.
  const rows = await readRows(`${HEADER.join(",")}\n${["Ravi", "9876543210", "Erode", '"open to the end', "Meta"].join(",")}\n`);

  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1].slice(0, 3), ["Ravi", "9876543210", "Erode"]);
});

test("rows read the same however the stream is chunked", async () => {
  /*
   * Every lookahead in the reader is one character, and each one sits at a chunk boundary sooner or
   * later. A `\r\n` split across two chunks used to be readable as two line breaks, which is an
   * empty row inserted into the middle of the file.
   */
  const text = `${HEADER.join(",")}\r\n${["Ravi", "9876543210", "Erode", quoted("first, line\r\nsecond line"), "Meta"].join(",")}\r\n${AFTER.join(",")}\r\n`;
  const whole = await readRows(text);

  assert.equal(whole.length, 3);
  for (const chunkSize of [1, 2, 3, 7, 16, 64]) {
    assert.deepEqual(await readRows(text, chunkSize), whole, `read differently in ${chunkSize}-byte chunks`);
  }
});

test("a file of N records yields N rows under the header", async () => {
  // The count, said plainly, on a file built the way the reported one was: a remark over two lines
  // with a comma in it on every fourth row.
  const records = Array.from({ length: 1000 }, (unused, n) => [
    `Lead ${n}`,
    `98765${String(n).padStart(5, "0")}`,
    "Erode",
    n % 4 === 0 ? quoted(`Called, no answer\nTry ${n} again`) : "ok",
    "Meta",
  ].join(","));
  const rows = await readRows(`${HEADER.join(",")}\n${records.join("\n")}\n`);

  assert.equal(rows.length - 1, 1000);
  assert.ok(rows.slice(1).every((row) => row.length === 5), "a row was cut into the wrong number of columns");
});
