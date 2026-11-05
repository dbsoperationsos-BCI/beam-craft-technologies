const test = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");
const repository = require("../src/modules/image-selection/publication/repository");

/*
 * Submit All's write: every item it sends is stamped in one transaction, or none is. A transaction
 * double stands in for the database - it records each call, and a throw inside the callback is the
 * rollback, exactly as Prisma's interactive transaction treats it.
 */
function fakeTransaction({ stampedCount, openAfter }) {
  const calls = [];
  const tx = {
    imageSelectionGalleryPublication: { update: async (args) => { calls.push(["publication.update", args]); } },
    imageSelectionDeliverableConfig: {
      updateMany: async (args) => { calls.push(["config.updateMany", args]); return { count: stampedCount }; },
      count: async (args) => { calls.push(["config.count", args]); return openAfter; },
    },
  };
  prisma.$transaction = async (work) => work(tx);
  return calls;
}

test("the gallery is locked first, then only this project's unsent items are stamped", async () => {
  const calls = fakeTransaction({ stampedCount: 2, openAfter: 1 });
  await repository.markSubmitted("project-1", ["ret", "fra"], ["ret", "fra", "alb"]);
  assert.equal(calls[0][0], "publication.update", "the publication row is touched before anything else");
  const [, stamp] = calls[1];
  assert.deepEqual(stamp.where, { id: { in: ["ret", "fra"] }, imageSelectionProjectId: "project-1", selectionSubmittedAt: null });
  assert.equal(calls.filter(([name]) => name === "publication.update").length, 1, "an item still open leaves the project unfinished");
});

test("the last open items finish the project inside the same transaction", async () => {
  const calls = fakeTransaction({ stampedCount: 2, openAfter: 0 });
  await repository.markSubmitted("project-1", ["ret", "fra"], ["ret", "fra"]);
  const flag = calls.filter(([name]) => name === "publication.update")[1];
  assert.ok(flag?.[1].data.selectionSubmittedAt instanceof Date);
});

test("an item already sent by another request rolls the whole write back as 409", async () => {
  const calls = fakeTransaction({ stampedCount: 1, openAfter: 0 });
  await assert.rejects(repository.markSubmitted("project-1", ["ret", "fra"], ["ret", "fra"]), (error) => error.status === 409);
  assert.ok(!calls.some(([name]) => name === "config.count"), "nothing after the short stamp runs");
});

test("an id named twice is stamped once and does not read as a short stamp", async () => {
  fakeTransaction({ stampedCount: 1, openAfter: 1 });
  await repository.markSubmitted("project-1", ["ret", "ret"], ["ret", "fra"]);
});
