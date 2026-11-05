const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { attentionFlagsOf, readyToDownloadConfigs } = require("../src/modules/image-selection/dashboard/classify");

/*
 * Yet to Download is "a submitted selection newer than the last download". The download stamp
 * (`selectedDownloadedAt`) is the selection state a complete run saved - read before the photos
 * were - so the project leaves the list when that state is downloaded and comes back when the
 * client submits again, as often as the cycle repeats. The card and the filtered table read the
 * same `readyToDownload` flag, from the project's stored stamp, so both hold across a refresh.
 */

const T = (minutes) => new Date(Date.UTC(2026, 9, 1, 10, minutes));
const project = ({ submissions, downloadedAt = null }) => ({
  archivedAt: null,
  selectionProgress: "completed",
  publication: { status: "PUBLISHED", expiresAt: T(10_000) },
  configs: submissions.map((at, index) => ({ id: `c${index}`, selectionSubmittedAt: at, selectedCount: 5 })),
  photoCount: 10,
  selectedDownloadedAt: downloadedAt,
});
const yet = (snapshot) => attentionFlagsOf(snapshot, T(500)).readyToDownload;

test("A/B/E: submitted → listed; downloaded → off, and stays off with nothing new", () => {
  assert.equal(yet(project({ submissions: [T(0)] })), true);
  const downloaded = project({ submissions: [T(0)], downloadedAt: T(5) });
  assert.equal(yet(downloaded), false);
  // A refresh reads the same stored stamp: still off, however often.
  for (let i = 0; i < 3; i += 1) assert.equal(yet(downloaded), false);
  assert.equal(attentionFlagsOf(downloaded, T(500)).downloaded, true);
});

test("C/F: a new submission brings it back; one or several, until the latest is downloaded", () => {
  assert.equal(yet(project({ submissions: [T(0), T(20)], downloadedAt: T(5) })), true, "update #2 after the download");
  assert.equal(yet(project({ submissions: [T(0), T(20), T(30)], downloadedAt: T(5) })), true, "update #3 too");
  assert.equal(yet(project({ submissions: [T(0), T(20), T(30)], downloadedAt: T(35) })), false, "downloading the latest clears them all");
  // The rows it opens on are the items submitted since the download.
  assert.deepEqual(readyToDownloadConfigs(project({ submissions: [T(0), T(20)], downloadedAt: T(5) })).map((c) => c.id), ["c1"]);
});

test("G: projects are judged one by one", () => {
  const a = project({ submissions: [T(0)], downloadedAt: T(5) });
  const b = project({ submissions: [T(0)] });
  assert.deepEqual([yet(a), yet(b)], [false, true]);
});

test("H: the card and the filtered table read the one flag", () => {
  const service = fs.readFileSync(path.join(__dirname, "../src/modules/image-selection/dashboard/service.js"), "utf8");
  assert.match(service, /notYetDownloaded: attention\.readyToDownload,/);
  assert.match(fs.readFileSync(path.join(__dirname, "../../frontend/src/lib/imageSelectionDashboard.mjs"), "utf8"), /\{ key: "notYetDownloaded", label: "Yet to Download", unit: "Project", view: \{ attention: "readyToDownload" \} \}/);
});

/* ── The stamp ── */

function galleryWithStore(initial) {
  const repoPath = require.resolve("../src/modules/image-selection/gallery/repository");
  const servicePath = require.resolve("../src/modules/image-selection/gallery/service");
  const repository = require(repoPath);
  const store = { stamp: initial, exists: true };
  repository.markSelectedDownloaded = async (projectId, at) => {
    if (!store.exists) return { found: false, selectedDownloadedAt: null };
    if (!store.stamp || store.stamp < at) store.stamp = at; // never backwards, as the query is
    return { found: true, selectedDownloadedAt: store.stamp };
  };
  delete require.cache[servicePath];
  return { service: require(servicePath), store };
}

test("the browser's download records the state its list was read at, never later and never backwards", async () => {
  const { service, store } = galleryWithStore(null);
  const asOf = new Date(Date.now() - 60_000).toISOString();
  await service.markSelectedDownloaded("p1", asOf);
  assert.equal(store.stamp.toISOString(), asOf, "the state read, not the moment the run ended");
  // A second download of a state already recorded changes nothing.
  await service.markSelectedDownloaded("p1", new Date(Date.now() - 120_000).toISOString());
  assert.equal(store.stamp.toISOString(), asOf);
  // A time from the future is held to now.
  const before = Date.now();
  await service.markSelectedDownloaded("p1", new Date(Date.now() + 3_600_000).toISOString());
  assert.ok(store.stamp.getTime() <= Date.now() && store.stamp.getTime() >= before);
  // An older browser that sends no time is recorded at the moment it reports.
  const { service: older, store: olderStore } = galleryWithStore(null);
  await older.markSelectedDownloaded("p1");
  assert.ok(olderStore.stamp instanceof Date);
  // A project that is not there is still a not-found.
  const { service: missing, store: missingStore } = galleryWithStore(null);
  missingStore.exists = false;
  await assert.rejects(() => missing.markSelectedDownloaded("gone"), { status: 404 });
});

