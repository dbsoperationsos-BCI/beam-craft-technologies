const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const { faviconBytes, VARIANTS } = require("../src/modules/image-selection/settings/appIcon");

/*
 * The installed app's icons are drawn from the studio's favicon. These cover the two things that
 * keep that safe: which favicons the server will read at all, and that every variant the manifest
 * names exists.
 */

test("the favicon is read from an upload, never fetched from an address it was handed", async () => {
  const png = await sharp({ create: { width: 4, height: 4, channels: 4, background: "#000" } }).png().toBuffer();
  const fromDataUri = await faviconBytes(`data:image/png;base64,${png.toString("base64")}`);
  assert.ok(fromDataUri.equals(png));
  // Some other web address is not this server's bucket, so nothing is fetched and the bundled icon is used.
  assert.equal(await faviconBytes("https://example.com/logo.png"), null);
  assert.equal(await faviconBytes("http://169.254.169.254/latest/meta-data"), null);
  assert.equal(await faviconBytes(""), null);
  assert.equal(await faviconBytes(null), null);
});

test("every icon the manifest and iOS name is a variant the endpoint draws", () => {
  for (const name of ["icon-192", "icon-512", "maskable-192", "maskable-512", "apple-touch-icon-180"]) {
    assert.ok(VARIANTS[name], `${name} is not drawn`);
  }
  // Maskable icons keep the mark inside the middle of the square Android crops.
  assert.ok(VARIANTS["maskable-512"].scale <= 0.8);
});

test("only the five icon names are variants - not an object's own properties", () => {
  const { isVariant } = require("../src/modules/image-selection/settings/appIcon");
  assert.equal(isVariant("icon-192"), true);
  for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty", "../icon-192", ""]) {
    assert.equal(isVariant(name), false, `${name} must not be a variant`);
  }
});

test("an oversized data: favicon is refused before it is decoded", async () => {
  const { MAX_FAVICON_BYTES } = require("../src/services/imageStorage");
  const tooLong = "A".repeat(Math.ceil(MAX_FAVICON_BYTES / 3) * 4 + 4);
  assert.equal(await faviconBytes(`data:image/png;base64,${tooLong}`), null);
});
