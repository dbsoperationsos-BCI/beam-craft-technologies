const test = require("node:test");
const assert = require("node:assert/strict");
const { assertTransition, canTransition, allowedTransitions } = require("../src/modules/image-selection/album-proofs/state");
const { ALBUM_STATES, ALBUM_TRANSITIONS } = require("../src/modules/image-selection/album-proofs/constants");
const { createAlbumProofService } = require("../src/modules/image-selection/album-proofs/service");
const { createAlbumPipelineService, orderedSubtree, orderPages, countsOf, processingComplete, naturalCompare } = require("../src/modules/image-selection/album-proofs/pipeline.service");
const { createAlbumQcService } = require("../src/modules/image-selection/album-proofs/qc.service");
const { createAlbumClientService } = require("../src/modules/image-selection/album-proofs/client.service");
const { createAlbumFinalizeService } = require("../src/modules/image-selection/album-proofs/finalize.service");
const proofSecurity = require("../src/modules/image-selection/album-proofs/security");

process.env.JWT_SECRET = process.env.JWT_SECRET || "album-proofs-test-secret";

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------
test("every declared transition target is a real state", () => {
  for (const [from, targets] of Object.entries(ALBUM_TRANSITIONS)) {
    assert.ok(ALBUM_STATES.includes(from), `${from} is not a state`);
    for (const to of targets) assert.ok(ALBUM_STATES.includes(to), `${from} -> ${to}: unknown target`);
  }
});

test("the walk the business process takes is fully allowed", () => {
  const happyPath = [
    "DRAFT", "PROCESSING", "READY_FOR_QC", "QC_REVIEW", "QC_CHANGES_REQUESTED",
    "QC_REVISION_IN_PROGRESS", "QC_REVIEW", "QC_APPROVED", "CLIENT_REVIEW",
    "CLIENT_CHANGES_REQUESTED", "REVISION_IN_PROGRESS", "REVISION_READY_FOR_QC",
    "QC_REVIEW", "QC_APPROVED", "CLIENT_REVIEW", "CLIENT_APPROVED", "COMPLETED",
  ];
  for (let step = 1; step < happyPath.length; step += 1) {
    assert.ok(canTransition(happyPath[step - 1], happyPath[step]), `${happyPath[step - 1]} -> ${happyPath[step]} must be allowed`);
  }
});

test("impossible jumps are refused with a 409 that names both ends", () => {
  for (const [from, to] of [["DRAFT", "CLIENT_APPROVED"], ["DRAFT", "QC_APPROVED"], ["PROCESSING", "CLIENT_REVIEW"], ["QC_REVIEW", "COMPLETED"], ["CLIENT_REVIEW", "QC_REVIEW"], ["COMPLETED", "DRAFT"]]) {
    assert.throws(() => assertTransition(from, to), (error) => error.status === 409 && error.message.includes("cannot move"));
  }
  assert.throws(() => assertTransition("DRAFT", "NOT_A_STATE"), (error) => error.status === 400);
  assert.equal(assertTransition("DRAFT", "DRAFT"), false); // same-state is a no-op, not an error
  assert.deepEqual(allowedTransitions("QC_REVIEW").sort(), ["QC_APPROVED", "QC_CHANGES_REQUESTED"]);
});

// ---------------------------------------------------------------------------
// Album service on fakes
// ---------------------------------------------------------------------------
function fakeRepository() {
  let nextId = 1;
  const id = (prefix) => `${prefix}-${nextId++}`;
  const state = { albums: [], activities: [], versions: [], pages: [], versionPages: [], uploads: [], corrections: [], qcRounds: [], submissions: [], projectFolders: [] };
  const project = { id: "project-1", projectName: "Rahul & Priya", clientName: null, salesProject: { whatsappGroupName: "WED Rahul & Priya" } };
  const withProject = (album) => album && { ...album, project };
  const repo = {
    state,
    transaction: (callback) => callback(repo),
    findProject: async (projectId) => (projectId === "project-1" ? { id: projectId, projectName: project.projectName, clientName: null } : null),
    listAlbums: async ({ projectId, status, archived }) => state.albums
      .filter((album) => !album.deletedAt && (archived ? album.archivedAt : !album.archivedAt) && (!projectId || album.projectId === projectId) && (!status || album.status === status))
      .map((album) => ({ ...withProject(album), versions: [], _count: { corrections: 0 } })),
    findAlbum: async (albumId) => withProject(state.albums.find((album) => album.id === albumId && !album.deletedAt) || null),
    findAlbumByName: async (projectId, name, excludeId) => state.albums.find((album) => album.projectId === projectId && album.name === name && !album.deletedAt && album.id !== excludeId) || null,
    createAlbum: async (data) => { const album = { id: id("album"), status: "DRAFT", revisionsUsed: 0, archivedAt: null, deletedAt: null, currentVersionId: null, approvedVersionId: null, createdAt: new Date(), updatedAt: new Date(), ...data }; state.albums.push(album); return withProject(album); },
    updateAlbum: async (albumId, data) => { const album = state.albums.find((row) => row.id === albumId); Object.assign(album, data, { updatedAt: new Date() }); return withProject(album); },
    updateAlbumIfStatus: async (albumId, fromStatus, data) => { const album = state.albums.find((row) => row.id === albumId && row.status === fromStatus && !row.deletedAt); if (!album) return { count: 0 }; Object.assign(album, data); return { count: 1 }; },
    listProjectFolders: async () => state.projectFolders,
    listSubtreeUploads: async (projectId, folderIds) => state.uploads.filter((upload) => upload.projectId === projectId && folderIds.includes(upload.folderId)),
    resetFailedUploads: async (projectId, folderIds) => { for (const upload of state.uploads) if (folderIds.includes(upload.folderId) && upload.status === "PROCESSING_FAILED") { upload.status = "PROCESSING"; upload.processingError = null; } },
    listFailedUploadIds: async (projectId, folderIds) => state.uploads.filter((upload) => folderIds.includes(upload.folderId) && upload.status === "PROCESSING_FAILED").map((upload) => ({ id: upload.id, fileName: upload.fileName })),
    // Newest version first, and its newest QC pass first, exactly as the real ordering does — the
    // service takes the first row of each version number as the pass that stands.
    listVersions: async (albumId) => state.versions
      .filter((version) => version.albumId === albumId)
      .sort((a, b) => (b.versionNumber - a.versionNumber) || ((b.iteration ?? 1) - (a.iteration ?? 1)))
      .map((version) => ({ ...version, _count: { pages: state.versionPages.filter((page) => page.versionId === version.id).length } })),
    findVersion: async (albumId, versionId) => {
      const version = state.versions.find((row) => row.id === versionId && row.albumId === albumId);
      return version ? { ...version, _count: { pages: state.versionPages.filter((page) => page.versionId === versionId).length } } : null;
    },
    maxVersionNumber: async (albumId) => Math.max(0, ...state.versions.filter((version) => version.albumId === albumId).map((version) => version.versionNumber)),
    latestFrozenVersion: async (albumId) => state.versions.filter((version) => version.albumId === albumId && version.status === "FROZEN").sort((a, b) => (b.versionNumber - a.versionNumber) || ((b.iteration ?? 1) - (a.iteration ?? 1)))[0] || null,
    maxIteration: async (albumId, versionNumber) => Math.max(0, ...state.versions.filter((version) => version.albumId === albumId && version.versionNumber === versionNumber).map((version) => version.iteration ?? 1)),
    createVersion: async (data) => {
      // The (album, version number, iteration) unique, so a racing second send collides the way
      // Prisma reports it — and two QC passes of one version no longer collide at all.
      if (state.versions.some((version) => version.albumId === data.albumId && version.versionNumber === data.versionNumber && (version.iteration ?? 1) === (data.iteration ?? 1))) { const error = new Error("Unique constraint failed"); error.code = "P2002"; throw error; }
      const version = { id: id("version"), iteration: 1, status: "DRAFT", frozenAt: null, pageCount: 0, createdAt: new Date(), ...data }; state.versions.push(version); return version;
    },
    updateVersion: async (versionId, data) => { const version = state.versions.find((row) => row.id === versionId); Object.assign(version, data); return version; },
    findDraftVersion: async (albumId) => state.versions.find((version) => version.albumId === albumId && version.status === "DRAFT") || null,
    deleteDraftVersions: async (albumId, { createdBefore } = {}) => {
      const drafts = state.versions.filter((version) => version.albumId === albumId && version.status === "DRAFT" && (!createdBefore || version.createdAt < createdBefore));
      state.versions = state.versions.filter((version) => !drafts.includes(version));
      state.versionPages = state.versionPages.filter((page) => !drafts.some((draft) => draft.id === page.versionId));
      return drafts.length;
    },
    createVersionPages: async (rows) => { for (const row of rows) state.versionPages.push({ id: id("page"), previewKey: null, thumbnailKey: null, ...row }); },
    listVersionPages: async (versionId) => state.versionPages.filter((page) => page.versionId === versionId).sort((a, b) => a.pageNumber - b.pageNumber),
    updateVersionPage: async (pageId, data) => { const page = state.versionPages.find((row) => row.id === pageId); Object.assign(page, data); return { id: pageId }; },
    createQcRound: async (data) => { const round = { id: id("round"), decision: null, ...data }; state.qcRounds.push(round); return round; },
    findOpenQcRound: async (versionId) => state.qcRounds.find((round) => round.versionId === versionId && !round.decision) || null,
    updateQcRound: async (roundId, data) => { const round = state.qcRounds.find((row) => row.id === roundId); Object.assign(round, data); return round; },
    listQcRounds: async (versionId) => state.qcRounds.filter((round) => round.versionId === versionId),
    maxQcRoundNumber: async (versionId) => Math.max(0, ...state.qcRounds.filter((round) => round.versionId === versionId).map((round) => round.roundNumber)),
    createCorrection: async (data) => { const correction = { id: id("correction"), status: "OPEN", resolvedAt: null, resolutionNote: null, lockedAt: null, submissionId: null, createdAt: new Date(), updatedAt: new Date(), ...data }; state.corrections.push(correction); return correction; },
    findCorrection: async (albumId, correctionId) => state.corrections.find((correction) => correction.id === correctionId && correction.albumId === albumId) || null,
    updateCorrection: async (correctionId, data) => { const correction = state.corrections.find((row) => row.id === correctionId); Object.assign(correction, data, { updatedAt: new Date() }); return correction; },
    listCorrections: async (albumId, { versionId, source, status } = {}) => state.corrections
      .filter((correction) => correction.albumId === albumId && (!versionId || correction.versionId === versionId) && (!source || correction.source === source) && (!status || correction.status === status))
      .map((correction) => ({ ...correction, version: { versionNumber: state.versions.find((version) => version.id === correction.versionId)?.versionNumber }, versionPage: { pageNumber: state.versionPages.find((page) => page.id === correction.versionPageId)?.pageNumber, fileName: "x.jpg" } })),
    countCorrections: async (albumId, { versionId, source, statuses } = {}) => state.corrections
      .filter((correction) => correction.albumId === albumId && (!versionId || correction.versionId === versionId) && (!source || correction.source === source) && (!statuses || statuses.includes(correction.status))).length,
    listUploadsByIds: async (projectId, ids) => state.uploads.filter((upload) => upload.projectId === projectId && ids.includes(upload.id)),
    resetUploadsForReprocess: async (ids) => { for (const upload of state.uploads) if (ids.includes(upload.id)) { upload.status = "PROCESSING"; upload.processingError = null; } },
    createPublication: async (data) => {
      state.publications = state.publications || [];
      // The unique index on the short code, so the allocator's retry is exercised rather than assumed.
      if (data.shortCode && state.publications.some((row) => row.shortCode === data.shortCode)) { const error = new Error("Unique constraint"); error.code = "P2002"; throw error; }
      const publication = { id: id("publication"), shortCode: null, revokedAt: null, lastAccessAt: null, accessCount: 0, publishedAt: new Date(), ...data };
      state.publications.push(publication);
      return publication;
    },
    // Mirrors the real select, which leaves the short code out: the link is a credential, and
    // reading the card is a READ-guarded action while being handed the link is not.
    latestPublication: async (albumId) => {
      const publication = (state.publications || []).filter((row) => row.albumId === albumId).sort((a, b) => b.publishedAt - a.publishedAt)[0];
      if (!publication) return null;
      const { shortCode, tokenHash, tokenCipher, pinHash, pinCipher, ...safe } = publication;
      return safe;
    },
    revokeActivePublications: async (albumId) => { for (const publication of state.publications || []) if (publication.albumId === albumId && !publication.revokedAt) publication.revokedAt = new Date(); },
    findPublicationByTokenHash: async (tokenHash) => {
      const publication = (state.publications || []).find((row) => row.tokenHash === tokenHash);
      if (!publication) return null;
      const album = state.albums.find((row) => row.id === publication.albumId);
      const version = state.versions.find((row) => row.id === publication.versionId);
      return { ...publication, album: album && { ...album, project: { id: "project-1", projectName: "Rahul & Priya", clientName: null, salesProject: { whatsappGroupName: "WED Rahul & Priya" } } }, version };
    },
    findPublicationByShortCode: async (shortCode) => {
      const publication = (state.publications || []).find((row) => row.shortCode === shortCode);
      if (!publication) return null;
      const album = state.albums.find((row) => row.id === publication.albumId);
      const version = state.versions.find((row) => row.id === publication.versionId);
      return { ...publication, album: album && { ...album, project: { id: "project-1", projectName: "Rahul & Priya", clientName: null, salesProject: { whatsappGroupName: "WED Rahul & Priya" } } }, version };
    },
    updatePublication: async (publicationId, data) => {
      const publication = (state.publications || []).find((row) => row.id === publicationId);
      if (!publication) { const error = new Error("Record not found"); error.code = "P2025"; throw error; }
      Object.assign(publication, data);
      const { shortCode, tokenHash, tokenCipher, pinHash, pinCipher, ...safe } = publication;
      return safe;
    },
    readPublicationPin: async (publicationId) => (state.publications || []).find((row) => row.id === publicationId) || null,
    readPublicationCredentials: async (albumId) => (state.publications || []).find((publication) => publication.albumId === albumId && !publication.revokedAt) || null,
    recordPublicationAccess: async (publicationId) => { const publication = (state.publications || []).find((row) => row.id === publicationId); publication.lastAccessAt = new Date(); publication.accessCount += 1; return publication; },
    createSubmission: async (data) => {
      state.submissions = state.submissions || [];
      if (state.submissions.some((submission) => submission.versionId === data.versionId && submission.type === data.type)) { const error = new Error("Unique constraint"); error.code = "P2002"; throw error; }
      const submission = { id: id("submission"), submittedAt: new Date(), correctionCount: 0, ...data };
      state.submissions.push(submission);
      return submission;
    },
    findSubmission: async (versionId, type) => (state.submissions || []).find((submission) => submission.versionId === versionId && submission.type === type) || null,
    listSubmissions: async (albumId) => (state.submissions || []).filter((submission) => submission.albumId === albumId),
    deleteCorrection: async (correctionId) => { state.corrections = state.corrections.filter((correction) => correction.id !== correctionId); return { id: correctionId }; },
    lockQcCorrections: async (versionId) => { for (const correction of state.corrections) if (correction.versionId === versionId && correction.source === "QC" && !correction.lockedAt) correction.lockedAt = new Date(); return { count: 0 }; },
    lockClientCorrections: async (versionId, submissionId) => { for (const correction of state.corrections) if (correction.versionId === versionId && correction.source === "CLIENT" && !correction.lockedAt) { correction.lockedAt = new Date(); correction.submissionId = submissionId; } },
    listVersionPageKeys: async (albumId) => state.pages.filter((page) => page.albumId === albumId),
    // Mirrors the real groupBy. It used to answer zero to everything, which no test noticed until
    // the revised-upload gate started reading it — and a gate fed zeros is a gate that is always open.
    correctionCounts: async (albumId) => {
      const rows = state.corrections.filter((row) => row.albumId === albumId);
      const unresolved = rows.filter((row) => ["OPEN", "IN_PROGRESS", "REOPENED"].includes(row.status));
      return {
        qcOpen: unresolved.filter((row) => row.source === "QC").length,
        clientOpen: unresolved.filter((row) => row.source !== "QC").length,
        total: rows.length,
      };
    },
    deletionImpact: async (albumId) => ({
      qcRoundCount: state.qcRounds.filter((round) => round.albumId === albumId).length,
      submissionCount: state.submissions.filter((submission) => submission.albumId === albumId).length,
      correctionCount: state.corrections.filter((correction) => correction.albumId === albumId).length,
      clientApproved: Boolean(state.albums.find((album) => album.id === albumId)?.approvedVersionId),
    }),
    recordActivity: async (data) => { state.activities.push(data); return { id: "activity" }; },
    listActivity: async ({ albumId, limit }) => state.activities.filter((row) => !albumId || row.albumId === albumId).slice(0, limit).map((row) => ({ ...row, id: "a", createdAt: new Date(), album: { name: "Main Album", project: { projectName: project.projectName } } })),
  };
  return repo;
}

