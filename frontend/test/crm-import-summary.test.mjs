import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * The CSV import's finished summary: one object, written in one place and read in another.
 *
 * `CRMPage.js` is JSX and cannot be imported by `node --test`, so this reads it as text - the same
 * way `crm-bulk-import.test.mjs` reads the dialog. What is worth pinning is not the wording of the
 * lines but that the two halves name the same field, because they did not: the tally was written
 * under `branches` and read as `verticals`, so `Object.entries(summary.verticals)` threw "Cannot
 * convert undefined or null to object" on every completed import - after the leads had been written,
 * taking the whole board down with it. A rename on one side is silent until somebody imports a file.
 */

const PAGE = fs.readFileSync(
  path.join(import.meta.dirname, "..", "src", "components", "sales", "CRMPage.js"),
  "utf8",
);

/** The object literal the CSV run builds when it finishes, as source. */
function summaryLiteral() {
  const start = PAGE.indexOf("      summary = {");
  assert.notEqual(start, -1, "the CSV import no longer builds a summary object");
  return PAGE.slice(start, PAGE.indexOf("\n      };", start));
}

/** The body of `importSummaryRows`, which renders it. */
function reader() {
  const start = PAGE.indexOf("export function importSummaryRows(summary) {");
  assert.notEqual(start, -1, "importSummaryRows is gone");
  return PAGE.slice(start, PAGE.indexOf("\n}\n", start));
}

test("every field the import summary is read for is a field it is written with", () => {
  const written = new Set([...summaryLiteral().matchAll(/^\s{8}(\w+)\s*[:,]/gm)].map((match) => match[1]));
  const read = new Set([...reader().matchAll(/summary\??\.(\w+)/g)].map((match) => match[1]));

  // `table` is written too, and is the fallback when no vertical was tallied.
  for (const field of read) {
    assert.ok(written.has(field), `importSummaryRows reads summary.${field}, which the import never writes`);
  }
  // The one the crash was about, named explicitly so a rename cannot quietly satisfy the loop above
  // by renaming both sides to something the server does not send.
  assert.ok(read.has("verticals"), "the summary no longer reports which system tables the rows landed in");
  assert.ok(written.has("verticals"), "the import writes the tally under some other name again");
  assert.doesNotMatch(summaryLiteral(), /branches:/, "the tally is back under a name nothing reads");
});

test("the tally is filled from the field the server actually answers with", () => {
  /*
   * The server replies `{ imported, skipped, overwritten, verticals }` per chunk. If the accumulator
   * reads anything else the summary is a column of zeroes, which is a quieter version of the same
   * fault - it reports a clean import of nothing.
   */
  assert.match(PAGE, /for \(const \[name, count\] of Object\.entries\(data\.verticals \|\| \{\}\)\) \{/);
});

test("a summary that arrives short prints a line short, not a crash", () => {
  /*
   * The dialog renders this straight, so anything that throws here is thrown during render and the
   * board goes with it. Defaults rather than assumptions: the numbers coerce and the tally defaults
   * to an empty object, so the next drift costs a missing line instead of the page.
   */
  const body = reader();
  assert.match(body, /Object\.entries\(summary\?\.verticals \|\| \{\}\)/, "the tally is read without a default again");
  assert.doesNotMatch(
    body,
    /summary\.(imported|rows|skipped|overwritten|failed)\.toLocaleString\(\)/,
    "a number is read straight off the summary again, which throws when it is missing",
  );
});
