import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * The Services table lists a service's bookings as rows, not as a sentence.
 *
 * It used to run every priced booking together in one Price cell - "Studio Full ₹9,000 · Studio
 * Half ₹4,000 · Outdoor Full ₹10,000" - so the shoot type a booking was priced for, how long it
 * ran and what it cost could not be read, sorted or filtered apart. Each booking is a row under its
 * service now, and a fourth shoot type is a fourth row.
 *
 * Reads the source, the way the other settings tests here do: there is no DOM in this suite.
 */

const HERE = import.meta.dirname;
const PANEL = fs.readFileSync(path.join(HERE, "..", "src", "components", "project-management", "ProjectSettingsPanel.js"), "utf8");

/**
 * The `id`s of one column list, in the order the table declares them.
 *
 * The value columns only: the trailing Actions column is written over several lines because it
 * holds a menu rather than a value, and it is asserted on its own below.
 */
function columnIds(name) {
  const start = PANEL.indexOf(`const ${name} = useMemo(() => [`);
  assert.ok(start > -1, `${name} is not declared`);
  const end = PANEL.indexOf("], [", start);
  return [...PANEL.slice(start, end).matchAll(/\{ id: "([a-zA-Z]+)"/g)].map((match) => match[1]);
}

test("the Services table names the columns the studio asked for, in that order", () => {
  // `deliverableAdded` sits after Price, beside Remarks, in the order the dialog asks them.
  assert.deepEqual(columnIds("serviceColumns"), [
    "name", "shootType", "sessionTiming", "duration", "size", "price", "deliverableAdded", "complimentary", "remarks",
  ]);
  assert.match(PANEL.slice(PANEL.indexOf("const serviceColumns")), /id: "actions",/);
});

test("every priced service folds its bookings under it, a single one included", () => {
  // The chevron is the shared table's own, the arrangement the quotation register uses.
  assert.match(PANEL, /expandable=\{\{ label: "the pricing lines of this service", getSubRows: \(row\) => row\.lines \|\| \[\], canExpand: \(row\) => \(row\.lines \|\| \[\]\)\.length > 0 \}\}/);
  // Every line goes inside, so "Size: Yes" always means the sizes are on the rows below it.
  assert.match(PANEL, /\n {6}lines,\n/);
  assert.doesNotMatch(PANEL, /const single = lines\.length === 1/);
});

test("the head answers for the service, and the bookings inside answer for themselves", () => {
  // A timing and its length belong to a booking, so the head claims neither.
  assert.match(PANEL, /sessionTiming: "—",\n {6}duration: "—",/);
});

test("a line names its own booking, and repeats neither the service nor its menu", () => {
  // The name is carried for filtering and drawn for the service alone - see the column's render.
  assert.match(PANEL, /render: \(row\) => \(row\.isLine \? null : <span className="font-medium text-slate-800">\{row\.name\}<\/span>\)/);
  // Edit and Delete mean the service; a line would name the wrong record.
  assert.match(PANEL, /render: \(row\) => \(row\.isLine \? null : <OptionsMenu/);
});

test("the head says whether a service is sold by size, and each booking inside names its own", () => {
  assert.match(PANEL, /size: row\.sizeEnabled === true \? "Yes" : "No"/);
  // Blank rather than "No" on a line: the head already answered that about the service.
  assert.match(PANEL, /size: service\.sizeEnabled === true \? \(entry\.size \|\| "—"\) : ""/);
});

test("the shoot types on a service are read off the bookings it is priced for", () => {
  assert.match(PANEL, /\[\.\.\.new Set\(lines\.map\(\(line\) => line\.shootType\)\)\]\.join\(", "\)/);
  // A service priced nowhere falls back to the list it carries, and then to every shoot.
  assert.match(PANEL, /labelsOf\(SHOOT_TYPE_OPTIONS, row\.shootTypes, "All"\)/);
});

test("the joined Price cell is gone, and the helpers that built it with it", () => {
  assert.doesNotMatch(PANEL, /const pricingLabel = useCallback/);
  assert.doesNotMatch(PANEL, /const sessionTimingLabel = useCallback/);
  assert.doesNotMatch(PANEL, /const serviceDurationLabel = useCallback/);
});