test("D: a submission landing mid-download keeps the project listed", () => {
  // The list was read at 10:05, the client submitted again at 10:06, the run ended at 10:09.
  assert.equal(yet(project({ submissions: [T(0), T(6)], downloadedAt: T(5) })), true);
});

test("the stamp is taken before the list is read, written never backwards, and only by a complete run", () => {
  const read = (...parts) => fs.readFileSync(path.join(__dirname, "../src/modules/image-selection", ...parts), "utf8");
  const controller = read("gallery", "controller.js");
  assert.ok(controller.indexOf("const asOf = new Date().toISOString();") < controller.indexOf("service.selectedManifest(params.projectId"));
  assert.match(controller, /, asOf \}\);/);
  assert.match(read("gallery", "repository.js"), /OR: \[\{ selectedDownloadedAt: null \}, \{ selectedDownloadedAt: \{ lt: at \} \}\]/);
  const originals = read("originals", "service.js");
  assert.ok(originals.indexOf("const selectionAsOf = new Date();") < originals.indexOf("repo.listSelectedOriginals(project.id"));
  assert.match(originals, /if \(copied\.length && !failed\.length\) await repo\.markSelectedDownloaded\(project\.id, selectionAsOf, deliverableConfigId \? \[deliverableConfigId\] : null\)/);
  // The desktop copy stamps through the one shared stamping, on its own client - the same never-backwards rule.
  assert.match(read("originals", "repository.js"), /stampSelectedDownloaded\(client, projectId, at, deliverableConfigIds\)/);
  // The browser records only a complete run, with the time its list was read, and says when it cannot.
  const button = fs.readFileSync(path.join(__dirname, "../../frontend/src/components/image-selection/DownloadSelectedButton.js"), "utf8");
  assert.match(button, /if \(!missing\.length && saved > 0\) \{\n\s*try \{ await markSelectedOriginalsDownloaded\(projectId, selectionAsOf, folder\?\.id \|\| null\); \}/, "the run says which folder it took, so only that folder's items are stamped");
  assert.match(button, /The download could not be recorded, so this project stays on Yet to Download\./);
});

// Visual Curation → Photo Selection: each selection item is its own submission. Retouches sent
// while Frames is still being picked puts the project on Yet to Download for Retouches alone, and
// Frames joins it only once it is sent itself - nothing waits for the whole shoot.
test("a category submitted on its own is listed on its own; the others join when they are sent", () => {
  const at = new Date("2026-10-20T07:00:00Z");
  const retouches = { id: "retouches", selectionSubmittedAt: "2026-10-20T06:45:46Z", selectedCount: 5 };
  const frames = { id: "frames", selectionSubmittedAt: null, selectedCount: 3 };
  const snapshot = { archivedAt: null, selectionProgress: "partiallyCompleted", publication: { status: "PUBLISHED" }, configs: [retouches, frames], photoCount: 10, selectedDownloadedAt: null };
  assert.equal(attentionFlagsOf(snapshot, at).readyToDownload, true, "Retouches alone puts the project on Yet to Download");
  assert.deepEqual(readyToDownloadConfigs(snapshot).map((config) => config.id), ["retouches"], "and only Retouches is behind it - Frames is not marked submitted by it");
  const both = { ...snapshot, configs: [retouches, { ...frames, selectionSubmittedAt: "2026-10-20T06:46:11Z" }] };
  assert.deepEqual(readyToDownloadConfigs(both).map((config) => config.id), ["retouches", "frames"]);
  // Downloaded after Retouches but before Frames: Frames alone is still to download.
  const downloadedBetween = { ...both, selectedDownloadedAt: "2026-10-20T06:46:00Z" };
  assert.deepEqual(readyToDownloadConfigs(downloadedBetween).map((config) => config.id), ["frames"]);
  assert.equal(attentionFlagsOf(downloadedBetween, at).readyToDownload, true);
});

/* ── Per item ── */

