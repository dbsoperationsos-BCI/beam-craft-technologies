import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { teamAbove, nearestShootTo, doubledBySwap, peopleOnOtherServices, scheduleProjectOptions, scheduleRows, scheduleShoots, swapInRows, seatPayload, seatValue, shootColour, zoomBy } from "../src/lib/productionSchedule.mjs";

const shoot = (id, date, overrides = {}) => ({ shootRecordId: id, projectId: "p1", eventId: "EVT-1", clientName: "Ranjan & Veena", shootDate: date, services: [{ name: "Candid", person: "Ajeesh" }], ...overrides });

const ids = (list) => list.map((row) => row.shootRecordId);

test("shoots come in the order they happen", () => {
  assert.deepEqual(ids(scheduleShoots([shoot("b", "2026-10-29T00:00:00"), shoot("a", "2026-10-28T00:00:00"), shoot("c", "2026-10-28T00:00:00")])), ["a", "c", "b"]);
});

test("the range keeps only the days inside it, and an undated shoot only while there is no range", () => {
  const shoots = [shoot("in", "2026-10-28T00:00:00"), shoot("out", "2026-11-05T00:00:00"), shoot("undated", null)];
  const range = { from: new Date(2026, 9, 28), to: new Date(2026, 9, 31) };
  assert.deepEqual(ids(scheduleShoots(shoots, { range })), ["in"]);
  assert.equal(scheduleShoots(shoots).length, 3);
  // Upcoming: from a day on, with no last day.
  assert.deepEqual(ids(scheduleShoots(shoots, { range: { from: new Date(2026, 9, 28), to: null } })), ["in", "out"]);
});

test("the projects picked narrow it", () => {
  const shoots = [shoot("a", "2026-10-28T00:00:00"), shoot("b", "2026-10-28T00:00:00", { projectId: "p2" })];
  assert.deepEqual(ids(scheduleShoots(shoots, { projectIds: ["p2"] })), ["b"]);
});

test("zoom steps through its levels and stops at either end", () => {
  assert.equal(zoomBy("100", 1), "115");
  assert.equal(zoomBy("100", -1), "90");
  assert.equal(zoomBy("130", 1), "130");
  assert.equal(zoomBy("80", -1), "80");
});

test("each project is offered once, by client and event", () => {
  assert.deepEqual(scheduleProjectOptions([shoot("a", null), shoot("b", null)]), [{ value: "p1", label: "Ranjan & Veena · EVT-1" }]);
});

test("a seat is read and sent as an employee, a vendor, or nobody", () => {
  assert.equal(seatValue({ employeeId: 12 }), "emp:12");
  assert.equal(seatValue({ vendorId: 7 }), "ven:7");
  assert.equal(seatValue({}), "");
  assert.deepEqual(seatPayload("emp:12"), { employeeId: 12, vendorId: null });
  assert.deepEqual(seatPayload("ven:7"), { employeeId: null, vendorId: 7 });
  assert.deepEqual(seatPayload(""), { employeeId: null, vendorId: null });
});

test("a shoot is coloured by its place in its project's rows, the same across projects", () => {
  const rows = scheduleRows([
    shoot("a2", "2026-10-29T00:00:00"), shoot("a1", "2026-10-28T00:00:00"),
    shoot("b1", "2026-11-02T00:00:00", { projectId: "p2" }), shoot("b2", "2026-11-03T00:00:00", { projectId: "p2" }), shoot("b3", "2026-11-04T00:00:00", { projectId: "p2" }),
  ]);
  const ordinal = Object.fromEntries(rows.map((row) => [row.shootRecordId, row.ordinal]));
  assert.deepEqual(ordinal, { a1: 0, a2: 1, b1: 0, b2: 1, b3: 2 });
  assert.equal(shootColour(ordinal.a1), shootColour(ordinal.b1));
  assert.equal(shootColour(ordinal.a2), shootColour(ordinal.b2));
  assert.notEqual(shootColour(0), shootColour(1));
  // The first row is never the page's own blue, nor a colour the service blocks use for a state.
  assert.ok(!/sky|amber|emerald|rose/.test(shootColour(0).chip));
  assert.equal(new Set(Array.from({ length: 10 }, (_, index) => shootColour(index).chip)).size, 10);
});

