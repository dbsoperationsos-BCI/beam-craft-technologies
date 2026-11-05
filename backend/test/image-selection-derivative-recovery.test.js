const test = require("node:test");
const assert = require("node:assert/strict");
const { createRecovery, expiringRules, parseArgs } = require("../src/modules/image-selection/processing/recovery");

/*
 * Preview-only recovery: a photo whose thumbnail or preview is gone from the bucket gets that
 * object rebuilt from an original this server can read, written back under the key already on its
 * row. Everything else the processing pipeline does when a photo becomes READY - the database
 * write, the face scan, the progress events - must not happen here, and a photo whose original
 * lives on a desktop or in a browser is reported, never touched. Fakes stand in for R2, the
 * database, the filesystem and the renderer, and record every call so the tests can say what did
 * NOT happen as firmly as what did.
 */
const ROOT = "D:\\Originals";
const UPLOAD_ROOT = "/srv/uploads";
const KEY = (name, variant) => `image-selection/photo-selection/wedding-aaaaaa/shoot/${variant}/${name}`;

function row(id, overrides = {}) {
  return {
    id, projectId: "proj-aaaaaa", fileName: `${id}.JPG`, storageName: `store-${id}`,
    thumbnailKey: KEY(`${id}.webp`, "thumbnail"), previewKey: KEY(`${id}.jpg`, "preview"),
    originalPath: `${ROOT}\\shoot\\${id}.JPG`, storageRootId: null,
    project: { projectName: "Wedding", albumProofing: false },
    ...overrides,
  };
}

function fixture({ rules = { rules: [] }, verify, renderFails = [], putFails = [] } = {}) {
  const calls = { puts: [], reads: [], renders: [], verified: [], other: [] };
  const present = new Set([row("b").thumbnailKey, row("c").thumbnailKey, row("c").previewKey]);
  const rows = [
    row("a"),                                                       // both objects gone, original readable
    row("b"),                                                       // thumbnail still there, preview gone
    row("c"),                                                       // whole
    row("d", { storageRootId: "root-1", originalPath: "shoot/d.JPG" }), // desktop-registered
    row("e", { originalPath: "baby shoot/e.JPG" }),                 // browser drop-zone trail
    row("f", { originalPath: `${ROOT}\\shoot\\missing.JPG` }),      // original no longer on disk
    row("g"),                                                       // readable, but rendering fails
  ];
  const readable = new Set(rows.filter((item) => !["d", "e", "f"].includes(item.id)).map((item) => item.originalPath));
  const r2 = {
    bucket: "bucket",
    publicUrl: (key) => `https://cdn.example/${key}`,
    listKeys: async () => new Map([...present].map((key) => [key, new Date("2026-09-21T07:20:55Z")])),
    putObject: async (key, body, contentType) => {
      if (putFails.includes(key)) throw new Error("upload refused");
      calls.puts.push({ key, bytes: body.length, contentType });
      present.add(key);
      return key;
    },
    lifecycleRules: async () => rules,
    deleteObjects: async () => { calls.other.push("deleteObjects"); },
  };
  const repository = {
    listReadyWithKeys: async ({ projectId }) => rows.filter((item) => !projectId || item.projectId === projectId),
    markReady: async () => { calls.other.push("markReady"); },
    markStarted: async () => { calls.other.push("markStarted"); },
  };
  const render = async (source, upload) => {
    calls.renders.push(upload.id);
    if (renderFails.includes(upload.id)) throw new Error("decode failed");
    return { thumbnail: { data: Buffer.from(`thumb-${upload.id}`), info: { size: 6 } }, preview: { data: Buffer.from(`preview-${upload.id}`), info: { size: 9 } } };
  };
  const files = {
    exists: (file) => readable.has(file),
    readFile: async (file) => { calls.reads.push(file); return Buffer.from(`original:${file}`); },
  };
  const recovery = createRecovery({
    r2, repository, render, files,
    settings: { read: async () => ({ originalStoragePath: ROOT }) },
    uploadRoot: UPLOAD_ROOT,
    isInsideRoot: (candidate, root) => String(candidate).toLowerCase().startsWith(`${root.toLowerCase()}\\`),
    verify: verify || (async (url) => { calls.verified.push(url); return { status: 200, contentType: "image/jpeg" }; }),
    log: () => {},
  });
  return { recovery, calls, rows };
}

