import test from "node:test";
import assert from "node:assert/strict";
import { folderShootGroup, unmatchedFolderShoots, withFolderNames } from "../src/lib/shootGroups.mjs";

/*
 * A manual project's shoots are its root folders. A saved selection-item group answers to its
 * folder BY ID, so a renamed folder is still the same one group - never a saved group plus a second,
 * empty group for the new name, which is how a rename used to look like it created a shoot.
 */

const wedding = { id: "f-wedding", name: "wedding 02" };
const reception = { id: "f-reception", name: "Reception" };

test("a renamed folder still answers to its saved group by id - no second group appears", () => {
  const saved = [{ id: "folder:f-wedding", shoot: "wedding 02", folderId: "f-wedding" }];
  assert.deepEqual(unmatchedFolderShoots(saved, [wedding, reception]), [reception]);
});

test("a folder no saved group answers to stands as its own empty group, keyed by its id", () => {
  assert.deepEqual(unmatchedFolderShoots([], [reception]), [reception]);
  assert.deepEqual(folderShootGroup(reception), { id: "folder:f-reception", shoot: { id: "folder:f-reception", shootId: null, shoot: "Reception", folderId: "f-reception" } });
});

test("a typed group no folder is linked to yet still answers by name", () => {
  const saved = [{ id: "manual:reception", shoot: "reception", folderId: null }];
  assert.deepEqual(unmatchedFolderShoots(saved, [reception]), []);
});

test("two folders of one name are two shoots now - each by its own id", () => {
  const twin = { id: "f-reception-2", name: "Reception" };
  assert.deepEqual(unmatchedFolderShoots([], [reception, twin]), [reception, twin]);
});

test("a renamed folder heads its saved items under the new name at once, without reloading them", () => {
  const items = [
    { id: "i1", shoot: { id: "folder:f-wedding", shoot: "wedding", folderId: "f-wedding" } },
    { id: "i2", shoot: { id: "manual:candid", shoot: "Candid", folderId: null } },
  ];
  const shown = withFolderNames(items, [wedding, reception]);
  assert.equal(shown[0].shoot.shoot, "wedding 02");
  assert.equal(shown[0].shoot.id, "folder:f-wedding");
  // An item no folder is linked to keeps its own name, untouched.
  assert.equal(shown[1], items[1]);
  // The loaded items themselves are never changed.
  assert.equal(items[0].shoot.shoot, "wedding");
});