test("a project's shoots on continuous days sit together under the row that names it, the runs by date", () => {
  // 11, 11, 15, 16, 19: three runs - the two 11ths, the 15th and 16th, the 19th alone - with p2's 12th between.
  const rows = scheduleRows([
    shoot("a5", "2026-11-19T00:00:00"), shoot("a3", "2026-11-15T00:00:00"), shoot("a1", "2026-11-11T00:00:00"),
    shoot("b1", "2026-11-12T00:00:00", { projectId: "p2" }), shoot("a4", "2026-11-16T00:00:00"), shoot("a2", "2026-11-11T00:00:00"),
  ]);
  assert.deepEqual(rows.map((row) => [row.shootRecordId, row.firstOfRun, row.ordinal]), [
    ["a1", true, 0], ["a2", false, 1], ["b1", true, 0], ["a3", true, 0], ["a4", false, 1], ["a5", true, 0],
  ]);
});

test("a run crosses a month's end, and a project's undated shoots make one run of their own", () => {
  const rows = scheduleRows([shoot("a1", "2026-10-31T00:00:00"), shoot("a2", "2026-11-01T00:00:00"), shoot("u1", null), shoot("u2", null)]);
  assert.deepEqual(rows.map((row) => row.firstOfRun), [true, false, true, false]);
});

test("a drop is drawn at once: the two services' people swap in the rows on screen", () => {
  const rows = [
    { shootRecordId: "s1", services: [{ definitionId: "candid", employeeId: 12, person: "Ajeesh" }, { definitionId: "video", vendorId: 7, person: "Venu Videos", vendor: true, vendorStatus: "CONFIRMED" }] },
    { shootRecordId: "s2", services: [{ definitionId: "drone", person: null }] },
  ];
  const within = swapInRows(rows, { shootId: "s1", serviceDefinitionId: "candid" }, { shootId: "s1", serviceDefinitionId: "video" });
  assert.deepEqual(within[0].services.map((service) => [service.person, service.vendorStatus]), [["Venu Videos", "CONFIRMED"], ["Ajeesh", null]]);
  const across = swapInRows(rows, { shootId: "s1", serviceDefinitionId: "video" }, { shootId: "s2", serviceDefinitionId: "drone" });
  assert.deepEqual([across[0].services[1].person, across[1].services[0].person, across[1].services[0].vendorStatus], [null, "Venu Videos", "WAITING"]);
  // A service the drop did not touch keeps its person.
  assert.equal(across[0].services[0].person, "Ajeesh");
});

test("one person works one service of a shoot: the pickers leave them out, and a drop that would double them is caught", () => {
  const rows = [
    { shootRecordId: "s1", services: [{ definitionId: "candid", employeeId: 12, person: "Ajeesh" }, { definitionId: "video", employeeId: 13, person: "Sridhar" }] },
    { shootRecordId: "s2", services: [{ definitionId: "drone", employeeId: 13, person: "Sridhar" }, { definitionId: "led", vendorId: 7, person: "Venu Videos" }] },
  ];
  assert.deepEqual([...peopleOnOtherServices(rows[0], "candid")], ["emp:13"]);
  // Ajeesh onto s2 is fine; Sridhar back to s1 would sit beside himself on Traditional Video.
  assert.equal(doubledBySwap(rows, { shootId: "s1", serviceDefinitionId: "candid" }, { shootId: "s2", serviceDefinitionId: "led" }), null);
  assert.equal(doubledBySwap(rows, { shootId: "s1", serviceDefinitionId: "candid" }, { shootId: "s2", serviceDefinitionId: "drone" }), "Sridhar");
  assert.equal(doubledBySwap(rows, { shootId: "s1", serviceDefinitionId: "candid" }, { shootId: "s1", serviceDefinitionId: "video" }), null);
});

