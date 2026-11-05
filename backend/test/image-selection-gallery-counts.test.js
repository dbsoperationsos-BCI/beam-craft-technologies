const test = require("node:test");
const assert = require("node:assert/strict");
const { summarizeFolders } = require("../src/modules/image-selection/gallery/repository");

const folders = [
  { id: "shoot-1", parentId: null, name: "Wedding" },
  { id: "card-1", parentId: "shoot-1", name: "card 1" },
];
// One photo picked for Frames only, one for Retouches only, one for both, one for neither.
const images = [
  { id: "a", folderId: "card-1", photoSelections: [{ imageSelectionDeliverableConfigId: "frames" }] },
  { id: "b", folderId: "card-1", photoSelections: [{ imageSelectionDeliverableConfigId: "retouches" }] },
  { id: "c", folderId: "card-1", photoSelections: [{ imageSelectionDeliverableConfigId: "frames" }, { imageSelectionDeliverableConfigId: "retouches" }] },
  { id: "d", folderId: "card-1", photoSelections: [] },
];

// The client gallery reads a folder card against one selection item at a time — "0 out of 30 Images
// Selected for Retouches" over a card reading "2/30 Selected" was the folder counting every photo
// picked for anything, Frames included.
test("counts a folder's selections per selection item, not across all of them", () => {
  const summary = summarizeFolders(folders, images);
  const card = summary.folders.find((folder) => folder.folderId === "card-1");
  assert.equal(card.total, 4);
  assert.equal(card.selectedByDeliverable.frames, 2);
  assert.equal(card.selectedByDeliverable.retouches, 2);
  // A photo picked for two items is one selected photo, which is what a gallery with no item in
  // view reports.
  assert.equal(card.selected, 3);
});

test("gives a selection item with nothing picked in a folder a count of zero, not the folder's", () => {
  const summary = summarizeFolders(folders, [
    { id: "a", folderId: "card-1", photoSelections: [{ imageSelectionDeliverableConfigId: "frames" }] },
    { id: "b", folderId: "card-1", photoSelections: [{ imageSelectionDeliverableConfigId: "frames" }] },
  ]);
  const card = summary.folders.find((folder) => folder.folderId === "card-1");
  assert.equal(card.selectedByDeliverable.frames, 2);
  assert.equal(card.selectedByDeliverable.retouches, undefined);
  assert.equal(card.selected, 2);
});

test("an empty folder answers every selection item with nothing", () => {
  const summary = summarizeFolders(folders, images);
  const shoot = summary.folders.find((folder) => folder.folderId === "shoot-1");
  assert.deepEqual(shoot, { folderId: "shoot-1", parentId: null, name: "Wedding", total: 0, selected: 0, selectedByDeliverable: {} });
});

test("totals the whole gallery and each selection item across folders", () => {
  const summary = summarizeFolders(folders, [
    ...images,
    { id: "e", folderId: null, photoSelections: [{ imageSelectionDeliverableConfigId: "retouches" }] },
  ]);
  // Photos with no folder are still the client's to pick from, so they are listed and counted.
  const unsorted = summary.folders.find((folder) => folder.name === "Unsorted");
  assert.equal(unsorted.selectedByDeliverable.retouches, 1);
  assert.deepEqual(summary.overall, { total: 5, selected: 4 });
  assert.deepEqual(summary.selectionCounts, { frames: 2, retouches: 3 });
});