// A run stamps only the items it covered. Retouches copied out alone leaves Frames on Yet to
// Download and the project short of Downloaded; a later Frames run finishes it. The project's one
// stamp only moves once every submitted item is up to date, and still serves rows from before the
// items carried a stamp of their own.
test("downloading one deliverable clears only that deliverable", () => {
  const at = T(500);
  const retouches = { id: "retouches", name: "Retouches", selectionSubmittedAt: T(10), selectedDownloadedAt: T(20), selectedCount: 5 };
  const frames = { id: "frames", name: "Frames", selectionSubmittedAt: T(15), selectedDownloadedAt: null, selectedCount: 3 };
  const snapshot = { archivedAt: null, selectionProgress: "completed", publication: { status: "PUBLISHED", expiresAt: T(10_000) }, configs: [retouches, frames], photoCount: 10, selectedDownloadedAt: null };
  const flags = attentionFlagsOf(snapshot, at);
  assert.equal(flags.readyToDownload, true, "Frames is still to download");
  assert.equal(flags.downloaded, false, "not Downloaded while Frames is pending");
  assert.equal(flags.clientSubmitted, true);
  assert.deepEqual(readyToDownloadConfigs(snapshot).map((config) => config.id), ["frames"]);
  const { submittedItemsOf } = require("../src/modules/image-selection/dashboard/classify");
  assert.deepEqual(submittedItemsOf(snapshot).map((item) => [item.name, Boolean(item.downloadedAt)]), [["Retouches", true], ["Frames", false]], "Client Submitted keeps Retouches after its download");
  // Frames copied out: nothing left, and the project reads Downloaded.
  const done = { ...snapshot, configs: [retouches, { ...frames, selectedDownloadedAt: T(30) }], selectedDownloadedAt: T(30) };
  assert.equal(attentionFlagsOf(done, at).readyToDownload, false);
  assert.equal(attentionFlagsOf(done, at).downloaded, true);
  // Frames submitted again later: pending again, Retouches untouched.
  const again = { ...done, configs: [retouches, { ...frames, selectionSubmittedAt: T(40), selectedDownloadedAt: T(30) }] };
  assert.deepEqual(readyToDownloadConfigs(again).map((config) => config.id), ["frames"]);
  assert.equal(attentionFlagsOf(again, at).downloaded, false);
});

test("Client Submitted counts a project with any item submitted, while the stage still says Selecting", () => {
  const { selectionProgressOf, stageOf } = require("../src/modules/image-selection/dashboard/classify");
  const configs = [{ id: "retouches", selectionSubmittedAt: T(10), selectedCount: 5 }, { id: "frames", selectionSubmittedAt: null, selectedCount: 2 }];
  const selectionProgress = selectionProgressOf(true, configs, new Set(["frames"]));
  assert.equal(selectionProgress, "partiallyCompleted");
  assert.equal(stageOf({ archivedAt: null, selectionProgress }), "selecting", "the pill is honest about Frames");
  const flags = attentionFlagsOf({ archivedAt: null, selectionProgress, publication: { status: "PUBLISHED", expiresAt: T(10_000) }, configs, photoCount: 10, selectedDownloadedAt: null }, T(500));
  assert.equal(flags.clientSubmitted, true, "and the card counts the project");
  const nothingSent = attentionFlagsOf({ archivedAt: null, selectionProgress: "partiallyCompleted", publication: { status: "PUBLISHED", expiresAt: T(10_000) }, configs: configs.map((config) => ({ ...config, selectionSubmittedAt: null })), photoCount: 10, selectedDownloadedAt: null }, T(500));
  assert.equal(nothingSent.clientSubmitted, false);
});

test("a folder run stamps only the items that folder covered; a whole-project run every item", async () => {
  const repoPath = require.resolve("../src/modules/image-selection/gallery/repository");
  const servicePath = require.resolve("../src/modules/image-selection/gallery/service");
  const repository = require(repoPath);
  const calls = [];
  repository.folderSubtreeIds = async (_projectId, folderId) => (folderId === "shoot-1" ? ["shoot-1", "shoot-1-sub"] : null);
  repository.coveredDeliverableConfigIds = async (_projectId, folderIds) => { calls.push({ folderIds }); return ["retouches"]; };
  repository.markSelectedDownloaded = async (projectId, at, ids) => { calls.push({ projectId, ids }); return { found: true, selectedDownloadedAt: at }; };
  delete require.cache[servicePath];
  const service = require(servicePath);
  const folderRun = await service.markSelectedDownloaded("p1", new Date(Date.now() - 1000).toISOString(), "shoot-1");
  assert.deepEqual(folderRun.deliverableConfigIds, ["retouches"]);
  assert.deepEqual(calls, [{ folderIds: ["shoot-1", "shoot-1-sub"] }, { projectId: "p1", ids: ["retouches"] }]);
  calls.length = 0;
  const wholeRun = await service.markSelectedDownloaded("p1", new Date(Date.now() - 1000).toISOString());
  assert.equal(wholeRun.deliverableConfigIds, null);
  assert.deepEqual(calls, [{ projectId: "p1", ids: null }], "no folder: every submitted item");
  await assert.rejects(() => service.markSelectedDownloaded("p1", null, "nowhere"), { status: 404 });
  // The desktop copy hands its one deliverable through the same stamping.
  const originals = require("node:fs").readFileSync(require.resolve("../src/modules/image-selection/originals/service.js"), "utf8");
  assert.match(originals, /repo\.markSelectedDownloaded\(project\.id, selectionAsOf, deliverableConfigId \? \[deliverableConfigId\] : null\)/);
});
