/*
 * What may be stored as a favicon, and what may not.
 *
 * This file is handed to every visitor's browser tab, on public pages with no login behind them,
 * so what it accepts is a decision worth pinning rather than a detail of an upload helper. Only
 * the two types a tab actually wants, only up to half a megabyte, and nothing that is not what it
 * says it is.
 *
 * The accepting cases are deliberately left to the end-to-end path: `storeFavicon` uploads to the
 * bucket when R2 is configured, and a unit test has no business putting objects there. What is
 * checked here is every answer it gives *before* reaching the network, plus the one shape that
 * never touches it — a link that is already stored.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { storeFavicon, MAX_FAVICON_BYTES } = require("../src/services/imageStorage");
const { faviconFileError } = require("../../frontend/src/lib/favicon.mjs");

const dataUri = (type, bytes) => `data:${type};base64,${Buffer.alloc(bytes, 1).toString("base64")}`;

test("nothing to store is not an error", async () => {
  // Settings sends every field it holds; a studio that has uploaded no favicon sends null, and
  // that has to mean "leave it unset" rather than "this request is malformed".
  for (const empty of [null, undefined, ""]) assert.equal(await storeFavicon(empty), null);
});

test("an already-stored favicon is kept, not uploaded again", async () => {
  const stored = await storeFavicon("  https://cdn.example.com/brand/favicon.svg  ");
  assert.deepEqual(stored, { url: "https://cdn.example.com/brand/favicon.svg", key: null, reused: true });
});

test("only the two types a browser tab wants", async () => {
  for (const type of ["image/jpeg", "image/webp", "image/gif", "image/x-icon", "text/html"]) {
    await assert.rejects(() => storeFavicon(dataUri(type, 32)), /PNG or an SVG/, `${type} was accepted`);
  }
  // And anything that is not a data URI at all — a path, a bare string, a script.
  for (const junk of ["/brand/favicon.svg", "favicon", "<svg onload=alert(1)>"]) {
    await assert.rejects(() => storeFavicon(junk), /PNG or SVG file/, `${junk} was accepted`);
  }
});

test("a favicon is small, and an empty one is not a file", async () => {
  await assert.rejects(() => storeFavicon(dataUri("image/png", MAX_FAVICON_BYTES + 1)), /smaller than 5 MB/);
  await assert.rejects(() => storeFavicon("data:image/png;base64,"), /PNG or SVG file/);
});

test("the browser refuses exactly what the API would", () => {
  /*
   * The picker checks a file before it is read, so a wrong one is answered instantly rather than
   * after an upload — but only the API's answer is binding. They are held to the same rules here
   * so the quick answer can never be the kinder one.
   */
  assert.equal(faviconFileError({ type: "image/png", size: 1024 }), "");
  assert.equal(faviconFileError({ type: "image/svg+xml", size: 1024 }), "");
  assert.match(faviconFileError({ type: "image/jpeg", size: 1024 }), /PNG or an SVG/);
  assert.match(faviconFileError({ type: "image/png", size: MAX_FAVICON_BYTES + 1 }), /smaller than 5 MB/);
});