function fakeFolders(repo) {
  let nextId = 1;
  const calls = { removed: [] };
  return {
    calls,
    create: async (projectId, { name, parentId = null }) => {
      const folder = { id: `folder-${nextId++}`, projectId, parentId, name };
      repo.state.projectFolders.push(folder);
      return folder;
    },
    rename: async (projectId, folderId, { name }) => ({ id: folderId, name }),
    remove: async (projectId, folderId) => { calls.removed.push(folderId); },
    list: async () => ({ folders: [] }),
  };
}
const fakeObjects = () => ({ deleted: [], deleteObjects(keys) { this.deleted.push(...keys); return Promise.resolve(); } });
const user = { id: 7, name: "Studio Admin" };

test("an album is created against an existing project, with a root folder and platform defaults", async () => {
  const repo = fakeRepository();
  const service = createAlbumProofService(repo, { folders: fakeFolders(repo), objects: fakeObjects() });
  const album = await service.create({ projectId: "project-1", name: "Main Wedding Album" }, user);
  assert.equal(album.status, "DRAFT");
  assert.equal(album.revisionLimit, 3);
  assert.equal(album.proofExpiryDays, 30);
  assert.equal(album.viewerMode, "SPREAD");
  assert.equal(album.rootFolderId, "folder-1");
  assert.equal(album.clientName, "WED Rahul & Priya"); // read through the project, never duplicated
  assert.deepEqual(album.allowedTransitions.sort(), ["ARCHIVED", "PROCESSING", "READY_FOR_QC"]);
  await assert.rejects(service.create({ projectId: "project-1", name: "Main Wedding Album" }, user), (error) => error.status === 409);
  await assert.rejects(service.create({ projectId: "project-404", name: "X" }, user), (error) => error.status === 404);
  assert.ok(repo.state.activities.some((row) => row.event === "ALBUM_CREATED"));
});

test("album folders live strictly inside the album's own subtree", async () => {
  const repo = fakeRepository();
  const folders = fakeFolders(repo);
  const service = createAlbumProofService(repo, { folders, objects: fakeObjects() });
  const album = await service.create({ projectId: "project-1", name: "Main Album" }, user);
  const wedding = await service.createFolder(album.id, { name: "Wedding" }, user);
  assert.equal(wedding.parentId, album.rootFolderId);
  const inner = await service.createFolder(album.id, { name: "Outdoor", parentId: wedding.id }, user);
  assert.equal(inner.parentId, wedding.id);
  // A folder outside the subtree — another album's, another project's — does not exist here.
  repo.state.projectFolders.push({ id: "foreign", projectId: "project-1", parentId: null, name: "Elsewhere" });
  await assert.rejects(service.createFolder(album.id, { name: "X", parentId: "foreign" }, user), (error) => error.status === 404);
  await assert.rejects(service.renameFolder(album.id, "foreign", { name: "X" }, user), (error) => error.status === 404);
  // The root folder is managed with the album itself, not through folder actions.
  await assert.rejects(service.removeFolder(album.id, album.rootFolderId, {}, user), (error) => error.status === 409);
});

test("deleting an album with QC or client history demands acknowledgement and never touches originals", async () => {
  const repo = fakeRepository();
  const folders = fakeFolders(repo);
  const objects = fakeObjects();
  const service = createAlbumProofService(repo, { folders, objects });
  const album = await service.create({ projectId: "project-1", name: "Main Album" }, user);
  repo.state.qcRounds.push({ albumId: album.id });
  repo.state.pages.push({ albumId: album.id, previewKey: "image-selection/album-proofs/p/a/v1/spread-1.jpg", thumbnailKey: null });
  await assert.rejects(service.remove(album.id, {}, user), (error) => error.status === 409 && error.details.requiresAcknowledgement);
  await service.remove(album.id, { acknowledge: true }, user);
  assert.ok(repo.state.albums[0].deletedAt);
  assert.deepEqual(folders.calls.removed, [album.rootFolderId]); // uploads/derivatives purge via the folders module
  assert.deepEqual(objects.deleted, ["image-selection/album-proofs/p/a/v1/spread-1.jpg"]); // frozen copies only — never an originalPath
});

test("archive blocks edits until restored", async () => {
  const repo = fakeRepository();
  const service = createAlbumProofService(repo, { folders: fakeFolders(repo), objects: fakeObjects() });
  const album = await service.create({ projectId: "project-1", name: "Main Album" }, user);
  await service.archive(album.id, user);
  await assert.rejects(service.edit(album.id, { name: "Renamed" }, user), (error) => error.status === 409);
  await service.restore(album.id, user);
  const renamed = await service.edit(album.id, { name: "Renamed" }, user);
  assert.equal(renamed.name, "Renamed");
});

// ---------------------------------------------------------------------------
// Pipeline: import, processing gate, immutable versions
// ---------------------------------------------------------------------------
function pipelineFixture() {
  const repo = fakeRepository();
  const folders = fakeFolders(repo);
  const objects = { copied: [], isConfigured: () => true, publicUrl: (key) => (key ? `https://cdn/${key}` : null), copyObject(source, destination) { this.copied.push([source, destination]); return Promise.resolve(destination); }, deleteObjects: async () => {} };
  const queue = { enqueued: [], enqueue(uploadId) { this.enqueued.push(uploadId); return Promise.resolve(); } };
  let registerResult = { claimed: [], skipped: [] };
  const originals = {
    browse: async (relativePath) => ({ path: relativePath, directories: [], files: [] }),
    register: async (projectId, { folderId }) => { for (const upload of registerResult.claimed) repo.state.uploads.push({ projectId, folderId, status: "PROCESSING", processingError: null, ...upload }); return { registered: registerResult.claimed.length, skipped: registerResult.skipped }; },
    setNext(claimed, skipped = []) { registerResult = { claimed, skipped }; },
  };
  const base = createAlbumProofService(repo, { folders, objects });
  const pipeline = createAlbumPipelineService(repo, { base, originals, queue, objects });
  return { repo, folders, objects, queue, originals, base, pipeline };
}
const albumOf = (repo) => repo.state.albums[0];

