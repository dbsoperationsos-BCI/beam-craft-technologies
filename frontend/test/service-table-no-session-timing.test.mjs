import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * The Quotation Generator, Create Project (Bookings) and Edit Sale Details (Converted) list a
 * service line without a Session Timing column: a service is priced at its one Settings price, so
 * nothing there turns on the session. The line still starts on its shoot's session and saves it, so
 * what is stored is unchanged. Project Management's Start Project keeps the column.
 */

const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", ...parts), "utf8");
const SECTION = read("project-management", "ProjectServiceCreationSection.js");
const GENERATOR = read("sales", "QuotationGeneratorPanel.js");
const CREATE = read("sales", "CreateProjectFormPanel.js");
const START = read("project-management", "StartProjectFormPanel.js");
// Create Project's pending lines and their payload, held in the hook it shares with Raise Request.
const PENDING = read("project-management", "usePendingShootLines.js");

test("the shared table draws Session Timing only where its host asks for it", () => {
  assert.match(SECTION, /sessionTimingColumn = true,/);
  assert.match(SECTION, /\.\.\.\(sessionTimingColumn \? \[\{ id: "sessionTiming", header: "Session Timing",/);
  // The other service columns are unconditional, as they were.
  for (const id of ["serviceName", "quantity", "size", "remarks"]) assert.match(SECTION, new RegExp(`\\{ id: "${id}", header: `));
});

test("the Quotation Generator, Create Project and Edit Sale Details turn it off", () => {
  assert.equal((GENERATOR.match(/sessionTimingColumn=\{false\}/g) || []).length, 1);
  // Create Project's own section, and the plan editor it shows once the project exists.
  assert.equal((CREATE.match(/sessionTimingColumn=\{false\}/g) || []).length, 2);
  assert.match(CREATE, /<ProjectServiceCreationSection \{\.\.\.plan\.sectionProps\} sessionTimingColumn=\{false\} \/>/);
  // Start Project in Project Management is not one of them.
  assert.doesNotMatch(START, /sessionTimingColumn/);
});

test("a new line still starts on its shoot's session and saves it", () => {
  assert.match(GENERATOR, /const sessionOptionId = defaultSessionOptionId\(definition, shoot\);/);
  assert.match(CREATE, /usePendingShootLines\(\{ serviceDefinitions, deliverableDefinitions \}\)/);
  assert.match(PENDING, /const sessionOptionId = defaultSessionOptionId\(definition, shoot\);/);
  assert.match(PENDING, /sessionOptionId: sessionOptionId \|\| null,/);
});

test("no service line shows a Size on any Service Creation screen; a deliverable's Size stays", () => {
  const services = SECTION.slice(SECTION.indexOf("const serviceColumns = useMemo"), SECTION.indexOf("const deliverableColumns = useMemo"));
  assert.doesNotMatch(services, /id: "size"|header: "Size"/);
  assert.doesNotMatch(SECTION, /function serviceSizeOptions|function displaySize\(/);
  const deliverables = SECTION.slice(SECTION.indexOf("const deliverableColumns = useMemo"));
  assert.match(deliverables, /\{ id: "size", header: "Size", accessorFn: displayDeliverableSize,/);
  // A size a line already holds still travels with it when a project is saved.
  assert.match(PENDING, /sizeOptionValueId: sizeOptionValueId \|\| null,/);
  assert.match(CREATE, /services: \(servicesByShoot\[id\] \|\| \[\]\)\.map\(servicePayload\),/);
});
