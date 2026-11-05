const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { normalizeRecipe, recipeIsEmpty, EMPTY_RECIPE, STYLE_IDS, TOOL_IDS, TOOLS, RETOUCH_TOOL_IDS, ENGINE_VERSION } = require("../src/modules/image-selection/ai-editing/recipe");
const { createAiEditingService, editedFileName, recipeMatchesApplied } = require("../src/modules/image-selection/ai-editing/service");
const { createRepository } = require("../src/modules/image-selection/ai-editing/repository");
const { buildEditKey, buildEditReferenceKey, EDIT_KEY_ROOT } = require("../src/modules/image-selection/storage/keys");

/*
 * AI Editing: the tab between AI Culling and Photo Selection. These hold the three rules the module
 * exists for - the recipe is the one contract every side agrees on, the source is never written to,
 * and the only way into Photo Selection or the album is the destination's own compression - with
 * fake storage, a fake engine and a fake repository, so no database, Redis or Python is needed.
 */
const read = (...segments) => fs.readFileSync(path.join(__dirname, "..", "src", "modules", "image-selection", ...segments), "utf8");

// ---------------------------------------------------------------- the recipe
test("a recipe is normalized: unknown keys dropped, numbers clamped, null kept only where the AI may choose", () => {
  const recipe = normalizeRecipe({ style: "nope", adjustments: { exposure: null, contrast: 500, vibrance: null, bogus: 9 }, tools: { denoise: { strength: "80" }, removeObject: { masks: [] }, autoCrop: { aspect: "9:16" }, unknown: {} }, reference: { strength: 999 } });
  assert.equal(recipe.style, "natural");
  assert.equal(recipe.adjustments.exposure, null, "exposure may be left to the AI");
  assert.equal(recipe.adjustments.contrast, 100);
  assert.equal(recipe.adjustments.vibrance, 0, "vibrance is never auto, so null reads as 0");
  assert.equal(recipe.adjustments.bogus, undefined);
  assert.deepEqual(recipe.tools.denoise, { strength: 80, detail: 60 });
  assert.deepEqual(recipe.advanced.hsl.orange, { hue: 0, sat: 0, lum: 0 });
  assert.deepEqual(recipe.advanced.colorBalance.shadows, { r: 0, g: 0, b: 0 });
  assert.equal(recipe.referenceProfile, null);
  const profiled = normalizeRecipe({ referenceProfile: { exposure: "12", temperature: 500, shadowTone: { b: 20 }, summary: "Reads warmer" } });
  assert.equal(profiled.referenceProfile.exposure, 12);
  assert.equal(profiled.referenceProfile.temperature, 100);
  assert.deepEqual(profiled.referenceProfile.shadowTone, { r: 0, g: 0, b: 20 });
  assert.equal(recipeIsEmpty(profiled), false, "a carried profile is an edit");
  assert.equal(STYLE_IDS.length, 10);
  assert.equal(recipe.tools.removeObject, undefined, "Remove Object with nothing painted is off");
  assert.equal(recipe.tools.autoCrop.aspect, "original");
  assert.equal(recipe.tools.unknown, undefined);
  assert.deepEqual(recipe.reference, { strength: 100 });
  assert.ok(STYLE_IDS.includes("warmWedding") && STYLE_IDS.includes("filmLook"));
  assert.equal(TOOL_IDS.length, 21, "eleven tools and the ten retouching regions");
});

test("the ten retouching regions are tools like any other: one clamped intensity each, off when absent, and never a change to an old recipe", () => {
  assert.deepEqual([...RETOUCH_TOOL_IDS], ["facialSkin", "bodySkin", "eyebrows", "eyeSclera", "irisPupil", "lips", "teeth", "hair", "facialHair", "clothes"]);
  for (const id of RETOUCH_TOOL_IDS) assert.ok(TOOL_IDS.includes(id), `${id} is in the contract`);
  const recipe = normalizeRecipe({ tools: { facialSkin: { amount: "70", bogus: 1 }, teeth: { amount: 500 }, hair: {}, clothes: { amount: -4 }, eyeSclera: null } });
  assert.deepEqual(recipe.tools.facialSkin, { amount: 70 }, "unknown settings dropped");
  assert.deepEqual(recipe.tools.teeth, { amount: 100 }, "clamped to the slider");
  assert.deepEqual(recipe.tools.hair, { amount: 30 }, "switched on with nothing said takes the natural default");
  assert.deepEqual(recipe.tools.clothes, { amount: 0 }, "an intensity of 0 leaves the region as shot");
  assert.equal(recipe.tools.eyeSclera, undefined, "absent is off");
  assert.equal(recipeIsEmpty(normalizeRecipe({ tools: { lips: { amount: 30 } } })), false, "a region on is an edit");
  // A recipe written before the regions existed normalizes to exactly what it did.
  const old = { style: "warmWedding", tools: { retouchFace: { smoothing: 40, blemishes: 50, underEyes: 40, skinTone: 30, shine: 40, exposure: 0, teeth: 40 }, sharpen: { amount: 35 } } };
  assert.deepEqual(Object.keys(normalizeRecipe(old).tools), ["retouchFace", "sharpen"]);
  for (const id of RETOUCH_TOOL_IDS) assert.deepEqual(TOOLS[id].settings, { amount: TOOLS[id].settings.amount }, `${id} carries one intensity`);
  assert.equal(ENGINE_VERSION, "2.1.0", "the contract moved with the regions");
});

test("an empty recipe changes nothing, and a send of such a photo needs no render", () => {
  assert.equal(recipeIsEmpty(EMPTY_RECIPE), true);
  assert.equal(recipeIsEmpty({ adjustments: { exposure: 0 } }), true);
  assert.equal(recipeIsEmpty({ adjustments: { exposure: null } }), false, "a slider left to the AI asks for a change");
  assert.equal(recipeIsEmpty({ style: "moody" }), false);
  assert.equal(recipeIsEmpty({ tools: { sharpen: {} } }), false);
});

test("a saved recipe matches its render when the sliders left to the AI read as the numbers the render chose", () => {
  const applied = { style: "natural", adjustments: { ...EMPTY_RECIPE.adjustments, exposure: 12, temperature: -5 }, tools: {}, reference: null };
  assert.equal(recipeMatchesApplied({ adjustments: { exposure: null, temperature: null } }, applied), true);
  assert.equal(recipeMatchesApplied({ adjustments: { exposure: 12, temperature: -5 } }, applied), true);
  assert.equal(recipeMatchesApplied({ adjustments: { exposure: 12, temperature: 20 } }, applied), false);
  assert.equal(recipeMatchesApplied({ adjustments: { exposure: 12 } }, null), false);
});