test("a vendor may work several services of one shoot: never left out of a picker, never caught on a drop", () => {
  const rows = [
    { shootRecordId: "s1", services: [{ definitionId: "candid", vendorId: 7, person: "Venu Videos" }, { definitionId: "video", employeeId: 13, person: "Sridhar" }] },
    { shootRecordId: "s2", services: [{ definitionId: "drone", employeeId: 12, person: "Ajeesh" }, { definitionId: "led", vendorId: 7, person: "Venu Videos" }] },
  ];
  assert.deepEqual([...peopleOnOtherServices(rows[0], "video")], []);
  assert.equal(doubledBySwap(rows, { shootId: "s1", serviceDefinitionId: "candid" }, { shootId: "s2", serviceDefinitionId: "drone" }), null);
});

test("the schedule opens on today's shoot, else the next one, else the latest", () => {
  const today = new Date(2026, 9, 28, 15, 0);
  const row = (id, date) => ({ shootRecordId: id, shootDate: date });
  assert.equal(nearestShootTo([row("past", new Date(2026, 9, 20)), row("today", new Date(2026, 9, 28)), row("next", new Date(2026, 9, 30))], today), "today");
  // Grouped by project, the rows are not in date order: the nearest upcoming one is found wherever it is.
  assert.equal(nearestShootTo([row("later", new Date(2026, 10, 9)), row("past", new Date(2026, 9, 20)), row("soonest", new Date(2026, 9, 31))], today), "soonest");
  assert.equal(nearestShootTo([row("old", new Date(2026, 8, 1)), row("recent", new Date(2026, 9, 25))], today), "recent");
  assert.equal(nearestShootTo([row("undated", null)], today), null);
});

test("Unknown date keeps only the shoots with no date yet; a span of days keeps none of them", async () => {
  const { scheduleShoots } = await import("../src/lib/productionSchedule.mjs");
  const shoots = [
    { shootRecordId: "dated", projectId: "p1", shootDate: "2026-11-02" },
    { shootRecordId: "undated", projectId: "p1", shootDate: null },
    { shootRecordId: "undated-2", projectId: "p2" },
  ];
  assert.deepEqual(scheduleShoots(shoots, { range: { undated: true } }).map((shoot) => shoot.shootRecordId).sort(), ["undated", "undated-2"]);
  assert.deepEqual(scheduleShoots(shoots, { range: { undated: true }, projectIds: ["p2"] }).map((shoot) => shoot.shootRecordId), ["undated-2"]);
  assert.deepEqual(scheduleShoots(shoots, { range: { from: new Date("2026-11-01T00:00:00Z"), to: new Date("2026-11-30T00:00:00Z") } }).map((shoot) => shoot.shootRecordId), ["dated"]);
  assert.equal(scheduleShoots(shoots, {}).length, 3, "All dates keeps every shoot, dated or not");
});

test("the schedule offers Unknown date beside its other date choices", async () => {
  const { readFileSync } = await import("node:fs");
  const page = readFileSync(new URL("../src/components/project-management/production/ProductionSchedulePage.js", import.meta.url), "utf8");
  assert.match(page, /const SCHEDULE_DATE_PRESETS = \[\{ value: ALL_DATES, label: "All dates" \}, UPCOMING, \{ value: "next30", label: "Next 30 days" \}, UNKNOWN_DATE\];/);
  assert.match(page, /range\.undated \? "Unknown date"/);
  const filter = readFileSync(new URL("../src/components/project-management/shoot-board/ShootDateRangeFilter.js", import.meta.url), "utf8");
  assert.match(filter, /export const UNKNOWN_DATE = \{ value: "unknown", label: "Unknown date", range: \(\) => \(\{ undated: true \}\) \};/);
});

