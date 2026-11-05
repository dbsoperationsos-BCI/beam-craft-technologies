import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PAYMENT_MODES, RECEIVED_CATEGORIES, SPENT_CATEGORIES, TRANSFER_CATEGORY, accountsListFilters, accountsTableFields } from "../src/constants/accountsConfig.js";

const read = (file) => fs.readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");

/*
 * Accounts Manager's filters: only the columns holding a short set of named values are a
 * multi-select; IDs, names, amounts, references and notes are typed into, however few rows there are.
 */
test("only the set-like accounts columns filter by a multi-select list", () => {
  assert.deepEqual(accountsListFilters, ["entryType", "source", "category", "branch", "toBranchName", "paymentMode", "receivedAccount", "paidFromAccount", "handlerName"]);
  const columns = new Set(accountsTableFields.map(([key]) => key));
  for (const key of accountsListFilters) assert.ok(columns.has(key), `${key} is an accounts column`);
  assert.match(read("components/accounts/AccountsTable.js"), /listFilters: accountsListFilters,/);
  // A column left out of the list is marked a typed filter, and the table derives no choices for it.
  assert.match(read("components/data-table/tableCells.js"), /\.\.\.\(listed && !listed\.has\(accessorKey\) \? \{ filter: "text" \} : \{\}\)/);
  assert.match(read("components/data-table/DataTable.js"), /column\.enableColumnFilter === false \|\| filterKindFor\(column\) === "text"\) continue;/);
});

/*
 * The category and the payment mode answer from a list the studio keeps, so their filters list all of
 * it rather than the values the loaded rows happen to hold.
 *
 * The bug this pins: the cash book's Category filter was derived from the rows on screen, so it
 * offered only the categories that already had an entry. "Vendor Payment" was not on it until the
 * first vendor payment was approved - and the entry that approval wrote could not be filtered for
 * until the page was read again. A filter that cannot name an empty category is a filter nobody can
 * use to check whether it is empty.
 */
test("the category and payment mode filters list what the studio keeps, not what is on screen", () => {
  const optionsFor = (key) => (accountsTableFields.find(([field]) => field === key) || [])[5];
  const categories = optionsFor("category");
  assert.ok(Array.isArray(categories), "the Category column names its own list");
  for (const value of [...RECEIVED_CATEGORIES, ...SPENT_CATEGORIES, TRANSFER_CATEGORY]) {
    assert.ok(categories.includes(value), `${value} can be filtered for before anything is filed under it`);
  }
  assert.deepEqual(optionsFor("paymentMode"), PAYMENT_MODES);

  const cells = read("components/data-table/tableCells.js");
  // The sixth element of a field becomes the column's own list, after the statuses so it wins.
  assert.match(cells, /\.\.\.fields\.map\(\(\[accessorKey, header, type, size, minSize, filterOptions\]\)/);
  assert.match(cells, /\.\.\.\(Array\.isArray\(filterOptions\) && filterOptions\.length \? \{ filterOptions \} : \{\}\)/);
  // And a column with its own list is answered by `knownFilterValues`, which also keeps whatever the
  // rows hold beyond it - a category since renamed stays reachable from its own filter.
  assert.match(read("components/data-table/DataTable.js"), /const ownList = Array\.isArray\(column\.meta\?\.filterOptions\)/);
  assert.match(read("components/data-table/DataTable.js"), /if \(ownList \|\| listKind\) \{\n\s*choices\[key\] = knownFilterValues\(/);
});
