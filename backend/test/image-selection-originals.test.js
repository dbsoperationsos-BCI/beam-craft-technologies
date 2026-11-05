const test = require("node:test");
const assert = require("node:assert/strict");
const { createOriginalsService } = require("../src/modules/image-selection/originals/service");
const { normalizeRoot, rootPathError, isInsideRoot, resolveWithinRoot, assertReadable, safeSegment, uniqueName } = require("../src/modules/image-selection/originals/paths");

const ORIGINAL_ROOT = "D:\\DBS-Originals";
const SELECTED_ROOT = "D:\\DBS-Selections";

// ---------------------------------------------------------------------------
// Paths — the only thing standing between a stored string and the filesystem.
// ---------------------------------------------------------------------------

test("stores a storage root the same way however it was typed", () => {
  assert.equal(normalizeRoot("D:\\DBS-Originals\\"), "D:\\DBS-Originals");
  assert.equal(normalizeRoot("  D:\\\\DBS-Originals\\\\Wedding  "), "D:\\DBS-Originals\\Wedding");
  assert.equal(normalizeRoot("D:"), "D:\\");
  // A share means nothing without the two separators it opens with.
  assert.equal(normalizeRoot("\\\\DBS-NAS\\Wedding\\"), "\\\\DBS-NAS\\Wedding");
  assert.equal(normalizeRoot("/srv/originals/"), "/srv/originals");
  assert.equal(normalizeRoot(""), "");
});

test("accepts a local drive and a NAS share, and refuses anything that is not a full path", () => {
  assert.equal(rootPathError("D:\\DBS-Originals"), "");
  assert.equal(rootPathError("\\\\DBS-NAS\\DBS-Originals"), "");
  assert.equal(rootPathError("/mnt/originals"), "");
  assert.notEqual(rootPathError("DBS-Originals"), "");
  assert.notEqual(rootPathError("..\\DBS-Originals"), "");
  assert.notEqual(rootPathError("D:\\DBS-Originals\\..\\Windows"), "");
});

test("treats only the root itself and what is under it as inside it", () => {
  assert.equal(isInsideRoot("D:\\DBS-Originals\\Wedding\\DSC_4582.CR3", ORIGINAL_ROOT), true);
  assert.equal(isInsideRoot("d:/dbs-originals/wedding/dsc_4582.cr3", ORIGINAL_ROOT), true, "Windows and SMB are case-insensitive");
  assert.equal(isInsideRoot(ORIGINAL_ROOT, ORIGINAL_ROOT), true);
  // A sibling whose name merely starts with the root's is not inside it.
  assert.equal(isInsideRoot("D:\\DBS-Originals-Archive\\DSC_4582.CR3", ORIGINAL_ROOT), false);
  assert.equal(isInsideRoot("D:\\Windows\\System32", ORIGINAL_ROOT), false);
});

test("refuses to resolve a location that escapes the configured root", () => {
  assert.equal(resolveWithinRoot(ORIGINAL_ROOT, ["Wedding", "Engagement"]), "D:\\DBS-Originals\\Wedding\\Engagement");
  // A traversal collapses the way the filesystem would collapse it, and is then caught.
  assert.throws(() => resolveWithinRoot(ORIGINAL_ROOT, ["..", "Windows"]), { status: 400 });
  assert.throws(() => resolveWithinRoot(ORIGINAL_ROOT, ["Wedding", "..", "..", "Windows"]), { status: 400 });
  // An absolute segment would otherwise replace the root entirely.
  assert.throws(() => resolveWithinRoot(ORIGINAL_ROOT, ["C:\\Windows\\System32"]), { status: 400 });
  assert.throws(() => resolveWithinRoot("", ["Wedding"]), { status: 409 });
});

test("refuses a stored original path that no longer sits under the configured root", () => {
  assert.equal(assertReadable("D:\\DBS-Originals\\Wedding\\DSC_4582.CR3", ORIGINAL_ROOT), "D:\\DBS-Originals\\Wedding\\DSC_4582.CR3");
  assert.throws(() => assertReadable("C:\\Windows\\System32\\config\\SAM", ORIGINAL_ROOT), { status: 409 });
  assert.throws(() => assertReadable(null, ORIGINAL_ROOT), { status: 409 });
});

test("cleans a folder name and numbers a repeated file name", () => {
  assert.equal(safeSegment("John & Priya Wedding"), "John & Priya Wedding");
  assert.equal(safeSegment("Reception: Day 1"), "Reception- Day 1");
  assert.equal(safeSegment(".."), "Unsorted");
  const taken = new Set();
  assert.equal(uniqueName(taken, "DSC_4582.CR3"), "DSC_4582.CR3");
  assert.equal(uniqueName(taken, "DSC_4582.CR3"), "DSC_4582 (1).CR3");
});

