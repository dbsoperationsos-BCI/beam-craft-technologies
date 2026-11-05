const test = require("node:test");
const assert = require("node:assert/strict");

/*
 * `submitSelection` tells the Photo Selection Submitted notification about each submission it has
 * committed - and about nothing else: a repeat of a submitted item is refused before any write, and
 * a write that fails announces nothing. The repositories and the deliverable service are stood in
 * for before the service is required, the way the direct-send tests stand in the session manager.
 */
const repositoryPath = require.resolve("../src/modules/image-selection/publication/repository");
const galleryPath = require.resolve("../src/modules/image-selection/gallery/repository");
const deliverablesPath = require.resolve("../src/modules/image-selection/deliverables/service");
const servicePath = require.resolve("../src/modules/image-selection/publication/service");
for (const path of [repositoryPath, galleryPath, deliverablesPath, servicePath]) delete require.cache[path];

const state = { items: [], marked: [], failWrite: null, stamp: new Date("2026-10-20T10:00:00Z") };
const publication = { projectId: "isel-1", status: "PUBLISHED", pinHash: null, expiresAt: new Date(Date.now() + 86400000), publishedAt: new Date(), project: { deletedAt: null, projectName: "Arun & Meera" } };
require(repositoryPath);
require.cache[repositoryPath].exports = {
  findByShortCode: async () => publication,
  findByTokenHash: async () => null, findAnyByShortCode: async () => null, findAnyByTokenHash: async () => null,
  markSubmitted: async (projectId, ids) => { if (state.failWrite) throw state.failWrite; state.marked.push(...ids); for (const item of state.items) if (ids.includes(item.id)) item.selectionSubmittedAt = state.stamp; return state.stamp; },
  markSelectionSubmitted: async () => { state.marked.push("all"); return state.stamp; },
  markClientActivity: async () => {},
  markGalleryOpened: async () => {},
};
require(galleryPath);
require.cache[galleryPath].exports = { ...require.cache[galleryPath].exports, countDeliverableSelections: async (_projectId, id) => (state.items.find((item) => item.id === id)?.picks || 0) };
require(deliverablesPath);
require.cache[deliverablesPath].exports = { ...require.cache[deliverablesPath].exports, createDeliverableService: () => ({ list: async () => state.items }) };

const service = require(servicePath);
const announced = [];
service.setSubmissionListenerForTest(async (projectId, ids, submittedAt) => { announced.push({ projectId, ids, submittedAt }); });
const flush = () => new Promise((resolve) => setImmediate(resolve));
const TOKEN = "ABCD1234";

test("each category submitted on its own is announced on its own, with its id, after the write", async () => {
  state.items = [{ id: "retouches", name: "Retouches", enabled: true, inactiveAt: null, selectionSubmittedAt: null, picks: 5 }, { id: "frames", name: "Frames", enabled: true, inactiveAt: null, selectionSubmittedAt: null, picks: 3 }];
  state.marked = []; announced.length = 0;
  assert.deepEqual(await service.submitSelection(TOKEN, "retouches"), { submitted: true, deliverableConfigId: "retouches" });
  await flush();
  assert.deepEqual(announced, [{ projectId: "isel-1", ids: ["retouches"], submittedAt: state.stamp }], "Retouches announced with the write's own stamp; Frames, still open, neither marked nor announced");
  assert.equal(state.items[1].selectionSubmittedAt, null);
  assert.deepEqual(await service.submitSelection(TOKEN, "frames"), { submitted: true, deliverableConfigId: "frames" });
  await flush();
  assert.deepEqual(announced.at(-1), { projectId: "isel-1", ids: ["frames"], submittedAt: state.stamp });
});

test("an item the studio reopened and the client sent again is announced again, as a new submission with the new stamp", async () => {
  announced.length = 0;
  const first = state.items[0].selectionSubmittedAt;
  state.items[0].selectionSubmittedAt = null; // the deliverables screen's reopen: uncheck, re-enable
  state.stamp = new Date(first.getTime() + 3600000);
  assert.deepEqual(await service.submitSelection(TOKEN, "retouches"), { submitted: true, deliverableConfigId: "retouches" });
  await flush();
  assert.deepEqual(announced, [{ projectId: "isel-1", ids: ["retouches"], submittedAt: state.stamp }]);
  assert.notEqual(announced[0].submittedAt.getTime(), first.getTime());
});

