const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { derivativeSchema } = require("../src/modules/image-selection/uploads/validation");
const { registerBatchSchema } = require("../src/modules/image-selection/originals/validation");
const { createOriginalsService } = require("../src/modules/image-selection/originals/service");
const { createRepository } = require("../src/modules/image-selection/ai-culling/repository");
const { createAiCullingService } = require("../src/modules/image-selection/ai-culling/service");

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", "src", "modules", "image-selection", ...parts), "utf8");

/*
 * Photos added through the AI Culling tab go through culling before Photo Selection: they are held
 * (cullingHoldAt) - off every Photo Selection surface - until a finalized run releases them (its
 * Keeps appear, the rest stay culled) or the studio sends them on without culling. Photos added
 * through Photo Selection are never held. A held photo is "not run", never a reject.
 */

const derivative = { fileName: "IMG_0001.JPG", relativePath: "Day 1/IMG_0001.JPG", mimeType: "image/jpeg", sizeBytes: "1000", width: "10", height: "10" };

test("an upload says whether it is for culling; anything else is Photo Selection's, as before", () => {
  assert.equal(derivativeSchema.parse(derivative).holdForCulling, false);
  assert.equal(derivativeSchema.parse({ ...derivative, holdForCulling: "true" }).holdForCulling, true);
  assert.equal(derivativeSchema.parse({ ...derivative, holdForCulling: "false" }).holdForCulling, false);
  assert.equal(derivativeSchema.safeParse({ ...derivative, holdForCulling: "maybe" }).success, false);
  const batch = { storageRootId: "root", files: [{ relativePath: "Day 1/IMG_0001.CR3", sizeBytes: 1 }] };
  assert.equal(registerBatchSchema.parse(batch).holdForCulling, false);
  assert.equal(registerBatchSchema.parse({ ...batch, holdForCulling: true }).holdForCulling, true);
});

// The desktop app is the only way into AI Culling and AI Editing: the browser's derivative route
// refuses a hold outright, before anything is written, rather than quietly becoming a second way in.
test("the browser's derivative upload refuses to hold a photo for culling or editing", () => {
  const controller = read("uploads", "derivativeController.js");
  assert.match(controller, /if \(body\.holdForCulling \|\| body\.holdForEditing\) return res\.status\(400\)\.json\(\{ message: DESKTOP_ONLY \}\);/);
  assert.doesNotMatch(controller, /cullingHoldAt: new Date\(\)/, "the route never sets a culling hold");
  assert.doesNotMatch(controller, /editingHoldAt: new Date\(\)/, "nor an editing hold");
  assert.ok(controller.indexOf("DESKTOP_ONLY }") < controller.indexOf("r2.putObject"), "refused before any byte reaches storage");
});

test("a desktop registration for culling holds every photo it registers", async () => {
  const created = [];
  const repo = {
    findProject: async () => ({ id: "p1" }),
    findStorageRoot: async () => ({ id: "root" }),
    findFolder: async () => ({ id: "f1" }),
    listRegisteredFolderPaths: async () => [],
    createUpload: async (data) => { created.push(data); return { id: `u${created.length}`, fileName: data.fileName }; },
  };
  const service = createOriginalsService(repo, { settings: { read: async () => ({}) } });
  await service.registerBatch("p1", { folderId: "f1", storageRootId: "root", files: [{ relativePath: "Day 1/A.CR3", sizeBytes: 1 }], holdForCulling: true });
  await service.registerBatch("p1", { folderId: "f1", storageRootId: "root", files: [{ relativePath: "Day 1/B.CR3", sizeBytes: 1 }] });
  assert.ok(created[0].cullingHoldAt instanceof Date, "held for culling");
  assert.equal(created[1].cullingHoldAt, undefined, "a Photo Selection registration is not");
  assert.match(read("originals", "controller.js"), /holdForCulling: body\.holdForCulling/);
});

