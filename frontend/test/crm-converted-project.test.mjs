import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { commonProjectInfoSections } from "../src/constants/infoPanelConfig.js";

/*
 * Opening a project out of Converted History.
 *
 * The tab named a project and stopped there. Reading it meant leaving the lead, opening Sales
 * Manager and finding the Event ID again by hand - so the row opens the record itself now, drawn by
 * the same `ProjectRecordPanel` every project table uses.
 *
 * Three things about that are easy to get wrong and silent when they are:
 *
 *   - the panel would land *underneath* the lead popup it was opened from, which reads as a
 *     double-click that did nothing at all;
 *   - the row would be openable by mouse alone, since a double click cannot be made from a
 *     keyboard;
 *   - a project held as a row rather than an id would follow the reader onto the next lead as they
 *     walk the queue.
 */

const url = (p) => new URL(p, import.meta.url);
const CRM = fs.readFileSync(url("../src/components/sales/CRMPage.js"), "utf8");
const PROJECT_TABLE = fs.readFileSync(url("../src/components/data-table/ProjectDataTable.js"), "utf8");
const RECORD_VIEW = fs.readFileSync(url("../src/components/data-table/RecordViewPanel.js"), "utf8");
const SCHEMA_PANEL = fs.readFileSync(url("../src/components/schema-form/SchemaFormPanel.js"), "utf8");

/** The Converted History branch of the lead popup. */
const CONVERTED = CRM.slice(CRM.indexOf('{leadTab === "converted" && ('), CRM.indexOf('{leadTab === "whatsapp" && ('));

test("the row opens the project, by mouse and by keyboard alike", () => {
  // The rows are `SimpleTable`'s now, so the row's own handlers arrive through `rowProps`.
  assert.match(CONVERTED, /onDoubleClick: \(\) => setViewingProjectId\(project\.id\),/);
  /*
   * The keyboard half is the half that gets left out, because the feature looks finished without
   * it: a double click has no keyboard equivalent, so a row that only answers `onDoubleClick` is a
   * project nobody navigating by keyboard can reach at all.
   */
  assert.match(CONVERTED, /role: "button",/);
  assert.match(CONVERTED, /tabIndex: 0,/);
  assert.match(CONVERTED, /event\.key !== "Enter" && event\.key !== " "/);
  // Space scrolls the pane otherwise, moving the table out from under the row just opened.
  assert.match(CONVERTED, /event\.preventDefault\(\);\s*\n\s*setViewingProjectId\(project\.id\);/);
  // And it says so, once, above the table - a row that opens something and does not say so is
  // found by accident or not at all.
  assert.match(CONVERTED, /Double-click a project to read it in full\./);
});

test("the project is held as an id, so it cannot follow the reader to the next lead", () => {
  /*
   * The popup stays mounted through Update and Proceed Next. A row held directly in state would go
   * on being drawn against the next lead - somebody else's project under this lead's name, which is
   * the worst shape this fault could take. Resolved out of the list instead: when the projects
   * change, the id names nothing and the panel closes itself.
   */
  assert.match(CRM, /const \[viewingProjectId, setViewingProjectId\] = useState\(null\);/);
  assert.match(CRM, /const viewingProject = projects\.find\(\(project\) => project\.id === viewingProjectId\) \|\| null;/);
});

test("the record lands above the popup that opened it, not behind it", () => {
  /*
   * The lead popup is `z-[120]` and the record view's own default is `z-[110]`, so without a layer
   * of its own the panel opens *underneath* the popup - present, focus-trapping, and invisible.
   * Threaded through both components rather than hard-coded in either, so a record opened from a
   * table still takes the default.
   */
  assert.match(CONVERTED, /zIndexClassName="z-\[160\]"/);
  const popupLayer = Number(CRM.match(/fixed inset-0 z-\[(\d+)\] bg-black\/40 p-2 sm:p-3/)[1]);
  assert.ok(160 > popupLayer, `the record view at 160 no longer clears the lead popup at ${popupLayer}`);
  assert.match(PROJECT_TABLE, /export function ProjectRecordPanel\(\{[^}]*zIndexClassName \}\)/);
  assert.match(RECORD_VIEW, /zIndexClassName=\{zIndexClassName\}/);
  // Undefined has to mean "keep the default" rather than "no layer at all", or every other record
  // view in the OS loses its own.
  assert.match(SCHEMA_PANEL, /zIndexClassName = "z-\[110\]"/);
});

test("the CRM shows the sale's reading of a project, not Project Management's", () => {
  /*
   * `commonProjectInfoSections` is what a project looks like to whoever sold it. The workflow
   * sections - shoots, service allocations, post-production - belong to Projects' permission, and
   * the endpoint behind this tab answers the CRM's. Payments are Accounts' figures and are not
   * offered here at all.
   */
  assert.match(CONVERTED, /sections=\{commonProjectInfoSections\}/);
  assert.doesNotMatch(CONVERTED, /projectManagementInfoSections/);
  assert.doesNotMatch(CONVERTED, /showPayments/);
  const titles = commonProjectInfoSections.map((section) => section.title);
  assert.deepEqual(titles, ["Project Identity", "Client & Branch", "Event Planning", "Deliverables", "WhatsApp Group Details", "Remarks", "System Details"]);
  assert.ok(!titles.some((title) => /Shoot|Production Creation|Post Production Allocation/.test(title)), "a workflow section reached the CRM's reading of a project");
});
