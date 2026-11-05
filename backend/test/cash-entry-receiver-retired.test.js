const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CONTROLLER = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "accounts", "cash-entries", "controller.js"), "utf8");
const { handlerFields } = require("../src/modules/accounts/cash-entries/controller");
const { mapHeaders } = require("../src/services/tableImport");
const SCHEMA = fs.readFileSync(path.join(__dirname, "..", "prisma", "schema.prisma"), "utf8");
const IMPORTER = fs.readFileSync(path.join(__dirname, "..", "src", "services", "tableImport.js"), "utf8");

/**
 * A payment **received through a mode that carries a remark** no longer names who received it.
 *
 * Which is "Other" out of the box: a payment that arrived by some arrangement the list does not name,
 * where the remark says what actually happened and the person filing it is the person it happened to
 * - so the Receiver box asked the form to repeat what the login already says, on the form that books
 * a project.
 *
 * Every other mode is untouched, in both directions. Money received by cash, UPI or a transfer still
 * names who took it, and the studio's own money leaving through somebody's hands always names them.
 */

test("a receiver is asked of everything but a received payment whose mode carries a remark", () => {
  // The import may also leave an expense's handler empty (`spentPartiesOptional`); the form may not.
  assert.match(CONTROLLER, /const asksHandler = !\(value\.entryType === "Received" && withDetails\.includes\(value\.paymentMode\)\)\s*\n\s*&& !\(value\.entryType === "Spent" && spentPartiesOptional\);/);
  assert.match(CONTROLLER, /const entrySchema = entryFields\.superRefine\(entryRules\(\)\);/);
  assert.match(CONTROLLER, /if \(asksHandler\) \{/);
  // The question is still direction-dependent, because it is still asked of money received by every
  // other mode - "Receiver" there, "Paid By" on money out.
  assert.match(CONTROLLER, /const who = received \? "received the money" : transfer \? "made the transfer" : "paid the money out";/);
  assert.match(CONTROLLER, /issue\("handlerName", `Enter who \$\{who\}`\)/);
  assert.match(CONTROLLER, /issue\("handlerEmployeeId", `Choose the employee who \$\{who\}`\)/);
});

test("a received entry records nobody, and an edit to an old one cannot erase its receiver", async () => {
  /*
   * **No keys, rather than nulls**, and that distinction is the whole of it: this runs on the way
   * into an update as well as a create, and the form no longer sends a handler. Nulls were therefore
   * written straight over the receiver an older receipt already held - losing it the first time
   * anybody corrected an amount on it, which is exactly what the migration promises cannot happen.
   * Omitting the keys leaves those columns as they are, and on a create there is nothing to leave.
   */
  assert.deepEqual(await handlerFields({ entryType: "Received" }), {});
  // "Named by hand" with no name counts as nothing given too: it would otherwise store a handler
  // marked as being off the payroll whom nobody named, which reads as an em dash where a name goes.
  assert.deepEqual(await handlerFields({ entryType: "Received", handlerIsOther: true }), {});

  /*
   * What a payment request supplies is still stored. An approved request can file money *in* - a
   * settlement where the studio spent less than it advanced - and it names who took it; that path is
   * not subject to the form's rule, so refusing to record it would throw away the one receiver still
   * being written down.
   */
  assert.deepEqual(await handlerFields({ entryType: "Received", handlerIsOther: true, handlerName: "Ravi" }), {
    handlerEmployeeId: null,
    handlerName: "Ravi",
    handlerIsOther: true,
  });
});

test("an old heading still reads, and the current one wins where a file carries both", () => {
  /*
   * Headings are matched by name, so renaming a column stops it being found in a spreadsheet the
   * studio saved earlier - and this one is not required, so the import would have succeeded with the
   * remark quietly missing rather than refusing the file.
   */
  const columns = [
    { field: "paymentModeOther", label: "Remarks", aliases: ["Payment Mode Details"] },
    { field: "amount", label: "Amount", required: true },
  ];
  const old = mapHeaders(columns, ["Amount", "Payment Mode Details"]);
  assert.deepEqual(old.mapped.map((column) => [column.field, column.index]), [["paymentModeOther", 1], ["amount", 0]]);
  assert.deepEqual(old.unknown, [], "the old heading is claimed, so it is not reported as a stray column");

  // Both headings present: the current name is read, and the old one is then a column nothing claims.
  const both = mapHeaders(columns, ["Amount", "Payment Mode Details", "Remarks"]);
  assert.equal(both.mapped.find((column) => column.field === "paymentModeOther").index, 2);

  // A column with no aliases behaves exactly as it did, including what it reports missing.
  const plain = mapHeaders([{ field: "amount", label: "Amount", required: true }], ["Something Else"]);
  assert.deepEqual(plain.missing, ["Amount"]);
  assert.deepEqual(plain.unknown, ["Something Else"]);
});

test("no two columns in one set answer to the same heading", () => {
  /*
   * An alias is a second name for a column, and nothing stops somebody giving one column a name
   * another column already answers to - both would then read the same cell, and which field got the
   * value would depend on the order of the list. Cheap to assert, and the only guard there is.
   */
  const { CASH_ENTRY_IMPORT_COLUMNS } = require("../src/modules/accounts/cash-entries/controller");
  const seen = new Map();
  for (const column of CASH_ENTRY_IMPORT_COLUMNS || []) {
    for (const heading of [column.label, ...(column.aliases || [])]) {
      const key = String(heading).trim().toLowerCase();
      assert.equal(seen.has(key), false, `"${heading}" is claimed by both ${seen.get(key)} and ${column.field}`);
      seen.set(key, column.field);
    }
  }
  assert.ok(seen.size > 0, "the cash book's import columns should be exported for this check");
});

test("nothing is stored in its place, and nothing supplied is thrown away", () => {
  /*
   * Null, not an empty string - which would read as a receiver called "" - and not the person filing
   * it, which would be this table answering a question nobody asked.
   *
   * Only where nothing was given, though. An approved payment request can file money **in** - a
   * settlement where the studio spent less than it advanced, so the balance comes back - and it names
   * who took it. That path is not subject to the form's rule, and refusing to store what it supplies
   * would throw away the one receiver still being recorded.
   */
  // Any entry naming nobody - money in by a mode with a remark, or an expense imported without one.
  assert.match(CONTROLLER, /if \(!input\.handlerEmployeeId && !input\.handlerName\) \{\s*\n\s*return \{\};/);
  // Which the column has to be able to say, so it is nullable - and every entry already filed keeps
  // the receiver it was filed with.
  assert.match(SCHEMA, /handlerName\s+String\?\s+@map\("handler_name"\)/);
  // An imported row with a blank Handled By is unknown too, rather than a handler called "".
  assert.match(CONTROLLER, /if \(!name\) return \{ handlerEmployeeId: null, handlerName: null, handlerIsOther: false \};/);
});

test("the mode's own box is a remark, and the old import heading still reads", () => {
  assert.match(CONTROLLER, /issue\("paymentModeOther", "Add a remark for this payment mode"\)/);
  /*
   * Renamed rather than replaced, so every explanation already recorded reads back under the new
   * name. Headings are matched by name, though, so the old spelling has to keep working or a
   * spreadsheet saved before the rename would import with the remark quietly missing - it is not a
   * required column, so nothing would have refused the file.
   */
  assert.match(CONTROLLER, /\{ field: "paymentModeOther", label: "Remarks", aliases: \["Payment Mode Details"\] \}/);
  assert.match(IMPORTER, /const headingsOf = \(column\) => \[column\.label, \.\.\.\(column\.aliases \|\| \[\]\)\]/);
  // The current name is tried first, so a file carrying both headings reads the new one.
  assert.match(IMPORTER, /const index = headingsOf\(column\)\.map\(\(heading\) => seen\.get\(heading\)\)\.find\(\(at\) => at !== undefined\);/);
});

test("what it costs is written down where the column is", () => {
  /*
   * `handlerEmployeeId` is one of the three columns `dataScope` narrows this table by, so an entry
   * that names no receiver is reachable through its branch or whoever created it and not through a
   * receiver it does not have. That is a visibility change, not only a form change, and the schema is
   * where somebody reading this table would look for it.
   */
  assert.match(SCHEMA, /`handlerEmployeeId` is one of the columns `dataScope` narrows this/);
  assert.match(CONTROLLER, /const CASH_SCOPE_COLUMNS = \{ branch: "branchId", employee: "handlerEmployeeId", user: "createdBy" \};/);
});
