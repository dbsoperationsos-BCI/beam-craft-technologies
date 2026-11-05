const test = require("node:test");
const assert = require("node:assert/strict");
const { shootDateWhere } = require("../src/modules/project-management/production/read");

/*
 * The Production Schedule asks the server for the days it shows, not every shoot the studio has had -
 * thousands on production. A shoot's day is stored at UTC midnight or at the studio's (18:30 the day
 * before), so the window is a day wider each side; the page keeps the exact days.
 */
const iso = (date) => date.toISOString();

test("a range of days is asked for a day wider at each end", () => {
  const where = shootDateWhere({ from: "2026-11-01", to: "2026-11-30" });
  assert.equal(iso(where.shoot.dateCreated.gte), "2026-10-31T00:00:00.000Z");
  assert.equal(iso(where.shoot.dateCreated.lt), "2026-12-02T00:00:00.000Z");
});

test("an open end - Upcoming - has no last day", () => {
  const where = shootDateWhere({ from: "2026-10-29" });
  assert.equal(iso(where.shoot.dateCreated.gte), "2026-10-28T00:00:00.000Z");
  assert.equal(where.shoot.dateCreated.lt, undefined);
});

test("Unknown date asks for the shoots with no date; nothing asked is every shoot", () => {
  assert.deepEqual(shootDateWhere({ undated: true }), { shoot: { dateCreated: null } });
  assert.equal(shootDateWhere(null), null);
  assert.equal(shootDateWhere({ from: "not a day" }), null);
});
