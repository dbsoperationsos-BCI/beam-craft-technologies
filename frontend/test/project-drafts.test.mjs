import test from "node:test";
import assert from "node:assert/strict";
import { PROJECT_DRAFT_TTL_MS, draftForEnquiry, projectDraftSnapshot, projectDraftTitle, readProjectDrafts, removeDraftsForEnquiry, removeProjectDraft, saveProjectDraft } from "../src/lib/projectDrafts.mjs";

function memoryStorage() {
  const map = new Map();
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), removeItem: (key) => map.delete(key) };
}

test("a draft lasts five days from its last save, then is gone", () => {
  const storage = memoryStorage();
  saveProjectDraft(storage, 1, { enquiryId: "42", title: "A", snapshot: {} }, 1000);
  assert.equal(readProjectDrafts(storage, 1, 1000 + PROJECT_DRAFT_TTL_MS - 1).length, 1);
  assert.equal(readProjectDrafts(storage, 1, 1000 + PROJECT_DRAFT_TTL_MS).length, 0);
});

test("one draft per enquiry: a second save replaces the first", () => {
  const storage = memoryStorage();
  saveProjectDraft(storage, 1, { enquiryId: "42", title: "first", snapshot: {} }, 1000);
  saveProjectDraft(storage, 1, { enquiryId: "42", title: "second", snapshot: {} }, 2000);
  saveProjectDraft(storage, 1, { title: "no enquiry", snapshot: {} }, 3000);
  const drafts = readProjectDrafts(storage, 1, 3000);
  assert.deepEqual(drafts.map((draft) => draft.title), ["no enquiry", "second"]);
  assert.equal(draftForEnquiry(storage, 1, "42", 3000).title, "second");
  assert.equal(draftForEnquiry(storage, 1, "", 3000), null);
});

test("saving a reopened draft keeps its id and replaces it", () => {
  const storage = memoryStorage();
  const draft = saveProjectDraft(storage, 1, { title: "x", snapshot: {} }, 1000);
  saveProjectDraft(storage, 1, { id: draft.id, title: "y", snapshot: {} }, 2000);
  assert.deepEqual(readProjectDrafts(storage, 1, 2000).map((entry) => [entry.id, entry.title]), [[draft.id, "y"]]);
});

test("drafts belong to the user who saved them", () => {
  const storage = memoryStorage();
  saveProjectDraft(storage, 1, { enquiryId: "42", snapshot: {} }, 1000);
  assert.equal(readProjectDrafts(storage, 2, 1000).length, 0);
});

test("removing by id and by enquiry", () => {
  const storage = memoryStorage();
  const a = saveProjectDraft(storage, 1, { enquiryId: "1", snapshot: {} }, 1000);
  saveProjectDraft(storage, 1, { enquiryId: "2", snapshot: {} }, 1000);
  removeProjectDraft(storage, 1, a.id);
  removeDraftsForEnquiry(storage, 1, "2");
  assert.equal(readProjectDrafts(storage, 1, 1000).length, 0);
});

test("broken or throwing storage reads as no drafts", () => {
  assert.deepEqual(readProjectDrafts({ getItem: () => "{nope" }, 1), []);
  assert.deepEqual(readProjectDrafts({ getItem: () => { throw new Error("blocked"); } }, 1), []);
  assert.deepEqual(readProjectDrafts(null, 1), []);
});

test("the snapshot drops picked files and the definitions on plan rows", () => {
  const file = new Blob(["x"]);
  const snapshot = projectDraftSnapshot({
    form: { enquiryId: "9", shoots: [{ key: "s1" }] },
    services: [{ serviceDefinitionId: "d1", serviceDefinition: { id: "d1", price: 5 } }],
    deliverables: [{ deliverableDefinitionId: "e1", deliverableDefinition: { id: "e1" } }],
    schedulePayments: [],
    advance: { amount: "100", paymentProof: [file] },
  });
  assert.deepEqual(snapshot.plan.services, [{ serviceDefinitionId: "d1" }]);
  assert.deepEqual(snapshot.plan.deliverables, [{ deliverableDefinitionId: "e1" }]);
  assert.deepEqual(snapshot.plan.shoots, [{ key: "s1" }]);
  assert.deepEqual(snapshot.advance, { amount: "100", paymentProof: [] });
  assert.doesNotThrow(() => JSON.stringify(snapshot));
});

test("a draft is named by its group, else its number, else its enquiry", () => {
  assert.equal(projectDraftTitle({ whatsappGroupName: "Asha & Ravi" }), "Asha & Ravi");
  assert.equal(projectDraftTitle({ clientMainNumber: "+91 98" }), "+91 98");
  assert.equal(projectDraftTitle({ enquiryId: "7" }), "Enquiry #7");
  assert.equal(projectDraftTitle({}), "Untitled project");
});

test("a draft remembers whether its enquiry was settled, and whether a receipt was left behind", async () => {
  const { draftDropsFiles } = await import("../src/lib/projectDrafts.mjs");
  assert.equal(projectDraftSnapshot({ form: {}, enquiryLocked: true }).enquiryLocked, true);
  assert.equal(projectDraftSnapshot({ form: {} }).enquiryLocked, false);
  assert.equal(draftDropsFiles({ amount: "5", paymentProof: [new Blob(["x"])] }), true);
  assert.equal(draftDropsFiles({ amount: "5", paymentProof: [] }), false);
});
