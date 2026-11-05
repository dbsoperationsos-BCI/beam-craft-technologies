const test = require("node:test");
const assert = require("node:assert");
const sharp = require("sharp");
const { createCoverVeil, pixelLuminance, regionLuminance, veilLevelFor, isCoverKey } = require("../src/modules/ai-feature/public/coverVeil");

/**
 * The join page's veil over an event's cover is measured by the server, because the bucket sends
 * no CORS headers and the guest's browser could never read the cover's pixels.
 */
const KEY = "ai-feature/event-abc/cover/1111.webp";
const solid = (r, g, b) => sharp({ create: { width: 64, height: 40, channels: 3, background: { r, g, b } } }).webp().toBuffer();

test("luminance weights the channels the way the eye does", () => {
  assert.ok(Math.abs(pixelLuminance(255, 255, 255) - 1) < 1e-9);
  assert.strictEqual(pixelLuminance(0, 0, 0), 0);
  assert.ok(pixelLuminance(0, 255, 0) > pixelLuminance(0, 0, 255), "green reads brighter than blue");
});

test("the region measured is the top band, where the text sits", () => {
  const white = [255, 255, 255, 255]; const black = [0, 0, 0, 255];
  const data = Buffer.from([...white, ...white, ...white, ...white, ...black, ...black, ...black, ...black]);
  assert.ok(Math.abs(regionLuminance(data, 2, 4, 0.5) - 1) < 1e-9, "only the top half is read");
  assert.ok(Math.abs(regionLuminance(data, 2, 4, 1) - 0.5) < 1e-9);
  assert.strictEqual(regionLuminance(Buffer.alloc(0), 2, 4), null);
  assert.strictEqual(regionLuminance(undefined, 2, 4), null);
});

test("a bright cover gets the strong veil, a dark one the light veil, and no measurement the medium", () => {
  assert.strictEqual(veilLevelFor(0.9), "strong");
  assert.strictEqual(veilLevelFor(0.2), "light");
  assert.strictEqual(veilLevelFor(0.5), "medium");
  assert.strictEqual(veilLevelFor(null), "medium");
  assert.strictEqual(veilLevelFor(Number.NaN), "medium");
});

test("a real cover is read from storage and measured: bright is strong, dark is light", async () => {
  const bright = await solid(250, 250, 250); const dark = await solid(15, 20, 30);
  const objects = { [KEY]: bright, "ai-feature/event-abc/cover/2222.webp": dark };
  const veil = createCoverVeil({ readObject: async (key) => objects[key] || null });
  assert.strictEqual(await veil.veilFor(KEY), "strong");
  assert.strictEqual(await veil.veilFor("ai-feature/event-abc/cover/2222.webp"), "light");
});

test("the top band decides: a dark sky over a bright foot is light", async () => {
  const top = await sharp({ create: { width: 32, height: 20, channels: 3, background: { r: 10, g: 10, b: 10 } } }).png().toBuffer();
  const image = await sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 255, g: 255, b: 255 } } }).composite([{ input: top, top: 0, left: 0 }]).webp().toBuffer();
  const veil = createCoverVeil({ readObject: async () => image });
  assert.strictEqual(await veil.veilFor(KEY), "light");
});

test("no cover is null; a missing, unreadable or foreign key is the medium veil and never an error", async () => {
  const reads = [];
  const veil = createCoverVeil({ readObject: async (key) => { reads.push(key); if (key.includes("boom")) throw new Error("R2 down"); return key.includes("junk") ? Buffer.from("not an image") : null; } });
  assert.strictEqual(await veil.veilFor(null), null);
  assert.strictEqual(await veil.veilFor(KEY), "medium", "missing object");
  assert.strictEqual(await veil.veilFor("ai-feature/event-abc/cover/junk.webp"), "medium", "unreadable bytes");
  assert.strictEqual(await veil.veilFor("ai-feature/event-abc/cover/boom.webp"), "medium", "storage error");
  for (const key of ["image-selection/branding/logo.png", "ai-feature/event-abc/originals/x.jpg", "ai-feature/event-abc/cover/../../secret"]) {
    assert.strictEqual(isCoverKey(key), false, key);
    assert.strictEqual(await veil.veilFor(key), "medium", key);
  }
  assert.ok(reads.every((key) => isCoverKey(key)), "only an event's cover is ever read");
});

test("a storage failure is tried again on the next visit; an oversized cover is not measured", async () => {
  const bright = await solid(250, 250, 250);
  let calls = 0;
  const veil = createCoverVeil({ readObject: async (key) => {
    if (key.includes("huge")) return Buffer.alloc(11 * 1024 * 1024);
    calls += 1; if (calls === 1) throw new Error("R2 blip"); return bright;
  } });
  assert.strictEqual(await veil.veilFor(KEY), "medium", "the failed read");
  assert.strictEqual(await veil.veilFor(KEY), "strong", "read again, not stuck on medium");
  assert.strictEqual(calls, 2);
  assert.strictEqual(await veil.veilFor("ai-feature/event-abc/cover/huge.webp"), "medium");
});

test("a cover is read once, and a slow read does not hold up the page", async () => {
  const bright = await solid(250, 250, 250);
  let reads = 0; let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const veil = createCoverVeil({ waitMs: 20, readObject: async () => { reads += 1; await gate; return bright; } });
  assert.strictEqual(await veil.veilFor(KEY), "medium", "the page is answered before the read finishes");
  release();
  assert.strictEqual(await veil.veilFor(KEY), "strong", "the next guest gets the measured veil");
  assert.strictEqual(await veil.veilFor(KEY), "strong");
  assert.strictEqual(reads, 1);
});