test("opening the gallery or the review, picking, un-picking and clearing announce nothing - only a committed submit does", async () => {
  announced.length = 0;
  // What the open, pick, un-pick and Deselect All handlers call on this service: activity stamps.
  await service.recordGalleryOpened("isel-1", new Date());
  await service.recordClientActivity("isel-1", new Date());
  await flush();
  assert.deepEqual(announced, []);
  // And the handlers themselves never reach the announcement: the call sits in `submitSelection`
  // alone, so a pick, a clear or a listing of the selected photos cannot queue a message.
  const fs = require("node:fs");
  const read = (path) => fs.readFileSync(require.resolve(path), "utf8");
  for (const path of ["../src/modules/image-selection/public-gallery/controller", "../src/modules/image-selection/gallery/service", "../src/modules/image-selection/gallery/repository"])
    assert.doesNotMatch(read(path), /announceSubmission|afterSubmission/, `${path} must not announce a submission`);
  const source = read("../src/modules/image-selection/publication/service");
  const callers = source.split(/^(?=(?:async )?function \w+\()/m).map((chunk) => [chunk, chunk.match(/^(?:async )?function (\w+)\(/)?.[1]]).filter(([chunk, name]) => name && name !== "announceSubmission" && chunk.includes("announceSubmission(")).map(([, name]) => name);
  assert.deepEqual(callers, ["submitSelection"]);
});

test("a repeat of a submitted category is refused before any write, and announces nothing", async () => {
  announced.length = 0; state.marked = [];
  await assert.rejects(service.submitSelection(TOKEN, "retouches"), (error) => error.status === 409);
  await flush();
  assert.deepEqual(announced, []);
  assert.deepEqual(state.marked, []);
});

test("a write that fails announces nothing", async () => {
  state.items = [{ id: "album", name: "Album", enabled: true, inactiveAt: null, selectionSubmittedAt: null, picks: 2 }];
  state.failWrite = Object.assign(new Error("deadlock"), { status: 500 });
  announced.length = 0;
  await assert.rejects(service.submitSelection(TOKEN, "album"));
  await flush();
  assert.deepEqual(announced, []);
  state.failWrite = null;
});

test("Submit All is one submission of several items, announced once with all of them", async () => {
  state.items = [{ id: "a", name: "A", enabled: true, inactiveAt: null, selectionSubmittedAt: null, picks: 1 }, { id: "b", name: "B", enabled: true, inactiveAt: null, selectionSubmittedAt: null, picks: 1 }];
  announced.length = 0;
  await service.submitSelection(TOKEN, null, null, ["a", "b"]);
  await flush();
  assert.deepEqual(announced, [{ projectId: "isel-1", ids: ["a", "b"], submittedAt: state.stamp }]);
});

test("a Submit All naming an item already sent on its own is refused whole, and announces nothing", async () => {
  state.items = [{ id: "retouches", name: "Retouches", enabled: true, inactiveAt: null, selectionSubmittedAt: new Date(), picks: 4 }, { id: "frames", name: "Frames", enabled: true, inactiveAt: null, selectionSubmittedAt: null, picks: 5 }];
  announced.length = 0; state.marked = [];
  await assert.rejects(service.submitSelection(TOKEN, null, null, ["retouches", "frames"]), (error) => error.status === 409 && /Retouches has already been submitted/.test(error.message));
  await flush();
  assert.deepEqual(announced, []);
  assert.deepEqual(state.marked, [], "Frames is not sent on its own either");
  assert.equal(state.items[1].selectionSubmittedAt, null);
});

test("a listener that throws never reaches the client", async () => {
  state.items = [{ id: "c", name: "C", enabled: true, inactiveAt: null, selectionSubmittedAt: null, picks: 1 }];
  service.setSubmissionListenerForTest(async () => { throw new Error("queue down"); });
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    assert.deepEqual(await service.submitSelection(TOKEN, "c"), { submitted: true, deliverableConfigId: "c" });
    await flush();
  } finally {
    console.warn = original;
  }
  assert.match(warnings.join("\n"), /could not queue the notification/);
});