test("pages order naturally across the folder walk: 002 before 010, Wedding before Reception", () => {
  assert.ok(naturalCompare("002.jpg", "010.jpg") < 0);
  assert.ok(naturalCompare("IMG_9.jpg", "IMG_10.jpg") < 0);
  const folders = [
    { id: "root", parentId: null, name: "Album", sortOrder: 0 },
    { id: "reception", parentId: "root", name: "Reception", sortOrder: 2 },
    { id: "wedding", parentId: "root", name: "Wedding", sortOrder: 1 },
    { id: "outdoor", parentId: "wedding", name: "Outdoor", sortOrder: 1 },
  ];
  const { ordered } = orderedSubtree(folders, "root");
  assert.deepEqual(ordered, ["root", "wedding", "outdoor", "reception"]);
  const pages = orderPages([
    { folderId: "reception", fileName: "001.jpg" },
    { folderId: "wedding", fileName: "010.jpg" },
    { folderId: "wedding", fileName: "002.jpg" },
  ], ordered);
  assert.deepEqual(pages.map((page) => `${page.folderId}/${page.fileName}`), ["wedding/002.jpg", "wedding/010.jpg", "reception/001.jpg"]);
});

test("the processing gate: complete means every page READY and nothing failed, pending or running", () => {
  assert.equal(processingComplete(countsOf([{ status: "READY" }, { status: "READY" }])), true);
  assert.equal(processingComplete(countsOf([])), false);
  assert.equal(processingComplete(countsOf([{ status: "READY" }, { status: "PROCESSING_FAILED" }])), false);
  assert.equal(processingComplete(countsOf([{ status: "READY" }, { status: "PROCESSING" }])), false);
  assert.equal(processingComplete(countsOf([{ status: "READY" }, { status: "PENDING" }])), false);
});

test("import registers paths only, moves the album to PROCESSING, and refuses impossible states", async () => {
  const { repo, base, pipeline, originals } = pipelineFixture();
  const album = await base.create({ projectId: "project-1", name: "Main Album" }, user);
  originals.setNext([{ id: "upload-1", fileName: "001.jpg", originalPath: "D:\\DBS\\Album\\001.jpg", sizeBytes: 1n, width: null, height: null, thumbnailKey: null, previewKey: null, processingCompletedAt: null }]);
  const result = await pipeline.importPages(album.id, { relativePath: "RahulPriya/Album" }, user);
  assert.equal(result.registered, 1);
  assert.equal(albumOf(repo).status, "PROCESSING");
  assert.ok(repo.state.activities.some((row) => row.event === "PAGES_IMPORTED"));
  // No byte-like fields anywhere near the row: the path IS the original.
  assert.ok(!("data" in repo.state.uploads[0]) && !("bytes" in repo.state.uploads[0]));
  // A completed album refuses import.
  albumOf(repo).status = "COMPLETED";
  await assert.rejects(pipeline.importPages(album.id, {}, user), (error) => error.status === 409);
});

test("pages from the upload dock: the album records the import, moves to PROCESSING and reconciles straight to READY_FOR_QC", async () => {
  const { repo, base, pipeline } = pipelineFixture();
  const album = await base.create({ projectId: "project-1", name: "Main Album" }, user);
  // Nothing has landed yet — there is nothing to move on.
  await assert.rejects(pipeline.pagesUploaded(album.id, {}, user), (error) => error.status === 409);
  // The derivatives endpoint finished this row on arrival; its path is the browser-reported trail.
  repo.state.uploads.push({ id: "upload-1", projectId: "project-1", folderId: album.rootFolderId, fileName: "001.jpg", originalPath: "Main Album/001.jpg", status: "READY", processingError: null, thumbnailKey: "t1", previewKey: "p1", processingCompletedAt: new Date() });
  await assert.rejects(pipeline.pagesUploaded(album.id, { folderId: "not-in-this-album" }, user), (error) => error.status === 404);
  const status = await pipeline.pagesUploaded(album.id, {}, user);
  assert.equal(status.status, "READY_FOR_QC");
  assert.equal(albumOf(repo).status, "READY_FOR_QC");
  assert.ok(repo.state.activities.some((row) => row.event === "PAGES_IMPORTED" && /upload/.test(row.detail)));
  assert.ok(repo.state.activities.some((row) => row.event === "PROCESSING_COMPLETED"));
  albumOf(repo).status = "COMPLETED";
  await assert.rejects(pipeline.pagesUploaded(album.id, {}, user), (error) => error.status === 409);
});

test("a DRAFT album whose dock pages have all landed moves on by itself when its status is read", async () => {
  const { repo, base, pipeline } = pipelineFixture();
  const album = await base.create({ projectId: "project-1", name: "Main Album" }, user);
  // No pages: DRAFT stays DRAFT.
  assert.equal((await pipeline.processingStatus(album.id)).status, "DRAFT");
  repo.state.uploads.push({ id: "upload-1", projectId: "project-1", folderId: album.rootFolderId, fileName: "001.jpg", originalPath: "Main Album/001.jpg", status: "READY", processingError: null, thumbnailKey: "t1", previewKey: "p1", processingCompletedAt: new Date() });
  const status = await pipeline.processingStatus(album.id);
  assert.equal(status.status, "READY_FOR_QC");
  assert.ok(repo.state.activities.some((row) => row.event === "PROCESSING_COMPLETED" && row.actorType === "SYSTEM"));
});

test("processing status reconciles the album: all READY becomes READY_FOR_QC, a failure becomes PROCESSING_FAILED, retry re-queues", async () => {
  const { repo, base, pipeline, queue, originals } = pipelineFixture();
  const album = await base.create({ projectId: "project-1", name: "Main Album" }, user);
  originals.setNext([
    { id: "upload-1", fileName: "001.jpg", originalPath: "D:\\A\\001.jpg", processingCompletedAt: null, thumbnailKey: null, previewKey: null },
    { id: "upload-2", fileName: "002.jpg", originalPath: "D:\\A\\002.jpg", processingCompletedAt: null, thumbnailKey: null, previewKey: null },
  ]);
  await pipeline.importPages(album.id, {}, user);
  repo.state.uploads[0].status = "READY";
  let status = await pipeline.processingStatus(album.id);
  assert.equal(status.status, "PROCESSING"); // one still running
  repo.state.uploads[1].status = "PROCESSING_FAILED"; repo.state.uploads[1].processingError = "corrupt file";
  status = await pipeline.processingStatus(album.id);
  assert.equal(status.status, "PROCESSING_FAILED");
  assert.deepEqual(status.failedFiles.map((file) => file.fileName), ["002.jpg"]);
  // Send to QC is refused while a failure stands — backend-side, not just a disabled button.
  await assert.rejects(pipeline.sendToQc(album.id, user), (error) => error.status === 409);
  const retried = await pipeline.retryFailed(album.id, user);
  assert.equal(retried.retried, 1);
  assert.deepEqual(queue.enqueued, ["upload-2"]);
  assert.equal(albumOf(repo).status, "PROCESSING");
  repo.state.uploads[1].status = "READY";
  status = await pipeline.processingStatus(album.id);
  assert.equal(status.status, "READY_FOR_QC");
});

test("a send while another freeze is still running is refused; a draft left by a dead freeze is swept and the send goes through", async () => {
  const { repo, base, pipeline } = pipelineFixture();
  const album = await base.create({ projectId: "project-1", name: "Main Album" }, user);
  repo.state.uploads.push({ id: "upload-1", projectId: "project-1", folderId: album.rootFolderId, fileName: "001.jpg", originalPath: "D:\\A\\001.jpg", status: "READY", sizeBytes: 1n, width: 10, height: 5, thumbnailKey: "live/t1", previewKey: "live/p1", processingCompletedAt: new Date() });
  albumOf(repo).status = "READY_FOR_QC";
  // Another request began freezing V1 a moment ago and is still copying pages.
  repo.state.versions.push({ id: "in-flight", albumId: album.id, versionNumber: 1, status: "DRAFT", createdAt: new Date(), frozenAt: null, pageCount: 0 });
  await assert.rejects(pipeline.sendToQc(album.id, user), (error) => error.status === 409 && /already being sent/.test(error.message));
  // The running freeze was left exactly as it was — not deleted from under the other request.
  assert.ok(repo.state.versions.some((version) => version.id === "in-flight"));
  // The same draft an hour old is a freeze that died: swept, and this send freezes V1 itself.
  repo.state.versions.find((version) => version.id === "in-flight").createdAt = new Date(Date.now() - 60 * 60 * 1000);
  const result = await pipeline.sendToQc(album.id, user);
  assert.equal(result.versionNumber, 1);
  assert.ok(!repo.state.versions.some((version) => version.id === "in-flight"));
  assert.equal(albumOf(repo).currentVersionId, result.versionId);
});

test("two sends racing past the draft check collide on the version number: the loser is told, nothing is frozen twice", async () => {
  const { repo, base, pipeline } = pipelineFixture();
  const album = await base.create({ projectId: "project-1", name: "Main Album" }, user);
  repo.state.uploads.push({ id: "upload-1", projectId: "project-1", folderId: album.rootFolderId, fileName: "001.jpg", originalPath: "D:\\A\\001.jpg", status: "READY", sizeBytes: 1n, width: 10, height: 5, thumbnailKey: "live/t1", previewKey: "live/p1", processingCompletedAt: new Date() });
  albumOf(repo).status = "READY_FOR_QC";
  // Both sends read "no versions yet"; the other one creates V1 before this one can.
  const originalMax = repo.maxVersionNumber;
  repo.maxVersionNumber = async (albumId) => { const max = await originalMax(albumId); repo.state.versions.push({ id: "winner", albumId, versionNumber: max + 1, status: "DRAFT", createdAt: new Date(), frozenAt: null, pageCount: 0 }); repo.maxVersionNumber = originalMax; return max; };
  await assert.rejects(pipeline.sendToQc(album.id, user), (error) => error.status === 409 && /already being sent/.test(error.message));
  assert.deepEqual(repo.state.versions.map((version) => version.id), ["winner"]);
  assert.equal(albumOf(repo).status, "READY_FOR_QC");
});

test("send to QC freezes an immutable V1: numbered pages in reading order, version-scoped derivative copies, QC round 1", async () => {
  const { repo, base, pipeline, objects } = pipelineFixture();
  const album = await base.create({ projectId: "project-1", name: "Main Album" }, user);
  const wedding = await base.createFolder(album.id, { name: "Wedding" }, user);
  repo.state.uploads.push(
    { id: "upload-b", projectId: "project-1", folderId: wedding.id, fileName: "010.jpg", originalPath: "D:\\A\\010.jpg", status: "READY", sizeBytes: 2n, width: 100, height: 50, thumbnailKey: "live/t10", previewKey: "live/p10", processingCompletedAt: new Date(), processingError: null },
    { id: "upload-a", projectId: "project-1", folderId: wedding.id, fileName: "002.jpg", originalPath: "D:\\A\\002.jpg", status: "READY", sizeBytes: 1n, width: 100, height: 50, thumbnailKey: "live/t2", previewKey: "live/p2", processingCompletedAt: new Date(), processingError: null },
  );
  albumOf(repo).status = "READY_FOR_QC";
  const result = await pipeline.sendToQc(album.id, user);
  assert.equal(result.versionNumber, 1);
  assert.equal(result.pageCount, 2);
  assert.equal(albumOf(repo).status, "QC_REVIEW");
  assert.equal(albumOf(repo).currentVersionId, result.versionId);
  const pages = repo.state.versionPages;
  assert.deepEqual(pages.map((page) => [page.pageNumber, page.fileName]), [[1, "002.jpg"], [2, "010.jpg"]]); // natural order
  assert.ok(pages.every((page) => page.originalPath.startsWith("D:\\A\\"))); // path only, never bytes
  assert.ok(pages.every((page) => page.previewKey.includes("/v1-1/preview/"))); // frozen copies, not live keys
  assert.equal(repo.state.versions[0].iteration, 1); // the first pass of the client's first version
  assert.equal(objects.copied.length, 4); // 2 previews + 2 thumbnails
  assert.equal(repo.state.qcRounds.length, 1);
  assert.equal(repo.state.qcRounds[0].roundNumber, 1);
  // A double-click cannot send twice or mint a second version: the album already moved on.
  await assert.rejects(pipeline.sendToQc(album.id, user), (error) => error.status === 409);
  assert.equal(repo.state.versions.length, 1);
});

