const test = require("node:test");
const assert = require("node:assert/strict");
const { syncProjectShootDeliverables } = require("../src/modules/sales/projects/controller");

/**
 * A stand-in for the Prisma transaction the helper is handed. It records what happened so a test can
 * assert on the thing that matters: whether a row kept its id.
 */
function fakeTransaction(rows) {
  const state = { rows: rows.map((row) => ({ ...row })), created: [], nextId: 100 };
  return {
    state,
    projectShootDeliverable: {
      findMany: async () => state.rows.filter((row) => !row.deletedAt).map((row) => ({ id: row.id, shootId: row.shootId, deliverableName: row.deliverableName })),
      update: async ({ where, data }) => { const row = state.rows.find((item) => item.id === where.id); Object.assign(row, data); return row; },
      create: async ({ data }) => { const row = { id: `new-${state.nextId++}`, ...data }; state.rows.push(row); state.created.push(row); return row; },
      updateMany: async ({ where, data }) => { state.rows.filter((row) => where.id.in.includes(row.id)).forEach((row) => Object.assign(row, data)); return { count: where.id.in.length }; },
    },
  };
}

const row = (overrides = {}) => ({ id: "deliverable-1", projectId: "project-1", shootId: "shoot-1", deliverableName: "Retouches", quantity: 30, selectionLimit: null, deletedAt: null, ...overrides });

test("keeps a deliverable's id when it is saved again", async () => {
  // The whole point: Image Selection's selection items and the client's photo picks hang off this id.
  // Recreating the row retired the selection item and stranded every pick made against it.
  const tx = fakeTransaction([row({ selectionLimit: 19 })]);
  await syncProjectShootDeliverables(tx, "project-1", [{ shootId: "shoot-1", deliverableName: "Retouches", quantity: 30 }]);
  assert.deepEqual(tx.state.rows.map((item) => item.id), ["deliverable-1"]);
  assert.equal(tx.state.created.length, 0);
  assert.equal(tx.state.rows[0].deletedAt, null);
});

test("leaves a selection limit alone when the save does not mention it", async () => {
  // Project Management's deliverables step does not ask for the limit. Treating its silence as null
  // would wipe a limit set in Image Selection, which is exactly what the shared column exists to stop.
  const tx = fakeTransaction([row({ selectionLimit: 19 })]);
  await syncProjectShootDeliverables(tx, "project-1", [{ shootId: "shoot-1", deliverableName: "Retouches", quantity: 40 }]);
  assert.equal(tx.state.rows[0].selectionLimit, 19);
  assert.equal(tx.state.rows[0].quantity, 40, "the quantity it did ask about is updated");
});

test("writes a selection limit when the save does mention it", async () => {
  const tx = fakeTransaction([row({ selectionLimit: 19 })]);
  await syncProjectShootDeliverables(tx, "project-1", [{ shootId: "shoot-1", deliverableName: "Retouches", quantity: 30, selectionLimit: 25 }]);
  assert.equal(tx.state.rows[0].selectionLimit, 25);
});

test("clears a selection limit when the save asks for null", async () => {
  const tx = fakeTransaction([row({ selectionLimit: 19 })]);
  await syncProjectShootDeliverables(tx, "project-1", [{ shootId: "shoot-1", deliverableName: "Retouches", quantity: 30, selectionLimit: null }]);
  assert.equal(tx.state.rows[0].selectionLimit, null);
});

test("matches a deliverable by shoot and name, ignoring case and padding", async () => {
  const tx = fakeTransaction([row()]);
  await syncProjectShootDeliverables(tx, "project-1", [{ shootId: "shoot-1", deliverableName: "  retouches ", quantity: 30 }]);
  assert.equal(tx.state.created.length, 0, "the same deliverable, spelled loosely");
  assert.deepEqual(tx.state.rows.map((item) => item.id), ["deliverable-1"]);
});

test("the same deliverable name on another shoot is its own row", async () => {
  const tx = fakeTransaction([row()]);
  await syncProjectShootDeliverables(tx, "project-1", [
    { shootId: "shoot-1", deliverableName: "Retouches", quantity: 30 },
    { shootId: "shoot-2", deliverableName: "Retouches", quantity: 15 },
  ]);
  assert.equal(tx.state.created.length, 1);
  assert.equal(tx.state.created[0].shootId, "shoot-2");
});

test("adds a deliverable that was not there before", async () => {
  const tx = fakeTransaction([row()]);
  await syncProjectShootDeliverables(tx, "project-1", [
    { shootId: "shoot-1", deliverableName: "Retouches", quantity: 30 },
    { shootId: "shoot-1", deliverableName: "Album Selection", quantity: 5000 },
  ]);
  assert.deepEqual(tx.state.created.map((item) => item.deliverableName), ["Album Selection"]);
  assert.equal(tx.state.rows.find((item) => item.id === "deliverable-1").deletedAt, null);
});

test("retires a deliverable dropped from the list, so removing one still works", async () => {
  const tx = fakeTransaction([row(), row({ id: "deliverable-2", deliverableName: "Custom Gifts", quantity: 10 })]);
  await syncProjectShootDeliverables(tx, "project-1", [{ shootId: "shoot-1", deliverableName: "Retouches", quantity: 30 }]);
  assert.equal(tx.state.rows.find((item) => item.id === "deliverable-1").deletedAt, null);
  assert.ok(tx.state.rows.find((item) => item.id === "deliverable-2").deletedAt, "the dropped one is retired, not deleted");
});

test("an empty list retires everything without creating anything", async () => {
  const tx = fakeTransaction([row()]);
  await syncProjectShootDeliverables(tx, "project-1", []);
  assert.ok(tx.state.rows[0].deletedAt);
  assert.equal(tx.state.created.length, 0);
});