test("a held photo is off every Photo Selection surface, like a culled one", () => {
  const gallery = read("gallery", "repository.js");
  assert.match(gallery, /const cullEligible = \{ cullRejectedAt: null, cullingHoldAt: null, editingHoldAt: null \};/);
  const publication = read("publication", "repository.js");
  assert.equal((publication.match(/cullRejectedAt: null, cullingHoldAt: null, editingHoldAt: null/g) || []).length, 3, "both publish counts, and the gallery's availability count");
});

test("finalizing lifts every analyzed photo's culling hold, moves the imported Keeps into AI Editing, and stamps the rest", async () => {
  const calls = [];
  const tx = {
    imageSelectionCullingSession: { updateMany: async () => ({ count: 1 }) },
    imageSelectionUpload: {
      updateMany: async (args) => { calls.push(args); return { count: 3 }; },
      count: async () => 0,
    },
  };
  const repo = createRepository({ $transaction: (work) => work(tx) });
  await repo.finalizeSession("s1", "p1");
  const release = calls.find((call) => call.data.cullingHoldAt === null);
  assert.ok(release, "the hold is lifted");
  assert.deepEqual(release.where, { projectId: "p1", cullingResults: { some: { sessionId: "s1" } }, cullingHoldAt: { not: null } });
  // AI Culling → AI Editing, never AI Culling → Photo Selection: the imported Keeps are held for
  // editing before their culling hold is lifted, so no window exists in which they are visible.
  const toEditing = calls.find((call) => call.data.editingHoldAt instanceof Date);
  assert.ok(toEditing, "the imported Keeps move into the editing bay");
  assert.deepEqual(toEditing.where, { projectId: "p1", cullingResults: { some: { sessionId: "s1", effectiveDecision: "KEEP" } }, cullingHoldAt: { not: null }, editingHoldAt: null });
  assert.ok(calls.indexOf(toEditing) < calls.indexOf(release), "held for editing before the culling hold goes");
  assert.ok(calls.some((call) => call.data.cullRejectedSessionId === "s1"), "non-Keeps are still stamped");
});

// There is no way past AI Culling: the "without culling" route, its service and repository
// functions are gone, and no other backend path lifts a culling hold or a reject stamp.
test("nothing sends a held or rejected photo to Photo Selection: no release route, no release function, no hold lifted outside finalize and reopen", () => {
  for (const file of ["routes.js", "controller.js", "service.js", "validation.js", "repository.js"]) {
    const source = read("ai-culling", file);
    assert.doesNotMatch(source, /release-held|releaseHeld|releaseUploads|without culling/, `${file} has no release`);
  }
  const culling = read("ai-culling", "repository.js");
  const lifts = culling.match(/cullingHoldAt: null/g) || [];
  assert.equal(lifts.length, 1, "the culling hold is lifted in finalizeSession alone");
  const editing = read("ai-editing", "repository.js");
  assert.match(editing, /editingHoldAt: \{ not: null \}, cullingHoldAt: null, cullRejectedAt: null \}, data: \{ editingHoldAt: null \}/, "AI Editing clears only its own hold, and only for a culled photo");
  assert.doesNotMatch(editing, /cullingHoldAt: null, cullRejectedAt: null, cullRejectedSessionId: null/, "AI Editing never lifts a cull");
  assert.match(read("ai-editing", "service.js"), /if \(upload\.cullingHoldAt \|\| upload\.cullRejectedAt\) \{ result\.notCulled \+= 1; continue; \}/);
});


test("the culling overview counts the photos held for it", () => {
  const service = read("ai-culling", "service.js");
  assert.match(service, /photoCounts\.held = repo\.countHeld \? Number\(await repo\.countHeld\(projectId, folderIds\)\) \|\| 0 : 0;/);
  const repository = read("ai-culling", "repository.js");
  assert.match(repository, /countHeld: \(projectId, folderIds = null\) => client\.imageSelectionUpload\.count\(\{ where: \{ projectId, cullingHoldAt: \{ not: null \}/);
});

test("Photo Selection's listing says how many photos wait in AI Culling", () => {
  const service = read("gallery", "service.js");
  assert.match(service, /heldForCulling: await repository\.countHeldForCulling\(projectId, options\.folderId \|\| null\)/);
});
