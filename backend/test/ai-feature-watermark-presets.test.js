const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

/*
 * Watermark Presets: the limit of twenty and the lock that holds it, the default that cannot be
 * deleted from under Event Default Settings, an event's own copy of a preset's logo, and guests
 * never handed a clean photo while a watermark is required. The database and storage are stubbed in
 * the require cache, so every call is recorded and nothing real is touched.
 */
const SRC = path.join(__dirname, "../src");
const calls = [];
const handlers = {};
const on = (model, method, fn) => { handlers[`${model}.${method}`] = fn; };
const callsTo = (model, method) => calls.filter((call) => call.model === model && call.method === method).map((call) => call.args);
function reset() { calls.length = 0; for (const key of Object.keys(handlers)) delete handlers[key]; deletedObjects.length = 0; }

const DEFAULT_ANSWERS = { findMany: [], count: 0, findFirst: null, findUnique: null };
const model = (name) => new Proxy({}, { get: (_, method) => async (args) => {
  calls.push({ model: name, method, args });
  const handler = handlers[`${name}.${method}`];
  if (handler) return handler(args);
  return method in DEFAULT_ANSWERS ? DEFAULT_ANSWERS[method] : { id: "row", ...(args?.data || {}) };
} });
const fakePrisma = new Proxy({}, { get: (_, name) => {
  if (name === "$transaction") return async (work) => (typeof work === "function" ? work(fakePrisma) : Promise.all(work));
  if (name === "$queryRaw") return async (strings, ...values) => { calls.push({ model: "$queryRaw", method: "raw", args: { sql: strings.join("?"), values } }); return []; };
  return model(name);
} });

const deletedObjects = [];
function stub(relative, exports) {
  const filename = require.resolve(path.join(SRC, relative));
  require.cache[filename] = { id: filename, filename, loaded: true, paths: [], exports };
}
stub("config/db", fakePrisma);
stub("services/imageStorage", { storeImage: async () => ({ key: "ai-feature-watermarks/2026/10/logo.webp", width: 400, height: 200 }) });
stub("services/objectStorage", {
  publicUrl: (key) => `https://cdn.test/${key}`,
  deleteObject: async (key) => { deletedObjects.push(key); return true; },
  getPublicObjectBuffer: async (key) => (key && !key.includes("missing") ? Buffer.from("logo") : null),
});
stub("modules/ai-feature/shared/storage", { isConfigured: () => true, putPublic: async (eventId, folder) => `ai-feature/event-${eventId}/${folder}/copy.webp`, deletePublicKeys: async () => {}, publicUrl: (key) => `https://cdn.test/${key}` });

const service = require("../src/modules/ai-feature/watermarks/service");
const { configHash, activeSnapshot, presetBodySchema } = require("../src/modules/ai-feature/watermarks/config");

const LOGO_BODY = { name: "Studio logo", type: "LOGO", logo: "data:image/png;base64,AAAA", position: "BOTTOM_RIGHT", size: 25, opacity: 70, offsetX: 0, offsetY: 0 };

test("a twenty-first preset is refused, under a lock, and its logo is not left behind", async () => {
  reset();
  on("aiWatermarkPreset", "count", () => 20);
  await assert.rejects(service.create(LOGO_BODY, { id: 1 }), (error) => error.status === 409 && /up to 20/.test(error.message));
  const raw = callsTo("$queryRaw", "raw")[0];
  assert.match(raw.sql, /FOR UPDATE/, "the count is taken under the defaults row's lock");
  assert.equal(callsTo("aiWatermarkPreset", "create").length, 0);
  assert.deepEqual(deletedObjects, ["ai-feature-watermarks/2026/10/logo.webp"]);
});

test("a preset under the limit is saved with its logo", async () => {
  reset();
  on("aiWatermarkPreset", "count", () => 19);
  const saved = await service.create(LOGO_BODY, { id: 1 });
  assert.equal(saved.logoUrl, "https://cdn.test/ai-feature-watermarks/2026/10/logo.webp");
  assert.equal(callsTo("aiWatermarkPreset", "create")[0].data.text, null, "a LOGO preset carries no text");
});

test("the preset Event Default Settings names cannot be deleted from under it", async () => {
  reset();
  on("aiWatermarkPreset", "findUnique", () => ({ id: "p1", logoKey: "logo-key" }));
  on("aiEventDefaultSetting", "findUnique", () => ({ id: "default", gallery: { watermark: true, watermarkPresetId: "p1" } }));
  await assert.rejects(service.remove("p1"), (error) => error.status === 409);
  assert.equal(callsTo("aiWatermarkPreset", "delete").length, 0);
  on("aiEventDefaultSetting", "findUnique", () => ({ id: "default", gallery: { watermarkPresetId: "p2" } }));
  await service.remove("p1");
  assert.deepEqual(deletedObjects, ["logo-key"]);
});

