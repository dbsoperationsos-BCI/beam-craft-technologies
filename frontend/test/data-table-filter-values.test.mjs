import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { matchesWordChunks } from "../src/lib/wordChunks.mjs";

/*
 * A header's filter takes a typed value or a picked list, and both have to work.
 *
 * It used to be a box somebody typed into, so a column that declared no filter of its own fell to
 * TanStack's guess - `includesString` for a column of text. The header picks from a list now
 * wherever a column's values are a set, and a picker hands back an **array**: `includesString`
 * stringifies that, so ticking two options searched for the literal `"a,b"` and matched nothing. The
 * column stopped filtering altogether, in every table that had not written a filter of its own.
 *
 * The rule is re-implemented here rather than imported, because `DataTable.js` is a React module
 * this suite has no DOM for. The assertion at the end holds the two in step.
 */
function defaultFilterFn(row, columnId, filterValue) {
  const text = String(row.getValue(columnId) ?? "").trim().toLowerCase();
  if (Array.isArray(filterValue)) {
    if (!filterValue.length) return true;
    return filterValue.some((value) => {
      const wanted = String(value ?? "").trim().toLowerCase();
      return wanted === text || (Boolean(wanted) && text.includes(wanted));
    });
  }
  return matchesWordChunks(text, filterValue);
}

const row = (value) => ({ getValue: () => value });
const matches = (value, filterValue) => defaultFilterFn(row(value), "x", filterValue);

test("a typed value filters exactly as it always did", () => {
  assert.equal(matches("Candid Photo", "candid"), true, "contained, ignoring case");
  assert.equal(matches("Candid Photo", "drone"), false);
  assert.equal(matches("Candid Photo", ""), true, "an empty box is not a filter");
  assert.equal(matches(null, "x"), false);
  assert.equal(matches("Candid Photo", "photo cand"), true, "words typed in any order");
});

test("several typed chunks keep a row holding every one of them, each anywhere - Word Chunk Search", () => {
  const rows = ["WED other 366895", "WED second 366895", "WED first 366895", "dxcfghjk", "Pre Wedding · qwer"];
  const kept = (typed) => rows.filter((value) => matches(value, typed));
  assert.deepEqual(kept("we ot"), ["WED other 366895"], "a chunk matches inside a word, not only at its start");
  assert.deepEqual(kept("we se"), ["WED second 366895"]);
  assert.deepEqual(kept("we fi"), ["WED first 366895"]);
  assert.deepEqual(kept("wed other"), ["WED other 366895"]);
  assert.deepEqual(kept("other"), ["WED other 366895"]);
  assert.deepEqual(kept("second"), ["WED second 366895"]);
  assert.deepEqual(kept("WE OT"), kept("we ot"), "case does not matter");
  assert.deepEqual(kept("  we   ot  "), kept("we ot"), "extra spaces do not matter");
  assert.deepEqual(kept(""), rows, "an empty box keeps every row");
  assert.deepEqual(kept("zzz qq"), [], "nothing matching keeps nothing");
  assert.deepEqual(kept("(we) [ot"), [], "brackets are searched as text, never as a pattern");
});

test("a picked list matches a row that is any of the ticked values", () => {
  assert.equal(matches("Outgoing", ["Incoming", "Outgoing"]), true);
  assert.equal(matches("Missed", ["Incoming", "Outgoing"]), false);
  assert.equal(matches("Yes", ["Yes"]), true);
  assert.equal(matches("No", ["Yes"]), false);
});

test("an empty list keeps every row, rather than none", () => {
  // Clearing the last tick must not leave the column filtering on nothing.
  assert.equal(matches("anything", []), true);
});

test("the literal joined string that used to be searched for matches nothing now", () => {
  // `String(["Incoming","Outgoing"])` is "Incoming,Outgoing" - the bug, written out.
  assert.equal(matches("Incoming", "Incoming,Outgoing"), false);
  assert.equal(matches("Incoming", ["Incoming", "Outgoing"]), true, "and the list itself does match");
});

test("a column that wrote its own filter keeps it", () => {
  const source = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "data-table", "DataTable.js"), "utf8");
  assert.match(source, /const filterFn = typeof column\.filterFn === "function" \? column\.filterFn : defaultFilterFn;/);
  // A column naming one of TanStack's by string takes the default instead, since a named one cannot
  // read a list either.
  assert.match(source, /function defaultFilterFn\(row, columnId, filterValue\)/);
});

test("the rule here is the rule the table runs", () => {
  // Re-implemented above for want of a DOM; if one moves without the other, this fails.
  const source = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "data-table", "DataTable.js"), "utf8");
  const body = source.slice(source.indexOf("function defaultFilterFn"), source.indexOf("/*\n * Filtering a table of projects"));
  const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim();
  assert.equal(strip(body), strip(defaultFilterFn.toString()));
});