// ---------------------------------------------------------------------------
// Registration and copy-out, against an in-memory filesystem.
// ---------------------------------------------------------------------------

function fakeFs(files = []) {
  // Directories are implied by the files inside them, which is all these tests need.
  const store = new Map(files.map((file) => [file.path.toLowerCase(), file]));
  const written = [];
  const notFound = (target) => Object.assign(new Error(`ENOENT: ${target}`), { code: "ENOENT" });
  const childrenOf = (directory) => {
    const prefix = `${directory.toLowerCase().replace(/\\+$/, "")}\\`;
    const names = new Map();
    for (const [key, file] of store) {
      if (!key.startsWith(prefix)) continue;
      const rest = file.path.slice(prefix.length);
      const cut = rest.indexOf("\\");
      if (cut === -1) names.set(rest, { name: rest, isFile: () => true, isDirectory: () => false });
      else { const name = rest.slice(0, cut); if (!names.has(name)) names.set(name, { name, isFile: () => false, isDirectory: () => true }); }
    }
    return [...names.values()];
  };
  return {
    written,
    readdir: async (directory) => { const entries = childrenOf(directory); if (!entries.length) throw notFound(directory); return entries; },
    stat: async (target) => { const file = store.get(target.toLowerCase()); if (!file) throw notFound(target); return { size: file.size, isFile: () => true, isDirectory: () => false }; },
    access: async (target) => { if (!store.get(target.toLowerCase())) throw notFound(target); },
    mkdir: async () => undefined,
    copyFile: async (source, target) => { const file = store.get(source.toLowerCase()); if (!file) throw notFound(source); written.push({ source, target }); store.set(target.toLowerCase(), { path: target, size: file.size }); },
    rename: async () => { throw new Error("A source original must never be moved."); },
    rm: async () => { throw new Error("A source original must never be deleted."); },
  };
}

const fakeSettings = (overrides = {}) => ({ read: async () => ({ originalStoragePath: ORIGINAL_ROOT, selectedOutputPath: SELECTED_ROOT, ...overrides }) });

function fakeRepository({ registered = [], selected = [] } = {}) {
  const state = { created: [], registered: [...registered], selected };
  return {
    state,
    findProject: async (id) => (id === "project-1" ? { id, projectName: "John & Priya Wedding" } : null),
    findFolder: async (projectId, folderId) => (folderId === "folder-1" ? { id: folderId, name: "Engagement" } : null),
    listRegisteredPaths: async () => state.registered,
    createUpload: async (data) => { const row = { id: `image-${state.created.length + 1}`, ...data }; state.created.push(row); return row; },
    listSelectedOriginals: async () => state.selected,
    findDeliverableConfig: async (projectId, configId) => (configId === "config-1" ? { id: configId, name: "Retouches" } : null),
    // The dashboard reads this stamp as "downloaded"; a copy that wrote every original writes it.
    markSelectedDownloaded: async (projectId, at = new Date()) => { state.downloaded = { projectId, at }; return { id: projectId, selectedDownloadedAt: at }; },
  };
}

const serviceFor = (repo, fs, settings = fakeSettings(), queue = null) => createOriginalsService(repo, { fs, settings, queue });

const originalFile = (name, size = 24_000_000, folder = "Wedding\\Engagement") => ({ path: `${ORIGINAL_ROOT}\\${folder}\\${name}`, size });

test("registers every photo in a folder as a reference, copying nothing", async () => {
  const repo = fakeRepository();
  const fs = fakeFs([originalFile("DSC_4582.CR3"), originalFile("DSC_4583.CR3"), originalFile("notes.txt")]);
  const queued = [];
  const result = await serviceFor(repo, fs, fakeSettings(), { enqueue: async (id) => queued.push(id) })
    .register("project-1", { folderId: "folder-1", relativePath: "Wedding/Engagement" });

  assert.equal(result.registered, 2, "the text file is not a photo and is skipped");
  assert.deepEqual(repo.state.created.map((row) => row.originalPath), [
    "D:\\DBS-Originals\\Wedding\\Engagement\\DSC_4582.CR3",
    "D:\\DBS-Originals\\Wedding\\Engagement\\DSC_4583.CR3",
  ]);
  // Nothing was written anywhere: the master file is left exactly where the photographer put it.
  assert.deepEqual(fs.written, []);
  // Each row is queued for the existing worker, which builds the preview.
  assert.equal(queued.length, 2);
  assert.ok(repo.state.created.every((row) => row.status === "PROCESSING" && row.folderId === "folder-1"));
  // Storage names stay unique without a file behind them, because R2 keys are built from them.
  assert.equal(new Set(repo.state.created.map((row) => row.storageName)).size, 2);
});