test("a dry run counts what it would do and writes nothing", async () => {
  const { recovery, calls } = fixture({ renderFails: ["g"] });
  const result = await recovery.run({ projectId: "proj-aaaaaa", apply: false });
  assert.deepEqual(result.counts, { photos: 7, missing: 6, rebuildable: 3, rebuilt: 0, skippedUnavailable: 3, failed: 0 });
  assert.deepEqual(calls.puts, []);
  assert.deepEqual(calls.reads, []);
  assert.deepEqual(calls.renders, []);
  assert.deepEqual(calls.other, []);
});

test("applying rebuilds only the objects that are missing, under the keys already on the row", async () => {
  const { recovery, calls } = fixture({ renderFails: ["g"] });
  const result = await recovery.run({ projectId: "proj-aaaaaa", apply: true });
  assert.deepEqual(result.counts, { photos: 7, missing: 6, rebuildable: 3, rebuilt: 2, skippedUnavailable: 3, failed: 1 });
  assert.deepEqual(calls.puts.map((put) => put.key).sort(), [row("a").previewKey, row("a").thumbnailKey, row("b").previewKey].sort());
  assert.equal(calls.puts.find((put) => put.key === row("a").thumbnailKey).contentType, "image/webp");
  assert.equal(calls.puts.find((put) => put.key === row("a").previewKey).contentType, "image/jpeg");
  // b kept its thumbnail, so only its preview was written.
  assert.equal(calls.puts.filter((put) => put.key === row("b").thumbnailKey).length, 0);
  // Each rebuilt photo was decoded once from the original on disk.
  assert.deepEqual(calls.reads.sort(), [row("a").originalPath, row("b").originalPath, row("g").originalPath].sort());
  assert.deepEqual(calls.renders.sort(), ["a", "b", "g"]);
});