test("an event's copy of a preset holds its own logo, and a lost logo is said plainly", async () => {
  reset();
  on("aiWatermarkPreset", "findUnique", () => ({ id: "p1", name: "Studio logo", type: "LOGO", logoKey: "ai-feature-watermarks/logo.webp", logoWidth: 400, logoHeight: 200, position: "TOP_LEFT", size: 20, opacity: 60, offsetX: 0, offsetY: 0 }));
  const snapshot = await service.snapshotFor("e1", "p1");
  assert.equal(snapshot.logoKey, "ai-feature/event-e1/watermark/copy.webp");
  assert.equal(snapshot.presetId, "p1");
  on("aiWatermarkPreset", "findUnique", () => ({ id: "p1", name: "Studio logo", type: "LOGO", logoKey: "missing.webp", position: "TOP_LEFT", size: 20, opacity: 60 }));
  await assert.rejects(service.snapshotFor("e1", "p1"), (error) => error.status === 400 && /missing/.test(error.message));
  on("aiWatermarkPreset", "findUnique", () => null);
  await assert.rejects(service.snapshotFor("e1", "gone"), (error) => error.status === 400);
});

test("guests get the photos as they are only when no watermark is required", async () => {
  reset();
  const rows = [{ id: "m1", eventId: "e1", kind: "PHOTO", previewKey: "p.jpg", thumbnailKey: "t.webp" }];
  assert.equal(await service.guestCopies({ watermark: false, watermarkPresetId: "p1" }, rows), null);
  assert.equal(await service.guestCopies({ watermark: true, watermarkPresetId: null }, rows), null, "an event from before presets keeps what it showed");
  const unusable = await service.guestCopies({ watermark: true, watermarkPresetId: "p1", watermarkSnapshot: null }, rows);
  assert.ok(unusable.hash === null && unusable.copies.size === 0, "required but undrawable: nothing is handed out, rather than a clean photo");
  const snapshot = { type: "TEXT", text: "Studio", textColor: "#FFFFFF", fontWeight: "BOLD", position: "CENTER", size: 20, opacity: 50, offsetX: 0, offsetY: 0 };
  on("aiEventMediaWatermark", "findMany", () => [{ mediaId: "m1", previewKey: "wm-p.jpg", thumbnailKey: "wm-t.webp" }]);
  const found = await service.guestCopies({ watermark: true, watermarkPresetId: "p1", watermarkSnapshot: snapshot }, rows);
  assert.equal(found.copies.get("m1").previewKey, "wm-p.jpg");
  assert.equal(found.hash, configHash(snapshot));
  assert.equal(callsTo("aiEventMediaWatermark", "findMany")[0].where.configHash, configHash(snapshot), "a copy is reused only for the look it was drawn with");
});

test("a copy's signed address names one photo and one look, and nothing else", () => {
  const saved = process.env.JWT_SECRET;
  delete process.env.JWT_SECRET;
  assert.throws(() => service.copyPath("m1", "a".repeat(64), "preview"), (error) => error.status === 500, "no secret, no addresses - never a key anyone could compute");
  process.env.JWT_SECRET = saved || "test-secret";
  const hash = "a".repeat(64);
  const address = service.copyPath("m1", hash, "preview");
  const signature = new URL(`https://api.test${address}`).searchParams.get("s");
  assert.match(address, /^\/api\/public\/ai-feature\/w\/m1\/a{64}\/preview\?s=/);
  assert.equal(service.verifyCopy("m1", hash, signature), true);
  assert.equal(service.verifyCopy("m2", hash, signature), false, "another photo");
  assert.equal(service.verifyCopy("m1", "b".repeat(64), signature), false, "another look");
  assert.equal(service.verifyCopy("m1", hash, undefined), false);
});

test("a look's name changes with every part of the look and with nothing else", () => {
  const look = { type: "LOGO", logoKey: "k", logoWidth: 4, logoHeight: 2, position: "CENTER", size: 20, opacity: 50, offsetX: 0, offsetY: 0 };
  const base = configHash(look);
  assert.equal(configHash({ ...look, name: "renamed", takenAt: "later", text: "ignored for a logo" }), base);
  for (const [key, value] of [["position", "TOP_LEFT"], ["size", 21], ["opacity", 51], ["offsetX", 1], ["offsetY", -1], ["logoKey", "k2"]]) assert.notEqual(configHash({ ...look, [key]: value }), base, key);
  assert.equal(activeSnapshot({ watermark: true, watermarkSnapshot: { ...look, logoKey: null } }), null, "a logo look with no logo draws nothing");
});

test("a preset is checked on the server whatever the screen sent", () => {
  assert.equal(presetBodySchema.safeParse({ ...LOGO_BODY, size: 61 }).success, false);
  assert.equal(presetBodySchema.safeParse({ ...LOGO_BODY, opacity: 4 }).success, false);
  assert.equal(presetBodySchema.safeParse({ ...LOGO_BODY, offsetX: 31 }).success, false);
  assert.equal(presetBodySchema.safeParse({ ...LOGO_BODY, position: "LEFT" }).success, false);
  assert.equal(presetBodySchema.safeParse({ ...LOGO_BODY, type: "TEXT", text: "" }).success, false);
  assert.equal(presetBodySchema.safeParse({ ...LOGO_BODY, type: "TEXT", text: "Studio", textColor: "red" }).success, false);
  assert.equal(presetBodySchema.safeParse({ ...LOGO_BODY, extra: 1 }).success, false);
});