test("registers a photo that lives on a NAS share exactly as one on a drive", async () => {
  const share = "\\\\DBS-NAS\\Wedding";
  const repo = fakeRepository();
  const fs = fakeFs([{ path: `${share}\\Project-001\\DSC_4582.CR3`, size: 30_000_000 }]);
  const result = await serviceFor(repo, fs, fakeSettings({ originalStoragePath: share })).register("project-1", { relativePath: "Project-001" });
  assert.equal(result.registered, 1);
  assert.equal(repo.state.created[0].originalPath, "\\\\DBS-NAS\\Wedding\\Project-001\\DSC_4582.CR3");
  assert.deepEqual(fs.written, []);
});

test("does not register the same original twice when a folder is scanned again", async () => {
  const repo = fakeRepository({ registered: [{ id: "image-1", originalPath: `${ORIGINAL_ROOT}\\Wedding\\Engagement\\DSC_4582.CR3` }] });
  const fs = fakeFs([originalFile("DSC_4582.CR3"), originalFile("DSC_4583.CR3")]);
  const result = await serviceFor(repo, fs).register("project-1", { relativePath: "Wedding\\Engagement" });
  assert.equal(result.registered, 1);
  assert.deepEqual(result.skipped.map((item) => item.fileName), ["DSC_4582.CR3"]);
});

test("refuses to import from outside the configured Original Storage Path", async () => {
  const service = serviceFor(fakeRepository(), fakeFs([]));
  await assert.rejects(() => service.register("project-1", { relativePath: "..\\..\\Windows" }), { status: 400 });
  await assert.rejects(() => service.browse("..\\Windows"), { status: 400 });
});

test("refuses to import at all until the Original Storage Path is configured", async () => {
  const service = serviceFor(fakeRepository(), fakeFs([]), fakeSettings({ originalStoragePath: null }));
  await assert.rejects(() => service.register("project-1", { relativePath: "Wedding" }), { status: 409 });
});

// ---------------------------------------------------------------------------
// The ordinary upload control, which sends paths instead of bytes.
// ---------------------------------------------------------------------------

test("registers the files the browser picked from their relative paths alone", async () => {
  const repo = fakeRepository();
  const fs = fakeFs([originalFile("DSC_4582.CR3"), originalFile("DSC_4583.CR3")]);
  const queued = [];
  const result = await serviceFor(repo, fs, fakeSettings(), { enqueue: async (id) => queued.push(id) })
    .registerFiles("project-1", { folderId: "folder-1", files: ["Wedding/Engagement/DSC_4582.CR3", "Wedding/Engagement/DSC_4583.CR3"] });

  assert.equal(result.registered, 2);
  assert.deepEqual(repo.state.created.map((row) => row.originalPath), [
    "D:\\DBS-Originals\\Wedding\\Engagement\\DSC_4582.CR3",
    "D:\\DBS-Originals\\Wedding\\Engagement\\DSC_4583.CR3",
  ]);
  // The whole point: the browser sent no bytes, and nothing was written anywhere.
  assert.deepEqual(fs.written, []);
  assert.equal(queued.length, 2, "each row still goes to the worker that builds the R2 preview");
  // The size on the row is the server's own stat of the master, not a number the browser claimed.
  assert.ok(repo.state.created.every((row) => Number(row.sizeBytes) === 24_000_000));
});

test("reports a picked file that is not under the Original Storage Path and keeps the rest", async () => {
  const repo = fakeRepository();
  const fs = fakeFs([originalFile("DSC_4582.CR3")]);
  const result = await serviceFor(repo, fs).registerFiles("project-1", {
    files: ["Wedding/Engagement/DSC_4582.CR3", "Elsewhere/DSC_9999.CR3", "Wedding/Engagement/notes.txt"],
  });

  assert.equal(result.registered, 1);
  assert.deepEqual(result.skipped.map((item) => item.fileName), ["DSC_9999.CR3", "notes.txt"]);
  // The message names where the server actually looked, so a genuinely absent file can be told
  // apart from a root pointed at the wrong folder.
  assert.match(result.skipped[0].reason, /D:\\DBS-Originals\\Elsewhere\\DSC_9999\.CR3/);
  assert.match(result.skipped[0].reason, /Not found under D:\\DBS-Originals/);
});