test("the next QC pass inherits, marks only changed pages, and leaves the pass before it untouched", async () => {
  const { repo, base, pipeline } = pipelineFixture();
  const album = await base.create({ projectId: "project-1", name: "Main Album" }, user);
  const frozenAt = new Date(Date.now() - 60_000);
  repo.state.versions.push({ id: "v1", albumId: album.id, versionNumber: 1, status: "FROZEN", frozenAt, pageCount: 2 });
  repo.state.versionPages.push(
    { id: "v1-p1", versionId: "v1", pageNumber: 1, fileName: "001.jpg", originalPath: "d:\\a\\001.jpg", previewKey: "old/v1/p1", thumbnailKey: null },
    { id: "v1-p2", versionId: "v1", pageNumber: 2, fileName: "002.jpg", originalPath: "d:\\a\\002.jpg", previewKey: "old/v1/p2", thumbnailKey: null },
  );
  repo.state.uploads.push(
    // 001 untouched since the freeze; 002 re-derived after it (the designer fixed the file); 003 is new.
    { id: "upload-1", projectId: "project-1", folderId: album.rootFolderId, fileName: "001.jpg", originalPath: "D:\\A\\001.jpg", status: "READY", processingCompletedAt: new Date(frozenAt.getTime() - 1000), thumbnailKey: "live/t1", previewKey: "live/p1", processingError: null },
    { id: "upload-2", projectId: "project-1", folderId: album.rootFolderId, fileName: "002.jpg", originalPath: "D:\\A\\002.jpg", status: "READY", processingCompletedAt: new Date(), thumbnailKey: "live/t2", previewKey: "live/p2", processingError: null },
    { id: "upload-3", projectId: "project-1", folderId: album.rootFolderId, fileName: "003.jpg", originalPath: "D:\\A\\003.jpg", status: "READY", processingCompletedAt: new Date(), thumbnailKey: "live/t3", previewKey: "live/p3", processingError: null },
  );
  // The album is mid QC-fix round with its one correction resolved, which is the only state from
  // which corrected spreads become a version.
  albumOf(repo).status = "QC_REVISION_IN_PROGRESS";
  albumOf(repo).currentVersionId = "v1";
  repo.state.corrections.push({ id: "c1", albumId: album.id, versionId: "v1", versionPageId: "v1-p1", source: "QC", status: "RESOLVED" });
  const result = await pipeline.createRevisedVersion(album.id, user);
  // QC's round does not advance the client's version: still V1, and its second pass.
  assert.equal(result.versionNumber, 1);
  assert.equal(result.iteration, 2);
  assert.equal(albumOf(repo).status, "REVISION_READY_FOR_QC");
  const nextPages = repo.state.versionPages.filter((page) => page.versionId === result.versionId);
  assert.deepEqual(nextPages.map((page) => [page.fileName, page.changedFromPrevious]), [["001.jpg", false], ["002.jpg", true], ["003.jpg", true]]);
  // The pass before it is byte-for-byte what it was — what QC reviewed is still there to look at.
  const v1Pages = repo.state.versionPages.filter((page) => page.versionId === "v1");
  assert.deepEqual(v1Pages.map((page) => page.previewKey), ["old/v1/p1", "old/v1/p2"]);
  assert.equal(repo.state.versions.find((version) => version.id === "v1").status, "FROZEN");
  // Its own keys, so one pass can never copy over the other's pixels.
  assert.ok(nextPages.every((page) => page.previewKey.includes("/v1-2/")));
});

// ---------------------------------------------------------------------------
// QC workflow and the correction engine
// ---------------------------------------------------------------------------
async function qcFixture() {
  const fixture = pipelineFixture();
  const { repo, base, pipeline, objects, queue } = fixture;
  const qcService = createAlbumQcService(repo, { base, objects, queue });
  const album = await base.create({ projectId: "project-1", name: "Main Album" }, user);
  repo.state.uploads.push(
    { id: "upload-1", projectId: "project-1", folderId: album.rootFolderId, fileName: "001.jpg", originalPath: "D:\\A\\001.jpg", status: "READY", thumbnailKey: "live/t1", previewKey: "live/p1", processingCompletedAt: new Date(Date.now() - 5000), processingError: null },
    { id: "upload-2", projectId: "project-1", folderId: album.rootFolderId, fileName: "002.jpg", originalPath: "D:\\A\\002.jpg", status: "READY", thumbnailKey: "live/t2", previewKey: "live/p2", processingCompletedAt: new Date(Date.now() - 5000), processingError: null },
  );
  albumOf(repo).status = "READY_FOR_QC";
  await pipeline.sendToQc(album.id, user);
  return { ...fixture, qcService, album };
}
const qcLead = { id: 9, name: "QC Lead" };

test("QC pins corrections at normalized coordinates on the version under review, and only there", async () => {
  const { repo, qcService, album } = await qcFixture();
  const page = repo.state.versionPages[0];
  const correction = await qcService.addQcCorrection(album.id, { versionPageId: page.id, x: 0.62, y: 0.31, comment: "Skin tone is too warm." }, qcLead);
  assert.equal(correction.source, "QC");
  assert.equal(correction.xNormalized, 0.62);
  assert.equal(correction.pageNumber, page.pageNumber);
  await assert.rejects(qcService.addQcCorrection(album.id, { versionPageId: "not-a-page", x: 0.5, y: 0.5, comment: "x" }, qcLead), (error) => error.status === 404);
  // Once QC has ruled, pinning is over.
  albumOf(repo).status = "QC_APPROVED";
  await assert.rejects(qcService.addQcCorrection(album.id, { versionPageId: page.id, x: 0.1, y: 0.1, comment: "late" }, qcLead), (error) => error.status === 409);
});

test("QC corrections are drafts until the ruling: edit and remove freely, then locked by request-changes", async () => {
  const { repo, qcService, album } = await qcFixture();
  const page = repo.state.versionPages[0];
  const first = await qcService.addQcCorrection(album.id, { versionPageId: page.id, x: 0.2, y: 0.2, comment: "Too warm." }, qcLead);
  const second = await qcService.addQcCorrection(album.id, { versionPageId: page.id, x: 0.8, y: 0.8, comment: "Crooked." }, qcLead);
  const edited = await qcService.editQcCorrection(album.id, first.id, { comment: "Skin tone is too warm.", x: 0.25 }, qcLead);
  assert.equal(edited.comment, "Skin tone is too warm.");
  assert.equal(edited.xNormalized, 0.25);
  assert.equal(edited.yNormalized, 0.2);
  await qcService.deleteQcCorrection(album.id, second.id, qcLead);
  assert.equal(repo.state.corrections.filter((row) => row.albumId === album.id).length, 1);
  assert.ok(repo.state.activities.some((row) => row.event === "QC_CORRECTION_EDITED"));
  assert.ok(repo.state.activities.some((row) => row.event === "QC_CORRECTION_REMOVED"));
  await assert.rejects(qcService.editQcCorrection(album.id, "missing", { comment: "x" }, qcLead), (error) => error.status === 404);
  // The ruling locks the round's pins: from here they are history, not drafts.
  await qcService.requestChanges(album.id, {}, qcLead);
  assert.ok(repo.state.corrections.find((row) => row.id === first.id).lockedAt);
  albumOf(repo).status = "QC_REVIEW";
  await assert.rejects(qcService.editQcCorrection(album.id, first.id, { comment: "late" }, qcLead), (error) => error.status === 409 && /unsent/.test(error.message));
  await assert.rejects(qcService.deleteQcCorrection(album.id, first.id, qcLead), (error) => error.status === 409);
  // A pin the studio has started working is no longer a draft either.
  albumOf(repo).status = "QC_REVIEW";
  const third = await qcService.addQcCorrection(album.id, { versionPageId: page.id, x: 0.5, y: 0.5, comment: "Replace." }, qcLead);
  repo.state.corrections.find((row) => row.id === third.id).status = "IN_PROGRESS";
  await assert.rejects(qcService.deleteQcCorrection(album.id, third.id, qcLead), (error) => error.status === 409);
});

test("QC decisions: request-changes needs a correction, approve refuses while one is unresolved", async () => {
  const { repo, qcService, album } = await qcFixture();
  await assert.rejects(qcService.requestChanges(album.id, {}, qcLead), (error) => error.status === 409 && /Add at least one/.test(error.message));
  const page = repo.state.versionPages[0];
  await qcService.addQcCorrection(album.id, { versionPageId: page.id, x: 0.5, y: 0.5, comment: "Replace this image." }, qcLead);
  await assert.rejects(qcService.approve(album.id, {}, qcLead), (error) => error.status === 409 && /unresolved/.test(error.message));
  await qcService.requestChanges(album.id, {}, qcLead);
  assert.equal(albumOf(repo).status, "QC_CHANGES_REQUESTED");
  assert.equal(repo.state.qcRounds[0].decision, "CHANGES_REQUESTED");
  // The state machine refuses ruling twice.
  await assert.rejects(qcService.requestChanges(album.id, {}, qcLead), (error) => error.status === 409);
});

test("the full QC round-trip: fix, resolve, upload, resubmit changed-only, reopen, and finally approve", async () => {
  const { repo, pipeline, qcService, album, objects } = await qcFixture();
  const page = repo.state.versionPages[0];
  const correction = await qcService.addQcCorrection(album.id, { versionPageId: page.id, x: 0.5, y: 0.5, comment: "Move this photo slightly left." }, qcLead);
  await qcService.requestChanges(album.id, {}, qcLead);
  await qcService.startFixes(album.id, user);
  assert.equal(albumOf(repo).status, "QC_REVISION_IN_PROGRESS");
  // The revised upload is locked while the correction stands, and so is the resubmit behind it.
  await assert.rejects(pipeline.createRevisedVersion(album.id, user), (error) => error.status === 409 && /still to resolve/.test(error.message));
  await assert.rejects(qcService.resubmitToQc(album.id, {}, user), (error) => error.status === 409 && /upload the corrected spreads/.test(error.message));
  await qcService.updateCorrection(album.id, correction.id, { status: "IN_PROGRESS" }, user);
  const resolved = await qcService.updateCorrection(album.id, correction.id, { status: "RESOLVED", resolutionNote: "Replaced with IMG_9021.jpg." }, user);
  assert.equal(resolved.resolutionNote, "Replaced with IMG_9021.jpg.");
  assert.ok(resolved.resolvedAt);
  // The designer re-derived page 1's file after the freeze; page 2 untouched.
  repo.state.uploads[0].processingCompletedAt = new Date(Date.now() + 1000);
  const copiedBefore = objects.copied.length;
  const firstVersionId = albumOf(repo).currentVersionId;
  const firstVersionPages = repo.state.versionPages
    .filter((row) => row.versionId === firstVersionId)
    .map((row) => ({ id: row.id, previewKey: row.previewKey, thumbnailKey: row.thumbnailKey }));
  /*
   * Resolving the last correction creates nothing. It unlocks the upload of the corrected spreads,
   * and **that** is what creates V2 — two separate acts, which is the whole rule.
   */
  const created = await pipeline.createRevisedVersion(album.id, user);
  assert.equal(created.versionNumber, 1, "a QC round advanced the client's version");
  assert.equal(created.iteration, 2);
  assert.equal(albumOf(repo).status, "REVISION_READY_FOR_QC", "the upload submitted the version by itself");
  const resubmitted = await qcService.resubmitToQc(album.id, {}, user);
  assert.equal(resubmitted.versionId, created.versionId, "the resubmit sent a different version than the upload created");
  /*
   * A resubmit is the next *version*, not another round inside the one QC reviewed. It used to
   * write the corrected derivatives back over the reviewed version's own page rows, so the spreads
   * QC had actually seen could no longer be shown at all.
   */
  assert.equal(resubmitted.versionNumber, 1);
  assert.equal(resubmitted.roundNumber, 1); // a new pass opens its own first round
  assert.equal(resubmitted.changedPages, 1);
  assert.equal(albumOf(repo).status, "QC_REVIEW");
  assert.notEqual(albumOf(repo).currentVersionId, firstVersionId);
  // Every spread frozen afresh under the new version: the whole album, not only what changed.
  assert.equal(objects.copied.length, copiedBefore + 4);
  const pages = repo.state.versionPages.filter((row) => row.versionId === albumOf(repo).currentVersionId);
  assert.equal(pages.length, 2);
  assert.deepEqual(pages.map((row) => row.changedFromPrevious), [true, false]); // changed-only review knows which
  // And V1 is exactly as it was - the point of the whole change.
  const afterFirst = repo.state.versionPages
    .filter((row) => row.versionId === firstVersionId)
    .map((row) => ({ id: row.id, previewKey: row.previewKey, thumbnailKey: row.thumbnailKey }));
  assert.deepEqual(afterFirst, firstVersionPages, "V1's frozen pages were written over");
  // QC is not satisfied: reopen, which sends it back through the fix cycle.
  const reopened = await qcService.reopenCorrection(album.id, correction.id, { note: "Still off-centre." }, qcLead);
  assert.equal(reopened.status, "REOPENED");
  await assert.rejects(qcService.approve(album.id, {}, qcLead), (error) => error.status === 409);
  await qcService.requestChanges(album.id, {}, qcLead);
  await qcService.startFixes(album.id, user);
  await qcService.updateCorrection(album.id, correction.id, { status: "RESOLVED", resolutionNote: "Centred." }, user);
  await pipeline.createRevisedVersion(album.id, user);
  await qcService.resubmitToQc(album.id, {}, user);
  const approved = await qcService.approve(album.id, { note: "Clean." }, qcLead);
  assert.equal(approved.approved, true);
  assert.equal(albumOf(repo).status, "QC_APPROVED");
  assert.ok(repo.state.qcRounds.every((round) => round.decision));
});