test("an event's copy of its preset is the server's to write, never a client's", () => {
  const { eventSettingsBodySchema, defaultsBodySchema } = require("../src/modules/ai-feature/default-settings/validation");
  const planted = { gallery: { watermark: true, watermarkPresetId: "p1", watermarkSnapshot: { type: "LOGO", logoKey: "someone-elses/logo.webp" } } };
  assert.equal(eventSettingsBodySchema.parse(planted).gallery.watermarkSnapshot, undefined);
  assert.equal(defaultsBodySchema.parse(planted).gallery.watermarkSnapshot, undefined);
});

test("a look switched off while the event was being drawn leaves none of its copies behind", async () => {
  reset();
  const snapshot = { type: "TEXT", text: "Studio", textColor: "#FFFFFF", fontWeight: "BOLD", position: "CENTER", size: 20, opacity: 50, offsetX: 0, offsetY: 0 };
  let reads = 0;
  on("aiEventSetting", "findUnique", () => { reads += 1; return { gallery: reads === 1 ? { watermark: true, watermarkPresetId: "p1", watermarkSnapshot: snapshot } : { watermark: false } }; });
  let listed = false;
  on("aiEventMediaWatermark", "findMany", (args) => { if (args.take === 500 && !listed) { listed = true; return [{ id: "w1", previewKey: "ai-feature/event-e1/watermarked/a.jpg", thumbnailKey: null }]; } return []; });
  await service.drawEvent("e1");
  const discarded = callsTo("aiEventMediaWatermark", "deleteMany");
  assert.equal(discarded.length, 1);
  assert.deepEqual(callsTo("aiEventMediaWatermark", "findMany").find((args) => args.take === 500).where, { media: { eventId: "e1" } }, "judged by the look as it is when the run ends: off, so every copy goes");
});

test("view and download are two switches, and an event from before them keeps what it drew", () => {
  const { mergeGroup, snapshotForEvent } = require("../src/modules/ai-feature/shared/settingsDefaults");
  const { eventSettingsBodySchema } = require("../src/modules/ai-feature/default-settings/validation");
  const { watermarkUses } = require("../src/modules/ai-feature/watermarks/config");
  // A row saved with only the old switch reads as both switches set to it.
  const old = mergeGroup("gallery", { watermark: true, watermarkPresetId: "p1" });
  assert.equal(old.watermarkOnView, true);
  assert.equal(old.watermarkOnDownload, true);
  assert.equal(mergeGroup("gallery", { watermark: false }).watermarkOnView, false);
  assert.equal(mergeGroup("gallery", {}).watermarkOnDownload, false, "nothing said, nothing drawn");
  // A row with the new switches is read as it says, and the old one follows them.
  const split = mergeGroup("gallery", { watermark: true, watermarkOnView: false, watermarkOnDownload: true, watermarkPresetId: "p1" });
  assert.deepEqual([split.watermarkOnView, split.watermarkOnDownload, split.watermark], [false, true, true]);
  assert.equal(mergeGroup("gallery", { watermarkOnView: false, watermarkOnDownload: false, watermarkPresetId: "p1" }).watermark, false);
  assert.equal(mergeGroup("gallery", { watermarkOnView: false, watermarkOnDownload: false, watermarkPresetId: "p1" }).watermarkPresetId, "p1", "both off keeps the chosen preset");
  // An older client that sends only the old switch sets both; a newer one is taken as it says.
  assert.deepEqual(eventSettingsBodySchema.parse({ gallery: { watermark: true } }).gallery, { watermark: true, watermarkOnView: true, watermarkOnDownload: true });
  assert.deepEqual(eventSettingsBodySchema.parse({ gallery: { watermark: true, watermarkOnView: true, watermarkOnDownload: false } }).gallery, { watermark: true, watermarkOnView: true, watermarkOnDownload: false });
  // Each switch needs a preset to mean anything.
  assert.deepEqual(watermarkUses({ watermarkOnView: true, watermarkOnDownload: false, watermarkPresetId: "p1" }), { view: true, download: false });
  assert.deepEqual(watermarkUses({ watermarkOnView: true, watermarkOnDownload: true, watermarkPresetId: null }), { view: false, download: false });
  // A new event takes both switches from the defaults, and its own choice over them.
  const fresh = snapshotForEvent({ gallery: { watermarkOnView: true, watermarkOnDownload: false, watermarkPresetId: "p1" } }, { gallery: { watermarkOnDownload: true } });
  assert.deepEqual([fresh.gallery.watermarkOnView, fresh.gallery.watermarkOnDownload], [true, true]);
});