// `webkitRelativePath` starts with the picked folder's own name, so pointing the root at that same
// folder doubles it: "…\images\Folder 2" + "Folder 2\DSC08659.JPG". Both readings of the root work.
test("accepts a root pointed at the picked folder itself, not only at its parent", async () => {
  const repo = fakeRepository();
  const fs = fakeFs([{ path: "C:\\images\\Folder 2\\DSC08659.JPG", size: 8_000_000 }]);
  const settings = fakeSettings({ originalStoragePath: "C:\\images\\Folder 2" });
  const result = await serviceFor(repo, fs, settings).registerFiles("project-1", { files: ["Folder 2/DSC08659.JPG"] });

  assert.equal(result.registered, 1);
  assert.deepEqual(result.skipped, []);
  assert.equal(repo.state.created[0].originalPath, "C:\\images\\Folder 2\\DSC08659.JPG");
});

// The de-duplication is a fallback, never a preference: a folder really can hold another of the
// same name, and that file has to keep winning over the guess.
test("prefers a real same-named subfolder over the de-duplicated trail", async () => {
  const repo = fakeRepository();
  const fs = fakeFs([
    { path: "C:\\images\\Wedding\\Wedding\\DSC_1.JPG", size: 100 },
    { path: "C:\\images\\Wedding\\DSC_1.JPG", size: 200 },
  ]);
  const settings = fakeSettings({ originalStoragePath: "C:\\images\\Wedding" });
  const result = await serviceFor(repo, fs, settings).registerFiles("project-1", { files: ["Wedding/DSC_1.JPG"] });

  assert.equal(result.registered, 1);
  assert.equal(repo.state.created[0].originalPath, "C:\\images\\Wedding\\Wedding\\DSC_1.JPG");
});

test("only drops a leading segment that actually repeats the root", () => {
  const { trailCandidates } = require("../src/modules/image-selection/originals/service");
  assert.deepEqual(trailCandidates(["Folder 2", "a.jpg"], "C:\\images\\Folder 2"), [["Folder 2", "a.jpg"], ["a.jpg"]]);
  // Case-insensitively, because Windows and SMB are.
  assert.deepEqual(trailCandidates(["folder 2", "a.jpg"], "C:\\images\\Folder 2"), [["folder 2", "a.jpg"], ["a.jpg"]]);
  // A different folder name is left alone, and a bare file name is never stripped to nothing.
  assert.deepEqual(trailCandidates(["Wedding", "a.jpg"], "C:\\images\\Folder 2"), [["Wedding", "a.jpg"]]);
  assert.deepEqual(trailCandidates(["Folder 2"], "C:\\images\\Folder 2"), [["Folder 2"]]);
});

test("refuses a browser-supplied path that climbs out of the configured root", async () => {
  const repo = fakeRepository();
  const service = serviceFor(repo, fakeFs([{ path: "C:\\Windows\\System32\\config\\SAM", size: 10 }]));
  const result = await service.registerFiles("project-1", { files: ["../../Windows/System32/config/SAM.jpg"] });
  assert.equal(result.registered, 0);
  assert.equal(repo.state.created.length, 0);
  assert.match(result.skipped[0].reason, /outside the configured storage path/i);
});

test("re-picking the same folder adds only what is new", async () => {
  const repo = fakeRepository({ registered: [{ id: "image-1", originalPath: `${ORIGINAL_ROOT}\\Wedding\\Engagement\\DSC_4582.CR3` }] });
  const fs = fakeFs([originalFile("DSC_4582.CR3"), originalFile("DSC_4583.CR3")]);
  const result = await serviceFor(repo, fs).registerFiles("project-1", { files: ["Wedding/Engagement/DSC_4582.CR3", "Wedding/Engagement/DSC_4583.CR3"] });
  assert.equal(result.registered, 1);
  assert.deepEqual(result.skipped.map((item) => item.reason), ["already registered"]);
});

test("refuses to register browser-picked files until the Original Storage Path is configured", async () => {
  const service = serviceFor(fakeRepository(), fakeFs([]), fakeSettings({ originalStoragePath: null }));
  await assert.rejects(() => service.registerFiles("project-1", { files: ["Wedding/DSC_4582.CR3"] }), { status: 409 });
});

