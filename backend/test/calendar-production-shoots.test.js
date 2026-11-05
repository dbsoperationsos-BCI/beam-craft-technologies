const test = require("node:test");
const assert = require("node:assert/strict");

/*
 * A viewer holding `PROJECT / Production` and none of the wide three sees the shoots they are named
 * on. The controller hands the source `viewer: { userId }`; the source once read `viewer.id`, which
 * is undefined, so `boardWhere` was asked about login 0, found no employee, and every such person's
 * calendar came back without a single shoot - their own included.
 *
 * `boardWhere` and the database are stubbed: what is pinned is that the signed-in login reaches the
 * "named on" question, and that the shoot query narrows to that person's **own** shoots
 * (`ownShootsWhere`) - not their project roles' or their reports', which the Shoot Board adds.
 */

const dbPath = require.resolve("../src/config/db");
const boardPath = require.resolve("../src/modules/project-management/shoot-board/read");
require(dbPath);
require(boardPath);

const NAMED = { OR: [{ production: { teamMembers: { some: { employeeId: { in: [7] } } } } }] };
const askedAbout = [];
const queried = [];

require.cache[boardPath].exports = {
  ...require.cache[boardPath].exports,
  boardWhere: async (userId) => { askedAbout.push(userId); return userId === 70 ? NAMED : null; },
};
require.cache[dbPath].exports = {
  projectShoot: { findMany: async (args) => { queried.push(args.where); return []; } },
  user: { findUnique: async ({ where }) => (where.id === 70 ? { linkedEmployeeId: 7 } : null) },
};
// Login 70's own shoots, employee 7: the shoot's own people, and its project's two managers.
const OWN = { OR: [
  { project: { productionManagerEmployeeId: 7 } },
  { project: { projectManagerEmployeeId: 7 } },
  { production: { productionCoordinatorEmployeeId: 7 } },
  { production: { teamMembers: { some: { employeeId: 7 } } } },
  { production: { serviceCrew: { some: { employeeId: 7 } } } },
] };

const { SOURCES } = require("../src/modules/schedule/calendar/service");
const shoots = SOURCES.find((source) => source.key === "shoot");
const productionOnly = async ({ feature }) => feature === "Production";

test("a Production-only viewer is narrowed by their own login, not by nobody", async () => {
  askedAbout.length = 0;
  queried.length = 0;
  await shoots.load({ from: null, to: null, viewer: { userId: 70 }, can: productionOnly });
  assert.deepEqual(askedAbout, [70], "boardWhere is asked about the signed-in login");
  assert.equal(queried.length, 1, "the shoots are queried rather than given up on");
  assert.deepEqual(queried[0].OR, OWN.OR, "narrowed to that person's own shoots, not every shoot of their projects or reports");
});

test("a login with no employee behind it still sees no shoots, rather than every shoot", async () => {
  askedAbout.length = 0;
  queried.length = 0;
  const entries = await shoots.load({ from: null, to: null, viewer: { userId: 71 }, can: productionOnly });
  assert.deepEqual(askedAbout, [71]);
  assert.deepEqual(entries, []);
  assert.equal(queried.length, 0);
});