test("the same team as above: the project's shoot above, only when they share a service with somebody on it", () => {
  const svc = (definitionId, employeeId = null) => ({ definitionId, employeeId, person: employeeId ? `E${employeeId}` : null });
  const rows = [
    { shootRecordId: "a1", projectId: "p1", services: [svc("candid", 12), svc("drone")] },
    { shootRecordId: "b1", projectId: "p2", services: [svc("candid", 13)] },
    { shootRecordId: "a2", projectId: "p1", services: [svc("candid"), svc("video")] },
    { shootRecordId: "a3", projectId: "p1", services: [svc("drone"), svc("led")] },
  ];
  // a2 takes a1's team - p2's row between them is not its project's.
  assert.equal(teamAbove(rows, rows[2])?.shootRecordId, "a1");
  // a3's nearest is a2, which shares no service with it: nothing to take.
  assert.equal(teamAbove(rows, rows[3]), null);
  // Nothing to change - the shared service already has the same person - nothing offered.
  assert.equal(teamAbove([rows[0], { ...rows[2], services: [svc("candid", 12)] }], { ...rows[2], services: [svc("candid", 12)] }), null);
  // The first of a project has nothing above it.
  assert.equal(teamAbove(rows, rows[0]), null);
});

test("a drone service is not held to one person, one service: in its picker, beside it, and on a drop", () => {
  const rows = [
    { shootRecordId: "s1", services: [{ definitionId: "candid", name: "Candid Photo", employeeId: 12, person: "Ajeesh" }] },
    { shootRecordId: "s2", services: [
      { definitionId: "video", name: "Traditional Video", employeeId: 12, person: "Ajeesh" },
      { definitionId: "drone", name: "Complementary Drone", employeeId: 13, person: "Sridhar" },
      { definitionId: "led", name: "LED Wall", employeeId: null, person: null },
    ] },
  ];
  // The drone's picker leaves nobody out; Sridhar, flying the drone, is still offered for LED Wall.
  assert.deepEqual([...peopleOnOtherServices(rows[1], "drone")], []);
  assert.deepEqual([...peopleOnOtherServices(rows[1], "led")], ["emp:12"]);
  // Ajeesh dropped on the drone of a shoot where he works Traditional Video: allowed.
  assert.equal(doubledBySwap(rows, { shootId: "s1", serviceDefinitionId: "candid" }, { shootId: "s2", serviceDefinitionId: "drone" }), null);
});

test("the quick filters: lists of the values held, a typed day or month, and people on a service or the Assist", async () => {
  const { filterScheduleShoots, scheduleFilterOptions, scheduleFiltersSet, EMPTY_SCHEDULE_FILTERS } = await import("../src/lib/productionSchedule.mjs");
  const shoots = [
    { shootRecordId: "a", eventId: "E1", clientName: "Ravi", shootId: "S1", shoot: "Haldi", shootDate: new Date(2026, 10, 11), services: [{ person: "Nithya" }], assist: [] },
    { shootRecordId: "b", eventId: "E2", clientName: "Anu", shootId: "S2", shoot: "Wedding", shootDate: new Date(2026, 11, 2), services: [{ person: "Sneha" }], assist: ["Nithya"] },
    { shootRecordId: "c", eventId: "E2", clientName: "Anu", shootId: "S3", shoot: "Reception", shootDate: new Date(2026, 11, 3), services: [{ person: null }], assist: [] },
  ];
  const keep = (filters) => filterScheduleShoots(shoots, { ...EMPTY_SCHEDULE_FILTERS, ...filters }).map((shoot) => shoot.shootRecordId);
  assert.deepEqual(scheduleFilterOptions(shoots).person, ["Nithya", "Sneha"]);
  assert.deepEqual(keep({}), ["a", "b", "c"]);
  // Nithya works a's service and b's Assist: both her projects.
  assert.deepEqual(keep({ person: ["Nithya"] }), ["a", "b"]);
  assert.deepEqual(keep({ eventId: ["E2"], shoot: ["Reception"] }), ["c"]);
  assert.deepEqual(keep({ date: "2026-12" }), ["b", "c"]);
  assert.deepEqual(keep({ date: "2026-11-11" }), ["a"]);
  assert.equal(scheduleFiltersSet(EMPTY_SCHEDULE_FILTERS), false);
  assert.equal(scheduleFiltersSet({ ...EMPTY_SCHEDULE_FILTERS, date: "2026" }), true);
});