const selectedImage = (overrides = {}) => ({
  id: "image-1",
  fileName: "DSC_4582.CR3",
  originalPath: `${ORIGINAL_ROOT}\\Wedding\\Engagement\\DSC_4582.CR3`,
  folder: { id: "folder-1", name: "Engagement", parent: { id: "shoot-1", name: "Wedding" } },
  photoSelections: [{ deliverableConfig: { id: "config-1", name: "Retouches" } }],
  ...overrides,
});

test("copies a selected original into the Selected Output Path and leaves the source alone", async () => {
  const repo = fakeRepository({ selected: [selectedImage()] });
  const fs = fakeFs([originalFile("DSC_4582.CR3")]);
  const result = await serviceFor(repo, fs).copySelected("project-1");

  assert.equal(result.copied.length, 1);
  assert.equal(result.failed.length, 0);
  assert.equal(result.copied[0].path, "D:\\DBS-Selections\\John & Priya Wedding\\Retouches\\Wedding\\Engagement\\DSC_4582.CR3");
  // Copied, never moved: the fake filesystem throws on rename and rm, so reaching here proves it.
  assert.deepEqual(fs.written.map((entry) => entry.source), ["D:\\DBS-Originals\\Wedding\\Engagement\\DSC_4582.CR3"]);
  // A complete copy is a download, and the dashboard reads the stamp it leaves.
  assert.equal(repo.state.downloaded?.projectId, "project-1");
  assert.ok(repo.state.downloaded?.at instanceof Date);
});

test("a copy that wrote nothing leaves no download stamp", async () => {
  const repo = fakeRepository({ selected: [selectedImage()] });
  // The only original is missing, so nothing is copied.
  const result = await serviceFor(repo, fakeFs([])).copySelected("project-1");
  assert.equal(result.copied.length, 0);
  assert.equal(repo.state.downloaded, undefined);
});

test("reports a missing original against that photo and copies the rest", async () => {
  const repo = fakeRepository({ selected: [
    selectedImage(),
    selectedImage({ id: "image-2", fileName: "DSC_4583.CR3", originalPath: `${ORIGINAL_ROOT}\\Wedding\\Engagement\\DSC_4583.CR3` }),
  ] });
  // Only the first photo is still on the drive; the second was moved or deleted outside the app.
  const fs = fakeFs([originalFile("DSC_4582.CR3")]);
  const result = await serviceFor(repo, fs).copySelected("project-1");

  assert.equal(result.copied.length, 1);
  assert.deepEqual(result.failed.map((item) => [item.fileName, item.reason]), [["DSC_4583.CR3", "Original file unavailable"]]);
  assert.equal(result.total, 2);
  // Not every original copied, so it is not a download: the project stays on Yet to Download.
  assert.equal(repo.state.downloaded, undefined);
});

test("refuses to copy an original recorded outside the configured root", async () => {
  const repo = fakeRepository({ selected: [selectedImage({ originalPath: "C:\\Windows\\System32\\config\\SAM" })] });
  const fs = fakeFs([{ path: "C:\\Windows\\System32\\config\\SAM", size: 10 }]);
  const result = await serviceFor(repo, fs).copySelected("project-1");
  assert.equal(result.copied.length, 0);
  assert.match(result.failed[0].reason, /outside the configured Original Storage Path/);
  assert.deepEqual(fs.written, [], "nothing outside the root is ever opened");
});

test("files a photo picked for two selection items under each of them", async () => {
  const repo = fakeRepository({ selected: [selectedImage({ photoSelections: [
    { deliverableConfig: { id: "config-1", name: "Retouches" } },
    { deliverableConfig: { id: "config-2", name: "Frames" } },
  ] })] });
  const fs = fakeFs([originalFile("DSC_4582.CR3")]);
  const result = await serviceFor(repo, fs).copySelected("project-1");
  assert.deepEqual(result.copied.map((item) => item.item), ["Retouches", "Frames"]);
  assert.equal(fs.written.length, 2);
});

test("refuses to copy until the Selected Output Path is configured", async () => {
  const service = serviceFor(fakeRepository({ selected: [selectedImage()] }), fakeFs([originalFile("DSC_4582.CR3")]), fakeSettings({ selectedOutputPath: null }));
  await assert.rejects(() => service.copySelected("project-1"), { status: 409 });
});

test("reports an unknown project and an unknown selection item rather than copying anything", async () => {
  const service = serviceFor(fakeRepository({ selected: [selectedImage()] }), fakeFs([originalFile("DSC_4582.CR3")]));
  await assert.rejects(() => service.copySelected("no-such-project"), { status: 404 });
  await assert.rejects(() => service.copySelected("project-1", { deliverableConfigId: "no-such-item" }), { status: 404 });
});
