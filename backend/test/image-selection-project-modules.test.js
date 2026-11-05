const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const iamService = require("../src/services/iam.service");
const modules = require("../src/modules/image-selection/projects/modules");
const { createProjectModules, manualModules, linkedModules, requireWorkspaceAccess } = modules;
const { requireCreatePermissions, modulesOfCreate } = require("../src/modules/image-selection/projects/moduleProjects");

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", "src", "modules", "image-selection", ...parts), "utf8");
const manual = (extra = {}) => ({ id: "p1", projectName: "Wedding ABC", salesProjectId: null, archivedAt: null, deletedAt: null, albumProofing: false, photoSelectionTab: true, photoCullingTab: true, aiEditingTab: null, signatureAlbumTab: false, ...extra });

// A Prisma stand-in with exactly the reads the module makes.
function fakeClient({ project, activeRuns = 0, activeEdits = 0, album = null, publication = null } = {}) {
  return {
    imageSelectionProject: { findFirst: async () => project },
    imageSelectionCullingSession: { count: async () => activeRuns },
    imageSelectionEdit: { count: async () => activeEdits },
    signatureAlbum: { findUnique: async () => album },
    imageSelectionGalleryPublication: { findUnique: async () => publication },
  };
}
// The permission service answers from a list of [feature, level] grants for the duration of `fn`.
async function withGrants(grants, fn) {
  const original = iamService.hasPermission;
  iamService.hasPermission = async (_user, module, feature, level) => module === "IMAGE_SELECTION" && grants.some(([f, l]) => f === feature && (l === "READ_WRITE" || level === "READ"));
  try { return await fn(); } finally { iamService.hasPermission = original; }
}
function call(middleware, req) {
  return new Promise((resolve) => {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { resolve({ status: this.statusCode, body }); } };
    middleware({ user: { id: 1 }, params: {}, query: {}, body: {}, method: "GET", ...req }, res, () => resolve({ status: "next" }));
  });
}

test("a manual project's modules are its ticks; a linked project's follow its allocation", () => {
  assert.deepEqual([...manualModules(manual())].sort(), ["culling", "editing", "photos"]);
  assert.deepEqual([...manualModules(manual({ photoCullingTab: false, aiEditingTab: false, signatureAlbumTab: true }))].sort(), ["album", "photos"]);
  assert.deepEqual([...linkedModules([])].sort(), ["culling", "editing"]);
  assert.deepEqual([...linkedModules([{ key: "photoselection", selectable: true }, { key: "signaturealbumsoftcopy", imageSelectionEnabled: true }])].sort(), ["album", "culling", "editing", "photos"]);
  assert.equal(linkedModules([{ key: "signaturealbum", imageSelectionEnabled: false }]).has("album"), false);
});

test("a send into a module the project was not created in is refused - never matched by name", async () => {
  const projectModules = createProjectModules(fakeClient({ project: manual() }));
  await projectModules.assertModule("p1", "editing");
  await assert.rejects(() => projectModules.assertModule("p1", "album"), (error) => error.status === 409 && error.code === "MODULE_NOT_LINKED");
  const linked = createProjectModules(fakeClient({ project: manual({ salesProjectId: "s1" }) }), { allocatedServices: async () => [] });
  await assert.rejects(() => linked.assertModule("p1", "photos"), /has no Photo Selection project/);
});

test("a module project is not deleted mid-run or while published to the client", async () => {
  assert.match(await createProjectModules(fakeClient({ activeRuns: 1 })).unlinkBlocker(manual(), "culling", { allowLast: true }), /AI Culling run is still in progress/);
  assert.match(await createProjectModules(fakeClient({ activeEdits: 2 })).unlinkBlocker(manual(), "editing", { allowLast: true }), /renders are still in progress/);
  assert.match(await createProjectModules(fakeClient({ album: { status: "PUBLISHED", expiresAt: null } })).unlinkBlocker(manual({ signatureAlbumTab: true }), "album", { allowLast: true }), /Unpublish it first/);
  assert.match(await createProjectModules(fakeClient({ publication: { status: "PUBLISHED" } })).unlinkBlocker(manual(), "photos", { allowLast: true }), /gallery is published/);
  assert.equal(await createProjectModules(fakeClient({})).unlinkBlocker(manual(), "culling", { allowLast: true }), null);
});