test("the Date column reads the shoot's time under it, or No time", async () => {
  const { scheduleTimeLabel } = await import("../src/lib/productionSchedule.mjs");
  assert.equal(scheduleTimeLabel(shoot("a", "2026-11-04", { startTime: "18:30", endTime: "22:00" })), "6:30 pm – 10:00 pm");
  assert.equal(scheduleTimeLabel(shoot("b", "2026-11-04", { startTime: "21:00", endTime: "02:00" })), "9:00 pm – 2:00 am (next day)");
  assert.equal(scheduleTimeLabel(shoot("c", "2026-11-04", { startTime: "09:00", endTime: null })), "9:00 am");
  assert.equal(scheduleTimeLabel(shoot("d", "2026-11-04")), "No time");
});

test("the schedule's optional columns filter like the others, and start hidden", async () => {
  const { filterScheduleShoots, scheduleFilterOptions, EMPTY_SCHEDULE_FILTERS } = await import("../src/lib/productionSchedule.mjs");
  const shoots = [
    { shootId: "S1", shootPlace: "Erode", district: "Erode", state: "Tamil Nadu", shootType: "Outdoor / On-Location", productionManager: "Ravi" },
    { shootId: "S2", shootPlace: "Kochi", district: "Ernakulam", state: "Kerala", shootType: "Studio / In-House", productionManager: "Anu" },
  ];
  assert.deepEqual(scheduleFilterOptions(shoots).state, ["Kerala", "Tamil Nadu"]);
  assert.deepEqual(filterScheduleShoots(shoots, { ...EMPTY_SCHEDULE_FILTERS, district: ["Ernakulam"] }).map((shoot) => shoot.shootId), ["S2"]);
  assert.deepEqual(filterScheduleShoots(shoots, { ...EMPTY_SCHEDULE_FILTERS, productionManager: ["Ravi"] }).map((shoot) => shoot.shootId), ["S1"]);
  const view = readFileSync(new URL("../src/components/project-management/production/ProductionScheduleView.js", import.meta.url), "utf8");
  for (const id of ["shootPlace", "district", "state", "shootType", "productionManager", "productionCoordinator"]) {
    assert.match(view, new RegExp(`\\{ id: "${id}", label: "[^"]+", value: \\(shoot\\) => shoot\\.${id}, units: \\d+, extra: true \\}`));
  }
});

test("Freeze Columns is in the schedule's ⋮, remembered per viewer and undone by Reset Table Layout", () => {
  const page = readFileSync(new URL("../src/components/project-management/production/ProductionSchedulePage.js", import.meta.url), "utf8");
  // One table layout, the shape the server keeps (`table:` keys): freeze, visibility and widths together.
  assert.match(page, /usePreference\("table:production-schedule", \{\}\)/);
  assert.match(page, /onFreezeColumnsChange=\{\(count\) => updateLayout\(\{ freezeCount: count \}\)\}/);
  assert.match(page, /const resetLayout = useCallback\(\(\) => setLayout\(\{\}\), \[setLayout\]\);/);
  assert.doesNotMatch(page, /usePreference\("production-schedule:/, "a key the server refuses is kept only in one browser");
  const view = readFileSync(new URL("../src/components/project-management/production/ProductionScheduleView.js", import.meta.url), "utf8");
  // Frozen cells are held at the summed widths before them, in the zoomed spacing unit.
  assert.match(view, /left: `calc\(var\(--spacing\) \* \$\{at\.get\(id\)\}\)`/);
});
