const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * Expand → a project's Enabled switch, one state for everyone (`image_selection_project.disabled_at`).
 * Disabled, a project takes no uploads, is not published, re-published or sent, and its published link
 * is paused - its photos, selections, URL, PIN and expiry kept, and working again once it is enabled.
 * The cards count the enabled projects; the table lists every project with whether it is enabled.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const DAY = 24 * 60 * 60 * 1000;

// An in-memory database for the parts that read it: the guard, the switch, and the client's link.
const db = { projects: new Map(), publication: null, raw: [] };
const dbPath = require.resolve("../src/config/db");
require(dbPath);
require.cache[dbPath].exports = {
  imageSelectionProject: {
    findFirst: async ({ where }) => {
      const project = db.projects.get(where.id);
      if (!project) return null;
      if (where.deletedAt === null && project.deletedAt) return null;
      if (where.albumProofing === false && project.albumProofing) return null;
      return { id: project.id, disabledAt: project.disabledAt || null };
    },
  },
  $executeRaw: async (strings, ...values) => {
    const sql = strings.join("?");
    db.raw.push(sql);
    const id = values[values.length - 1];
    const project = db.projects.get(id);
    if (/disabled_at = NULL/.test(sql)) Object.assign(project, { disabledAt: null, disabledByUserId: null });
    else Object.assign(project, { disabledAt: values[0], disabledByUserId: values[1] });
    return 1;
  },
  imageSelectionGalleryPublication: {
    findFirst: async ({ where }) => (db.publication && where.shortCode === db.publication.shortCode && (!where.status || where.status === db.publication.status)
      ? { ...db.publication, project: { id: "p1", projectName: "Asha & Ravi", deletedAt: null, disabledAt: db.projects.get("p1").disabledAt || null, salesProject: null } }
      : null),
  },
};

const { createDashboardService } = require("../src/modules/image-selection/dashboard/service");
const expand = require("../src/modules/image-selection/dashboard/expand");
const { requireProjectEnabled, DISABLED_MESSAGE } = require("../src/modules/image-selection/projectEnabled");
const publication = require("../src/modules/image-selection/publication/service");
const { dashboardQuerySchema, expandSchema } = require("../src/modules/image-selection/dashboard/validation");

function reset() {
  db.projects = new Map([
    ["p1", { id: "p1", disabledAt: null }],
    ["p2", { id: "p2", disabledAt: null }],
    ["album", { id: "album", disabledAt: null, albumProofing: true }],
  ]);
  db.raw = [];
  db.publication = { id: "pub", projectId: "p1", status: "PUBLISHED", shortCode: "MBUM8D", tokenCipher: "token", pinHash: "pin-hash", pinCipher: "pin", expiresAt: new Date(Date.now() + 100 * DAY), revokedAt: null, revokedReason: null };
}

// ── The dashboard ──────────────────────────────────────────────────────────────────────────────

const NOW = new Date("2026-09-08T10:00:00.000Z");
const daysAgo = (days) => new Date(NOW.getTime() - days * DAY);
const project = (overrides = {}) => ({ id: "p1", projectCode: "DBS-VCIS-000001", projectName: "Arun & Priya Wedding", sourceType: "Manual", salesProjectId: null, clientName: "Priya", archivedAt: null, createdAt: daysAgo(5), updatedAt: daysAgo(5), lastOpenedAt: null, totalPhotoSize: BigInt(0), salesProject: null, disabledAt: null, ...overrides });
function fakeRepository(projects) {
  const state = { calls: [] };
  return {
    state,
    listProjects: async () => projects,
    countAllProjects: async () => projects.length,
    listShootDatesForSalesProjects: async () => [],
    periodCounts: async (range, options) => { state.calls.push(["periodCounts", options]); return { projectsCreated: 1, photosAdded: 0, selectionsMade: 0, itemsSubmitted: 0 }; },
    clientNames: async () => new Map(),
    rootFolders: async () => [],
    snapshotData: async () => ({ publications: [{ projectId: "p1", status: "PUBLISHED", publishedAt: daysAgo(4), expiresAt: new Date(NOW.getTime() + 100 * DAY) }], configs: [], photoCounts: [{ projectId: "p1", count: 10 }], legacySelected: [], selectionCounts: [] }),
    storageStats: async () => ({ totalPhotos: 0, added: {} }),
    queueCounts: async () => ({ available: false }),
  };
}
const dashboard = (repo) => createDashboardService(repo, { settings: { read: async () => ({ defaultSelectionLimit: 50 }) }, now: () => NOW, closeAbandonedBatches: async () => ({ count: 0 }) });
const threeProjects = (p2 = {}) => [project(), project({ id: "p2", projectName: "Corporate Launch", createdAt: daysAgo(3), updatedAt: daysAgo(3), ...p2 }), project({ id: "p3", projectName: "Old Shoot", createdAt: daysAgo(40), updatedAt: daysAgo(1) })];