test("nothing but the object store is touched: no database write, no face scan, no queue", async () => {
  const { recovery, calls } = fixture();
  await recovery.run({ projectId: "proj-aaaaaa", apply: true });
  assert.deepEqual(calls.other, []);
  // The module itself must not reach for the face hook, the processing queue or the worker:
  // whatever those do when a photo becomes READY is exactly what recovery must never do.
  const loaded = Object.keys(require.cache).map((id) => id.replace(/\\/g, "/"));
  assert.equal(loaded.some((id) => /image-selection\/faces\//.test(id)), false, "faces module was loaded");
  assert.equal(loaded.some((id) => /processing\/(queue|worker|service)\.js$/.test(id)), false, "processing pipeline was loaded");
});

test("a desktop-registered or browser-uploaded photo, or one whose original is gone, is skipped and named", async () => {
  const { recovery } = fixture();
  const result = await recovery.run({ projectId: "proj-aaaaaa", apply: true });
  const skipped = result.items.filter((item) => item.outcome === "skipped-unavailable").map((item) => [item.id, item.reason]);
  assert.deepEqual(skipped, [
    ["d", "re-register from the desktop"],
    ["e", "re-upload from the browser"],
    ["f", "original not reachable"],
  ]);
});

test("a rebuilt object that does not come back as image bytes counts as failed", async () => {
  const { recovery } = fixture({ verify: async (url) => (url.endsWith("a.jpg") ? { status: 404, contentType: "text/html" } : { status: 200, contentType: "image/webp" }) });
  const result = await recovery.run({ projectId: "proj-aaaaaa", apply: true });
  // a fails its check, b and g come back as image bytes.
  assert.equal(result.counts.failed, 1);
  assert.equal(result.counts.rebuilt, 2);
  assert.match(result.items.find((item) => item.id === "a").reason, /404/);
});

test("an enabled expiry rule over the photo-selection root blocks an apply unless forced", async () => {
  const rules = { rules: [{ ID: "expire-previews", Status: "Enabled", Expiration: { Days: 10 }, Filter: { Prefix: "image-selection/" } }] };
  const blocked = fixture({ rules });
  const result = await blocked.recovery.run({ projectId: "proj-aaaaaa", apply: true });
  assert.match(result.blocked, /expire-previews/);
  assert.deepEqual(blocked.calls.puts, []);
  const forced = fixture({ rules });
  const forcedResult = await forced.recovery.run({ projectId: "proj-aaaaaa", apply: true, force: true });
  assert.equal(forcedResult.blocked, null);
  // a and g lost both objects, b only its preview.
  assert.equal(forced.calls.puts.length, 5);
});

test("rules this token cannot read also block an apply unless forced", async () => {
  const { recovery, calls } = fixture({ rules: { error: "AccessDenied" } });
  const result = await recovery.run({ projectId: "proj-aaaaaa", apply: true });
  assert.match(result.blocked, /AccessDenied/);
  assert.deepEqual(calls.puts, []);
  // A dry run is never blocked: it writes nothing, so there is nothing to protect.
  const dry = await recovery.run({ projectId: "proj-aaaaaa", apply: false });
  assert.equal(dry.blocked, null);
});

test("one of --project or --all is required", async () => {
  const { recovery } = fixture();
  await assert.rejects(() => recovery.run({ apply: false }), /--project <id> or --all/);
});

test("expiringRules keeps only enabled expiry rules whose prefix covers the root", () => {
  const prefix = "image-selection/photo-selection/";
  const rules = [
    { ID: "whole-bucket", Status: "Enabled", Expiration: { Days: 30 } },
    { ID: "this-root", Status: "Enabled", Expiration: { Days: 10 }, Filter: { Prefix: prefix } },
    { ID: "one-project", Status: "Enabled", Expiration: { Days: 10 }, Filter: { Prefix: `${prefix}wedding-aaaaaa/` } },
    { ID: "elsewhere", Status: "Enabled", Expiration: { Days: 10 }, Prefix: "hrm/attendance/" },
    { ID: "disabled", Status: "Disabled", Expiration: { Days: 10 }, Filter: { Prefix: prefix } },
    { ID: "multipart-only", Status: "Enabled", AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 }, Filter: { Prefix: prefix } },
    { ID: "and-prefix", Status: "Enabled", Expiration: { Days: 10 }, Filter: { And: { Prefix: "image-selection/", Tags: [{ Key: "k", Value: "v" }] } } },
    { ID: "legacy-prefix", Status: "Enabled", Expiration: { Date: "2026-10-01T00:00:00Z" }, Prefix: prefix },
    { ID: "tags-only", Status: "Enabled", Expiration: { Days: 10 }, Filter: { Tag: { Key: "k", Value: "v" } } },
  ];
  // A tag-only filter has no prefix, so it is read as covering the whole bucket: the safe side.
  assert.deepEqual(expiringRules(rules, prefix).map((rule) => rule.ID), ["whole-bucket", "this-root", "one-project", "and-prefix", "legacy-prefix", "tags-only"]);
  assert.deepEqual(expiringRules(null, prefix), []);
});


test("an upload that the bucket refuses counts as failed and leaves the photo's other object alone", async () => {
  const { recovery, calls } = fixture({ putFails: [row("a").previewKey] });
  const result = await recovery.run({ projectId: "proj-aaaaaa", apply: true });
  const a = result.items.find((item) => item.id === "a");
  assert.equal(a.outcome, "failed");
  assert.match(a.reason, /upload refused/);
  // The thumbnail that did upload is not undone: it is a correct object under its own key.
  assert.deepEqual(calls.puts.filter((put) => put.key.includes("/a.")).map((put) => put.key), [row("a").thumbnailKey]);
  assert.equal(result.counts.failed, 1);
  assert.equal(result.counts.rebuilt, 2);
});

test("a dry run still says whether an apply would be blocked", async () => {
  const { recovery } = fixture({ rules: { error: "AccessDenied" } });
  const result = await recovery.run({ projectId: "proj-aaaaaa", apply: false });
  assert.equal(result.blocked, null);
  assert.match(result.guard, /AccessDenied/);
});

test("parseArgs reads the flags and refuses a project id that is missing or is another flag", () => {
  assert.deepEqual(parseArgs(["--project", "p1", "--apply", "--list"]), { projectId: "p1", all: false, apply: true, force: false, list: true });
  assert.deepEqual(parseArgs(["--all"]), { projectId: null, all: true, apply: false, force: false, list: false });
  assert.throws(() => parseArgs(["--project"]), /--project needs an id/);
  assert.throws(() => parseArgs(["--project", "--apply"]), /--project needs an id/);
  assert.throws(() => parseArgs(["--project", "p1", "--all"]), /either --project <id> or --all/);
  assert.throws(() => parseArgs([]), /--project <id> or --all/);
  assert.throws(() => parseArgs(["--project", "p1", "--bogus"]), /unknown flag --bogus/);
});