test("the revised upload refuses while regenerated previews are still processing or failed", async () => {
  const { repo, pipeline, qcService, album, queue } = await qcFixture();
  const page = repo.state.versionPages[0];
  const correction = await qcService.addQcCorrection(album.id, { versionPageId: page.id, x: 0.5, y: 0.5, comment: "Fix alignment." }, qcLead);
  await qcService.requestChanges(album.id, {}, qcLead);
  await qcService.startFixes(album.id, user);
  await qcService.updateCorrection(album.id, correction.id, { status: "RESOLVED" }, user);
  const result = await qcService.reprocessPages(album.id, { uploadIds: ["upload-1"] }, user);
  assert.equal(result.reprocessing, 1);
  assert.deepEqual(queue.enqueued.slice(-1), ["upload-1"]);
  await assert.rejects(pipeline.createRevisedVersion(album.id, user), (error) => error.status === 409 && /regenerating/.test(error.message));
  repo.state.uploads[0].status = "PROCESSING_FAILED";
  await assert.rejects(pipeline.createRevisedVersion(album.id, user), (error) => error.status === 409 && /failed/.test(error.message) && error.details.failedFiles.length === 1);
  // A failed upload creates nothing: no version, and the album stays in its fix round.
  assert.equal(repo.state.versions.length, 1);
  assert.equal(albumOf(repo).status, "QC_REVISION_IN_PROGRESS");
  repo.state.uploads[0].status = "READY";
  const created = await pipeline.createRevisedVersion(album.id, user);
  assert.deepEqual([created.versionNumber, created.iteration], [1, 2]);
  assert.equal((await qcService.resubmitToQc(album.id, {}, user)).versionNumber, 1);
});

/*
 * ── Resolve ≠ version ────────────────────────────────────────────────────────────────────────
 *
 * The rule that the whole revision loop turns on, taken one condition at a time: resolving the
 * last correction unlocks the *upload*, the upload creates the version, and submitting it is a
 * third act again. Everything here is the service, not the screen — the button is a convenience
 * and this is the law it is a convenience for.
 */
test("resolving the last correction unlocks the upload and creates nothing", async () => {
  const { repo, base, pipeline, qcService, album } = await qcFixture();
  const page = repo.state.versionPages[0];
  const one = await qcService.addQcCorrection(album.id, { versionPageId: page.id, x: 0.2, y: 0.2, comment: "One." }, qcLead);
  const two = await qcService.addQcCorrection(album.id, { versionPageId: page.id, x: 0.8, y: 0.8, comment: "Two." }, qcLead);
  await qcService.requestChanges(album.id, {}, qcLead);
  await qcService.startFixes(album.id, user);

  const gateOf = async () => (await base.get(album.id)).revisedUpload;
  assert.equal((await gateOf()).unlocked, false, "two corrections open and the upload was offered");

  // Some resolved is not all resolved.
  await qcService.updateCorrection(album.id, one.id, { status: "RESOLVED" }, user);
  assert.equal((await gateOf()).unlocked, false);
  assert.match((await gateOf()).reason, /1 QC correction still to resolve/);
  await assert.rejects(pipeline.createRevisedVersion(album.id, user), (error) => error.status === 409);

  // All resolved: the upload is offered, and still nothing has been created.
  await qcService.updateCorrection(album.id, two.id, { status: "RESOLVED" }, user);
  assert.equal((await gateOf()).unlocked, true);
  assert.equal(repo.state.versions.length, 1, "resolving created a version");
  assert.equal(albumOf(repo).status, "QC_REVISION_IN_PROGRESS");

  // Reopened: locked again at once, on the server and not only on the screen.
  await qcService.reopenCorrection(album.id, two.id, { note: "Not quite." }, qcLead);
  assert.equal((await gateOf()).unlocked, false);
  await assert.rejects(pipeline.createRevisedVersion(album.id, user), (error) => error.status === 409 && /still to resolve/.test(error.message));

  // Resolved again: unlocked again, and now the upload is what makes V2. The album never left the
  // fix round to reopen a correction, so there is nothing to restart — only the work to redo.
  assert.equal(albumOf(repo).status, "QC_REVISION_IN_PROGRESS");
  await qcService.updateCorrection(album.id, two.id, { status: "RESOLVED" }, user);
  assert.equal((await gateOf()).unlocked, true);
  const created = await pipeline.createRevisedVersion(album.id, user);
  assert.deepEqual([created.versionNumber, created.iteration], [1, 2], "a QC round must not advance the client's version");
  assert.equal(repo.state.versions.length, 2);
  // Two snapshots, one client version — which is exactly what the history list must show.
  assert.deepEqual((await base.get(album.id)).versions.map((row) => row.versionNumber), [1]);
  assert.equal((await base.get(album.id)).versions[0].iterations, 2);
});

test("an album that was never corrected is never offered a revised upload", async () => {
  const { repo, base, pipeline, album } = await qcFixture();
  // Straight into the fix state with no corrections behind it: unresolved is zero, and zero
  // unresolved must not read as "everything is resolved".
  albumOf(repo).status = "QC_REVISION_IN_PROGRESS";
  assert.equal((await base.get(album.id)).revisedUpload.unlocked, false);
  await assert.rejects(pipeline.createRevisedVersion(album.id, user), (error) => error.status === 409 && /No QC corrections/.test(error.message));
  assert.equal(repo.state.versions.length, 1);
});

test("two admins uploading at once make one version, and the second is told", async () => {
  const { repo, pipeline, qcService, album } = await qcFixture();
  const page = repo.state.versionPages[0];
  const correction = await qcService.addQcCorrection(album.id, { versionPageId: page.id, x: 0.5, y: 0.5, comment: "Fix." }, qcLead);
  await qcService.requestChanges(album.id, {}, qcLead);
  await qcService.startFixes(album.id, user);
  await qcService.updateCorrection(album.id, correction.id, { status: "RESOLVED" }, user);

  // Both admins press Upload; both uploads land at the same moment.
  const results = await Promise.allSettled([pipeline.createRevisedVersion(album.id, user), pipeline.createRevisedVersion(album.id, user)]);
  const made = results.filter((result) => result.status === "fulfilled");
  assert.equal(made.length, 1, "both requests created a version");
  assert.equal(results.find((result) => result.status === "rejected").reason.status, 409);
  assert.equal(repo.state.versions.length, 2, "a second snapshot was created");
  assert.deepEqual(repo.state.versions.map((row) => [row.versionNumber, row.iteration]), [[1, 1], [1, 2]]);

  // A refresh, a back button, a second tab: the server's state is what stands, and repeating the
  // request does not repeat the version.
  await assert.rejects(pipeline.createRevisedVersion(album.id, user), (error) => error.status === 409);
  assert.equal(repo.state.versions.length, 2);
  // Nor does a double resubmit.
  const first = await qcService.resubmitToQc(album.id, {}, user);
  await assert.rejects(qcService.resubmitToQc(album.id, {}, user), (error) => error.status === 409);
  assert.equal(first.versionNumber, 1);
  assert.equal(repo.state.versions.length, 2);
  assert.equal(repo.state.qcRounds.filter((round) => round.versionId === first.versionId).length, 1, "a second QC round was opened");
});

/*
 * V1, V2, V3 are the CLIENT's versions, and only a client round advances one.
 *
 * QC asking for corrections and being answered with a revised upload is a pass *inside* the
 * version the client is waiting on, however many times it goes round — so a studio that takes four
 * QC passes to get V1 right has a history reading V1, not V1, V1, V1, V1. Each pass still freezes
 * its own immutable snapshot, because the proofs QC reviewed on an earlier pass must stay exactly
 * as they were reviewed; they are simply not versions anybody has been sent.
 */