test("every project - existing or just created - is enabled until somebody disables it", async () => {
  const data = await dashboard(fakeRepository([...threeProjects(), project({ id: "p-new", createdAt: NOW, updatedAt: NOW })])).build({ range: "month", expand: true });
  assert.ok(data.recentProjects.every((row) => row.expandEnabled === true));
  assert.equal(data.summary.totalProjects, 4);
});

test("a disabled project stays in the table, marked, and leaves every Expand card and period figure", async () => {
  const repo = fakeRepository(threeProjects({ disabledAt: daysAgo(1) }));
  const data = await dashboard(repo).build({ range: "month", expand: true });
  assert.deepEqual(data.recentProjects.map((row) => row.id).sort(), ["p1", "p2", "p3"]);
  assert.equal(data.recentProjects.find((row) => row.id === "p2").expandEnabled, false);
  // When it was switched off travels with it, so the Enabled and Disabled cards can trend over the range.
  assert.equal(new Date(data.recentProjects.find((row) => row.id === "p2").disabledAt).getTime(), new Date(daysAgo(1)).getTime());
  assert.equal(data.recentProjects.find((row) => row.id === "p1").disabledAt, null);
  assert.ok(data.recentProjects.every((row) => row.createdAt));
  assert.equal(data.summary.totalProjects, 2);
  assert.deepEqual(repo.state.calls.find(([name]) => name === "periodCounts")[1], { excludeIds: ["p2"] });
  // The Dashboard page counts every project, as it always has.
  assert.equal((await dashboard(fakeRepository(threeProjects({ disabledAt: daysAgo(1) }))).build({ range: "month" })).summary.totalProjects, 3);
});

test("the query reads expand=true as the Expand view; the switch takes a plain true or false", () => {
  assert.equal(dashboardQuerySchema.parse({ expand: "true" }).expand, true);
  assert.equal(dashboardQuerySchema.parse({}).expand, false);
  assert.equal(expandSchema.safeParse({ enabled: "false" }).success, false);
});

// ── The switch ─────────────────────────────────────────────────────────────────────────────────

test("disabling stamps the project and who did it; enabling clears both; nothing else is written", async () => {
  reset();
  await expand.setEnabled(7, "p1", false);
  assert.ok(db.projects.get("p1").disabledAt instanceof Date);
  assert.equal(db.projects.get("p1").disabledByUserId, 7);
  await expand.setEnabled(7, "p1", false);
  assert.equal(db.raw.length, 1, "disabling twice writes once");
  await expand.setEnabled(7, "p1", true);
  assert.equal(db.projects.get("p1").disabledAt, null);
  assert.ok(db.raw.every((sql) => !/updated_at/.test(sql)), "the project's place and Last Activity stay put");
  assert.equal(db.projects.get("p2").disabledAt, null, "no other project is touched");
});

test("only a project the Projects page lists can be switched", async () => {
  reset();
  await assert.rejects(expand.setEnabled(7, "nope", false), (error) => error.status === 404);
  await assert.rejects(expand.setEnabled(7, "album", false), (error) => error.status === 404);
});

// ── What a disabled project refuses ────────────────────────────────────────────────────────────

function run(projectId) {
  return new Promise((resolve) => {
    const res = { status(code) { this.code = code; return this; }, json(body) { resolve({ code: this.code, body }); } };
    requireProjectEnabled({ params: { projectId } }, res, () => resolve({ next: true }));
  });
}

