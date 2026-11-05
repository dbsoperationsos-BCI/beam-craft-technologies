import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * The Services table is one row per service, at its one price.
 *
 * Shoot Type, Session Timing, Duration and Size are no longer Settings questions: their columns,
 * their filters and sorting, and the per-booking pricing rows that hung under each service are gone.
 * Services, Price, Deliverable Added, Complimentary, Remarks and the ⋯ menu stay.
 *
 * Reads the source, the way the other settings tests here do: there is no DOM in this suite.
 */

const HERE = import.meta.dirname;
const PANEL = fs.readFileSync(path.join(HERE, "..", "src", "components", "project-management", "ProjectSettingsPanel.js"), "utf8");
const DIALOG = fs.readFileSync(path.join(HERE, "..", "src", "components", "project-management", "ServiceDefinitionDialog.js"), "utf8");

/** The value columns' `id`s, in the order the table declares them. */
function columnIds(name) {
  const start = PANEL.indexOf(`const ${name} = useMemo(() => [`);
  assert.ok(start > -1, `${name} is not declared`);
  const end = PANEL.indexOf("], [", start);
  return [...PANEL.slice(start, end).matchAll(/\{ id: "([a-zA-Z]+)"/g)].map((match) => match[1]);
}

const serviceSection = () => PANEL.slice(PANEL.indexOf("const serviceRows = useMemo"), PANEL.indexOf("const serviceColumns"));
const serviceColumnsSource = () => PANEL.slice(PANEL.indexOf("const serviceColumns"), PANEL.indexOf("], [serviceActionItems, serviceReorder]);"));

test("the Services table keeps Services, Price, Deliverable Added, Complimentary, Remarks and the menu", () => {
  assert.deepEqual(columnIds("serviceColumns"), ["name", "price", "deliverableAdded", "complimentary", "remarks"]);
  assert.match(serviceColumnsSource(), /id: "actions",/);
  // The menu's items are `serviceActionItems`, shared with the Board's cards.
  assert.match(serviceColumnsSource(), /items=\{serviceActionItems\(row\)\}/);
  const items = PANEL.slice(PANEL.indexOf("const serviceActionItems = useCallback"), PANEL.indexOf("const serviceColumns"));
  assert.match(items, /\{ label: "Edit", onSelect/);
  assert.match(items, /\{ label: "Duplicate", onSelect/);
  assert.match(items, /\{ label: "Delete", tone: "danger", onSelect/);
});

test("Shoot Type, Session Timing, Duration and Size are gone from the table, its rows and its filters", () => {
  for (const field of ["shootType", "sessionTiming", "duration", "size"]) {
    assert.doesNotMatch(serviceColumnsSource(), new RegExp(`id: "${field}"`), field);
    assert.doesNotMatch(serviceSection(), new RegExp(`\\b${field}:`), field);
  }
  for (const header of ["Shoot Type", "Session Timing", "Duration", "Size"]) assert.doesNotMatch(serviceColumnsSource(), new RegExp(`header: "${header}"`), header);
});

test("no pricing rows hang under a service any more", () => {
  assert.doesNotMatch(PANEL, /const lineRowsOf = useCallback/);
  assert.doesNotMatch(PANEL, /the pricing lines of this service/);
  assert.doesNotMatch(serviceSection(), /lines/);
  // The service's own row and menu are never blanked as a line.
  assert.doesNotMatch(serviceColumnsSource(), /row\.isLine/);
});

test("Price is the service's one price, still filtered and sorted", () => {
  assert.match(serviceSection(), /price: money\(row\.price\),/);
  assert.match(serviceColumnsSource(), /\{ id: "price", header: "Price", accessorKey: "price", [^\n]*filterFn: "includesString", sortingFn: "alphanumeric"/);
});

test("the dialog asks none of the four, and keeps one Price", () => {
  for (const label of ["Shoot Type", "Session Timing", "Duration", "Duration (hours)", "Size", "Size (Wall or TV etc...)"]) {
    assert.doesNotMatch(DIALOG, new RegExp(`label="${label.replace(/[.()]/g, "\\$&")}"`), label);
  }
  assert.doesNotMatch(DIALOG, /Add Pricing/);
  assert.equal((DIALOG.match(/label="Price"/g) || []).length, 1);
  assert.match(DIALOG, /price: form\.price === "" \? null : Number\(form\.price\),/);
});

test("an edit sends nothing for the four, so what a service stores is kept; a duplicate copies it", () => {
  const submit = DIALOG.slice(DIALOG.indexOf("&& onSubmit({"), DIALOG.indexOf("})}", DIALOG.indexOf("&& onSubmit({")));
  for (const field of ["timingModes", "shootTypes", "timingOptionSetId", "defaultDurationHours", "sizeEnabled", "sizeOptionSetId", "pricing"]) {
    assert.doesNotMatch(submit, new RegExp(`\\b${field}:`), field);
  }
  // Only a Duplicate carries them, from the service it was copied from.
  assert.match(DIALOG, /const carried = !isEdit && copyOf \? \{/);
  assert.match(submit, /\.\.\.carried,/);
});
