const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { inStudioOrder } = require("../src/modules/project-management/production/serviceOrder");
const { toBoardRow, toDetail } = require("../src/modules/project-management/production/read");
const { planMissing } = require("../src/modules/project-management/production/planCompleteness");

/*
 * A shoot's services are crewed in the studio's order, not the order somebody booked them.
 *
 * The Production Schedule sheet and the plan's Service Crew both read the same list, so both take
 * it from the server already ordered - there is no second ordering in the frontend to drift from
 * this one. The order itself is master data (`sort_order` on the service, Settings -> Project ->
 * Services), which is why no service name is written into the server or the page: renaming a
 * service in Settings keeps its place, and the studio can reorder without a release.
 */

const service = (name, sortOrder) => ({ serviceName: name, serviceDefinition: sortOrder === null ? null : { sortOrder } });
const names = (rows) => inStudioOrder(rows).map((row) => row.serviceName);

test("the studio's order decides, not the order the services were booked in", () => {
  const booked = [service("Drone", 8), service("Traditional Photo", 0), service("Candid Video", 7), service("Traditional Video", 1)];
  assert.deepEqual(names(booked), ["Traditional Photo", "Traditional Video", "Candid Video", "Drone"]);
});

test("a service that is not in Settings goes last, never first", () => {
  // It has no order to read. Sorted as a null it would lead the sheet - and it is the one service
  // nobody can be assigned to, so it is the last thing the person crewing the shoot needs to see.
  const booked = [service("An old import", null), service("Traditional Photo", 0), service("Drone", 8)];
  assert.deepEqual(names(booked), ["Traditional Photo", "Drone", "An old import"]);
});

test("two services sharing a position fall back to their name, so the sheet never shuffles", () => {
  const booked = [service("Crane", 12), service("AI Memorial Video", 12)];
  assert.deepEqual(names(booked), ["AI Memorial Video", "Crane"]);
  assert.deepEqual(names([...booked].reverse()), ["AI Memorial Video", "Crane"]);
});

test("the list handed in is left as it was: the caller's array is not sorted under it", () => {
  const booked = [service("Drone", 8), service("Traditional Photo", 0)];
  inStudioOrder(booked);
  assert.deepEqual(booked.map((row) => row.serviceName), ["Drone", "Traditional Photo"]);
  assert.deepEqual(inStudioOrder(), [], "nothing booked is an empty sheet, not a crash");
  assert.deepEqual(inStudioOrder(undefined), []);
});

test("the schedule sheet, the plan and the plan's checklist all read one order", () => {
  /*
   * Through the real readers rather than the source text: all three take the same list, so an order
   * added to one and forgotten in the others is the thing that would break the screen.
   */
  const allocations = [
    { id: "a-led", serviceDefinitionId: "def-led", serviceName: "LED Wall", serviceDefinition: { sortOrder: 21, deliverableAdded: false } },
    { id: "a-trad", serviceDefinitionId: "def-trad", serviceName: "Traditional Photo", serviceDefinition: { sortOrder: 0, deliverableAdded: false } },
    { id: "a-drone", serviceDefinitionId: "def-drone", serviceName: "Drone", serviceDefinition: { sortOrder: 8, deliverableAdded: false } },
  ];
  const record = {
    id: "prod-1", shootId: "shoot-1", currentStep: "PINEAPPLE_MEETING", updatedAt: new Date("2026-11-03T05:00:00Z"),
    shoot: { id: "shoot-1", shootId: "DBS-SID-1", shoot: "Reception", dateCreated: new Date("2026-11-03T00:00:00Z"), postProductionAllocations: allocations },
    salesProject: { id: "project-1", eventId: "DBS-EV-1" },
    serviceCrew: [], teamMembers: [], files: [], messages: [],
  };
  const wanted = ["Traditional Photo", "Drone", "LED Wall"];
  assert.deepEqual(toBoardRow(record, new Map()).services.map((service) => service.name), wanted, "the schedule sheet");
  assert.deepEqual(toDetail(record, new Map(), { employeeId: 5, superAdmin: false }).plan.services.map((service) => service.name), wanted, "the plan");
  // Nobody is on any of them, so each asks for its person - in the order the sheet lists them.
  assert.deepEqual(planMissing(record).filter((label) => label.endsWith(" - Person")), wanted.map((name) => `${name} - Person`), "the plan's checklist");
});

test("the migration puts the studio's crewing order on the services, and leaves the rest alphabetical", () => {
  /*
   * The order the studio asked for: the traditional pair, then photo, then video, then the drones,
   * each variant beside its parent. Everything else keeps its alphabetical place after them.
   */
  const SQL = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20261103120000_service_definition_crew_order", "migration.sql"), "utf8");
  const wanted = [
    "Traditional Photo", "Traditional Video",
    "Semi Candid Photo", "Semi Candid Photo + reel",
    "Candid Photo", "Candid Photo + Reels",
    "Semi Candid Video", "Candid Video",
    "Drone", "Complementary Drone",
  ];
  wanted.forEach((name, position) => {
    assert.match(SQL, new RegExp(`WHEN '${name.replace(/[+]/g, "\\$&")}'\\s+THEN ${position}\\b`), `${name} is ${position}`);
  });
  assert.match(SQL, /9 \+ ROW_NUMBER\(\) OVER \(ORDER BY `name` ASC\)/, "the rest follow the ten, alphabetically");
  // A service the studio renamed or never created simply does not match - the migration must not
  // fail on it, which is why it only ever UPDATEs by name.
  const statements = SQL.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
  assert.doesNotMatch(statements, /\b(INSERT|DELETE|ALTER|DROP|TRUNCATE)\b/i, "it moves services, it does not create or remove any");
  assert.match(statements, /^UPDATE/m, "data only - no DDL, so it adds no schema drift");
});