test("the recipe contract is mirrored on the web and the desktop", () => {
  const web = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", "lib", "aiEditingRecipe.mjs"), "utf8");
  for (const id of STYLE_IDS) assert.match(web, new RegExp(`"${id}"`), `web lacks style ${id}`);
  for (const id of TOOL_IDS) assert.match(web, new RegExp(`\\b${id}\\b`), `web lacks tool ${id}`);
  const desktopPath = path.join(__dirname, "..", "..", "..", "Image-Selection_Desktop---BCT", "src", "modules", "image-selection", "editing", "editingRecipe.js");
  if (fs.existsSync(desktopPath)) {
    const desktop = fs.readFileSync(desktopPath, "utf8");
    for (const id of STYLE_IDS) assert.match(desktop, new RegExp(`"${id}"`), `desktop lacks style ${id}`);
    for (const id of TOOL_IDS) assert.match(desktop, new RegExp(`\\b${id}\\b`), `desktop lacks tool ${id}`);
  }
});

// ---------------------------------------------------------------- keys
test("edit objects live under their own versioned prefix, never beside the source's derivatives", () => {
  const identity = { projectName: "Wedding", projectId: "proj123456", fileName: "DSC_0001.CR2", storageName: "abcdef12-3456" };
  assert.equal(buildEditKey({ ...identity, version: 3, variant: "output" }), `${EDIT_KEY_ROOT}/wedding-123456/dsc-0001-abcdef12/v3/output.jpg`);
  assert.equal(buildEditKey({ ...identity, version: 3, variant: "thumbnail" }), `${EDIT_KEY_ROOT}/wedding-123456/dsc-0001-abcdef12/v3/thumbnail.webp`);
  assert.match(buildEditReferenceKey({ ...identity, token: "ffeeddcc-1" }), /\/reference-ffeeddcc\.jpg$/);
  assert.throws(() => buildEditKey({ ...identity, version: 1, variant: "original" }));
  assert.equal(editedFileName("DSC_0001.CR2"), "DSC_0001 (edited).jpg");
});

// ---------------------------------------------------------------- the invariants, in source
test("a photo in the AI Editing bay is off every Photo Selection surface until it is sent on", () => {
  assert.match(read("gallery", "repository.js"), /cullEligible = \{ cullRejectedAt: null, cullingHoldAt: null, editingHoldAt: null \}/);
  const publication = read("publication", "repository.js");
  assert.equal((publication.match(/editingHoldAt: null/g) || []).length, 3, "both publication counts, and the gallery's availability count, leave the bay out");
});

test("the two upload entry points accept the AI Editing hold beside the culling hold, and the desktop's register-batch too", () => {
  assert.match(read("uploads", "validation.js"), /holdForEditing: z\.enum\(\["true", "false"\]\)/);
  // The browser's route refuses the hold: AI Editing is fed by the desktop app (register-batch) or
  // from AI Culling, never by a browser upload.
  assert.match(read("uploads", "derivativeController.js"), /if \(body\.holdForCulling \|\| body\.holdForEditing\) return res\.status\(400\)/);
  assert.match(read("originals", "validation.js"), /holdForEditing: z\.boolean\(\)\.optional\(\)\.default\(false\)/);
  assert.match(read("originals", "service.js"), /holdForEditing \? \{ editingHoldAt: new Date\(\) \}/);
});

