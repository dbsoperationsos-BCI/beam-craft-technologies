const test = require("node:test");
const assert = require("node:assert/strict");

const store = require("../src/modules/sales/whatsapp-chat/mediaStore");

/*
 * Where a client's WhatsApp files land in the bucket.
 *
 * The layout is meant to be read by a person opening R2 - one folder per client, four folders
 * inside it - so the shape of the key is part of the feature rather than an implementation
 * detail. These tests hold that shape, and hold the two things that make it safe: a name typed by
 * a person cannot become anything other than one path segment, and two clients who share a name
 * cannot share a folder.
 */

test("a file lands under crm/whatsapp-chat/<client>/<kind>", () => {
  const key = store.buildMediaKey({
    enquiryId: "DBS-DD-EID-4871",
    clientName: "Dhanush",
    mediaType: "image",
    fileName: "ABC123.jpg",
  });
  assert.equal(key, "crm/whatsapp-chat/dhanush-DBS-DD-EID-4871/images/ABC123.jpg");
});

test("each media type gets its own folder", () => {
  const folders = ["image", "sticker", "audio", "video", "document"].map(store.folderFor);
  assert.deepEqual(folders, ["images", "images", "audios", "videos", "files"]);
  // A sticker is an image, and anything unrecognised is a file rather than a new folder.
  assert.equal(store.folderFor("something-new"), "files");
  assert.equal(store.folderFor(""), "files");
});

test("two clients with the same name do not share a folder", () => {
  // This CRM already holds two leads named Puri. A folder per name alone would silently merge
  // two people's conversations, which is why the enquiry id is part of the folder.
  const first = store.buildMediaKey({ enquiryId: "DBS-DD-EID-4868", clientName: "Puri", mediaType: "image", fileName: "a.jpg" });
  const second = store.buildMediaKey({ enquiryId: "DBS-DD-EID-4869", clientName: "Puri", mediaType: "image", fileName: "a.jpg" });
  assert.notEqual(first, second);
  assert.ok(first.includes("puri-DBS-DD-EID-4868"));
  assert.ok(second.includes("puri-DBS-DD-EID-4869"));
});

test("a client name becomes exactly one path segment", () => {
  // Names are typed by people and can contain anything at all.
  for (const [name, expected] of [
    ["Ravi Kumar", "ravi-kumar"],
    ["../../etc", "etc"],
    ["A/B\\C", "a-b-c"],
    ["  spaced  out  ", "spaced-out"],
    ["!!!", "unnamed"],
    ["", "unnamed"],
  ]) {
    const slug = store.clientSlug(name);
    assert.equal(slug, expected, `${JSON.stringify(name)} should slug to ${expected}`);
    assert.match(slug, /^[a-z0-9-]+$/, "a slug may only be lower-case letters, digits and hyphens");
  }
});

test("a hostile file name cannot add folders to the key", () => {
  const key = store.buildMediaKey({
    enquiryId: "DBS-DD-EID-4871",
    clientName: "Dhanush",
    mediaType: "document",
    fileName: "../../../creds.json",
  });
  // Four segments and no more: root, client, kind, file.
  assert.equal(key.split("/").length, 5);
  assert.ok(key.startsWith("crm/whatsapp-chat/dhanush-DBS-DD-EID-4871/files/"));
  assert.equal(key.includes(".."), false);
});

test("a key is only built for a real lead id", () => {
  // Returning "" rather than throwing: a message whose file cannot be placed still belongs in
  // the thread, without its attachment.
  for (const bad of ["", "not-an-id", "DBS-DD-EID-", "../../x", null]) {
    assert.equal(store.buildMediaKey({ enquiryId: bad, clientName: "X", mediaType: "image", fileName: "a.jpg" }), "");
  }
});

test("a stored path says which store it came from", () => {
  // A slash is the discriminator: local names never contain one, bucket keys always do, so files
  // stored before the bucket keep working untouched.
  assert.equal(store.isRemoteKey("crm/whatsapp-chat/x-DBS-DD-EID-1/images/a.jpg"), true);
  assert.equal(store.isRemoteKey("ABC123.jpg"), false);
  assert.equal(store.isRemoteKey(""), false);
  assert.equal(store.isRemoteKey(null), false);
});

test("a file name is reduced to something that can only name a file", () => {
  assert.equal(store.safeFileName("../../creds.json"), "creds.json");
  assert.equal(store.safeFileName("a/b/c.png"), "c.png");
  assert.equal(store.safeFileName(".hidden"), "hidden");
  assert.equal(store.safeFileName("na me!.pdf"), "na_me_.pdf");
  assert.ok(store.safeFileName("").length > 0, "an empty name still has to produce something");
});
