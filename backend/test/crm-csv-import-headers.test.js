const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { VERTICAL_TEMPLATE_HEADERS, assertHeadersMatchVertical } = require("../src/modules/sales/crm-leads/csvImportService");
const { resolveColumnMapping } = require("../src/modules/sales/crm-leads/googleSheetsService");

/*
 * The CSV a user imports is the one the Download CSV Template button wrote, and that button
 * writes `boardTableColumns` from the CRM page. So the columns this module insists on are
 * only correct if they are that same list - and when they were not, every templated file was
 * refused ("Missing 1 column: Verticals") for a column no template has ever carried.
 *
 * The frontend cannot be required from here: it is a React module in another package. Its
 * definition is read as text instead, which is enough to compare the two lists and is what
 * makes them impossible to drift apart again unnoticed.
 */
function frontendTableColumns() {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "..", "frontend", "src", "components", "sales", "CRMPage.js"),
    "utf8",
  );
  const start = source.indexOf("const boardTableColumns = {");
  assert.notEqual(start, -1, "boardTableColumns was not found in CRMPage.js");
  const block = source.slice(start, source.indexOf("\n};", start));

  const tables = {};
  let current = null;
  for (const line of block.split("\n")) {
    const table = line.match(/^ {2}"?([A-Za-z ]+?)"?: \[/);
    if (table) {
      current = table[1];
      tables[current] = [];
      continue;
    }
    const label = line.match(/label: "([^"]+)"/);
    if (label && current) tables[current].push(label[1]);
  }
  return tables;
}

/*
 * Calls is a board, not an import target.
 *
 * It holds the Callyzer calls nobody has placed yet, and a call reaches the CRM from Callyzer and
 * from nowhere else - so it has table columns of its own but no CSV template, and the dialog never
 * offers it. Named here rather than filtered silently, so a table that stops being importable has
 * to say so.
 */
const NOT_IMPORTABLE = ["Calls"];

test("every system table requires exactly the columns its template writes", () => {
  const frontend = frontendTableColumns();
  for (const board of NOT_IMPORTABLE) {
    assert.ok(frontend[board], `${board} is no longer a table on the CRM page`);
    delete frontend[board];
  }
  assert.deepEqual(Object.keys(frontend).sort(), Object.keys(VERTICAL_TEMPLATE_HEADERS).sort());

  for (const [vertical, columns] of Object.entries(frontend)) {
    assert.deepEqual(
      [...VERTICAL_TEMPLATE_HEADERS[vertical]].sort(),
      [...columns].sort(),
      `${vertical} requires different columns from the ones its CSV template carries`,
    );
  }
});

// The vertical is the table picked in the dialog, so no template asks for it.
test("no table asks the file to name its own vertical", () => {
  for (const [vertical, headers] of Object.entries(VERTICAL_TEMPLATE_HEADERS)) {
    assert.ok(!headers.includes("Verticals"), `${vertical} still requires a Verticals column`);
  }
});

test("a file built from the template is accepted for its own table", () => {
  for (const [vertical, headers] of Object.entries(VERTICAL_TEMPLATE_HEADERS)) {
    assert.doesNotThrow(() => assertHeadersMatchVertical(headers, vertical));
  }
});

// Old exports still carry a Verticals column, and re-saving a template adds and reorders
// nothing that should matter: extra columns are ignored and headings match on letters alone.
test("extra columns, reordering and re-punctuated headings are still accepted", () => {
  const headers = ["Verticals", ...VERTICAL_TEMPLATE_HEADERS["Qua Qua"]].reverse().map((header) => header.toUpperCase());
  assert.doesNotThrow(() => assertHeadersMatchVertical([...headers, "Some Column Nobody Reads"], "Qua Qua"));
});

test("a file for another table is refused, and named", () => {
  assert.throws(
    () => assertHeadersMatchVertical(VERTICAL_TEMPLATE_HEADERS.Corp, "Dum Dum"),
    /looks like a Corp export but Dum Dum is selected/,
  );
});

/*
 * A column a file does not carry imports empty, exactly as a column left blank in it does.
 *
 * The check used to demand a table's full set, which was too strong for what it protects against:
 * adding Last Followup Date and Next followup Date to Dum Dum invalidated every template anybody
 * had already downloaded - a file named `crm-dum-dum-template.csv`, written by this application,
 * refused by this application - and a file built by hand with the columns a studio actually keeps
 * was refused outright.
 */
test("a file missing a table's optional columns is imported, not refused", () => {
  const full = VERTICAL_TEMPLATE_HEADERS["Dum Dum"];
  const withoutFollowUps = full.filter((header) => !/followup date/i.test(header));
  assert.equal(withoutFollowUps.length, full.length - 2, "the two follow-up date columns have been renamed");
  assert.doesNotThrow(() => assertHeadersMatchVertical(withoutFollowUps, "Dum Dum"), "an older template is refused again");
  assert.doesNotThrow(() => assertHeadersMatchVertical(["Enquiry Name", "Phone Number"], "Dum Dum"));
  assert.doesNotThrow(() => assertHeadersMatchVertical(["Enquiry Name", "Phone Number", "Status", "City"], "Dum Dum"));
});

