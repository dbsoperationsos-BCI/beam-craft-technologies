import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ASSET_IMPORT_COLUMNS,
  CASH_ENTRY_IMPORT_COLUMNS,
  CLIENT_STORAGE_IMPORT_COLUMNS,
  EMPLOYEE_IMPORT_COLUMNS,
  PROJECT_IMPORT_COLUMNS,
  VENDOR_IMPORT_COLUMNS,
} from "../src/constants/importColumns.js";

/*
 * The browser's copy of each module's import columns, held to the server's.
 *
 * Both sides declare them: the server so it can map a file's headings onto its own schema, the
 * browser so it can write the template and judge a file before uploading it. If they drift, the
 * template a studio downloads is one the server refuses - which is the most confusing possible
 * failure, because the file came from the application itself.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.join(HERE, "..", "..", "backend", "src", relative), "utf8");

const MODULES = [
  ["Vendor Management", VENDOR_IMPORT_COLUMNS, "modules/assets/vendors.controller.js", "VENDOR_IMPORT_COLUMNS"],
  ["Asset Management", ASSET_IMPORT_COLUMNS, "modules/assets/assets.controller.js", "ASSET_IMPORT_COLUMNS"],
  ["Client Storage", CLIENT_STORAGE_IMPORT_COLUMNS, "modules/assets/client-storage.controller.js", "CLIENT_STORAGE_IMPORT_COLUMNS"],
  ["Employee Repository", EMPLOYEE_IMPORT_COLUMNS, "modules/hrm/employees/controller.js", "EMPLOYEE_IMPORT_COLUMNS"],
  ["Accounts", CASH_ENTRY_IMPORT_COLUMNS, "modules/accounts/cash-entries/controller.js", "CASH_ENTRY_IMPORT_COLUMNS"],
  ["Bookings & Projects", PROJECT_IMPORT_COLUMNS, "modules/sales/projects/controller.js", "PROJECT_IMPORT_COLUMNS"],
];

/** The `{ field, label, required }` triples the server declares, read out of its source. */
function serverColumns(source, name) {
  const block = source.slice(source.indexOf(`const ${name} = [`));
  const list = block.slice(0, block.indexOf("\n];"));
  return [...list.matchAll(/\{ field: "([^"]+)", label: "([^"]+)"(, required: true)?/g)]
    .map((match) => ({ field: match[1], label: match[2], required: Boolean(match[3]) }));
}

test("every module's columns are the same on both sides", () => {
  for (const [label, browser, file, name] of MODULES) {
    const server = serverColumns(read(file), name);
    assert.ok(server.length, `${label}: the server declares no ${name}`);
    assert.deepEqual(
      browser.map((column) => ({ field: column.field, label: column.label, required: column.required })),
      server,
      `${label}: the template the browser writes is not the file the server accepts`,
    );
  }
});

test("every module names at least one column a file must carry, or none at all", () => {
  /*
   * Both are legitimate and the difference is meaningful. A vendor has to be called something, so a
   * file without that column is refused outright. A client storage record is entirely made up of
   * optional detail, so any subset of its columns is a usable file - and demanding one would refuse
   * files that are perfectly importable.
   */
  for (const [label, columns] of MODULES) {
    const required = columns.filter((column) => column.required);
    assert.ok(columns.length, `${label} declares no columns at all`);
    if (label === "Client Storage") assert.equal(required.length, 0, "a storage record has no required field");
    else assert.ok(required.length, `${label} names no required column, so an empty file would be accepted`);
  }
});

test("no module asks a file for the identifier it mints itself", () => {
  /*
   * A file bringing its own id could collide with one already issued, and the counters in
   * `services/identifiers.js` are the only thing allowed to hand one out.
   *
   * Per module, because the same word means different things: a booking names an `enquiryId`, and
   * that is a *reference* to a lead the CRM already issued one for - not a booking minting its own.
   * What a module must never ask for is the identifier of the record it is creating.
   */
  const ownIdentifier = {
    "Vendor Management": "vendorId",
    "Asset Management": "assetCode",
    "Client Storage": "storageId",
    "Employee Repository": "employeeId",
    Accounts: "entryId",
    "Bookings & Projects": "eventId",
  };
  for (const [label, columns] of MODULES) {
    const own = ownIdentifier[label];
    assert.ok(own, `${label} has no identifier named here, so nothing is checked for it`);
    for (const column of columns) {
      assert.notEqual(column.field, own, `${label} asks the file for ${own}, which its own counter mints`);
    }
  }
});

test("no two columns in a module share a heading", () => {
  // Headings are matched case- and punctuation-insensitively, so two that fold together would make
  // one of them unreachable - and silently, since the file would still import.
  const fold = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");
  for (const [label, columns] of MODULES) {
    const seen = new Set();
    for (const column of columns) {
      const key = fold(column.label);
      assert.ok(!seen.has(key), `${label} has two columns that read as "${column.label}"`);
      seen.add(key);
    }
  }
});
