const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { Prisma } = require("@prisma/client");

const {
  candidateWhere,
  FILTERABLE_COLUMNS,
  FILTERABLE_TEXT_COLUMNS,
} = require("../src/modules/hrm/interview/service");

/*
 * Filtering the Interview register, and where it happens.
 *
 * The register is read a hundred rows at a time. Filtering it in the browser therefore filtered the
 * hundred rows the browser happened to hold: picking a position the column plainly listed answered
 * "no records found" over a stage holding five hundred of them, because those five hundred had not
 * been scrolled to. So the filter is a query - `candidateWhere` builds it - and the menus ask the
 * server what the column holds rather than reading it off the page in hand.
 *
 * `exceptColumn` is the part that makes the menus cascade. A menu is built under every **other**
 * column's filter, so Position on a source-filtered register offers the positions that source
 * actually holds; under its own filter as well it would offer only the values already ticked, and
 * a filter could never be widened once narrowed.
 */

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");
const SERVICE = read("src", "modules", "hrm", "interview", "service.js");
/** The same file with its comments taken out, for assertions about what the code does. */
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const CONTROLLER = read("src", "modules", "hrm", "interview", "controller.js");
const ROUTES = read("src", "modules", "hrm", "interview", "routes.js");

test("a stage and the deleted rows are always part of the query", () => {
  assert.deepEqual(candidateWhere({ status: "Selected" }), { deletedAt: null, status: "Selected" });
  // No stage is the All tab, which is every stage rather than a blank one.
  assert.deepEqual(candidateWhere({}), { deletedAt: null });
});

test("several ticked values are an `in`, one typed value is a `contains`", () => {
  // The menus are multi-select, so the common case is a list - matched exactly, because a menu
  // offers the column's own values and "Senior" must not also drag in "Senior Editor".
  assert.deepEqual(
    candidateWhere({ filters: { position: ["Photographer", "Editor"] } }).position,
    { in: ["Photographer", "Editor"] },
  );
  // A free-text column is typed into rather than picked from, so a fragment is meant to match.
  assert.deepEqual(candidateWhere({ filters: { name: "ram" } }).AND, [{ name: { contains: "ram" } }]);
  // Word Chunk Search: every word typed, in any order - "kumar ram" finds "Ram Kumar".
  assert.deepEqual(candidateWhere({ filters: { name: "kumar ram" } }).AND, [{ name: { contains: "kumar" } }, { name: { contains: "ram" } }]);
});

test("an empty filter is no filter at all", () => {
  // The table reports its filter row as it is edited, including the moment a value is cleared. A
  // blank arriving as `{ contains: "" }` matches everything, but an empty `in` matches *nothing* -
  // which is a register that empties itself when somebody unticks the last value.
  assert.deepEqual(candidateWhere({ filters: { position: [] } }), { deletedAt: null });
  assert.deepEqual(candidateWhere({ filters: { position: ["", "  "] } }), { deletedAt: null });
  assert.deepEqual(candidateWhere({ filters: { name: "   " } }), { deletedAt: null });
});

test("a column that is not filterable is ignored rather than queried", () => {
  // The filters arrive from the browser as an object of column names. Passed to Prisma unchecked,
  // an unknown key throws and a made-up one - `password`, a relation - is a query nobody wrote.
  assert.deepEqual(candidateWhere({ filters: { notAColumn: "x", "user.password": "y" } }), { deletedAt: null });
});

test("duplicates are dropped and the list is capped", () => {
  assert.deepEqual(candidateWhere({ filters: { source: ["CSV import", "CSV import"] } }).source, { in: ["CSV import"] });
  const many = Array.from({ length: 900 }, (_, index) => `value-${index}`);
  assert.equal(candidateWhere({ filters: { source: many } }).source.in.length, 500);
});

test("a column's own filter is left out of the query that builds its menu", () => {
  // Otherwise ticking one value narrows that menu to the one value ticked, and the other values the
  // column holds can never be added - the filter becomes one-way.
  const where = candidateWhere({ filters: { position: ["Editor"], source: ["CSV import"] }, exceptColumn: "position" });
  assert.equal(where.position, undefined);
  // Every *other* filter stays, which is what makes the menus cascade.
  assert.deepEqual(where.source, { in: ["CSV import"] });
});

