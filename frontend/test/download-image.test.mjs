import test from "node:test";
import assert from "node:assert/strict";

import downloadImage from "../src/lib/downloadImage.js";

/**
 * The helper reaches for the document to make its anchor. Nothing here renders, so the anchor is
 * a plain object and the assertions read the two fields a download actually depends on: what it
 * points at, and what the file is called on the way to disk.
 */
function stubBrowser() {
  const clicked = [];
  const opened = [];
  const anchor = { remove() {}, click() { clicked.push({ href: anchor.href, download: anchor.download }); } };
  globalThis.document = { createElement: () => anchor, body: { appendChild() {} } };
  globalThis.window = { setTimeout: () => 0, open: (url) => opened.push(url) };
  globalThis.URL.createObjectURL = () => "blob:fake";
  globalThis.URL.revokeObjectURL = () => {};
  return { clicked, opened };
}

test("a data URI is written straight to disk, named after the person", async () => {
  const { clicked } = stubBrowser();
  await downloadImage("data:image/png;base64,AAAA", "Dhanush M M");
  assert.equal(clicked.length, 1);
  assert.equal(clicked[0].download, "dhanush-m-m-photo.png");
  assert.equal(clicked[0].href, "data:image/png;base64,AAAA");
});

test("the extension follows the image's own type, not a guess", async () => {
  const { clicked } = stubBrowser();
  await downloadImage("data:image/webp;base64,AAAA", "Ana");
  assert.equal(clicked[0].download, "ana-photo.webp");
  await downloadImage("data:image/jpeg;base64,AAAA", "Ana");
  assert.equal(clicked[1].download, "ana-photo.jpg");
});

test("a name that could describe a path cannot, and an empty one still yields a file", async () => {
  const { clicked } = stubBrowser();
  await downloadImage("data:image/png;base64,AAAA", "../../etc/passwd");
  assert.equal(clicked[0].download, "etc-passwd-photo.png");
  await downloadImage("data:image/png;base64,AAAA", "   ");
  assert.equal(clicked[1].download, "profile-photo.png");
});

test("a stored URL is saved from the bytes the caller reads, never navigated to", async () => {
  const { clicked, opened } = stubBrowser();
  const readBytes = async () => ({ type: "image/png" });
  await downloadImage("https://cdn.example.com/photo", "Ana", readBytes);
  assert.equal(clicked.length, 1);
  assert.equal(clicked[0].href, "blob:fake");
  assert.equal(clicked[0].download, "ana-photo.png");
  assert.deepEqual(opened, [], "a download must never become a new tab");
});

// The one bad outcome is a button that quietly does something else. A failure has to reach the
// person who pressed it, so the caller can say so.
test("a failure to read the bytes is raised, not turned into a new tab", async () => {
  const { clicked, opened } = stubBrowser();
  const readBytes = async () => { throw new Error("The stored photo could not be read (403)."); };
  await assert.rejects(() => downloadImage("https://cdn.example.com/p.jpg", "Ana", readBytes), /could not be read \(403\)/);
  assert.equal(clicked.length, 0);
  assert.deepEqual(opened, []);
});

test("a URL with no way to read its bytes is refused rather than half-attempted", async () => {
  const { clicked, opened } = stubBrowser();
  await assert.rejects(() => downloadImage("https://cdn.example.com/p.jpg", "Ana"), /cannot be downloaded/i);
  assert.equal(clicked.length, 0);
  assert.deepEqual(opened, []);
});

test("nothing to download is an error rather than an empty file", async () => {
  stubBrowser();
  await assert.rejects(() => downloadImage("", "Ana"), /no photo to download/i);
});
