const test = require("node:test");
const assert = require("node:assert/strict");
const { createOrgChartService, MAX_CHAIN_DEPTH } = require("../src/modules/hrm/org-chart/service");

/*
 * The reporting chart is walked, not fetched whole, so the walk is what these hold.
 *
 * `reports_to_employee_id` is a plain nullable column. The form refuses to write a loop, but a
 * direct database edit, a restored backup or a bulk import can still leave one — and an unguarded
 * walk upward would spin until the request timed out rather than answer. A cycle has to be survived
 * and reported, not merely avoided in the UI that writes it.
 */

const person = (id, name, reportsToEmployeeId = null) => ({
  id, employeeId: `DBS${String(id).padStart(3, "0")}`, employeeName: name,
  designation: "Photographer", department: "Production", employmentStatus: "Active", reportsToEmployeeId,
});

function fakeRepository(people, usernames = new Map()) {
  const byId = new Map(people.map((row) => [row.id, row]));
  return {
    findNode: async (id) => byId.get(id) || null,
    listDirectReports: async (managerId) => people.filter((row) => row.reportsToEmployeeId === managerId),
    countReportsFor: async (ids) => new Map(ids.map((id) => [id, people.filter((row) => row.reportsToEmployeeId === id).length])),
    usernamesFor: async (ids) => new Map(ids.filter((id) => usernames.has(id)).map((id) => [id, usernames.get(id)])),
  };
}

const serviceFor = (people, usernames) => createOrgChartService(fakeRepository(people, usernames));

test("walks the whole chain to the top, nearest manager first", async () => {
  const chart = await serviceFor([
    person(1, "Founder"),
    person(2, "Head of Production", 1),
    person(3, "Team Lead", 2),
    person(4, "Priya", 3),
  ]).chartFor(4);

  assert.equal(chart.employee.employeeName, "Priya");
  assert.deepEqual(chart.managers.map((m) => m.employeeName), ["Team Lead", "Head of Production", "Founder"]);
  assert.equal(chart.chainBrokenAt, null);
});

test("lists everyone reporting directly to the employee, and nobody further down", async () => {
  const chart = await serviceFor([
    person(1, "Manager"),
    person(2, "Arun", 1),
    person(3, "Kavya", 1),
    // Reports to Arun, not to the manager: one level down only.
    person(4, "Deep", 2),
  ]).chartFor(1);

  assert.deepEqual(chart.directReports.map((r) => r.employeeName), ["Arun", "Kavya"]);
  // Each node says how many report to it, so a report with a team of their own is worth clicking.
  assert.equal(chart.directReports.find((r) => r.employeeName === "Arun").directReportCount, 1);
  assert.equal(chart.directReports.find((r) => r.employeeName === "Kavya").directReportCount, 0);
});

test("an employee reporting to nobody is a root, with an empty chain", async () => {
  const chart = await serviceFor([person(1, "Founder"), person(2, "Arun", 1)]).chartFor(1);
  assert.deepEqual(chart.managers, []);
  assert.equal(chart.employee.reportsToEmployeeId, null);
  assert.equal(chart.chainBrokenAt, null);
});

test("a loop in the reporting line is survived and reported, not followed forever", async () => {
  // A pair pointing at each other — the shortest ring, and the one a bad import actually produces.
  const chart = await serviceFor([person(1, "Arun", 2), person(2, "Priya", 1)]).chartFor(1);

  assert.equal(chart.chainBrokenAt, "cycle");
  // It still answers with what it could follow rather than failing the whole request.
  assert.deepEqual(chart.managers.map((m) => m.employeeName), ["Priya"]);
});

test("a chain longer than the limit is cut short rather than drawn", async () => {
  // Each person reports to the next, far past the bound.
  const people = Array.from({ length: MAX_CHAIN_DEPTH + 10 }, (_, index) =>
    person(index + 1, `Person ${index + 1}`, index + 2 <= MAX_CHAIN_DEPTH + 10 ? index + 2 : null));

  const chart = await serviceFor(people).chartFor(1);

  assert.equal(chart.chainBrokenAt, "too-deep");
  assert.equal(chart.managers.length, MAX_CHAIN_DEPTH);
});

test("the chain stops at the last person still employed when a manager is archived", async () => {
  // findNode answers null for an archived row, the way the repository's archivedAt filter does.
  const chart = await serviceFor([person(1, "Arun", 99), person(2, "Priya")]).chartFor(1);
  assert.deepEqual(chart.managers, []);
  // Not a cycle and not too deep: the line simply ends there.
  assert.equal(chart.chainBrokenAt, null);
});

test("an employee who is not there is a 404, not an empty chart", async () => {
  await assert.rejects(() => serviceFor([person(1, "Arun")]).chartFor(999), { status: 404 });
});

test("who the employee works with is everyone else reporting to the same manager", async () => {
  const chart = await serviceFor([
    person(1, "Manager"),
    person(2, "Arun", 1),
    person(3, "Kavya", 1),
    person(4, "Deep", 1),
    // Reports to Arun, not the shared manager: not a peer of Arun's.
    person(5, "Nested", 2),
  ]).chartFor(2);

  assert.deepEqual(chart.peers.map((p) => p.employeeName).sort(), ["Deep", "Kavya"]);
  // Never the employee's own row among their peers.
  assert.equal(chart.peers.some((p) => p.employeeName === "Arun"), false);
});

test("the top of the chart has no peers rather than the whole studio", async () => {
  const chart = await serviceFor([person(1, "Founder"), person(2, "Arun", 1)]).chartFor(1);
  assert.deepEqual(chart.peers, []);
});

test("a node carries the sign-in username behind it, where one exists", async () => {
  const chart = await serviceFor(
    [person(1, "Manager"), person(2, "Arun", 1)],
    new Map([[2, "arun.k"]]),
  ).chartFor(2);

  assert.equal(chart.employee.username, "arun.k");
  // Nobody's login is invented for a person who has none yet.
  assert.equal(chart.managers[0].username, null);
});

test("the chart carries only what a diagram shows, never the rest of the record", async () => {
  const chart = await serviceFor([person(1, "Arun")]).chartFor(1);
  // The employee row also holds salary, Aadhaar and PAN. None of it belongs in this response.
  for (const field of ["totalSalary", "aadharCardNumber", "panCardNumber", "accountNumber"]) {
    assert.equal(field in chart.employee, false, `${field} must not be on an org chart node`);
  }
});
