const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * Resolve → unlock the upload → upload the corrected spreads → **only then** the next version.
 *
 * Two things went wrong here in turn, and these hold the shape of both fixes so neither can quietly
 * come back. First, resubmitting after fixes freshened the *reviewed* version's own page rows in
 * place: the earlier round's bytes survived in storage but nothing pointed at them, so the spreads
 * QC had actually reviewed could no longer be shown. Then, with that fixed, the freeze still hung
 * off the resubmit — so resolving the last correction and pressing Resubmit made a version out of
 * whatever happened to be in the album, and there was no step at which the corrected spreads were
 * actually uploaded.
 *
 * Four separate acts now: resolve a correction, upload the corrected spreads, create the version,
 * submit it. The upload is the only one that creates a version, for a QC round and a client round
 * alike, indefinitely. `album-proofs.test.js` drives the whole cycle against the fake repository.
 */

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", "src", "modules", "image-selection", "album-proofs", ...parts), "utf8");
const read2 = (name) => fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", "components", "image-selection", "album-proofing", name), "utf8");
const QC = read("qc.service.js");
const PIPELINE = read("pipeline.service.js");

test("the freeze is one routine, and only the revised upload reaches it", () => {
  // Two freezes would be two ideas of what a version is; the second would drift.
  assert.match(PIPELINE, /async function freezeNextVersion\(album, user, source = null\)/);
  assert.match(PIPELINE, /createRevisedVersion, submitFrozenVersion,/);
  // The first upload freezes V1; after that, only the revised upload creates a version.
  const freezes = [...PIPELINE.matchAll(/await freezeNextVersion\(album, user/g)];
  assert.equal(freezes.length, 2, "sendToQc's first send and createRevisedVersion are the only freezes");
  assert.doesNotMatch(QC, /freezeNextVersion/, "the QC service creates versions again");
  assert.doesNotMatch(read("finalize.service.js"), /freezeNextVersion/, "the client round creates versions of its own");
});

test("resolving a correction creates nothing — the upload does", () => {
  // The rule in one line: the only thing that turns a correction round into a version is the
  // corrected spreads landing. Resubmit sends the version that already exists.
  assert.match(PIPELINE, /async function createRevisedVersion\(albumId, user\)/);
  assert.match(PIPELINE, /await transition\(albumId, album\.status, "REVISION_READY_FOR_QC", \{ currentVersionId: frozen\.versionId \}\)/);
  assert.match(QC, /if \(album\.status !== "REVISION_READY_FOR_QC"\)/);
  assert.match(QC, /return pipeline\.submitFrozenVersion\(album, user/);
  // Submitting freezes nothing, so a double-click cannot manufacture a version.
  assert.match(PIPELINE, /if \(!version \|\| version\.status !== "FROZEN"\) throw httpError\(409/);
  // The in-place rewrite is gone: nothing in the QC service writes a page's frozen derivatives.
  assert.doesNotMatch(QC, /updateVersionPage/);
  // And a new version opens its own first round rather than incrementing the old version's.
  assert.match(PIPELINE, /roundNumber: 1, scope, submittedByUserId/);
});

test("both rounds take the same four acts, and the client's is not a second path", () => {
  // QC's round and the client's differ only in whose corrections gate them; the stage decides
  // that, so neither round can be gated by the other's corrections.
  const gate = read("revisionGate.js");
  assert.match(gate, /QC_REVISION_IN_PROGRESS: "QC"/);
  assert.match(gate, /REVISION_IN_PROGRESS: "CLIENT"/);
  assert.match(PIPELINE, /const source = ROUND_SOURCE\[album\.status\];/);
  // The client round runs the one revised-upload path rather than a copy of it.
  assert.match(read("finalize.service.js"), /await pipeline\.createRevisedVersion\(albumId, user\)/);
});

test("zero corrections never unlock the upload", () => {
  /*
   * Counting only what is unresolved makes "no corrections at all" look exactly like "every
   * correction resolved", which would offer a revised upload on an album nobody has corrected.
   */
  const gate = read("revisionGate.js");
  assert.match(gate, /if \(roundTotal === 0\) return \{ source, unlocked: false/);
  assert.match(gate, /if \(unresolved > 0\) return \{ source, unlocked: false/);
  const { revisedUploadGate } = require("../src/modules/image-selection/album-proofs/revisionGate");
  assert.equal(revisedUploadGate({ status: "QC_REVISION_IN_PROGRESS", roundTotal: 0, unresolved: 0 }).unlocked, false);
  assert.equal(revisedUploadGate({ status: "QC_REVISION_IN_PROGRESS", roundTotal: 3, unresolved: 1 }).unlocked, false);
  assert.equal(revisedUploadGate({ status: "QC_REVISION_IN_PROGRESS", roundTotal: 3, unresolved: 0 }).unlocked, true);
  // A reopened correction locks it again, and an album outside a fix round never unlocks at all.
  assert.equal(revisedUploadGate({ status: "REVISION_IN_PROGRESS", roundTotal: 2, unresolved: 1 }).unlocked, false);
  assert.equal(revisedUploadGate({ status: "QC_REVIEW", roundTotal: 3, unresolved: 0 }).unlocked, false);
});

test("a revised upload leaves the album in its round rather than reconciling it away", () => {
  /*
   * PROCESSING reconciles to READY_FOR_QC. That is right for a first upload and would carry a
   * revised one clean out of the round QC or the client is waiting on, losing the stage and
   * leaving the corrections gating a round the album was no longer in.
   */
  assert.match(PIPELINE, /if \(!REVISING_STATES\.includes\(album\.status\) && album\.status !== "PROCESSING"\) await transition/);
  assert.equal([...PIPELINE.matchAll(/!REVISING_STATES\.includes\(album\.status\) && album\.status !== "PROCESSING"/g)].length, 2, "import and the upload dock must both hold the round");
});

test("V1, V2, V3 are the client's versions; a QC pass never advances one", () => {
  /*
   * QC asking for corrections is a pass inside the version the client is waiting on. Numbering a
   * QC pass as a client version is what turned a four-pass V1 into a history reading V1, V1, V1,
   * V1 — and it also meant a client who had been sent V1 was told the next thing they saw was V3.
   */
  assert.match(PIPELINE, /async function nextFreezeTarget\(album, source\)/);
  assert.match(PIPELINE, /if \(source === "QC" && album\.currentVersionId\)/);
  assert.match(PIPELINE, /return \{ versionNumber: current\.versionNumber, iteration: \(await repo\.maxIteration\(album\.id, current\.versionNumber\)\) \+ 1 \};/);
  assert.match(PIPELINE, /return \{ versionNumber: \(await repo\.maxVersionNumber\(album\.id\)\) \+ 1, iteration: 1 \};/);
  // Each pass freezes under its own key, or the newer copy would land on the older one's pixels.
  assert.match(PIPELINE, /v\$\{versionNumber\}-\$\{iteration\}/);
  // And the history the studio reads collapses the passes back to one card per client version.
  assert.match(read("service.js"), /function clientVersions\(versions, album\)/);
  assert.match(read("service.js"), /seen\.iterations \+= 1;/);
  // Numbered after the sweep, never before it: a dead freeze's DRAFT still counts toward the
  // album's highest number until it is cleared, so reading first skipped a number on every retry.
  assert.ok(PIPELINE.indexOf("await repo.deleteDraftVersions(albumId") < PIPELINE.indexOf("await nextFreezeTarget(album, source)"));
  // A race loses on the unique, a stale DRAFT is swept, a live one refuses a second send.
  assert.match(PIPELINE, /error\?\.code === "P2002"/);
  assert.match(PIPELINE, /await repo\.deleteDraftVersions\(albumId/);
  assert.match(PIPELINE, /if \(await repo\.findDraftVersion\(albumId\)\) throw httpError\(409, ALREADY_SENDING\)/);
  // FROZEN is written only after every copy has landed, so an interrupted freeze leaves a DRAFT.
  assert.match(PIPELINE, /await repo\.updateVersion\(version\.id, \{ status: "FROZEN"/);
});

test("an outstanding correction blocks the upload, wherever it was raised", () => {
  /*
   * Counted per version, a correction reopened on an earlier version would block nothing at all -
   * Reopen would silently do nothing the moment a newer version existed. Every gate counts the
   * album's, so reopening one locks the next upload again at once.
   */
  const gates = [...QC.matchAll(/countCorrections\(albumId, \{ source: "QC", statuses: UNRESOLVED \}\)/g)];
  assert.equal(gates.length, 2, "approve and requestChanges each gate on the album");
  assert.match(PIPELINE, /repo\.countCorrections\(albumId, \{ source, statuses: UNRESOLVED_STATUSES \}\)/);
  assert.doesNotMatch(PIPELINE, /countCorrections\(albumId, \{ versionId: version\.id, source, statuses/);
});

test("the revised upload names the spreads that are holding it up", () => {
  // The freeze refuses outstanding processing too, but only by the numbers; these say which pages
  // and hand the failed ones back by name, which is what the designer's screen shows.
  assert.match(PIPELINE, /still regenerating\./);
  assert.match(PIPELINE, /failed to regenerate\./);
  assert.match(PIPELINE, /failedFiles: failed\.map\(\(page\) => page\.fileName\)/);
  // Asked before anything is frozen, so a failed upload leaves no half-made version behind.
  assert.ok(PIPELINE.indexOf("await assertReviewedPagesReady(album, version)") < PIPELINE.indexOf("const frozen = await freezeNextVersion(album, user)"));
});

test("the revision buttons are offered only once their corrections are resolved", () => {
  /*
   * Resolving a correction, uploading the corrected files and freezing the next version are three
   * separate acts. Offering the freeze while corrections are outstanding made a primary button that
   * could only fail - the backend refused it with a 409 - so both revision steps are now gated on
   * the album's own unresolved counts, which is the same thing the backend counts. The button is a
   * convenience; the service remains the authority.
   */
  const workspace = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", "components", "image-selection", "album-proofing", "AlbumProofWorkspace.js"), "utf8");
  assert.match(workspace, /const revisedUpload = album\.revisedUpload \|\| \{ unlocked: false, reason: "" \};/);
  assert.match(workspace, /disabled: !revisedUpload\.unlocked \|\| awaitingRevisedUpload/);
  // Upload and resubmit are never offered together: one belongs to the round, one to the version.
  assert.match(workspace, /if \(REVISING\.includes\(album\.status\)\) \{/);
  assert.match(workspace, /if \(album\.status === "REVISION_READY_FOR_QC"\) actions\.push\(\{ label: "Resubmit to QC"/);
  // And the version is created by the upload landing, not by the button.
  assert.match(workspace, /await createAlbumRevisedVersion\(albumId\);/);
  /*
   * Read from the upload store, never received from it. Its completion event fires once per batch,
   * only to whoever is subscribed at that instant, and is never replayed — so re-subscribing,
   * remounting or navigating away and back missed it and left the button waiting for ever. A
   * snapshot can be read again at any moment, so arriving late is the same as arriving on time.
   */
  assert.match(workspace, /useSyncExternalStore\(subscribeUploadStore, getUploadStoreSnapshot, getUploadStoreServerSnapshot\)/);
  assert.match(workspace, /session\.batchId !== ignoreBatchId/);
  assert.doesNotMatch(workspace, /awaitingRevisedUpload\) \{\s*try \{\s*await createAlbumRevisedVersion/);
  // A batch already finished in the dock belongs to an earlier upload: acting on it would freeze a
  // version out of the spreads already in the album, before a corrected one had arrived.
  assert.match(workspace, /setIgnoreBatchId\(uploads\.sessions\.find\(\(session\) => session\.key === sessionKey\)\?\.batchId \?\? null\);/);
  // The dock is closed through the fix stage: dropping a folder while corrections are outstanding
  // is not the next step, and the album already has spreads, so an upload there is a revision.
  assert.match(workspace, /revisedUploadOpen=\{awaitingRevisedUpload\}/);
  const pane = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", "components", "image-selection", "album-proofing", "AlbumPagesPane.js"), "utf8");
  assert.match(pane, /\(!FIXING\.includes\(album\.status\) \|\| revisedUploadOpen\)/);
  /*
   * The note that says where to upload belongs inside the pane. The tab's container is
   * `md:flex-row`, so a sibling beside the pane is not a banner above it — it is a second column
   * half the width of the tab, stretched to its full height.
   */
  assert.match(pane, /\{revisedUploadOpen && <p className="mb-4/);
  assert.doesNotMatch(workspace, /awaitingRevisedUpload && <p/);
  // And it names what the upload actually produces: a QC round adds a pass, it does not advance V.
  assert.match(pane, /const advancesVersion = album\.revisedUpload\?\.source === "CLIENT";/);
  assert.match(pane, /the next QC pass of V\$\{currentVersion\}/);
  // Regenerate Previews belongs to the fix stage, not to the dock, so closing one keeps the other.
  assert.ok(pane.indexOf("Regenerate Previews") > pane.indexOf("</section>}"), "Regenerate Previews is inside the dock that the fix stage closes");
  /*
   * And the renderer honours a disabled action, rather than only the older `phase` flag.
   *
   * `busy` is its own prop rather than a third term of `disabled`, which is a different statement
   * about the button: `phase` and `disabled` are steps this album cannot take, where `busy` is one
   * it is taking right now - so the button says so and a second press is told apart from a first
   * that appeared to do nothing. `Button` disables on either.
   */
  assert.match(workspace, /busy=\{busy\} disabled=\{Boolean\(action\.phase\) \|\| Boolean\(action\.disabled\)\}/);
});

test("a correction offers one next step, and the step is the status the server holds", () => {
  /*
   * Opening the spread and resolving are what the person doing the work does. Offering them on a
   * correction nobody had picked up let one be resolved by somebody who had never looked at it,
   * and made three buttons out of a row with one thing to do next.
   */
  const tab = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", "components", "image-selection", "album-proofing", "CorrectionsTab.js"), "utf8");
  assert.match(tab, /const notStarted = \(correction\) => \["OPEN", "REOPENED"\]\.includes\(correction\.status\);/);
  assert.match(tab, /workable && notStarted\(correction\) &&.*Start Fixes/s);
  assert.match(tab, /workable && correction\.status === "IN_PROGRESS" &&.*Resolve/s);
  /*
   * A row acts only once the round is open. `QC_CHANGES_REQUESTED` is corrections handed over and
   * not yet picked up: the next act is Start Fix Round, on the album, and a per-correction Start
   * Fixes beside it put two different acts under one label on one screen.
   */
  assert.match(tab, /const ROUND_STARTED_STATES = \["QC_REVISION_IN_PROGRESS", "REVISION_IN_PROGRESS"\];/);
  assert.match(tab, /const workable = canWrite && ROUND_STARTED_STATES\.includes\(album\.status\);/);
  assert.match(tab, /const roundPending = FIXING_STATES\.includes\(album\.status\) && !ROUND_STARTED_STATES\.includes\(album\.status\);/);
  /*
   * Looking is not acting. View Spread is withheld in exactly one case — the person who can work
   * this correction has not started it — and never from a reader or from someone browsing an
   * earlier version's corrections. Written as `A || <Button>` it did the opposite: `!workable`
   * made the expression true and the button rendered for nobody at all.
   */
  assert.match(tab, /const canViewSpread = \(correction\) => !roundPending && !\(workable && notStarted\(correction\)\);/);
  assert.match(tab, /\{canViewSpread\(correction\) && <Button/);
  // Read from the correction the API returned, so a reload or a second tab shows the same row.
  assert.doesNotMatch(tab, /useState\(\)?\s*\/\/ started/);
});

test("the counts the buttons read are the album's, matching the gates", () => {
  // Per version they would disagree with the backend the moment a correction was reopened on an
  // earlier one: the button would offer a freeze the service then refused.
  const repository = read("repository.js");
  assert.match(repository, /counts\.qcOpen \+= group\._count\._all; else counts\.clientOpen/);
  assert.match(repository, /\["OPEN", "IN_PROGRESS", "REOPENED"\]\.includes\(group\.status\)/);
  assert.match(read("service.js"), /corrections: counts,/);
  assert.match(read("service.js"), /revisedUpload: await revisedUploadState\(album, counts\),/);
});

test("a correction still says which version and spread it belongs to", () => {
  // With several versions alive, a correction that does not name its own is unreadable.
  const tab = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", "components", "image-selection", "album-proofing", "CorrectionsTab.js"), "utf8");
  assert.match(tab, /V\{group\.versionNumber\} · Spread \{String\(group\.pageNumber\)\.padStart\(2, "0"\)\}/);
  assert.match(tab, /\(b\.versionNumber - a\.versionNumber\) \|\| \(a\.pageNumber - b\.pageNumber\)/);
});

test("an earlier version's spreads can be looked at, and looking changes nothing", () => {
  /*
   * The API always served them; the Versions list said how many pages a version held and gave no
   * way to see them, which is what made earlier rounds feel lost. It opens the panel the album
   * already reviews in, so an old round shows its spreads AND what was marked on them — a
   * thumbnail grid stood here before and could show one without the other.
   *
   * The Corrections tab is where a round is worked and the Versions tab is where one is looked at,
   * so this entry is read-only. `reviewing` is the single gate every control in that panel reads —
   * marking, the pen, the correction menus, reopening, the ruling bar — so history mode has one
   * thing to do: make it false. Disabling controls one by one is what leaves one of them behind.
   */
  const panel = read2("QcReviewPanel.js");
  assert.match(panel, /const reviewing = Boolean\(!historyOnly && qcCanWrite && detail\?\.album\?\.status === "QC_REVIEW"\);/);
  assert.match(panel, /await getAlbumVersion\(album\.id, versionId\);/);
  assert.match(panel, /Version History · View only/);
  const workspace = read2("AlbumProofWorkspace.js");
  assert.match(workspace, /if \(historyVersion\) return <QcReviewPanel album=\{album\} qcCanWrite=\{false\} versionId=\{historyVersion\.id\} historyOnly onBack=/);
  assert.match(workspace, /<VersionSpreads version=\{version\} onOpen=\{setHistoryVersion\} \/>/);
  // The button asks the workspace to open it; it reaches no endpoint of its own.
  const entry = read2("VersionSpreads.js");
  assert.match(entry, /onClick=\{\(\) => onOpen\?\.\(version\)\}/);
  assert.doesNotMatch(entry, /apiRequest|album-proofs\.service/);
});
