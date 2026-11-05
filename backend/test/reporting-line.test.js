const test = require("node:test");
const assert = require("node:assert/strict");
const { shiftDirectReportsUp, nearestWorkingManager } = require("../src/services/reportingLine");

// The studio's working list, handed over so these tests never read Settings.
const WORKING = { workingStatuses: ["Active"] };

/*
 * When somebody stops working here, whoever reported to them is shifted up to the manager they
 * themselves reported to - rather than left pointing at somebody no longer active - unless there is
 * nobody above to shift them to, which is refused rather than left rootless.
 */

/**
 * A stand-in for Prisma holding `id -> reportsToEmployeeId`, mutated by `updateMany` like the real
 * thing. A third element is the person's status (Active unless said), and "archived" archives them.
 */
function fakeClient(people) {
  const rows = new Map(people.map(([id, reportsToEmployeeId, status = "Active"]) => [id, {
    id, reportsToEmployeeId, employeeName: `Person ${id}`,
    employmentStatus: status === "archived" ? "Active" : status,
    archivedAt: status === "archived" ? new Date() : null,
  }]));
  return {
    rows,
    employee: {
      findMany: async ({ where, select }) => [...rows.values()]
        .filter((row) => row.reportsToEmployeeId === where.reportsToEmployeeId)
        .map((row) => (select ? Object.fromEntries(Object.keys(select).map((key) => [key, row[key]])) : row)),
      findFirst: async ({ where, select }) => {
        const row = rows.get(where.id);
        if (!row) return null;
        return select ? Object.fromEntries(Object.keys(select).map((key) => [key, row[key]])) : row;
      },
      updateMany: async ({ where, data }) => {
        for (const id of where.id.in) {
          const row = rows.get(id);
          if (row) Object.assign(row, data);
        }
        return { count: where.id.in.length };
      },
    },
  };
}

test("nobody reporting to this employee - nothing to do", async () => {
  const client = fakeClient([[1, null]]);
  await shiftDirectReportsUp(1, client, WORKING);
  assert.equal(client.rows.get(1).reportsToEmployeeId, null);
});

test("their reports move up to their own manager", async () => {
  // 1 (root) -> 2 (leaving) -> 3, 4 (report to 2)
  const client = fakeClient([[1, null], [2, 1], [3, 2], [4, 2]]);
  await shiftDirectReportsUp(2, client, WORKING);
  assert.equal(client.rows.get(3).reportsToEmployeeId, 1);
  assert.equal(client.rows.get(4).reportsToEmployeeId, 1);
  // The employee who left is untouched by this call - only their reports move.
  assert.equal(client.rows.get(2).reportsToEmployeeId, 1);
});

test("somebody with reports but nobody above them refuses, naming how many", async () => {
  // 1 is a root with two reports.
  const client = fakeClient([[1, null], [2, 1], [3, 1]]);
  await assert.rejects(
    () => shiftDirectReportsUp(1, client, WORKING),
    (error) => {
      assert.equal(error.status, 409);
      assert.match(error.message, /2 people still report/i);
      assert.match(error.message, /nobody above them/i);
      return true;
    },
  );
  // Refused before anything is written.
  assert.equal(client.rows.get(2).reportsToEmployeeId, 1);
  assert.equal(client.rows.get(3).reportsToEmployeeId, 1);
});

test("the refusal reads in the singular for exactly one report", async () => {
  const client = fakeClient([[1, null], [2, 1]]);
  await assert.rejects(
    () => shiftDirectReportsUp(1, client, WORKING),
    (error) => {
      assert.match(error.message, /1 person still reports/i);
      assert.match(error.message, /reassign that report/i);
      return true;
    },
  );
});

test("a root with nobody reporting to them is not refused - there is nothing to shift", async () => {
  const client = fakeClient([[1, null]]);
  await shiftDirectReportsUp(1, client, WORKING);
});

test("a deeper chain shifts reports to the immediate manager, not the top of the tree", async () => {
  // 1 -> 2 -> 3 (leaving) -> 4. 4 should move to 2, not to 1.
  const client = fakeClient([[1, null], [2, 1], [3, 2], [4, 3]]);
  await shiftDirectReportsUp(3, client, WORKING);
  assert.equal(client.rows.get(4).reportsToEmployeeId, 2);
});

/*
 * The leaver's own manager may have left too. Moving the reports onto them would point them at
 * somebody no longer active, so the move goes on up to the nearest manager still working.
 */
test("a manager who has left is passed over for the nearest one still working", async () => {
  // 1 (working root) -> 2 (has Left) -> 3 (leaving) -> 4, 5
  const client = fakeClient([[1, null], [2, 1, "Left"], [3, 2], [4, 3], [5, 3]]);
  await shiftDirectReportsUp(3, client, WORKING);
  assert.equal(client.rows.get(4).reportsToEmployeeId, 1);
  assert.equal(client.rows.get(5).reportsToEmployeeId, 1);
});

test("an archived manager is passed over too", async () => {
  const client = fakeClient([[1, null], [2, 1, "archived"], [3, 2], [4, 3]]);
  await shiftDirectReportsUp(3, client, WORKING);
  assert.equal(client.rows.get(4).reportsToEmployeeId, 1);
});

test("with nobody above still working, the move is refused rather than made onto a leaver", async () => {
  const client = fakeClient([[1, null, "Left"], [2, 1], [3, 2]]);
  await assert.rejects(() => shiftDirectReportsUp(2, client, WORKING), (error) => {
    assert.equal(error.status, 409);
    assert.match(error.message, /nobody above them still working/i);
    return true;
  });
  assert.equal(client.rows.get(3).reportsToEmployeeId, 2, "nothing moved");
});

test("a chain that loops back on itself finds nobody rather than walking for ever", async () => {
  const client = fakeClient([[1, 2, "Left"], [2, 1, "Left"], [3, 1]]);
  assert.equal(await nearestWorkingManager(3, client, WORKING), null);
});

test("the hand-over pop-up suggests the same person the reports move to", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "src", "modules", "hrm", "separations", "controller.js"), "utf8");
  assert.match(source, /const nearest = await nearestWorkingManager\(employee\.id, prisma\);/);
});