test("Create Project asks Read / Write on every module it would create in, whatever the form offered", async () => {
  assert.deepEqual(modulesOfCreate({ sourceModule: "culling", linkedModules: ["editing", "culling"] }), ["culling", "editing"]);
  // An older form's ticks are read as they always were: Photo Selection, with AI Editing on unless unticked.
  assert.deepEqual(modulesOfCreate({}), ["photos", "editing"]);
  assert.deepEqual(modulesOfCreate({ salesProjectId: "s1" }), []);

  const culler = [["AI Culling", "READ_WRITE"], ["AI Editing", "READ_WRITE"]];
  await withGrants(culler, async () => {
    assert.equal((await call(requireCreatePermissions, { method: "POST", body: { sourceModule: "culling", linkedModules: ["editing"] } })).status, "next");
    // Photo Selection was never offered to this user: a manipulated request is refused.
    const refused = await call(requireCreatePermissions, { method: "POST", body: { sourceModule: "culling", linkedModules: ["photos"] } });
    assert.equal(refused.status, 403);
    assert.equal(refused.body.module, "photos");
    assert.equal((await call(requireCreatePermissions, { method: "POST", body: { sourceModule: "culling", linkedModules: ["sales"] } })).status, 400);
  });
  // Read alone opens a module but creates nothing in it.
  await withGrants([["AI Culling", "READ"]], async () => {
    assert.equal((await call(requireCreatePermissions, { method: "POST", body: { sourceModule: "culling" } })).status, 403);
  });
});

test("the photo workspace opens on the module's own permission, for a project in that module", async () => {
  const original = modules.findProject;
  const originalModulesOf = modules.modulesOf;
  modules.findProject = async () => manual({ photoSelectionTab: false });
  modules.modulesOf = async (project) => manualModules(project);
  try {
    // AI Culling alone opens a culling project's folders - no Photo Selection permission needed.
    await withGrants([["AI Culling", "READ"]], async () => {
      assert.equal((await call(requireWorkspaceAccess(), { params: { projectId: "p1" } })).status, "next");
      assert.equal((await call(requireWorkspaceAccess(), { params: { projectId: "p1" }, method: "POST" })).status, 403, "Read does not change it");
    });
    // Photo Selection's permission does not open a project that is not in Photo Selection.
    await withGrants([["Project Management", "READ_WRITE"]], async () => {
      assert.equal((await call(requireWorkspaceAccess(), { params: { projectId: "p1" } })).status, 403);
    });
    // The culling routes take AI Culling's alone.
    await withGrants([["AI Editing", "READ_WRITE"]], async () => {
      assert.equal((await call(requireWorkspaceAccess(["culling"]), { params: { projectId: "p1" } })).status, 403);
    });
  } finally {
    modules.findProject = original;
    modules.modulesOf = originalModulesOf;
  }
});

test("every module's work is guarded by its own permission on the server", () => {
  assert.match(read("ai-culling", "routes.js"), /router\.use\(requireWorkspaceAccess\(\["culling"\]\)\);/);
  assert.match(read("ai-culling", "routes.js"), /send-to-photo-selection", checkPermission\("IMAGE_SELECTION", "Project Management", "READ_WRITE"\), requireProjectEnabled, requireProjectLink\(\[\["culling", "photos"\]\]\)/);
  const editing = read("ai-editing", "routes.js");
  assert.match(editing, /router\.use\(requireWorkspaceAccess\(\["editing"\]\)\);/);
  assert.match(editing, /"\/send-to-signature-album", checkPermission\("IMAGE_SELECTION", "Signature Album", "READ_WRITE"\), requireProjectLink\(\[\["editing", "album"\]\]\)/);
  // Photo Selection's own client-facing work keeps Photo Selection's permission alone.
  const gallery = read("gallery", "routes.js");
  assert.ok(gallery.indexOf('router.get("/:imageId/thumbnail", requireWorkspaceAccess(), thumbnail);') < gallery.indexOf("router.use(photoSelection);"));
  assert.ok(gallery.indexOf("router.use(photoSelection);") < gallery.indexOf('router.patch("/:imageId/selection", updateSelection);'));
  const routes = read("projects", "moduleProjects.routes.js");
  assert.match(routes, /router\.post\("\/", requireCreatePermissions,/);
  assert.match(routes, /router\.get\("\/", requireListPermission,/);
  assert.match(routes, /router\.patch\("\/:recordId", requireRecordPermission,/);
  assert.match(routes, /router\.delete\("\/:recordId", requireRecordPermission,/);
  // The old create path asks the same of the modules its ticks name.
  assert.match(read("projects", "routes.js"), /router\.post\("\/projects", photoSelection, requireCreatePermissions, createProject\);/);
  // Photo Selection's guard sits on its own routes, never on the whole /api/image-selection prefix,
  // where it stood in front of every module's routes mounted after it.
  assert.doesNotMatch(read("projects", "routes.js"), /router\.use\(requireModule/);
  // No linking after creation: the link endpoint is gone.
  assert.doesNotMatch(read("projects", "routes.js"), /modules\/:module/);
});
