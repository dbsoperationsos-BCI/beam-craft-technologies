import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { mapLinkFor } from "../src/lib/mapLink.mjs";

/*
 * The administrator's Attendance Dashboard: where each login and logout was captured, as a link
 * that opens the position on the map.
 */

const read = (...parts) => fs.readFileSync(path.join(process.cwd(), "src", ...parts), "utf8");

test("a captured position opens on the map; none, or a position that cannot be, is no link", () => {
  assert.equal(mapLinkFor({ latitude: 11.351212, longitude: 77.6909635 }), "https://www.google.com/maps?q=11.351212,77.6909635");
  assert.equal(mapLinkFor({ latitude: "11.35", longitude: "77.69" }), "https://www.google.com/maps?q=11.35,77.69");
  assert.equal(mapLinkFor(null), null);
  assert.equal(mapLinkFor({ latitude: null, longitude: 77 }), null);
  assert.equal(mapLinkFor({ latitude: 91, longitude: 77 }), null);
});

test("the Employees table has Login location link and Logout location link, opened in a new tab", () => {
  const TABLE = read("components", "hrm", "AdminAttendanceEmployees.js");
  assert.match(TABLE, /header: "Login location link"[\s\S]{0,260}<TableCellValue value=\{mapLinkFor\(row\.original\.loginLocation\)\} type="link" linkLabel="View on map" \/>/);
  assert.match(TABLE, /header: "Logout location link"[\s\S]{0,260}<TableCellValue value=\{mapLinkFor\(row\.original\.logoutLocation\)\} type="link" linkLabel="View on map" \/>/);
  // The shared link cell, named rather than shown as a host and a query.
  assert.match(read("components", "data-table", "tableCells.js"), /\{linkLabel \|\| fileLabelFor\(value\)\}/);
});

test("the Dashboard's employee table shows the Work Mode right after Check In", () => {
  const TABLE = read("components", "hrm", "AdminAttendanceEmployees.js");
  const ids = [...TABLE.matchAll(/\{ id: "(\w+)", header:/g)].map((match) => match[1]);
  assert.equal(ids.indexOf("workMode"), ids.indexOf("checkIn") + 1);
  assert.match(TABLE, /\{ id: "workMode", header: "Work Mode", accessorFn: \(row\) => row\.workMode \|\| "", width: 140, cell: \(\{ row \}\) => row\.original\.workMode \|\| "—" \}/);
});
