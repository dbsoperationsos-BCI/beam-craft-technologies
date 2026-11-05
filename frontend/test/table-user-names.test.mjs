import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const table = fs.readFileSync(new URL("../src/components/data-table/DataTable.js", import.meta.url), "utf8");

/*
 * Every table names who created or changed a row: a raw user-id field is never offered as a column,
 * and the name the server sends beside it reads "Created By".
 */
test("a user id is never a column; the name beside it is, headed by who", () => {
  assert.match(table, /const USER_ID_FIELD = \/\(\?:By\|ByUserId\|ById\)\$\/;/);
  assert.match(table, /fields\.filter\(\(field\) => !configured\.has\(field\) && !isUserIdField\(field, data\)\)/);
  assert.match(table, /const shown = \/ByName\$\/\.test\(field\) \? String\(field\)\.replace\(\/Name\$\/, ""\) : field;/);
});