test("a file with nothing to make a lead from is refused", () => {
  // Both are shared by all three tables, so this is not a per-table rule.
  assert.throws(() => assertHeadersMatchVertical(["Enquiry ID", "Enquiry Name"], "Dum Dum"), /no Phone Number column/);
  assert.throws(() => assertHeadersMatchVertical(["Enquiry ID", "Phone Number"], "Dum Dum"), /no Enquiry Name column/);
  assert.throws(() => assertHeadersMatchVertical([], "Dum Dum"), /no column headings/);
  assert.throws(() => assertHeadersMatchVertical(["Enquiry ID"], "Weddings"), /is not a CRM system table/);
});

/*
 * The wrong table is what the check is really for, and the one thing leniency must not cost. The
 * three tables share sixteen columns, so a Qua Qua export picked as Dum Dum would put sixteen
 * columns of real data into the wrong vertical with the ten that make a Dum Dum lead left blank.
 */
test("another table's export is still refused, and named", () => {
  const quaQua = ["Enquiry Name", "Phone Number", "Shoot ID", "Baby (or) Mother Name", "Date of Birth (or) EDOD"];
  assert.throws(() => assertHeadersMatchVertical(quaQua, "Dum Dum"), /looks like a Qua Qua export/);

  const corp = ["Enquiry Name", "Phone Number", "Company Name (or) Client organisation", "Designation"];
  assert.throws(() => assertHeadersMatchVertical(corp, "Dum Dum"), /looks like a Corp export/);

  // ...but only when the file carries none of the chosen table's own columns. A studio keeping one
  // spreadsheet for everything has a file that genuinely belongs to both, and it is not somebody
  // else's export.
  assert.doesNotThrow(() => assertHeadersMatchVertical([...quaQua, "Groom Name"], "Dum Dum"));
});

/*
 * Passing the header check only means the file was let in; it says nothing about whether the
 * values behind those headings are kept. A template column that no field claims is read by
 * nobody and lands in no lead - which is how "Enquiry Date" and Qua Qua's "Contact" were
 * silently dropped from every import while the file itself was accepted.
 */
test("every column a template writes lands in a lead field", () => {
  for (const [vertical, headers] of Object.entries(VERTICAL_TEMPLATE_HEADERS)) {
    const mapping = resolveColumnMapping(headers, vertical);
    const claimed = new Set(Object.values(mapping.fields || {}).map((field) => field.columnIndex));
    const unmapped = headers.filter((_, index) => !claimed.has(index));
    assert.deepEqual(unmapped, [], `${vertical} writes columns that import into nothing`);
  }
});

/*
 * Two headings that both read as a phone number must not take each other's column.
 *
 * Aliases are matched in declaration order over the columns still free, so a pair like this is what
 * breaks first if that order moves - `contactNumber` lists both "contactnumber" and "contact", and
 * either could swallow "Phone Number" if the alias lists were reordered.
 *
 * Qua Qua used to be that pair: it headed one column "Contact" and another "Phone Number". The
 * "Contact" column has been dropped - it held the same number the Phone Number column did, and the
 * board asked for it twice, once in the grid and again in the lead popup directly under the Contact
 * that shows the enquiry number. Corp still carries the pair, so the guard moves there.
 */
test("Phone Number and Contact Number do not take each other's column", () => {
  const corp = VERTICAL_TEMPLATE_HEADERS.Corp;
  const mapping = resolveColumnMapping(corp, "Corp");
  assert.equal(corp[mapping.fields.phone.columnIndex], "Phone Number");
  assert.equal(corp[mapping.fields.contactNumber.columnIndex], "Contact Number");

  // Qua Qua has one number column now, and it is the enquiry number.
  const quaQua = VERTICAL_TEMPLATE_HEADERS["Qua Qua"];
  const quaQuaMapping = resolveColumnMapping(quaQua, "Qua Qua");
  assert.equal(quaQua[quaQuaMapping.fields.phone.columnIndex], "Phone Number");
  assert.equal(quaQuaMapping.fields.contactNumber, undefined, "Qua Qua asks for a contact number again");
  assert.ok(!quaQua.includes("Contact"), "the Contact column is back in the Qua Qua template");
  assert.ok(!quaQua.includes("Date"), "the Date column is back in the Qua Qua template");
});

/*
 * "Nearest Branch" is where a lead is handled - Erode, Hyderabad - and not which of the three
 * verticals it belongs to. It was listed as an alias of both, and fields claim columns in
 * declaration order, so the vertical took it first: every imported lead lost its Nearest Branch,
 * and a cell reading "WED" was taken for the lead's vertical and moved it to another table.
 */
