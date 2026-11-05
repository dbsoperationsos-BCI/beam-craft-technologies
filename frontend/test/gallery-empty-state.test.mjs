import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { galleryEmptyMessage } from "../src/lib/galleryEmptyState.mjs";

// The client gallery's empty shoot says why it is empty, in the client's words - never "Select a
// Selection Setting" to a client who already has one open.

const item = { id: "item-1", name: "High-end Retouched pictures", shoot: { shoot: "Post Wedding" } };
const shootFolder = { folderId: "post-wedding", parentId: null, name: "Post Wedding", total: 0, preparing: 0 };

test("an open item over a shoot with nothing filed says the photos have not been added yet", () => {
  const message = galleryEmptyMessage({ item, groupFolderId: "post-wedding", folders: [shootFolder] });
  assert.equal(message, "No photos have been added for Post Wedding yet. The studio will share them here.");
  assert.doesNotMatch(message, /Selection Setting/);
});

test("photos on their way to the shoot - in the folder or a card under it - read as being prepared", () => {
  assert.equal(
    galleryEmptyMessage({ item, groupFolderId: "post-wedding", folders: [{ ...shootFolder, preparing: 40 }] }),
    "Your photos for Post Wedding are being prepared. They will appear here shortly.",
  );
  const card = { folderId: "card-1", parentId: "post-wedding", name: "Card 1", total: 0, preparing: 12 };
  assert.match(galleryEmptyMessage({ item, groupFolderId: "post-wedding", folders: [shootFolder, card] }), /being prepared/);
  // Another shoot's preparing photos say nothing about this one.
  const other = { folderId: "wedding", parentId: null, name: "Wedding", total: 0, preparing: 30 };
  assert.match(galleryEmptyMessage({ item, groupFolderId: "post-wedding", folders: [shootFolder, other] }), /No photos have been added/);
});

test("an item whose shoot has no folder in the gallery yet says its photos are not ready", () => {
  assert.equal(galleryEmptyMessage({ item, groupFolderId: null, folders: [] }), "The photos for Post Wedding are not ready yet. The studio will add them soon.");
});

test("no item open asks for one; nothing shared at all says so", () => {
  assert.equal(galleryEmptyMessage({ item: null, folders: [shootFolder] }), "Choose a selection item to see its photos.");
  assert.match(galleryEmptyMessage({ hasItems: false }), /No photos have been shared with you yet/);
});

test("the message never names the studio's internal steps", () => {
  const all = [
    galleryEmptyMessage({ item, groupFolderId: "post-wedding", folders: [{ ...shootFolder, preparing: 3 }] }),
    galleryEmptyMessage({ item, groupFolderId: "post-wedding", folders: [shootFolder] }),
    galleryEmptyMessage({ item, folders: [] }),
  ].join(" ");
  assert.doesNotMatch(all, /cull|editing|AI|processing|upload/i);
});

test("the folder cards read their empty message from this rule", () => {
  const source = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "image-selection", "client-gallery", "FolderCards.js"), "utf8");
  assert.match(source, /emptyMessage=\{galleryEmptyMessage\(\{ item: active, groupFolderId: activeFolderGroupId, folders, hasItems: deliverables\.length > 0 \}\)\}/);
  assert.doesNotMatch(source, /Select a Selection Setting/);
});