test("the router is guarded by AI Editing, its one send carries the album's permission, and it has no send to Photo Selection", () => {
  const routes = read("ai-editing", "routes.js");
  assert.match(routes, /router\.use\(protect\)/);
  assert.match(routes, /requireModule\("IMAGE_SELECTION", "AI Editing"\)/);
  assert.match(routes, /send-to-signature-album", checkPermission\("IMAGE_SELECTION", "Signature Album", "READ_WRITE"\)/);
  // AI Editing hands edited photos to the Signature Album only. Photo Selection is reached through
  // AI Culling's send of a finalized run's Keeps, which still uses the service's `sendToPhotoSelection`.
  assert.doesNotMatch(routes, /send-to-photo-selection|sendToPhotoSelection/, "no route from AI Editing into Photo Selection");
  const controller = read("ai-editing", "controller.js");
  assert.doesNotMatch(controller, /sendToPhotoSelection|Photo Selection/, "no handler either");
  assert.doesNotMatch(controller, /req\.user\.role/);
  assert.match(read("ai-culling", "service.js"), /sender\.sendToPhotoSelection\(projectId/, "AI Culling's finalized Keeps still travel through the service's send");
});

test("the permission ships in the catalogue and in a migration that grants it to SUPER_ADMIN only", () => {
  const catalogue = fs.readFileSync(path.join(__dirname, "..", "prisma", "seeds", "permission-catalogue.js"), "utf8");
  assert.match(catalogue, /feature: "AI Editing",\s+level: "ISAI_EDITING"/);
  const sql = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20261011090000_ai_editing", "migration.sql"), "utf8");
  assert.match(sql, /ADD COLUMN `editing_hold_at` DATETIME\(3\) NULL/);
  assert.match(sql, /ADD COLUMN `edit_of_upload_id` VARCHAR\(191\) NULL/);
  assert.match(sql, /ADD COLUMN `ai_editing_tab` BOOLEAN NULL/);
  assert.match(sql, /CREATE TABLE `image_selection_edit`/);
  assert.match(sql, /'IMAGE_SELECTION', 'AI Editing', 'ISAI_EDITING'/);
  assert.match(sql, /WHERE `role`\.`name` = 'SUPER_ADMIN' AND `role_permission`\.`id` IS NULL/);
  assert.equal((sql.match(/INSERT INTO `role_permission`/g) || []).length, 1, "one grant, Super Admin's, and no other role");
});

// ---------------------------------------------------------------- the service, with fakes
function fakes({ uploads = [], originalStoragePath = "", readFile, loadPreviewBytes } = {}) {
  const objects = new Map();
  const r2 = {
    isConfigured: () => true, missingConfig: () => [],
    publicUrl: (key) => (key ? `https://cdn.test/${key}` : null),
    putObject: async (key, body) => { objects.set(key, Buffer.from(body)); return key; },
    getObjectStream: async (key) => { const body = objects.get(key); if (!body) return null; return (async function* () { yield body; })(); },
    deleteObjects: async (keys) => { for (const key of keys) objects.delete(key); return { deleted: keys.length, failed: [] }; },
  };
  const rows = new Map(uploads.map((upload) => [upload.id, { edit: null, ...upload }]));
  const edits = new Map();
  let nextEdit = 0;
  const copies = [];
  const repo = {
    findProject: async (projectId) => (projectId === "p1" ? { id: "p1", projectName: "Wedding" } : null),
    folderSubtreeIds: async () => null,
    findUpload: async (projectId, id) => { const row = rows.get(id); return row && row.projectId === projectId ? { ...row, project: { id: projectId, projectName: "Wedding", albumProofing: false } } : null; },
    listUploads: async (projectId, ids) => ids.map((id) => rows.get(id)).filter((row) => row && row.projectId === projectId),
    findEdit: async (editId) => { for (const row of rows.values()) if (row.edit?.id === editId) return { ...row.edit, upload: { ...row, project: { id: "p1", projectName: "Wedding", albumProofing: false } } }; return null; },
    upsertEdit: async (projectId, uploadId, data) => { const row = rows.get(uploadId); row.edit = { id: row.edit?.id || `e${++nextEdit}`, projectId, uploadId, status: "DRAFT", version: 0, recipe: null, appliedRecipe: null, outputKey: null, referenceKey: null, ...row.edit, ...data }; edits.set(row.edit.id, row.edit); return row.edit; },
    updateEdit: async (editId, data) => { const edit = edits.get(editId); Object.assign(edit, data); return edit; },
    transitionEdit: async (editId, from, data) => { const edit = edits.get(editId); if (!from.includes(edit.status)) return { count: 0 }; Object.assign(edit, data); return { count: 1 }; },
    releaseUpload: async (projectId, id) => { const row = rows.get(id); const held = Boolean(row.editingHoldAt || row.cullingHoldAt); row.editingHoldAt = null; row.cullingHoldAt = null; return held; },
    createPhotoSelectionCopy: async (data) => { copies.push(data); return { id: `copy${copies.length}`, fileName: data.fileName }; },
    findFolderChain: async () => [{ name: "Wedding" }, { name: "Card 1" }],
    addToBay: async () => ({ added: 0, skipped: 0, missing: 0 }),
  };
  const engine = {
    calls: [],
    enabled: () => true, health: () => ({ status: "ready", reason: null }), version: () => "edit-engine@1.0.0", capabilities: async () => ({ tools: {} }),
    render: async (args) => { engine.calls.push(args); return { image: Buffer.from(`edited:${args.source.toString()}`), width: 3000, height: 2000, applied: { adjustments: { ...normalizeRecipe(args.recipe).adjustments, exposure: 7 } }, notes: [], faces: 1 }; },
  };
  const processing = {
    rendered: [],
    recipeForModule: async (module) => ({ module }),
    renderWithRecipe: async (source, recipe) => { processing.rendered.push({ source: source.toString(), module: recipe.module }); return { thumbnail: { data: Buffer.from("thumb"), info: { size: 5 } }, preview: { data: Buffer.from(`preview-of-${source.toString()}`), info: { size: 10 } } }; },
  };
  const ready = [];
  const processingRepository = { markReady: async (id, batchId, data) => { ready.push({ id, ...data }); return { id }; } };
  const faceHook = { queued: [], enqueueAfterReady: (id) => faceHook.queued.push(id) };
  const albumService = {
    imported: [], rendered: [],
    ensureForProject: async () => ({ id: "album1" }),
    importUploads: async (projectId, { imageIds }) => { albumService.imported.push(...imageIds); return { albumId: "album1", added: imageIds.length, skipped: 0 }; },
    importRendered: async (projectId, photo) => { albumService.rendered.push(photo); return { photoId: `ap${albumService.rendered.length}` }; },
  };
  const queue = { queued: [], enqueue: async (editId) => queue.queued.push(editId) };
  const service = createAiEditingService(repo, { engine, r2, queue, processing, processingRepository, faceHook, albumService, settings: { read: async () => ({ originalStoragePath }) }, readFile: readFile || (async () => { throw new Error("ENOENT"); }), loadPreviewBytes: loadPreviewBytes || (async () => { throw new Error("No preview derivative exists for this photo."); }), now: () => new Date("2026-10-11T10:00:00Z") });
  return { service, repo, engine, processing, processingRepository, faceHook, albumService, queue, objects, rows, copies, ready };
}
const upload = (over = {}) => ({ id: "u1", projectId: "p1", folderId: "f1", fileName: "DSC_0001.JPG", storageName: "11112222-3333", originalPath: "shoot/DSC_0001.JPG", storageRootId: null, mimeType: "image/jpeg", sizeBytes: 5n, status: "READY", width: 6000, height: 4000, thumbnailKey: "t", previewKey: "image-selection/photo-selection/p/preview/x.jpg", cullingHoldAt: null, cullRejectedAt: null, editingHoldAt: null, capturedAt: null, createdAt: new Date(), ...over });

test("a render reads the original only when it is an absolute path under the configured root, else the preview, and says which", async () => {
  const reads = [];
  const inside = fakes({ uploads: [upload({ originalPath: "D:\\Studio\\Originals\\shoot\\DSC_0001.JPG" })], originalStoragePath: "D:\\Studio\\Originals", readFile: async (file) => { reads.push(file); return Buffer.from("original-bytes"); } });
  assert.deepEqual(await inside.service.resolveSource(inside.rows.get("u1")), { bytes: Buffer.from("original-bytes"), kind: "ORIGINAL" });
  assert.equal(reads.length, 1);

  const outside = fakes({ uploads: [upload({ originalPath: "E:\\Elsewhere\\DSC_0001.JPG" })], originalStoragePath: "D:\\Studio\\Originals", readFile: async () => Buffer.from("must-not-read") });
  await assert.rejects(outside.service.resolveSource(outside.rows.get("u1")), /Preview fetch|fetch failed|No preview/i, "outside the root it falls to the preview, never the path");

  const desktop = fakes({ uploads: [upload({ originalPath: "shoot/DSC_0001.JPG", storageRootId: "root1" })], originalStoragePath: "D:\\Studio\\Originals", readFile: async () => Buffer.from("must-not-read") });
  await assert.rejects(desktop.service.resolveSource(desktop.rows.get("u1")), /Preview fetch|fetch failed|No preview/i, "a workstation's relative trail is never opened here");
});

test("a render never writes the source: it stores new versioned objects and reports what it applied", async () => {
  const f = fakes({ uploads: [upload({ originalPath: "D:\\O\\a.jpg" })], originalStoragePath: "D:\\O", readFile: async () => Buffer.from("src") });
  const edit = await f.service.requestRender("p1", "u1", { style: "cinematic", adjustments: { exposure: null } }, 7);
  assert.equal(edit.status, "QUEUED");
  assert.deepEqual(f.queue.queued, [edit.id]);
  await f.service.renderEdit(edit.id);
  const row = f.rows.get("u1");
  assert.equal(row.edit.status, "RENDERED");
  assert.equal(row.edit.version, 1);
  assert.equal(row.edit.sourceKind, "ORIGINAL");
  assert.equal(row.edit.outputKey, "image-selection/ai-editing/wedding-p1/dsc-0001-11112222/v1/output.jpg");
  assert.equal(f.objects.get(row.edit.outputKey).toString(), "edited:src");
  assert.equal(row.edit.appliedRecipe.adjustments.exposure, 7, "the number the AI chose comes back");
  assert.equal(row.previewKey, "image-selection/photo-selection/p/preview/x.jpg", "the source's derivatives are untouched");
  assert.ok(!f.objects.has(row.previewKey), "nothing was written at the source's keys");
  // A second render makes v2 and drops v1's objects.
  await f.service.requestRender("p1", "u1", { style: "moody" }, 7);
  await f.service.renderEdit(row.edit.id);
  assert.equal(row.edit.version, 2);
  assert.ok(f.objects.has("image-selection/ai-editing/wedding-p1/dsc-0001-11112222/v2/output.jpg"));
  assert.ok(!f.objects.has("image-selection/ai-editing/wedding-p1/dsc-0001-11112222/v1/output.jpg"));
});

test("sending an edited photo to Photo Selection compresses the edit master to Image Selection's recipe into a new linked row; the source stays in the bay", async () => {
  const f = fakes({ uploads: [upload({ originalPath: "D:\\O\\a.jpg", editingHoldAt: new Date() })], originalStoragePath: "D:\\O", readFile: async () => Buffer.from("src") });
  const edit = await f.service.requestRender("p1", "u1", { style: "cinematic" }, 7);
  await f.service.renderEdit(edit.id);
  const first = await f.service.sendToPhotoSelection("p1", ["u1"], {}, 7);
  assert.deepEqual(first, { created: 1, released: 0, alreadyVisible: 0, alreadySent: [], skipped: 0, notCulled: 0 });
  assert.deepEqual(f.processing.rendered.at(-1), { source: "edited:src", module: "imageSelection" }, "compressed from the edit master, with the destination's recipe");
  assert.equal(f.copies.length, 1);
  assert.equal(f.copies[0].editOfUploadId, "u1");
  assert.equal(f.copies[0].fileName, "DSC_0001 (edited).jpg");
  assert.equal(f.copies[0].folderId, "f1");
  assert.match(f.ready[0].previewKey, /^image-selection\/photo-selection\/wedding-p1\/wedding\/card-1\/preview\/dsc-0001-edited-/);
  assert.equal(f.objects.get(f.ready[0].previewKey).toString(), "preview-of-edited:src", "what Photo Selection serves is the compressed pair, never the master");
  assert.deepEqual(f.faceHook.queued, ["copy1"]);
  assert.ok(f.rows.get("u1").editingHoldAt, "the source stays held in the bay: Photo Selection shows one photo, the edited one");
  // The same version again is a question, not a duplicate - unless forced.
  const again = await f.service.sendToPhotoSelection("p1", ["u1"], {}, 7);
  assert.deepEqual(again.alreadySent, ["u1"]);
  assert.equal(f.copies.length, 1);
  const forced = await f.service.sendToPhotoSelection("p1", ["u1"], { force: true }, 7);
  assert.equal(forced.created, 1);
  assert.equal(f.copies.length, 2);
});

test("sending an unedited photo to Photo Selection clears its editing hold only; one still waiting for its cull, or rejected by it, does not go", async () => {
  const f = fakes({ uploads: [upload({ editingHoldAt: new Date() }), upload({ id: "u2" }), upload({ id: "u3", editingHoldAt: new Date(), cullingHoldAt: new Date() }), upload({ id: "u4", cullRejectedAt: new Date() })] });
  const result = await f.service.sendToPhotoSelection("p1", ["u1", "u2", "u3", "u4", "ghost"], {}, 7);
  assert.deepEqual(result, { created: 0, released: 1, alreadyVisible: 1, alreadySent: [], skipped: 0, notCulled: 2 });
  assert.equal(f.rows.get("u1").editingHoldAt, null);
  assert.ok(f.rows.get("u3").cullingHoldAt, "a culling hold is AI Culling's to lift");
  assert.ok(f.rows.get("u3").editingHoldAt, "and the photo stays in the bay");
  assert.ok(f.rows.get("u4").cullRejectedAt, "a cull's reject stamp is never overridden here");
  assert.equal(f.processing.rendered.length, 0, "no second compression");
  assert.equal(f.copies.length, 0);
});

test("sending to the Signature Album: an edited photo is compressed to the album's recipe into the album's library, an unedited one joins by reference", async () => {
  const f = fakes({ uploads: [upload({ originalPath: "D:\\O\\a.jpg" }), upload({ id: "u2" })], originalStoragePath: "D:\\O", readFile: async () => Buffer.from("src") });
  const edit = await f.service.requestRender("p1", "u1", { tools: { sharpen: {} } }, 7);
  await f.service.renderEdit(edit.id);
  const result = await f.service.sendToSignatureAlbum("p1", ["u1", "u2"], {}, 7);
  assert.equal(result.created, 1);
  assert.equal(result.referenced, 1);
  assert.equal(result.albumId, "album1");
  assert.deepEqual(f.processing.rendered.at(-1), { source: "edited:src", module: "signatureAlbum" });
  assert.equal(f.albumService.rendered[0].preview.buffer.toString(), "preview-of-edited:src");
  assert.equal(f.albumService.rendered[0].fileName, "DSC_0001 (edited).jpg");
  assert.deepEqual(f.albumService.imported, ["u2"]);
  assert.equal(f.rows.get("u1").edit.sentToAlbumVersion, 1);
  const again = await f.service.sendToSignatureAlbum("p1", ["u1"], {}, 7);
  assert.deepEqual(again.alreadySent, ["u1"]);
});

// "In Photo Selection" on a bay photo is the gallery's own listing rule and nothing else: Photo
// Selection has no membership table, so a photo is there exactly when every Photo Selection
// surface would list it - READY, no culling hold, no editing hold, no cull stamp. Being in the bay,
// in a culling run, in the same project or folder, or under the same file name proves nothing.
test("the bay says In Photo Selection only when the gallery's own rule lists the photo", async () => {
  const gallery = require("../src/modules/image-selection/gallery/repository");
  assert.deepEqual(Object.keys(gallery.cullEligible).sort(), ["cullRejectedAt", "cullingHoldAt", "editingHoldAt"], "the one rule, the gallery's");
  const held = new Date("2026-10-10T10:44:00Z");
  const f = fakes({ uploads: [
    upload({ id: "culling", cullingHoldAt: held }),                          // imported for culling, still waiting for the run
    upload({ id: "editing", editingHoldAt: held }),                          // in the bay before Photo Selection has seen it
    upload({ id: "both", cullingHoldAt: held, editingHoldAt: held }),        // sent to AI Editing while still held for culling
    upload({ id: "rejected", cullRejectedAt: held }),                        // a finalized cull hid it
    upload({ id: "uploading", status: "PROCESSING" }),                       // not even READY yet
    upload({ id: "visible" }),                                               // READY, no hold, no stamp: what the gallery lists
    upload({ id: "nulls", cullingHoldAt: null, editingHoldAt: null, cullRejectedAt: null, cullRejectedSessionId: null }),
  ] });
  // An edit row on each of them, as a photo sent to AI Editing carries: it changes nothing about Photo Selection.
  for (const id of ["culling", "editing", "both", "rejected", "visible", "nulls"]) await f.repo.upsertEdit("p1", id, { status: "DRAFT" }, 7);
  const expected = { culling: false, editing: false, both: false, rejected: false, uploading: false, visible: true, nulls: true };
  const flags = {};
  for (const id of Object.keys(expected)) flags[id] = (await f.service.get("p1", id)).inPhotoSelection;
  assert.deepEqual(flags, expected);
  // The bay's listing and the one photo's own endpoint (what the grid and the editor read) are the
  // same serializer over the same row, so they answer alike; both say nothing about an edit row.
  for (const id of Object.keys(expected)) assert.equal((await f.service.get("p1", id)).heldForEditing, id === "editing" || id === "both");
  // The row-level rule is the gallery's where-clause, column for column, and tolerates nothing missing.
  assert.equal(gallery.isVisibleInPhotoSelection(null), false);
  assert.equal(gallery.isVisibleInPhotoSelection({}), false, "no status is not READY");
  assert.equal(gallery.isVisibleInPhotoSelection({ status: "READY" }), true, "undefined hold columns read as no hold, as NULL does");
  assert.equal(gallery.isVisibleInPhotoSelection({ status: "READY", editingHoldAt: held }), false);
  assert.equal(gallery.isCullEligible({ cullRejectedAt: null, cullingHoldAt: null, editingHoldAt: held }), false);
  // Sharing the project, the folder and the file name with a visible photo proves nothing for a held one.
  const twin = fakes({ uploads: [upload({ id: "a" }), upload({ id: "b", editingHoldAt: held })] });
  const twins = await Promise.all(["a", "b"].map((id) => twin.service.get("p1", id)));
  assert.deepEqual(twins.map((photo) => [photo.id, photo.fileName, photo.inPhotoSelection]), [["a", "DSC_0001.JPG", true], ["b", "DSC_0001.JPG", false]]);
  // The repository helper reads the same rule.
  const repo = createRepository({ imageSelectionUpload: { findFirst: async () => ({ status: "READY", editingHoldAt: null, cullingHoldAt: null, cullRejectedAt: null }) } });
  assert.equal(await repo.isVisibleInPhotoSelection("p1", "u1"), true);
  const repoHeld = createRepository({ imageSelectionUpload: { findFirst: async () => ({ status: "READY", editingHoldAt: held, cullingHoldAt: null, cullRejectedAt: null }) } });
  assert.equal(await repoHeld.isVisibleInPhotoSelection("p1", "u1"), false);
});

// A missing face landmark model is said with the file and the place it was looked for: the
// desktop renders on a workstation, where "this server" was the wrong place and named nothing.
test("the editing engine names the landmark file and where it runs whenever that model is missing", () => {
  const engine = read("ai-editing", "edit_engine.py");
  assert.doesNotMatch(engine, /not installed on this server/, "no hard-coded host in any note or reason");
  assert.match(engine, /HOST_LABEL = \(os\.environ\.get\("AI_EDIT_HOST_LABEL"\) or "this server"\)\.strip\(\) or "this server"/);
  assert.match(engine, /LANDMARK_FILE = "1k3d68\.onnx"/);
  assert.match(engine, /LANDMARK_MISSING = f"the face landmark model \(\{FACE_MODEL\}\/\{LANDMARK_FILE\}\), which is not installed on \{HOST_LABEL\}"/);
  assert.equal((engine.match(/\{LANDMARK_MISSING\}/g) || []).length, 6, "the four render notes and the two capability reasons");
  assert.match(engine, /self\.landmarks = os\.path\.exists\(os\.path\.join\(model_dir, LANDMARK_FILE\)\)/);
});

test("a photo whose render is still in flight, waiting for the workstation or failed is not sent to the album as it is: it is counted and left alone", async () => {
  const f = fakes({ uploads: [upload({ id: "queued" }), upload({ id: "rendering" }), upload({ id: "waiting", storageRootId: "root1" }), upload({ id: "failed" }), upload({ id: "plain" })] });
  await f.repo.upsertEdit("p1", "queued", { status: "QUEUED", recipe: { style: "moody" } });
  // An earlier render exists, but a newer one is in flight: neither the stale output nor the original goes.
  await f.repo.upsertEdit("p1", "rendering", { status: "RENDERING", version: 1, recipe: { style: "moody" }, appliedRecipe: { style: "classic" }, outputKey: "k/v1/output.jpg" });
  await f.repo.upsertEdit("p1", "waiting", { status: "WAITING_FOR_DESKTOP", recipe: { style: "moody" } });
  await f.repo.upsertEdit("p1", "failed", { status: "FAILED", version: 1, recipe: { style: "moody" }, appliedRecipe: { style: "classic" }, outputKey: "k/v1/output.jpg", error: "The edit could not be rendered." });
  const result = await f.service.sendToSignatureAlbum("p1", ["queued", "rendering", "waiting", "failed", "plain"], {}, 7);
  assert.equal(result.notReady, 4, "four photos have no settled render to send");
  assert.equal(result.created, 0);
  assert.equal(result.referenced, 1, "only the untouched photo joins by reference");
  assert.deepEqual(f.albumService.imported, ["plain"]);
  assert.equal(f.processing.rendered.length, 0, "nothing was compressed");
  for (const id of ["queued", "rendering", "waiting", "failed"]) assert.equal(f.rows.get(id).edit.sentToAlbumPhotoId, undefined, `${id} records no send`);
});

test("a reset empties the recipe and discards the output; the source is never touched", async () => {
  const f = fakes({ uploads: [upload({ originalPath: "D:\\O\\a.jpg" })], originalStoragePath: "D:\\O", readFile: async () => Buffer.from("src") });
  const edit = await f.service.requestRender("p1", "u1", { style: "moody" }, 7);
  await f.service.renderEdit(edit.id);
  const key = f.rows.get("u1").edit.outputKey;
  assert.ok(f.objects.has(key));
  const after = await f.service.reset("p1", "u1");
  assert.equal(after.status, "DRAFT");
  assert.equal(after.hasOutput, false);
  assert.ok(!f.objects.has(key));
  assert.equal(f.rows.get("u1").previewKey, "image-selection/photo-selection/p/preview/x.jpg");
});

test("a render that cannot decode the original falls back to the preview and says so", async () => {
  const f = fakes({ uploads: [upload({ originalPath: "D:\\O\\a.CR2" })], originalStoragePath: "D:\\O", readFile: async () => Buffer.from("raw"), loadPreviewBytes: async () => Buffer.from("preview") });
  const sources = [];
  f.engine.render = async (args) => { sources.push(args.source.toString()); if (args.source.toString() === "raw") throw new Error("ValueError: the photo could not be decoded"); return { image: Buffer.from("edited"), width: 1, height: 1, applied: {}, notes: [], faces: 0 }; };
  const edit = await f.service.requestRender("p1", "u1", { style: "moody" }, 7);
  await f.service.renderEdit(edit.id);
  assert.deepEqual(sources, ["raw", "preview"]);
  const row = f.rows.get("u1");
  assert.equal(row.edit.sourceKind, "PREVIEW");
  assert.match(row.edit.appliedRecipe.notes.join(" "), /rendered from the uploaded preview/);
});

test("a photo of another project, or none, is refused by name, and a photo mid-render refuses a second Apply", async () => {
  const f = fakes({ uploads: [upload({ originalPath: "D:\\O\\a.jpg" }), upload({ id: "other", projectId: "p2" })], originalStoragePath: "D:\\O", readFile: async () => Buffer.from("src") });
  await assert.rejects(f.service.get("p1", "other"), /not in this project/);
  await assert.rejects(f.service.get("p1", "ghost"), /not in this project/);
  await assert.rejects(f.service.saveRecipe("p1", "other", { style: "moody" }, 7), /not in this project/);
  await assert.rejects(f.service.requestRender("p1", "other", { style: "moody" }, 7), /not in this project/);
  await assert.rejects(f.service.get("p9", "u1"), /project not found/);
  // Sends name photos: one from another project is simply not among this project's rows.
  const sent = await f.service.sendToPhotoSelection("p1", ["other", "ghost", "u1"], {}, 7);
  assert.deepEqual(sent, { created: 0, released: 0, alreadyVisible: 1, alreadySent: [], skipped: 0, notCulled: 0 });
  // A second Apply while the first is queued is told so, and makes no second job.
  await f.service.requestRender("p1", "u1", { style: "moody" }, 7);
  await assert.rejects(f.service.requestRender("p1", "u1", { style: "cinematic" }, 7), /still rendering/);
  assert.equal(f.queue.queued.length, 1);
  assert.equal(f.rows.get("u1").edit.recipe.style, "moody", "the queued recipe is untouched by the refused Apply");
});

test("a send takes a bounded slice, and a failure says why in the studio's words - never a path or an env name", async () => {
  const f = fakes({ uploads: [upload()] });
  await assert.rejects(f.service.sendToPhotoSelection("p1", Array.from({ length: 101 }, (_, i) => `u${i}`), {}, 7), /up to 100 photos/);
  await assert.rejects(f.service.sendToSignatureAlbum("p1", Array.from({ length: 101 }, (_, i) => `u${i}`), {}, 7), /up to 100 photos/);
  const reason = f.service.failureReason;
  assert.match(reason(Object.assign(new Error("spawn ENOENT (C:\\x\\.venv-face\\Scripts\\python.exe)"), { code: "EDIT_ENGINE_UNAVAILABLE" })), /not available on this server/);
  assert.doesNotMatch(reason(Object.assign(new Error("spawn ENOENT (C:\\x\\.venv-face\\Scripts\\python.exe)"), { code: "EDIT_ENGINE_UNAVAILABLE" })), /venv|python|C:/);
  assert.match(reason(new Error("Object storage is not configured: R2_ACCOUNT_ID")), /storage is not configured/);
  assert.doesNotMatch(reason(new Error("Object storage is not configured: R2_ACCOUNT_ID")), /R2_/);
  assert.match(reason(new Error("ValueError: the photo could not be decoded")), /could not be read/);
  assert.match(reason(new Error("cv2.error: (-215:Assertion failed) in function 'cvtColor'")), /could not be rendered/);
  assert.doesNotMatch(reason(new Error("cv2.error: (-215:Assertion failed)")), /cv2|Assertion/);
});

test("an edited photo still waiting for its cull is not compressed into Photo Selection either", async () => {
  const f = fakes({ uploads: [upload({ cullingHoldAt: new Date(), editingHoldAt: new Date() })] });
  await f.repo.upsertEdit("p1", "u1", { status: "RENDERED", version: 1, recipe: { style: "moody" }, appliedRecipe: { style: "moody" }, outputKey: "k/v1/output.jpg", outputBytes: 3 });
  f.objects.set("k/v1/output.jpg", Buffer.from("edited"));
  const result = await f.service.sendToPhotoSelection("p1", ["u1"], {}, 7);
  assert.deepEqual(result, { created: 0, released: 0, alreadyVisible: 0, alreadySent: [], skipped: 0, notCulled: 1 });
  assert.equal(f.copies.length, 0, "no copy reaches Photo Selection past AI Culling");
  assert.equal(f.processing.rendered.length, 0);
});

test("a whole culling decision can be sent to AI Editing: the run's Keeps resolve to photo ids, a foreign run is not found", async () => {
  const f = fakes({ uploads: [upload()] });
  const calls = [];
  f.repo.addToBay = async (projectId, ids) => { calls.push(ids); return { added: ids.length, skipped: 0, missing: 0 }; };
  const sessions = { s1: "FINALIZED", open: "REVIEW_READY" };
  const service = createAiEditingService(f.repo, { engine: f.engine, r2: { isConfigured: () => true, publicUrl: () => null }, queue: f.queue, processing: f.processing, albumService: f.albumService, settings: { read: async () => ({}) },
    cullingRepository: {
      findSession: async (projectId, sessionId) => (sessions[sessionId] ? { id: sessionId, status: sessions[sessionId] } : null),
      listSessionUploadIds: async (projectId, sessionId, decision, options = {}) => (sessionId === "s1" ? (decision === "KEEP" ? ["u1", "u2"].slice(0, options.limit || 2) : decision === null ? ["u1", "u2", "u3"] : []) : null),
    } });
  assert.deepEqual(await service.addPhotos("p1", { cullingSessionId: "s1" }, 7), { added: 2, skipped: 0, missing: 0 });
  assert.deepEqual(calls, [["u1", "u2"]]);
  assert.deepEqual(await service.addPhotos("p1", { cullingSessionId: "s1", limit: 1 }, 7), { added: 1, skipped: 0, missing: 0 }, "a count sends the first that many of the run's Keeps");
  assert.deepEqual(calls[1], ["u1"]);
  const { addPhotosSchema } = require("../src/modules/image-selection/ai-editing/validation");
  assert.deepEqual(addPhotosSchema.parse({ cullingSessionId: "s1", limit: "3" }), { cullingSessionId: "s1", decision: "KEEP", limit: 3 }, "the count is a whole number of at least one");
  assert.throws(() => addPhotosSchema.parse({ cullingSessionId: "s1", limit: 0 }));
  assert.deepEqual(await service.addPhotos("p1", { cullingSessionId: "s1", decision: "MAYBE" }, 7), { added: 0, skipped: 0, missing: 0, notCulled: 0 }, "nothing decided that way adds nothing");
  await assert.rejects(service.addPhotos("p1", { cullingSessionId: "other" }, 7), /not in this project/);
  assert.deepEqual(await service.addPhotos("p1", { uploadIds: ["u1"] }, 7), { added: 1, skipped: 0, missing: 0 });
  // A run that is not finalized sends nothing, whether its Keeps or photos ticked in its review.
  const before = calls.length;
  await assert.rejects(service.addPhotos("p1", { cullingSessionId: "open" }, 7), (error) => error.status === 409 && error.details.notFinalized && error.details.status === "REVIEW_READY");
  await assert.rejects(service.addPhotos("p1", { cullingSessionId: "open", uploadIds: ["u1"] }, 7), (error) => error.status === 409);
  assert.equal(calls.length, before, "nothing reached the bay");
  // Ticked in a finalized run's review: those of them the run analysed, whatever their verdict.
  await service.addPhotos("p1", { cullingSessionId: "s1", uploadIds: ["u3", "u1", "elsewhere"] }, 7);
  assert.deepEqual(calls.at(-1), ["u3", "u1"]);
  assert.deepEqual(addPhotosSchema.parse({ uploadIds: ["u1"], cullingSessionId: "s1" }), { uploadIds: ["u1"], cullingSessionId: "s1" });
});

test("the AI tabs are on for a manual project whose tick was never stored, as the workspace reads them", () => {
  const web = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", "components", "image-selection", "ImageSelectionProjectWorkspace.js"), "utf8");
  assert.match(web, /tab\.id === "culling" \? project\.photoCullingTab !== false/);
  assert.match(web, /tab\.id === "editing" \? project\.aiEditingTab !== false/);
  const service = read("projects", "service.js");
  assert.match(service, /aiEditingTab: input\.workspaceTabs\?\.aiEditing \?\? null/);
});

test("a batch puts one recipe on many photos as one job each: a photo mid-render is skipped, the reference's profile travels, the reference bytes do not", async () => {
  const f = fakes({ uploads: [upload({ id: "a" }), upload({ id: "b" }), upload({ id: "c", status: "PROCESSING" })] });
  // b already has a reference photo of its own; a does not.
  await f.repo.upsertEdit("p1", "b", { referenceKey: "ref-b" }, 7);
  const recipe = { style: "luxuryWedding", reference: { strength: 60 }, referenceProfile: { exposure: -10, temperature: 12, summary: "Reads warmer" }, tools: { sharpen: {} } };
  const result = await f.service.batchApply("p1", { uploadIds: ["a", "b", "c", "ghost"], recipe }, 7);
  assert.deepEqual(result, { queued: 2, waitingForDesktop: 0, requiresSourceChoice: 0, skipped: 2, total: 4 });
  assert.equal(f.queue.queued.length, 2);
  assert.equal(f.rows.get("a").edit.recipe.reference, null, "no reference photo on a: the profile alone carries the look");
  assert.equal(f.rows.get("a").edit.recipe.referenceProfile.temperature, 12);
  assert.deepEqual(f.rows.get("b").edit.recipe.reference, { strength: 60 }, "b keeps its own reference photo");
  // Mid-render photos are left alone.
  const again = await f.service.batchApply("p1", { uploadIds: ["a"], recipe }, 7);
  assert.deepEqual(again, { queued: 0, waitingForDesktop: 0, requiresSourceChoice: 0, skipped: 1, total: 1 });
});

test("a render carries the culling scene hint and the engine's stages, and keeps the measured profile on the recipe", async () => {
  const f = fakes({ uploads: [upload({ originalPath: "D:\\O\\a.jpg" })], originalStoragePath: "D:\\O", readFile: async () => Buffer.from("src") });
  const stages = [];
  f.repo.setStage = async (id, stage) => { stages.push(stage); return { count: 1 }; };
  const seen = {};
  f.engine.render = async (args) => { seen.sceneHint = args.sceneHint; args.onStage("Analyzing image"); args.onStage("Retouching skin"); return { image: Buffer.from("edited"), width: 1, height: 1, applied: { adjustments: {} }, notes: [], faces: 1, analysis: { scene: "couple", lighting: "indoor" }, referenceProfile: { exposure: -20, summary: "Reads darker" } }; };
  const service = createAiEditingService(f.repo, { engine: f.engine, r2: f.service.r2 || { isConfigured: () => true, missingConfig: () => [], publicUrl: () => null, putObject: async () => {}, deleteObjects: async () => ({}) , getObjectStream: async () => null }, queue: f.queue, processing: f.processing, albumService: f.albumService, settings: { read: async () => ({ originalStoragePath: "D:\\O" }) }, readFile: async () => Buffer.from("src"), loadPreviewBytes: async () => Buffer.from("preview"), cullingRepository: { findLatestSceneLabel: async () => "BRIDE_PORTRAIT", listSessionUploadIds: async () => [] } });
  const edit = await service.requestRender("p1", "u1", { style: "classic" }, 7);
  await service.renderEdit(edit.id);
  assert.equal(seen.sceneHint, "BRIDE_PORTRAIT");
  assert.deepEqual(stages, ["Analyzing image", "Retouching skin"]);
  const row = f.rows.get("u1").edit;
  assert.equal(row.stage, null);
  assert.equal(row.appliedRecipe.analysis.scene, "couple");
  assert.equal(row.recipe.referenceProfile.exposure, -20, "the measured profile now rides on the recipe");
});

test("the repository's bay is held-for-editing or edited photos, and a photo still held for culling is refused, never skipped past its cull", async () => {
  const captured = [];
  const client = {
    imageSelectionFolder: { findMany: async () => [] },
    imageSelectionUpload: {
      findMany: async ({ where }) => { captured.push(where); return [{ id: "a", cullingHoldAt: new Date(), editingHoldAt: null, edit: null }, { id: "b", cullingHoldAt: null, editingHoldAt: null, edit: null }, { id: "c", cullingHoldAt: null, editingHoldAt: null, edit: { id: "e" } }]; },
      count: async () => 0, update: (args) => ({ kind: "update", ...args }), groupBy: async () => [],
    },
    imageSelectionEdit: { create: (args) => ({ kind: "create", ...args }), groupBy: async () => [] },
    $transaction: async (ops) => { captured.push(ops); return ops; },
  };
  const repo = createRepository(client);
  const result = await repo.addToBay("p1", ["a", "b", "c", "c"], 9);
  assert.deepEqual(result, { added: 1, skipped: 1, missing: 0, notCulled: 1, syncNow: [] }, "a: still held for culling (no finalized run), refused; b: added; c: already there");
  assert.equal(captured.filter(Array.isArray).length, 0, "no hold is written: only the edit row");
  await repo.listBay("p1", null, {});
  const where = captured.find((entry) => entry && entry.OR);
  assert.deepEqual(where.OR, [{ editingHoldAt: { not: null } }, { edit: { isNot: null } }]);
});

// The desktop app renders from the original on its own disk and hands over the master: stored as
// a server render is, so the web, the sends and Reset see one kind of edit - and the server is
// never asked for, nor given, the original.
test("a desktop-rendered master is stored as a server render is: versioned keys, the display pair at Image Selection's preset, sourceKind ORIGINAL_LOCAL, the previous version released", async () => {
  const sharp = require("sharp");
  const master = await sharp({ create: { width: 12, height: 8, channels: 3, background: "#8899aa" } }).jpeg().toBuffer();
  const f = fakes({ uploads: [upload({ storageRootId: 15, originalPath: "Reception/IMG_0001.CR3" })] });
  // A server render had already made v1; the desktop's hand-over becomes v2 and v1's objects go.
  await f.repo.upsertEdit("p1", "u1", { status: "RENDERED", version: 1, recipe: { style: "moody" }, outputKey: "old/v1/output.jpg", outputPreviewKey: "old/v1/preview.jpg", outputThumbnailKey: "old/v1/thumbnail.webp" });
  f.objects.set("old/v1/output.jpg", Buffer.from("x"));
  const payload = { recipe: { style: "luxuryWedding", adjustments: { exposure: null }, tools: { retouchFace: { smoothing: 40 } } }, appliedRecipe: { adjustments: { exposure: -9 }, analysis: { scene: "couple", lighting: "indoor" }, notes: ["from the original"], faces: 2, referenceProfile: null }, engineVersion: "edit-engine@2.0.0 (desktop)" };
  const edit = await f.service.storeRenderedOutput("p1", "u1", { buffer: master }, payload, 7);
  assert.equal(edit.status, "RENDERED");
  assert.equal(edit.version, 2);
  assert.equal(edit.sourceKind, "ORIGINAL_LOCAL");
  assert.equal(edit.engineVersion, "edit-engine@2.0.0 (desktop)");
  assert.equal(edit.outputWidth, 12); assert.equal(edit.outputHeight, 8); assert.equal(edit.outputBytes, master.length);
  assert.equal(edit.recipe.style, "luxuryWedding");
  assert.equal(edit.appliedRecipe.adjustments.exposure, -9, "the engine's own numbers come back onto the sliders");
  assert.deepEqual(edit.appliedRecipe.analysis, { scene: "couple", lighting: "indoor" });
  assert.deepEqual(edit.appliedRecipe.notes, ["from the original"]);
  assert.equal(edit.appliedRecipe.faces, 2);
  assert.equal(edit.hasOutput, true);
  const stored = f.rows.get("u1").edit;
  assert.equal(stored.outputKey, buildEditKey({ projectName: "Wedding", projectId: "p1", fileName: "DSC_0001.JPG", storageName: "11112222-3333", version: 2, variant: "output" }));
  assert.ok(f.objects.get(stored.outputKey).equals(master), "the master is stored as handed over");
  assert.ok(f.objects.has(stored.outputPreviewKey) && f.objects.has(stored.outputThumbnailKey), "the display pair is made here");
  assert.deepEqual(f.processing.rendered.map((entry) => entry.module), ["imageSelection"], "the display pair follows Image Selection's preset");
  assert.equal(f.objects.has("old/v1/output.jpg"), false, "the earlier version's objects are released");
  assert.equal(f.engine.calls.length, 0, "the server's engine is not asked");
  // What the row says about where the original is: the desktop's trail, never a path this server opens.
  const photo = await f.service.get("p1", "u1");
  assert.equal(photo.originalPath, "Reception/IMG_0001.CR3");
  assert.equal(photo.storageRootId, 15);
  assert.equal(photo.localRenderable, true);
  assert.equal(photo.originalReachable, false, "the server itself cannot read a storage-root original");
});

test("a desktop-rendered master is refused while the server is rendering, when it is not a JPEG, or when it is too large", async () => {
  const sharp = require("sharp");
  const f = fakes({ uploads: [upload()] });
  await assert.rejects(f.service.storeRenderedOutput("p1", "u1", { buffer: Buffer.from("not a jpeg") }, { recipe: {}, engineVersion: "x" }, 7), /must be a JPEG/);
  const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#000" } }).png().toBuffer();
  await assert.rejects(f.service.storeRenderedOutput("p1", "u1", { buffer: png }, { recipe: {}, engineVersion: "x" }, 7), /must be a JPEG/);
  await assert.rejects(f.service.storeRenderedOutput("p1", "u1", { buffer: Buffer.alloc(49 * 1024 * 1024, 0xff) }, { recipe: {}, engineVersion: "x" }, 7), /48 MB/);
  await f.repo.upsertEdit("p1", "u1", { status: "RENDERING", version: 1, recipe: { style: "moody" } });
  const jpeg = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#000" } }).jpeg().toBuffer();
  await assert.rejects(f.service.storeRenderedOutput("p1", "u1", { buffer: jpeg }, { recipe: {}, engineVersion: "x" }, 7), /still rendering on the server/);
  assert.equal(f.objects.size, 0, "nothing reached storage");
});

test("the output route sits behind the desktop hand-off switch and takes one bounded JPEG, and the clients name the local render", () => {
  const routes = read("ai-editing", "routes.js");
  assert.match(routes, /router\.post\("\/photos\/:uploadId\/output", gate\(desktopAiEnabled\), receiveOutput, c\.storeOutput\)/);
  assert.match(routes, /outputUpload\.single\("output"\)/);
  assert.match(routes, /fileSize: 48 \* 1024 \* 1024/);
  const desktopRoutes = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "desktop", "routes.js"), "utf8");
  assert.match(desktopRoutes, /router\.get\("\/runtime\/edit-engine\.py", gate\(virtualCurationEnabled\), getRuntimeEditEngineScript\)/);
  const web = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", "lib", "imageSelectionEditing.mjs"), "utf8");
  assert.match(web, /ORIGINAL_LOCAL/, "the web names a render done on the desktop from the original");
  const desktopState = path.join(__dirname, "..", "..", "..", "Image-Selection_Desktop---BCT", "src", "modules", "image-selection", "editing", "editingState.js");
  if (fs.existsSync(desktopState)) assert.match(fs.readFileSync(desktopState, "utf8"), /ORIGINAL_LOCAL/);
});

test("the bay's list has a total order, so it can be read batch after batch with nothing twice or skipped", async () => {
  const seen = [];
  const repo = createRepository({
    imageSelectionUpload: { findMany: (args) => { seen.push(args.orderBy); return []; }, count: () => 0 },
    $transaction: async (ops) => Promise.all(ops),
  });
  for (const sort of ["createdAt", "capturedAt", "fileName"]) await repo.listBay("p1", null, { page: 2, pageSize: 60, sort, order: "desc" });
  assert.deepEqual(seen, [
    [{ createdAt: "desc" }, { id: "desc" }],
    [{ capturedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    [{ fileName: "desc" }, { id: "desc" }],
  ]);
});