test("all three reads answer under the same filters", () => {
  // The rows drawn, the ids a select-all resolves to, and the values a menu offers. If any one of
  // them ignored the filters, "select all" would act on rows the reader had filtered away.
  assert.match(SERVICE, /async function listCandidates\([^)]*filters = \{\}/s);
  assert.match(SERVICE, /async function listCandidateIds\(\{[^}]*filters = \{\}/s);
  assert.match(SERVICE, /async function candidateColumnValues\(\{[^}]*filters = \{\}/s);
  assert.match(SERVICE, /candidateWhere\(\{ status, filters, exceptColumn: field \}\)/);
});

test("the filters are parsed and checked before they reach a query", () => {
  assert.match(CONTROLLER, /const filtersSchema = z\.record\(/);
  assert.match(CONTROLLER, /Invalid filters parameter\./);
  // Read on all three routes, or one of them silently ignores the filter row.
  assert.equal((CONTROLLER.match(/= readFilters\(req, res\)/g) || []).length, 3);
});

test("the two filter routes are declared before the one that takes an id", () => {
  // `/candidates/:id` would otherwise swallow them and answer "candidate not found" for a filter.
  const lines = ROUTES.split("\n").map((line) => line.trim());
  const at = (needle) => lines.findIndex((line) => line.startsWith(needle));
  const byId = at('router.get("/candidates/:id"');
  assert.ok(byId > -1);
  assert.ok(at('router.get("/candidates/ids"') < byId);
  assert.ok(at('router.get("/candidates/column-values"') < byId);
});

/* ── The menu, and the ways it can come back empty ───────────────────────────────────────────── */

test("every filterable column is a real column on the candidate", () => {
  // A name that is not a column is not an error anybody sees: the read throws, the page swallows it,
  // and that column's menu is simply empty - which reads as "this column holds nothing".
  const model = Prisma.dmmf.datamodel.models.find((entry) => entry.name === "HrmInterviewCandidate");
  assert.ok(model, "HrmInterviewCandidate is not in the schema");
  const scalars = new Set(model.fields.filter((field) => field.kind === "scalar").map((field) => field.name));
  for (const column of [...FILTERABLE_COLUMNS, ...FILTERABLE_TEXT_COLUMNS]) {
    assert.ok(scalars.has(column), `${column} is offered as a filter but is not a column`);
  }
});

test("the menu query does not ask a required column not to be null", () => {
  /*
   * This is the bug the Status menu shipped with, and it is worth the test because the symptom
   * hides the cause completely.
   *
   * `{ [field]: { not: null } }` looked like a free way to keep blanks out of the menu. Prisma
   * refuses it against a **required** field - "Argument `not` must not be null" - so asking Status
   * for its values threw, the page's catch turned that into an empty list, and the Status menu was
   * blank while every other menu worked. Status is the one filterable column that cannot be null,
   * which is why it was the only one that broke.
   *
   * Blanks are dropped in code instead, where a null and the empty string a spreadsheet import
   * leaves behind are the same thing and both have to go.
   */
  // Comments stripped: the reason this is gone is written out in the service, literal and all.
  assert.doesNotMatch(stripComments(SERVICE), /\{ not: null \}/);
  assert.match(SERVICE, /const value = String\(row\?\.\[field\] \?\? ""\)\.trim\(\);\s*\n\s*if \(value\) seen\.add\(value\);/);
});

test("the register only offers a menu for a column the server will answer for", () => {
  // A column offering a menu the server does not answer for is the same empty menu again, reached
  // the other way round. The two lists are written on opposite sides of the app, so they are pinned
  // to each other here rather than left to agree by hand.
  const constants = fs.readFileSync(
    path.join(__dirname, "..", "..", "frontend", "src", "constants", "interviewConfig.js"),
    "utf8",
  );
  const block = constants.match(/export const FILTERABLE_CANDIDATE_COLUMNS = \[([^\]]*)\]/);
  assert.ok(block, "FILTERABLE_CANDIDATE_COLUMNS is not in interviewConfig.js");
  const offered = [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(offered.length, "the register offers no filter menus at all");
  for (const column of offered) {
    assert.ok(FILTERABLE_COLUMNS.has(column), `the register offers a ${column} menu the server will not answer`);
  }
});