test("the guard refuses a disabled project with the message, and lets every other project through", async () => {
  reset();
  db.projects.get("p1").disabledAt = new Date();
  assert.deepEqual(await run("p1"), { code: 409, body: { message: DISABLED_MESSAGE, code: "PROJECT_DISABLED" } });
  assert.equal(DISABLED_MESSAGE, "This project is disabled. Enable it from Expand to upload photos or send the client link.");
  assert.deepEqual(await run("p2"), { next: true }, "an enabled project is unaffected");
  assert.deepEqual(await run(undefined), { next: true });
  db.projects.get("p1").disabledAt = null;
  assert.deepEqual(await run("p1"), { next: true }, "enabled again, it works again");
});

test("the guard sits on every route that puts something new in front of the client, and nowhere it should not", () => {
  const read = (file) => fs.readFileSync(path.join(__dirname, "../src/modules/image-selection", file), "utf8");
  const guarded = {
    "uploads/routes.js": ['router.post("/batches", requireProjectEnabled', 'router.post("/batches/:batchId/retry-failed", requireProjectEnabled', 'router.post("/derivatives", requireProjectEnabled'],
    // After the workspace's own permission guard (projects/modules.js), as every route here is.
    "originals/routes.js": ['router.post("/register", requireWorkspaceAccess(), requireProjectEnabled', 'router.post("/register-files", requireWorkspaceAccess(), requireProjectEnabled', 'router.post("/register-batch", requireWorkspaceAccess(), requireProjectEnabled'],
    "publication/routes.js": ['router.post("/", requireProjectEnabled', 'router.post("/regenerate-pin", requireProjectEnabled'],
    "publish-share/routes.js": ['router.post("/prepare", requireProjectEnabled'],
    "whatsapp/routes.js": ['router.post("/send", requireProjectEnabled', "router.post(\"/send-group\", limits.send, requireProjectEnabled", 'router.post("/notify-app", requireProjectEnabled'],
    "ai-culling/routes.js": ['router.post("/sessions/:sessionId/send-to-photo-selection", checkPermission("IMAGE_SELECTION", "Project Management", "READ_WRITE"), requireProjectEnabled'],
  };
  for (const [file, routes] of Object.entries(guarded)) for (const route of routes) assert.ok(read(file).includes(route), `${file}: ${route}`);
  // Taking the gallery down, cancelling an upload and the studio's own work stay open.
  assert.ok(read("publication/routes.js").includes('router.delete("/", revokeGallery);'));
  assert.ok(read("uploads/routes.js").includes('router.delete("/:uploadId", cancelUpload);'));
  assert.ok(!read("folders/routes.js").includes("requireProjectEnabled"));
});

test("the switch is a Read / Write action under the module guard", () => {
  const routes = fs.readFileSync(path.join(__dirname, "../src/modules/image-selection/dashboard/routes.js"), "utf8");
  assert.ok(routes.indexOf('router.put("/expand/:projectId", setExpand);') > routes.indexOf('router.use(requireModule("IMAGE_SELECTION", "Project Management"));'), "a PUT under requireModule asks READ_WRITE");
  assert.match(fs.readFileSync(path.join(__dirname, "../src/modules/image-selection/dashboard/controller.js"), "utf8"), /expand\.setEnabled\(req\.user\.id, req\.params\.projectId, body\.enabled\)/);
});

// ── The client's link ──────────────────────────────────────────────────────────────────────────

test("a disabled project's link is paused - same URL, PIN and expiry - and opens again once enabled", async () => {
  reset();
  const before = { ...db.publication };
  assert.equal((await publication.authorize("MBUM8D")).pinHash, "pin-hash");
  await expand.setEnabled(7, "p1", false);
  await assert.rejects(publication.authorize("MBUM8D"), (error) => error.status === 404 && /temporarily unavailable/.test(error.message));
  assert.deepEqual(db.publication, before, "the publication row is not touched");
  await expand.setEnabled(7, "p1", true);
  const back = await publication.authorize("MBUM8D");
  assert.equal(back.shortCode, "MBUM8D");
  assert.equal(back.pinHash, "pin-hash");
});

test("an expired link stays expired whether or not the project is disabled", async () => {
  reset();
  db.publication.expiresAt = new Date(Date.now() - DAY);
  db.projects.get("p1").disabledAt = new Date();
  const fakeRevoke = require("../src/modules/image-selection/publication/repository");
  const original = fakeRevoke.revoke;
  fakeRevoke.revoke = async () => {};
  try {
    await assert.rejects(publication.authorize("MBUM8D"), (error) => !/temporarily unavailable/.test(error.message));
  } finally { fakeRevoke.revoke = original; }
});
