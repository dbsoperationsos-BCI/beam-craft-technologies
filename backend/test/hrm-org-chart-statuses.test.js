const test = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");
const service = require("../src/modules/hrm/org-chart/service");
const { workingEmployeeStatuses } = require("../src/services/employeeOptionLists");

/*
 * Who the org chart draws.
 *
 * It left out archived rows and nothing else, which is not the same question. An employee row exists
 * from the moment HR sends an onboarding invite and stays after somebody leaves - so the chart drew
 * candidates who had not filled in their form, and colleagues who had been relieved, fired or had
 * absconded, as part of an organisation none of them is in. A chart is a picture of who reports to
 * whom **now**.
 *
 * The three working statuses, not Active alone: somebody in training occupies a real place in the
 * structure and people report to them, and drawing the chart without them would leave those reports
 * hanging off nobody.
 *
 * Needs MySQL, like the other repository tests - the rule being checked is a `where`, and a fake
 * repository would only be this file agreeing with itself. `hrm-org-chart.test.js` beside it holds
 * the walk, which is the service's half and needs no database.
 */

const STAMP = `ZZORG-${Date.now()}`;
const named = (suffix) => `${STAMP} ${suffix}`;
const people = {};

const make = (suffix, employmentStatus, manager = null) => prisma.employee.create({
  data: {
    employeeId: `${STAMP}${suffix}`,
    employeeName: named(suffix),
    employmentStatus,
    reportsToEmployeeId: manager ? manager.id : null,
  },
});

test.before(async () => {
  people.boss = await make("BOSS", "Active");
  people.trainee = await make("TRAINEE", "in Training", people.boss);
  people.pip = await make("PIP", "PIP", people.boss);
  people.gone = await make("GONE", "Relieved", people.boss);
  people.fired = await make("FIRED", "Fired", people.boss);
  people.pending = await make("PENDING", "HR Onboarding Pending", people.boss);
  people.unsubmitted = await make("UNSUBMITTED", "Employee Submission Pending", people.boss);
  people.archived = await prisma.employee.create({
    data: { employeeId: `${STAMP}ARCHIVED`, employeeName: named("ARCHIVED"), employmentStatus: "Active", reportsToEmployeeId: people.boss.id, archivedAt: new Date() },
  });
  people.underTrainee = await make("UNDER-TRAINEE", "Active", people.trainee);
  people.underGone = await make("UNDER-GONE", "Active", people.gone);
});

test.after(async () => {
  await prisma.employee.deleteMany({ where: { employeeId: { startsWith: STAMP } } });
  await prisma.$disconnect();
});

test("the chart draws everybody working here, whatever their working status", async () => {
  const chart = await service.chartFor(people.boss.id);
  const drawn = chart.directReports.map((row) => row.employeeName);
  assert.ok(drawn.includes(named("TRAINEE")), "somebody in training is missing from the chart");
  assert.ok(drawn.includes(named("PIP")), "somebody on a plan is missing from the chart");
  // The property, over whatever else this studio holds: every node drawn is somebody working here.
  const working = new Set(await workingEmployeeStatuses());
  for (const node of [chart.employee, ...chart.managers, ...chart.directReports, ...chart.peers]) {
    assert.ok(working.has(node.employmentStatus), `"${node.employeeName}" is drawn and is ${node.employmentStatus}`);
  }
});

test("nobody offboarded, still onboarding or archived is drawn", async () => {
  const chart = await service.chartFor(people.boss.id);
  const drawn = chart.directReports.map((row) => row.employeeName);
  for (const suffix of ["GONE", "FIRED", "PENDING", "UNSUBMITTED", "ARCHIVED"]) {
    assert.ok(!drawn.includes(named(suffix)), `${suffix} is still drawn on the chart`);
  }
});

test("the count under a node promises what clicking it shows", async () => {
  /*
   * Counted over the same people the chart draws. Counted over everybody, the boss's card would read
   * seven and open on two - a number under a card is a promise about what is behind it.
   */
  const chart = await service.chartFor(people.boss.id);
  assert.equal(chart.employee.directReportCount, chart.directReports.length);
  const trainee = chart.directReports.find((row) => row.employeeName === named("TRAINEE"));
  assert.equal(trainee.directReportCount, 1, "the trainee's own report is not counted");
});

test("a chain running up through somebody who has left stops at the last person still here", async () => {
  /*
   * The same behaviour archiving already had, for the same reason: the truthful answer is that the
   * chain ends, not that there is a gap in the middle of the chart. `chainBrokenAt` stays null - a
   * manager who has left is a vacancy, not a fault in the data.
   */
  const chart = await service.chartFor(people.underGone.id);
  assert.deepEqual(chart.managers, []);
  assert.equal(chart.chainBrokenAt, null);
});

test("a chain running up through somebody in training carries on through them", async () => {
  const chart = await service.chartFor(people.underTrainee.id);
  assert.deepEqual(chart.managers.map((row) => row.employeeName), [named("TRAINEE"), named("BOSS")]);
});

test("asking for the chart of somebody the chart does not draw is a 404", async () => {
  // The same answer as an id naming nobody: they have no place in a picture of who reports to whom
  // now, and a chart of one node with no chain would suggest they do.
  for (const who of [people.gone, people.pending, people.archived]) {
    await assert.rejects(
      () => service.chartFor(who.id),
      (error) => error.status === 404,
      `a chart was drawn for ${who.employeeName}`,
    );
  }
});

test("peers are the colleagues still here, not everyone who ever reported to the manager", async () => {
  const chart = await service.chartFor(people.trainee.id);
  const peers = chart.peers.map((row) => row.employeeName);
  assert.deepEqual(peers.sort(), [named("PIP")], "the peer list is drawn from people who have left or have not arrived");
});