test("Nearest Branch is the lead's branch, not its vertical", () => {
  for (const [name, headers] of Object.entries(VERTICAL_TEMPLATE_HEADERS)) {
    const mapping = resolveColumnMapping(headers, name);
    assert.equal(
      headers[mapping.fields.assignedBranch?.columnIndex],
      "Nearest Branch",
      `${name} does not map Nearest Branch onto assignedBranch`,
    );
    assert.equal(mapping.fields.vertical, undefined, `${name} reads a vertical out of one of its own columns`);
  }
});

/*
 * ── Nearest Branch is the studio's branch, not the file's spelling ────────────────────────────
 *
 * A file's Nearest Branch column is typed by whoever exported it: "Erode" for `Erode TN`, "Vizag"
 * for `Visakhapatnam AP`. `branch_id` beside it was always resolved through `referenceMatchers`, so
 * the scoped reads were right — but the *text* was stored verbatim, and the text is what the lead
 * popup and Add Lead show through a picker built from the branch table. A lead filed under the
 * right branch therefore displayed a branch that matched no option in the picker.
 *
 * Both halves now come from one match against that table. The rule itself lives in
 * `referenceMatchers` and is replayed against real rows by `data-scope-backfill.test.js`; what
 * these hold is that the import paths use it for the name as well as for the id, and that no branch
 * is written down in any of them.
 */

const { branchMatcher } = require("../src/services/referenceMatchers");

test("the branch text stored is the branch register's own name", () => {
  const branches = [
    { id: 1, name: "Erode TN" },
    { id: 2, name: "Visakhapatnam AP" },
    { id: 3, name: "Bangalore KA" },
  ];
  const match = branchMatcher(branches);
  const nameFor = (value) => match(value).target?.name ?? value;

  assert.equal(nameFor("Erode"), "Erode TN", "the name without the state keyword is that branch");
  assert.equal(nameFor("erode tn"), "Erode TN", "case and spacing are not a different branch");
  assert.equal(nameFor("Visakhapatnam"), "Visakhapatnam AP");
  /*
   * `Vizag` is the studio's own name for `Visakhapatnam AP` - not a shortening of it, which is why
   * the "and nothing shorter" rule cannot reach it, and why it is carried as a named alias instead.
   * A file typed that way is filed under the branch it means, and stored reading the way the
   * register spells it.
   */
  assert.equal(nameFor("Vizag"), "Visakhapatnam AP");
  assert.equal(nameFor(" VIZAG "), "Visakhapatnam AP", "case and surrounding space are not a different branch");
  /*
   * Text naming no branch is still given back as it arrived rather than blanked: an unrecognised
   * value is something somebody has to look at, and an empty Assigned Branch would hide that the
   * file said something unexpected. A guess at a branch is not an alias - the list is one entry
   * long and everything outside it is still refused.
   */
  for (const guess of ["viza", "vizagg", "erd", "Dsa"]) assert.equal(nameFor(guess), guess);
  assert.equal(nameFor(""), "");
});

test("every path that writes a lead takes its branch name from the same match as its branch id", () => {
  const read = (file) => fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "crm-leads", file), "utf8");

  // The CSV import: after the spread, so it replaces the file's own spelling rather than the other
  // way round - which is the ordering the whole fix turns on.
  const csv = read("csvImportService.js");
  assert.match(csv, /\.\.\.columns,[\s\S]{0,900}assignedBranch: refs\.branchName\(columns\.assignedBranch\)/);
  assert.match(csv, /branchId: refs\.branchId\(columns\.assignedBranch\)/);

  // The sheet sync, which takes hand-typed branches for the same reason a CSV does.
  assert.match(read("googleSheetsService.js"), /data\.assignedBranch = refs\.branchName\(data\.assignedBranch\)/);

  // And every save through the application, so a lead written by any door reads the same afterwards.
  assert.match(read("crmLeadService.js"), /columns\.assignedBranch = \(await referenceLookups\(\)\)\.branchName\(columns\.assignedBranch\)/);
});

test("no branch name is written down in the import paths", () => {
  /*
   * The point of the register. Three files each held a hard-coded list of six branches once - the
   * CRM's picker, the quotation's and the import dialog's - and every one of them named branches
   * the studio does not have. A name typed into an import path is that fault growing back.
   */
  for (const file of ["csvImportService.js", "googleSheetsService.js", "crmLeadService.js"]) {
    const source = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "crm-leads", file), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const branch of ["Erode TN", "Tiruppur TN", "Coimbatore TN", "Bangalore KA", "Hyderabad TL", "Visakhapatnam AP"]) {
      assert.ok(!code.includes(branch), `${file} should not name ${branch} - the branch table is the list`);
    }
  }
});