test("QC passes stay inside a client version; only a client round advances the number", async () => {
  const { repo, base, objects, pipeline, qcService, album } = await qcFixture();
  const finalizeService = createAlbumFinalizeService(repo, { base, objects });
  const clientService = createAlbumClientService(repo, { base, objects });
  const pageOfCurrent = () => repo.state.versionPages.find((row) => row.versionId === albumOf(repo).currentVersionId).id;

  // One QC round: corrections, all resolved, corrected spreads uploaded, sent back to QC.
  async function qcRound(comment) {
    const correction = await qcService.addQcCorrection(album.id, { versionPageId: pageOfCurrent(), x: 0.5, y: 0.5, comment }, qcLead);
    await qcService.requestChanges(album.id, {}, qcLead);
    await qcService.startFixes(album.id, user);
    await qcService.updateCorrection(album.id, correction.id, { status: "RESOLVED" }, user);
    const created = await pipeline.createRevisedVersion(album.id, user);
    await qcService.resubmitToQc(album.id, {}, user);
    return created;
  }

  // One client round: approve, send, client corrects, studio resolves and uploads, back to QC.
  async function clientRound(comment) {
    await qcService.approve(album.id, {}, qcLead);
    const credentials = await clientService.publish(album.id, user);
    const token = credentials.clientPath.replace(/^\/(p|album-proof)\//, "");
    proofSecurity._resetPinAttempts();
    await clientService.verifyPin(token, credentials.pin, "10.0.0.7");
    const reviewed = albumOf(repo).currentVersionId;
    const correction = await clientService.addCorrection(token, { versionPageId: pageOfCurrent(), x: 0.4, y: 0.4, comment });
    assert.equal(repo.state.corrections.find((row) => row.id === correction.id).versionId, reviewed, "a client correction must name the version reviewed");
    await clientService.submitCorrections(token, {});
    await finalizeService.startRevision(album.id, user);
    await qcService.updateCorrection(album.id, correction.id, { status: "RESOLVED" }, user);
    const created = await finalizeService.markRevisionReady(album.id, user);
    await pipeline.sendToQc(album.id, user);
    return created;
  }

  // Two QC rounds before the client has seen anything: still V1, passes 2 and 3.
  const qcOne = await qcRound("Straighten.");
  const qcTwo = await qcRound("Warm tone.");
  assert.deepEqual([qcOne, qcTwo].map((row) => [row.versionNumber, row.iteration]), [[1, 2], [1, 3]]);
  assert.equal(repo.state.versions.length, 3, "three snapshots, which is right — three version numbers, which is not");
  assert.deepEqual((await base.get(album.id)).versions.map((row) => row.versionNumber), [1], "QC passes reached the client's version history");
  assert.equal((await base.get(album.id)).versions[0].iterations, 3);

  // The client's round is what advances it, and QC may pass inside the new number just the same.
  const clientOne = await clientRound("Swap this photograph.");
  assert.deepEqual([clientOne.versionNumber, clientOne.iteration], [2, 1]);
  const qcOnV2 = await qcRound("Crop tighter.");
  assert.deepEqual([qcOnV2.versionNumber, qcOnV2.iteration], [2, 2], "a QC pass on V2 advanced the client's version");
  const clientTwo = await clientRound("One more swap.");
  assert.deepEqual([clientTwo.versionNumber, clientTwo.iteration], [3, 1]);

  // The history the studio reads: three client versions, newest first.
  assert.deepEqual((await base.get(album.id)).versions.map((row) => row.versionNumber), [3, 2, 1]);
  // Every snapshot is still there, still frozen, still holding its own pages under its own keys.
  assert.deepEqual(repo.state.versions.map((row) => [row.versionNumber, row.iteration]), [[1, 1], [1, 2], [1, 3], [2, 1], [2, 2], [3, 1]]);
  const keys = new Set();
  for (const version of repo.state.versions) {
    assert.equal(version.status, "FROZEN");
    const pages = repo.state.versionPages.filter((row) => row.versionId === version.id);
    assert.ok(pages.length > 0, `V${version.versionNumber} pass ${version.iteration} lost its pages`);
    for (const page of pages) {
      assert.ok(!keys.has(page.previewKey), "two snapshots share a preview key — one copied over the other");
      keys.add(page.previewKey);
    }
  }
  // And every correction still names the exact snapshot it was raised on.
  for (const correction of repo.state.corrections) {
    assert.ok(repo.state.versions.some((version) => version.id === correction.versionId), "a correction lost its version");
  }
});

// ---------------------------------------------------------------------------
// Client publication, PIN, corrections, revision rounds, approval
// ---------------------------------------------------------------------------
test.beforeEach(() => proofSecurity._resetPinAttempts());

async function clientFixture() {
  const fixture = await qcFixture();
  const { repo, base, qcService, album } = fixture;
  await qcService.approve(album.id, {}, qcLead);
  const clientService = createAlbumClientService(repo, { base, objects: fixture.objects });
  const credentials = await clientService.publish(album.id, user);
  return { ...fixture, clientService, credentials, token: credentials.clientPath.replace(/^\/(p|album-proof)\//, "") };
}

test("publish demands QC approval, issues hashed credentials, and revokes the previous link", async () => {
  const { repo, base, album } = await qcFixture();
  const clientService = createAlbumClientService(repo, { base });
  await assert.rejects(clientService.publish(album.id, user), (error) => error.status === 409); // still QC_REVIEW
  const qcService = createAlbumQcService(repo, { base });
  await qcService.approve(album.id, {}, qcLead);
  const first = await clientService.publish(album.id, user);
  // The URL a client is given is the short code, and it says nothing about the album behind it.
  assert.match(first.clientPath, /^\/p\/[A-Z0-9]{6}$/);
  assert.equal(first.clientPath, `/p/${repo.state.publications[0].shortCode}`);
  assert.ok(!first.clientPath.includes(album.id));
  assert.match(first.pin, /^\d{4}$/);
  assert.equal(albumOf(repo).status, "CLIENT_REVIEW");
  const stored = repo.state.publications[0];
  // The token is still the link's private name, and is never at rest in plaintext.
  const revealedToken = (await clientService.revealCredentials(album.id)).clientPath;
  assert.ok(!stored.tokenCipher.includes(proofSecurity.decryptValue(stored.tokenCipher).slice(-20)));
  assert.equal(revealedToken, first.clientPath); // reading it back gives the same URL, not a new one
  assert.ok(stored.pinHash.startsWith("$2"));
  assert.ok(!JSON.stringify(repo.state.activities).includes(first.pin)); // PIN never in activity
});

test("the PIN gate: wrong PIN refused, brute force rate limited, expiry and revocation kill the link", async () => {
  const { repo, clientService, credentials, token } = await clientFixture();
  await assert.rejects(clientService.verifyPin(token, credentials.pin === "111111" ? "222222" : "111111", "1.2.3.4"), (error) => error.status === 401);
  const session = await clientService.verifyPin(token, credentials.pin, "1.2.3.4");
  assert.ok(session.sessionToken);
  assert.equal(clientService.requireSession(token, `Bearer ${session.sessionToken}`).proofToken, token);
  // Another token's session does not open this proof.
  assert.throws(() => clientService.requireSession("A".repeat(43), `Bearer ${session.sessionToken}`), (error) => error.status === 401);
  // Rate limiting.
  proofSecurity._resetPinAttempts();
  const wrong = credentials.pin === "333333" ? "444444" : "333333";
  for (let attempt = 0; attempt < 8; attempt += 1) await assert.rejects(clientService.verifyPin(token, wrong, "9.9.9.9"), (error) => error.status === 401);
  await assert.rejects(clientService.verifyPin(token, credentials.pin, "9.9.9.9"), (error) => error.status === 429);
  // Expiry → 410; revocation → generic 404; unknown token → generic 404.
  repo.state.publications[0].expiresAt = new Date(Date.now() - 1000);
  await assert.rejects(clientService.meta(token), (error) => error.status === 410);
  repo.state.publications[0].expiresAt = new Date(Date.now() + 1000000);
  repo.state.publications[0].revokedAt = new Date();
  await assert.rejects(clientService.meta(token), (error) => error.status === 404);
  await assert.rejects(clientService.meta("B".repeat(43)), (error) => error.status === 404);
});

test("client corrections: add, edit and delete freely before submission — never after", async () => {
  const { repo, clientService, token } = await clientFixture();
  const proof = await clientService.proof(token);
  assert.equal(proof.locked, false);
  assert.ok(proof.pages.every((page) => !("originalPath" in page))); // paths never reach the client
  const page = proof.pages[0];
  const correction = await clientService.addCorrection(token, { versionPageId: page.id, x: 0.4, y: 0.7, comment: "Please replace this photograph." });
  const edited = await clientService.editCorrection(token, correction.id, { comment: "Please replace this photo with a smiling one." });
  assert.match(edited.comment, /smiling/);
  const second = await clientService.addCorrection(token, { versionPageId: page.id, x: 0.2, y: 0.2, comment: "Crop tighter." });
  await clientService.deleteCorrection(token, second.id);
  assert.equal(repo.state.corrections.filter((row) => row.source === "CLIENT").length, 1);
  const submitted = await clientService.submitCorrections(token, {});
  assert.equal(submitted.correctionCount, 1);
  // After submission: locked in every direction.
  await assert.rejects(clientService.editCorrection(token, correction.id, { comment: "late" }), (error) => error.status === 409);
  await assert.rejects(clientService.addCorrection(token, { versionPageId: page.id, x: 0.1, y: 0.1, comment: "late" }), (error) => error.status === 409);
  assert.ok(repo.state.corrections[repo.state.corrections.length - 1].lockedAt);
});

test("submitting corrections consumes exactly one revision round, once, and respects the limit", async () => {
  const { repo, clientService, token } = await clientFixture();
  const proof = await clientService.proof(token);
  await clientService.addCorrection(token, { versionPageId: proof.pages[0].id, x: 0.5, y: 0.5, comment: "Fix this." });
  const result = await clientService.submitCorrections(token, {});
  assert.equal(result.revisionNumber, 1);
  assert.equal(result.remainingRevisions, 2);
  assert.equal(albumOf(repo).revisionsUsed, 1);
  assert.equal(albumOf(repo).status, "CLIENT_CHANGES_REQUESTED");
  // The double-click: the second submit finds the round already filed.
  await assert.rejects(clientService.submitCorrections(token, {}), (error) => error.status === 409);
  assert.equal(albumOf(repo).revisionsUsed, 1);
  // At the limit the round is refused before anything is written; a grant lifts it, audited.
  albumOf(repo).revisionsUsed = 3;
  albumOf(repo).status = "CLIENT_REVIEW";
  repo.state.submissions = [];
  await clientService.addCorrection(token, { versionPageId: proof.pages[0].id, x: 0.6, y: 0.6, comment: "One more." });
  await assert.rejects(clientService.submitCorrections(token, {}), (error) => error.status === 409 && error.details?.revisionLimitReached);
  const granted = await clientService.grantExtraRevision(albumOf(repo).id, user);
  assert.equal(granted.revisionLimit, 4);
  assert.ok(repo.state.activities.some((row) => row.event === "REVISION_GRANTED"));
  const afterGrant = await clientService.submitCorrections(token, {});
  assert.equal(afterGrant.revisionNumber, 4);
});

test("approval: only with zero corrections, exactly once, and the album locks", async () => {
  const { repo, clientService, token } = await clientFixture();
  const proof = await clientService.proof(token);
  const correction = await clientService.addCorrection(token, { versionPageId: proof.pages[0].id, x: 0.5, y: 0.5, comment: "Fix." });
  await assert.rejects(clientService.approve(token, {}, {}), (error) => error.status === 409 && /still have corrections/.test(error.message));
  await clientService.deleteCorrection(token, correction.id);
  const approved = await clientService.approve(token, { confirmation: "I approve this album for final processing." }, { ip: "1.2.3.4", userAgent: "test" });
  assert.equal(approved.approved, true);
  assert.equal(albumOf(repo).status, "CLIENT_APPROVED");
  assert.equal(albumOf(repo).approvedVersionId, albumOf(repo).currentVersionId);
  // Locked: no second approval, no late corrections.
  await assert.rejects(clientService.approve(token, {}, {}), (error) => error.status === 409);
  await assert.rejects(clientService.addCorrection(token, { versionPageId: proof.pages[0].id, x: 0.1, y: 0.1, comment: "late" }), (error) => error.status === 409);
});

// ---------------------------------------------------------------------------
// The revision loop end-to-end, reopen, complete, and the originalPath download
// ---------------------------------------------------------------------------
function fakeFiles(existing) {
  const calls = { copied: [], mkdirs: [] };
  return {
    calls,
    access: async (candidate) => { if (!existing.has(String(candidate))) { const error = new Error("ENOENT"); error.code = "ENOENT"; throw error; } },
    mkdir: async (directory) => { calls.mkdirs.push(directory); },
    copyFile: async (source, destination) => { calls.copied.push([source, destination]); },
  };
}
const fakeSettings = (overrides = {}) => ({ read: async () => ({ originalStoragePath: "D:\\A", selectedOutputPath: "D:\\Out", ...overrides }) });

test("the whole business process: V1 → QC → client corrections → V2 → QC → client approval → complete → originals copied by path", async () => {
  const { repo, base, qcService, pipeline, clientService, objects, token, credentials } = await clientFixture();
  const finalizeService = createAlbumFinalizeService(repo, { base, objects, settings: fakeSettings(), files: fakeFiles(new Set(["D:\\A\\001.jpg", "D:\\A\\002.jpg"])) });
  const album = albumOf(repo);
  // Client pins one correction on V1 and submits the round.
  const proof = await clientService.proof(token);
  await clientService.addCorrection(token, { versionPageId: proof.pages[0].id, x: 0.5, y: 0.5, comment: "Replace this image." });
  await clientService.submitCorrections(token, {});
  assert.equal(album.status, "CLIENT_CHANGES_REQUESTED");
  // Studio: revision toward V2 — resolve, ready, freeze V2, QC, publish.
  await finalizeService.startRevision(album.id, user);
  const clientCorrection = repo.state.corrections.find((row) => row.source === "CLIENT");
  await assert.rejects(finalizeService.markRevisionReady(album.id, user), (error) => error.status === 409); // unresolved client correction blocks the upload
  await qcService.updateCorrection(album.id, clientCorrection.id, { status: "RESOLVED", resolutionNote: "Updated in V2." }, user);
  // Resolving created nothing; uploading the corrected spreads is what makes V2.
  assert.equal(repo.state.versions.length, 1);
  await finalizeService.markRevisionReady(album.id, user);
  assert.equal(album.status, "REVISION_READY_FOR_QC");
  assert.equal(repo.state.versions.length, 2);
  const v2 = await pipeline.sendToQc(album.id, user);
  assert.equal(v2.versionNumber, 2);
  // V1 remains frozen and untouched by V2's existence.
  const v1 = repo.state.versions.find((version) => version.versionNumber === 1);
  assert.equal(v1.status, "FROZEN");
  await qcService.approve(album.id, {}, qcLead);
  const secondPublish = await clientService.publish(album.id, user);
  assert.notEqual(secondPublish.clientPath, credentials.clientPath); // fresh credentials; V1 link revoked
  const v2Token = secondPublish.clientPath.replace(/^\/(p|album-proof)\//, "");
  await assert.rejects(clientService.meta(token), (error) => error.status === 404); // the old link is dead
  // Client approves V2 (zero corrections on the new version).
  const approved = await clientService.approve(v2Token, {}, {});
  assert.equal(approved.versionNumber, 2);
  // Complete + download originals from their paths.
  await finalizeService.complete(album.id, user);
  assert.equal(album.status, "COMPLETED");
  const files = fakeFiles(new Set(["D:\\A\\001.jpg", "D:\\A\\002.jpg", "D:\\A\\003.jpg"]));
  const downloader = createAlbumFinalizeService(repo, { base, settings: fakeSettings(), files });
  const result = await downloader.downloadFinal(album.id, user);
  assert.equal(result.copied, result.total);
  assert.ok(files.calls.copied.every(([source]) => source.startsWith("D:\\A\\"))); // originals, never previews
  assert.ok(files.calls.copied.every(([, destination]) => destination.includes("Final V2")));
});

test("the download is all-or-nothing: a missing original reports source-offline with the exact files, and copies nothing", async () => {
  const { repo, base, clientService, token } = await clientFixture();
  await clientService.approve(token, {}, {});
  const files = fakeFiles(new Set(["D:\\A\\001.jpg"])); // 002 is unreachable
  const finalizeService = createAlbumFinalizeService(repo, { base, settings: fakeSettings(), files });
  await assert.rejects(finalizeService.downloadFinal(albumOf(repo).id, user), (error) =>
    error.status === 409 && error.details.sourceOffline && error.details.available === 1 && error.details.total === 2 &&
    error.details.unavailable.some((entry) => entry.fileName === "002.jpg"));
  assert.equal(files.calls.copied.length, 0); // nothing was half-copied, no preview substituted
  // A path outside the configured root is refused even if some file exists there.
  repo.state.versionPages[0].originalPath = "E:\\Elsewhere\\001.jpg";
  await assert.rejects(finalizeService.downloadFinal(albumOf(repo).id, user), (error) => error.status === 409 && error.details.unavailable.some((entry) => entry.reason.includes("outside")));
});

test("reopening an approved album demands a reason, is audited, and never mutates history", async () => {
  const { repo, base, clientService, token } = await clientFixture();
  await clientService.approve(token, {}, {});
  const finalizeService = createAlbumFinalizeService(repo, { base, settings: fakeSettings(), files: fakeFiles(new Set()) });
  const submissionCount = repo.state.submissions.length;
  const reopened = await finalizeService.reopenApproved(albumOf(repo).id, { reason: "Client called: one name is misspelled." }, user);
  assert.equal(reopened.status, "REVISION_IN_PROGRESS");
  assert.equal(albumOf(repo).approvedVersionId, null);
  assert.equal(repo.state.submissions.length, submissionCount); // the approval record is history, not erased
  assert.ok(repo.state.activities.some((row) => row.event === "ALBUM_REOPENED" && /misspelled/.test(row.detail)));
  // Complete is refused until a client approves again.
  await assert.rejects(finalizeService.complete(albumOf(repo).id, user), (error) => error.status === 409);
});

/*
 * The whole cycle, end to end: V1 → QC → V2 → QC → V3 → client → V4.
 *
 * Every earlier version is snapshotted before each round and compared afterwards, because the
 * fault this replaced was precisely that a resubmit wrote the corrected derivatives back over the
 * version QC had reviewed - the spreads survived in storage with nothing pointing at them. A
 * version's pages must be exactly what they were the day it was frozen, however many rounds follow.
 */
test("the whole cycle: V1 pass 1 → QC → pass 2 → QC → pass 3 → client → V2, and no snapshot is ever written over", async () => {
  const { repo, base, pipeline, qcService, album, objects } = await qcFixture();
  const finalizeService = createAlbumFinalizeService(repo, { base, objects });
  const clientService = createAlbumClientService(repo, { base, objects });
  const pagesOf = (versionId) => repo.state.versionPages
    .filter((row) => row.versionId === versionId)
    .map((row) => ({ id: row.id, pageNumber: row.pageNumber, previewKey: row.previewKey, thumbnailKey: row.thumbnailKey }))
    .sort((a, b) => a.pageNumber - b.pageNumber);
  const pageOf = (versionId, pageNumber) => repo.state.versionPages.find((row) => row.versionId === versionId && row.pageNumber === pageNumber);
  const reDerive = (index) => { repo.state.uploads[index].processingCompletedAt = new Date(Date.now() + 60_000); };

  // ── V1: the first freeze ────────────────────────────────────────────────
  const v1Id = albumOf(repo).currentVersionId;
  assert.equal(repo.state.versions.length, 1);
  const v1Pages = pagesOf(v1Id);
  assert.equal(v1Pages.length, 2);

  // Two QC corrections on V1, and a partial resolve does not unlock the upload.
  const first = await qcService.addQcCorrection(album.id, { versionPageId: pageOf(v1Id, 1).id, x: 0.3, y: 0.3, comment: "Straighten." }, qcLead);
  const second = await qcService.addQcCorrection(album.id, { versionPageId: pageOf(v1Id, 2).id, x: 0.6, y: 0.6, comment: "Warm tone." }, qcLead);
  await qcService.requestChanges(album.id, {}, qcLead);
  await qcService.startFixes(album.id, user);
  await qcService.updateCorrection(album.id, first.id, { status: "RESOLVED" }, user);
  await assert.rejects(pipeline.createRevisedVersion(album.id, user), (error) => error.status === 409 && /still to resolve/.test(error.message));

  // ── Pass 2: every correction resolved unlocks the UPLOAD, and the upload makes the snapshot ─
  await qcService.updateCorrection(album.id, second.id, { status: "RESOLVED" }, user);
  assert.equal(repo.state.versions.length, 1, "resolving the last correction created a snapshot by itself");
  reDerive(0);
  const created2 = await pipeline.createRevisedVersion(album.id, user);
  // A QC round does not advance the client's version — it takes the next pass inside it.
  assert.deepEqual([created2.versionNumber, created2.iteration], [1, 2]);
  assert.equal(albumOf(repo).status, "REVISION_READY_FOR_QC");
  const v2 = await qcService.resubmitToQc(album.id, {}, user);
  assert.equal(v2.versionNumber, 1);
  assert.equal(v2.versionId, created2.versionId);
  assert.equal(repo.state.versions.length, 2);
  assert.equal(albumOf(repo).status, "QC_REVIEW");
  assert.deepEqual(pagesOf(v1Id), v1Pages, "pass 1's spreads were written over by the pass 2 freeze");
  const v2Id = albumOf(repo).currentVersionId;
  assert.notEqual(v2Id, v1Id);
  assert.equal(pagesOf(v2Id).length, 2, "the unchanged spread is inherited, not dropped");
  const v2Pages = pagesOf(v2Id);
  // Its own copies, so neither pass can move the other's pixels.
  assert.equal(v2Pages.filter((page) => v1Pages.some((old) => old.previewKey === page.previewKey)).length, 0);
  // And the studio's history still reads as the one version the client is waiting on.
  assert.deepEqual((await base.get(album.id)).versions.map((row) => row.versionNumber), [1]);

  // Neither act can run twice: the album has already moved to review, and a second upload or a
  // second resubmit is refused rather than quietly making a third snapshot.
  await assert.rejects(qcService.resubmitToQc(album.id, {}, user), (error) => error.status === 409);
  await assert.rejects(pipeline.createRevisedVersion(album.id, user), (error) => error.status === 409);
  assert.equal(repo.state.versions.length, 2);

  // ── Pass 3: a correction raised on pass 2 this time ─────────────────────
  const onV2 = await qcService.addQcCorrection(album.id, { versionPageId: pageOf(v2Id, 2).id, x: 0.5, y: 0.5, comment: "Crop tighter." }, qcLead);
  assert.equal(onV2.versionId, v2Id, "a correction belongs to the exact snapshot it was raised on");
  await qcService.requestChanges(album.id, {}, qcLead);
  await qcService.startFixes(album.id, user);
  // Reopening pass 1's correction locks the upload again, though the album is on pass 2.
  await qcService.reopenCorrection(album.id, first.id, { note: "Came back." }, qcLead);
  await assert.rejects(pipeline.createRevisedVersion(album.id, user), (error) => error.status === 409 && /still to resolve/.test(error.message));
  await qcService.updateCorrection(album.id, first.id, { status: "RESOLVED" }, user);
  await qcService.updateCorrection(album.id, onV2.id, { status: "RESOLVED" }, user);
  reDerive(1);
  await pipeline.createRevisedVersion(album.id, user);
  const v3 = await qcService.resubmitToQc(album.id, {}, user);
  assert.equal(v3.versionNumber, 1, "a third QC pass advanced the client's version");
  assert.deepEqual(pagesOf(v1Id), v1Pages, "pass 1 moved during the pass 3 freeze");
  assert.deepEqual(pagesOf(v2Id), v2Pages, "pass 2 moved during the pass 3 freeze");
  const v3Id = albumOf(repo).currentVersionId;
  // Three QC passes, and the client has still only ever been promised V1.
  assert.deepEqual((await base.get(album.id)).versions.map((row) => [row.versionNumber, row.iterations]), [[1, 3]]);

  // ── QC approves it, and the client reviews V1 ───────────────────────────
  const approved = await qcService.approve(album.id, {}, qcLead);
  assert.equal(approved.versionNumber, 1);
  const credentials = await clientService.publish(album.id, user);
  const token = credentials.clientPath.replace(/^\/(p|album-proof)\//, "");
  await clientService.verifyPin(token, credentials.pin, "1.2.3.4");
  const clientCorrection = await clientService.addCorrection(token, { versionPageId: pageOf(v3Id, 1).id, x: 0.4, y: 0.4, comment: "Swap this photograph." });
  // The client's own shape deliberately carries no version; the stored row is what must name it.
  assert.equal(repo.state.corrections.find((row) => row.id === clientCorrection.id).versionId, v3Id, "a client correction belongs to the version reviewed");
  await clientService.submitCorrections(token, {});
  assert.equal(albumOf(repo).status, "CLIENT_CHANGES_REQUESTED");

  // ── V2: the client's round is the one thing that advances the number ────
  await finalizeService.startRevision(album.id, user);
  await assert.rejects(finalizeService.markRevisionReady(album.id, user), (error) => error.status === 409 && /still to resolve/.test(error.message));
  await qcService.updateCorrection(album.id, clientCorrection.id, { status: "RESOLVED" }, user);
  assert.equal(repo.state.versions.length, 3, "resolving the client's correction created a snapshot by itself");
  reDerive(0);
  await finalizeService.markRevisionReady(album.id, user); // the client round's revised upload
  const v4 = await pipeline.sendToQc(album.id, user);
  assert.deepEqual([v4.versionNumber, repo.state.versions.at(-1).iteration], [2, 1]);

  // ── The history: four snapshots, two client versions, each holding its own spreads ─
  assert.deepEqual(repo.state.versions.map((row) => [row.versionNumber, row.iteration]), [[1, 1], [1, 2], [1, 3], [2, 1]]);
  assert.deepEqual((await base.get(album.id)).versions.map((row) => row.versionNumber), [2, 1]);
  assert.deepEqual(pagesOf(v1Id), v1Pages);
  assert.deepEqual(pagesOf(v2Id), v2Pages);
  for (const versionId of [v1Id, v2Id, v3Id, albumOf(repo).currentVersionId]) {
    assert.equal(pagesOf(versionId).length, 2, "every version kept its whole album");
  }
  // Every correction still names the version it was raised on - none migrated forward.
  assert.equal(repo.state.corrections.find((row) => row.id === first.id).versionId, v1Id);
  assert.equal(repo.state.corrections.find((row) => row.id === onV2.id).versionId, v2Id);
  assert.equal(repo.state.corrections.find((row) => row.id === clientCorrection.id).versionId, v3Id);
});

/*
 * The PIN is issued once and read back, never made again.
 *
 * It is stored two ways on purpose: `pinHash` is what a client's entry is checked against, and
 * `pinCipher` is what lets the studio read the same PIN back afterwards. So revealing it is a
 * decryption, not a generation - which is what makes it survive a reload, a new session and a
 * restart. A PIN that changed when the card was reopened would be one the client could no longer
 * use, and nothing on screen would say so.
 */
test("the PIN is four digits, survives being read back, and only a new publish changes it", async () => {
  const { repo, clientService, credentials, album } = await clientFixture();
  assert.match(credentials.pin, /^\d{4}$/);

  // Read it back ten times: the card being reopened must not move it.
  for (let reload = 0; reload < 10; reload += 1) {
    const shown = await clientService.revealCredentials(album.id);
    assert.equal(shown.pin, credentials.pin, `reveal ${reload + 1} handed back a different PIN`);
    assert.equal(shown.clientPath, credentials.clientPath);
  }
  // And reading never writes: the stored row is untouched by being looked at.
  const stored = repo.state.publications.map((row) => ({ ...row }));
  await clientService.revealCredentials(album.id);
  await clientService.publicationInfo(album.id);
  assert.deepEqual(repo.state.publications.map((row) => ({ ...row })), stored, "reading the card changed the publication");
  // Reading the card is READ-guarded; being handed the link and the PIN is not. Neither is in it.
  const card = await clientService.publicationInfo(album.id);
  assert.equal(card.shortCode, undefined, "the read endpoint handed out the client URL");
  assert.ok(!JSON.stringify(card).includes(credentials.pin));
  assert.ok(!JSON.stringify(card).includes(repo.state.publications[0].shortCode));

  // The gate is told how long this link's PIN is, and the PIN itself never leaves the server.
  const token = credentials.clientPath.replace(/^\/(p|album-proof)\//, "");
  const meta = await clientService.meta(token);
  assert.equal(meta.pinLength, 4);
  assert.ok(!JSON.stringify(meta).includes(credentials.pin), "meta leaked the PIN");

  // Only publishing again issues a new one - and that is a deliberate act, not a page load.
  await clientService.revoke(album.id, user);
  const second = await clientService.publish(album.id, user);
  assert.match(second.pin, /^\d{4}$/);
  assert.notEqual(second.clientPath, credentials.clientPath);
});

/*
 * ── The share-management actions ─────────────────────────────────────────────────────────────
 *
 * Reset PIN, moving the expiry, copying and opening the URL are all things done to one link. None
 * of them may issue a second link, move the album on, or touch the version the client is looking
 * at - the bug they exist to prevent is a studio resetting a PIN and quietly stranding the album
 * in a new revision round.
 */
test("reset PIN issues a new four-digit PIN and changes nothing else about the share", async () => {
  const { repo, clientService, credentials, album } = await clientFixture();
  const before = { ...repo.state.publications[0] };
  const albumBefore = { ...albumOf(repo) };

  const reset = await clientService.resetPin(album.id, user);
  assert.match(reset.pin, /^\d{4}$/);
  assert.notEqual(reset.pin, credentials.pin);

  const after = repo.state.publications[0];
  assert.equal(repo.state.publications.length, 1, "reset PIN created a second publication");
  assert.equal(after.shortCode, before.shortCode, "the client URL moved");
  assert.equal(after.tokenHash, before.tokenHash);
  assert.equal(after.expiresAt, before.expiresAt, "the expiry moved");
  assert.equal(after.versionId, before.versionId, "the share changed version");
  assert.equal(after.revisionNumber, before.revisionNumber);
  assert.equal(albumOf(repo).status, albumBefore.status, "reset PIN moved the album");
  assert.equal(albumOf(repo).currentVersionId, albumBefore.currentVersionId);
  assert.equal(repo.state.versions.length, 1, "reset PIN created a version");

  // The old PIN stops working at once; the new one is what the gate accepts.
  const token = credentials.clientPath.replace(/^\/(p|album-proof)\//, "");
  await assert.rejects(clientService.verifyPin(token, credentials.pin, "1.1.1.1"), (error) => error.status === 401);
  proofSecurity._resetPinAttempts();
  assert.ok((await clientService.verifyPin(token, reset.pin, "1.1.1.1")).sessionToken);

  // And it survives being read back, exactly as the published one does.
  assert.equal((await clientService.revealCredentials(album.id)).pin, reset.pin);
  assert.ok(!JSON.stringify(repo.state.activities).includes(reset.pin), "PIN leaked into activity");
  assert.ok(repo.state.activities.some((row) => row.event === "CLIENT_PIN_RESET"), "reset was not audited");
});

test("a new link expires six calendar months out, and the studio can move that date", async () => {
  const { repo, clientService, credentials, album } = await clientFixture();
  const published = repo.state.publications[0];
  const expected = new Date(published.publishedAt);
  expected.setDate(1);
  expected.setMonth(expected.getMonth() + 6);
  assert.equal(credentials.expiresAt.getFullYear(), expected.getFullYear());
  assert.equal(credentials.expiresAt.getMonth(), expected.getMonth(), "default expiry was not six calendar months out");

  const moved = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000);
  const updated = await clientService.updateExpiry(album.id, moved, user);
  assert.equal(updated.expiresAt.getTime(), moved.getTime());
  assert.equal(updated.active, true);
  // Nothing else moved with it.
  assert.equal(repo.state.publications.length, 1);
  assert.equal(repo.state.publications[0].shortCode, published.shortCode);
  assert.equal((await clientService.revealCredentials(album.id)).pin, credentials.pin, "the PIN moved with the expiry");
  // And it persists: reading the card back shows the saved date, not the default.
  assert.equal((await clientService.publicationInfo(album.id)).expiresAt.getTime(), moved.getTime());

  // Backdating it closes the link, which is what expiry enforcement means on the client side.
  await clientService.updateExpiry(album.id, new Date(Date.now() - 1000), user);
  const token = credentials.clientPath.replace(/^\/(p|album-proof)\//, "");
  await assert.rejects(clientService.meta(token), (error) => error.status === 410 && /expired/i.test(error.message));
});

test("the short code and the original token are two spellings of one link", async () => {
  const { repo, clientService, credentials, album } = await clientFixture();
  const shortCode = repo.state.publications[0].shortCode;
  const token = proofSecurity.decryptValue(repo.state.publications[0].tokenCipher);
  assert.equal(credentials.clientPath, `/p/${shortCode}`);

  const byCode = await clientService.meta(shortCode);
  const byToken = await clientService.meta(token);
  assert.deepEqual(byCode, byToken, "the two spellings resolved to different proofs");
  assert.equal(byCode.versionNumber, 1);
  // Lower case survives the trip: a code retyped from a screenshot still opens the link.
  assert.deepEqual(await clientService.meta(shortCode.toLowerCase()), byCode);

  /*
   * A link published before the short code existed is given one the next time the studio looks at
   * it — and the URL the client already has goes on working, which is the only reason that is a
   * safe thing to do to a live link.
   */
  repo.state.publications[0].shortCode = null;
  const backfilled = await clientService.revealCredentials(album.id);
  assert.match(backfilled.clientPath, /^\/p\/[A-Z0-9]{6}$/, "the legacy link was never given a short code");
  assert.notEqual(repo.state.publications[0].shortCode, shortCode, "the backfill reused the old code");
  assert.equal((await clientService.meta(token)).versionNumber, 1, "the original URL stopped working");
  assert.equal((await clientService.meta(repo.state.publications[0].shortCode)).versionNumber, 1);
  // And it is allocated once: looking again does not draw a second code.
  const settled = repo.state.publications[0].shortCode;
  for (let reload = 0; reload < 5; reload += 1) assert.equal((await clientService.revealCredentials(album.id)).clientPath, `/p/${settled}`);

  // And nothing that is neither is ever looked up.
  for (const nonsense of ["", "../../etc/passwd", "a".repeat(64), "!!!!!!"]) {
    await assert.rejects(clientService.meta(nonsense), (error) => error.status === 404 || error.status === 400);
  }
});

test("revoking still kills both spellings, and reset PIN cannot revive a revoked link", async () => {
  const { repo, clientService, credentials, album } = await clientFixture();
  const shortCode = repo.state.publications[0].shortCode;
  const token = proofSecurity.decryptValue(repo.state.publications[0].tokenCipher);

  await clientService.revoke(album.id, user);
  await assert.rejects(clientService.meta(shortCode), (error) => error.status === 404);
  await assert.rejects(clientService.meta(token), (error) => error.status === 404);
  await assert.rejects(clientService.verifyPin(shortCode, credentials.pin, "1.1.1.1"), (error) => error.status === 404);
  await assert.rejects(clientService.resetPin(album.id, user), (error) => error.status === 404);
  await assert.rejects(clientService.updateExpiry(album.id, new Date(Date.now() + 86400000), user), (error) => error.status === 404);
  assert.equal(repo.state.publications.length, 1, "a management action published a new link");
});

test("a PIN with a leading zero stays four characters, and the old six-digit links still open", () => {
  const security = require("../src/modules/image-selection/album-proofs/security");
  // `0047` as a number is 47, and a client would be typing a PIN the record no longer matched.
  assert.equal(security.PIN_LENGTH, 4);
  for (let attempt = 0; attempt < 2000; attempt += 1) assert.match(security.generatePin(), /^\d{4}$/);
  // The gate accepts both lengths until the links issued before this have gone.
  const { pinBodySchema } = require("../src/modules/image-selection/album-proofs/validation");
  assert.equal(pinBodySchema.safeParse({ pin: "0047" }).success, true);
  assert.equal(pinBodySchema.safeParse({ pin: "183058" }).success, true, "a link already shared must still open");
  assert.equal(pinBodySchema.safeParse({ pin: "47" }).success, false);
  assert.equal(pinBodySchema.safeParse({ pin: "12345" }).success, false);
});
