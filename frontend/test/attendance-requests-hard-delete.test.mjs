import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Delete over a selection of requests is a Super Admin's alone and removes them outright; the row's
 * own Delete is unchanged. The permissions provider carries the server's Super Admin answer.
 */
const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");
const PAGE = read("components", "hrm", "AttendanceRequestsPage.js");
const PROVIDER = read("components", "auth", "PermissionsProvider.js");

test("the selection's Delete is offered to a Super Admin alone, against the bulk route", () => {
  const call = PAGE.slice(PAGE.indexOf("const selection = useTableSelection({"), PAGE.indexOf("});", PAGE.indexOf("const selection = useTableSelection({")));
  assert.match(call, /prefix: "\/api\/hrm\/attendance\/requests",/);
  assert.match(call, /canDelete: isSuperAdmin,/);
  assert.match(call, /permanently deleted for everyone/);
});

test("the provider hands out the server's Super Admin answer", () => {
  assert.match(PROVIDER, /setIsSuperAdmin\(data\?\.isSuperAdmin === true\);/);
  assert.match(PROVIDER, /\n\s+isSuperAdmin,\n/);
});
