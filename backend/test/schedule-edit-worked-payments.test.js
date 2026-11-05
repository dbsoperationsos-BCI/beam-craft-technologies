const test = require("node:test");
const assert = require("node:assert/strict");
const { saveProjectSchedule } = require("../src/modules/accounts/scheduled-payments/service");

/*
 * Edit mode opens every payment - completed and upcoming alike - so a save may change or remove one
 * Accounts has already worked. Removing a paid one never removes money: its receipts are unlinked
 * and stay on the project's books.
 */
const SIGNED = 129200;

function fakeClient(saved) {
  const writes = [];
  const client = {
    salesProject: { findUnique: async () => ({ initialConvertedValue: SIGNED }) },
    paymentScheduleCategory: { findMany: async () => [{ id: 1, name: "Advance", repeatable: false }] },
    projectShoot: { findMany: async () => [] },
    projectPaymentSchedule: {
      findMany: async () => saved,
      update: async (args) => writes.push(["update", args]),
      create: async (args) => writes.push(["create", args]),
      updateMany: async (args) => writes.push(["withdraw", args]),
    },
    cashEntry: { updateMany: async (args) => writes.push(["unlink", args]) },
  };
  return { client, writes };
}
const row = (id, fields) => ({
  id, projectId: "p1", category: "Advance", categoryId: 1, percentage: null, amount: null, sortOrder: 1, remarks: null,
  dueDate: new Date("2026-11-01T00:00:00.000Z"), splitFromId: null, holdAt: null, receipts: [], _count: { splits: 0 }, ...fields,
});

test("a cleared payment is updated with what the form sends, not kept as it was", async () => {
  const cleared = row("paid", { percentage: 5, receipts: [{ amount: 6460 }] });
  const { client, writes } = fakeClient([cleared]);
  await saveProjectSchedule("p1", [{ id: "paid", category: "Advance", date: "2026-11-10", remarks: "Slot booking moved", percentage: 6 }], 1, { client });
  const update = writes.find(([kind]) => kind === "update");
  assert.ok(update, "the worked payment is written");
  assert.equal(update[1].where.id, "paid");
  assert.equal(update[1].data.percentage, 6);
  assert.equal(update[1].data.remarks, "Slot booking moved");
  assert.equal(update[1].data.dueDate.toISOString().slice(0, 10), "2026-11-10");
  assert.equal(writes.some(([kind]) => kind === "unlink"), false, "nothing was removed, so no receipt is unlinked");
});

test("removing a paid payment withdraws it and unlinks its receipts - the money stays", async () => {
  const { client, writes } = fakeClient([row("paid", { percentage: 5, receipts: [{ amount: 6460 }] }), row("next", { percentage: 20 })]);
  await saveProjectSchedule("p1", [{ id: "next", category: "Advance", date: "2026-12-01", percentage: 20 }], 1, { client });
  const withdraw = writes.find(([kind]) => kind === "withdraw");
  assert.deepEqual(withdraw[1].where.id.in, ["paid"]);
  const unlink = writes.find(([kind]) => kind === "unlink");
  assert.deepEqual(unlink[1], { where: { paymentScheduleId: { in: ["paid"] } }, data: { paymentScheduleId: null } });
});

test("a payment fixed at an amount stays fixed unless its amount is changed", async () => {
  // What a part payment left: ₹3,071, sent back by the form as its share of ₹1,29,200.
  const fixed = row("split", { amount: 3071, splitFromId: "paid" });
  const same = fakeClient([fixed]);
  await saveProjectSchedule("p1", [{ id: "split", category: "Advance", date: "2026-11-02", percentage: 2.376935 }], 1, { client: same.client });
  const kept = same.writes.find(([kind]) => kind === "update")[1].data;
  assert.equal(kept.percentage, null, "still a fixed amount");
  assert.equal("amount" in kept, false, "the amount is left as it was");

  const changed = fakeClient([fixed]);
  await saveProjectSchedule("p1", [{ id: "split", category: "Advance", date: "2026-11-02", percentage: 5 }], 1, { client: changed.client });
  const moved = changed.writes.find(([kind]) => kind === "update")[1].data;
  assert.equal(moved.percentage, 5);
  assert.equal(moved.amount, null, "now a share of the quotation like any other");
});
