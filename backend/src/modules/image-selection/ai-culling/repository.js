const { olderVerdicts } = require("./stampOwnership");
// A reopen re-derives its released photos in pages this size (MySQL IN lists stay small).
const REOPEN_CHUNK = 1000;
const prisma = require("../../../config/db");
const { ACTIVE_STATUSES, REASON_CODES, CONFIDENCE_LINES } = require("./constants");
const { subtreeIds } = require("./scope");

/** A session is reachable only through its own, live project — a soft-deleted project takes its runs out of reach with it. */
const sessionWhere = (projectId, sessionId) => ({ id: sessionId, projectId, project: { deletedAt: null } });

/**
 * What a restart re-enqueues: every run still moving, except a desktop-analyzed run that is still
 * waiting for its workstation's signals — that one has no job yet, and must not be given one.
 */
// ... and not a run that began with the import and is still waiting for its photos to land - that
// one is handed over when the last photo arrives, never by a restart.
const recoveryWhere = () => ({ status: { in: ACTIVE_STATUSES }, AND: [{ NOT: { analysisSource: "DESKTOP", status: "QUEUED" } }, { NOT: { awaitsUploads: true, startedAt: null } }] });

/**
 * The review gallery's facets as Prisma where-clauses. Pure and exported so the tests can pin
 * each facet's meaning without a database. Reason-code facets use MySQL's JSON containment over
 * the `reason_codes` array.
 */
function resultFilterWhere(filter) {
  switch (filter) {
    case "keep": return { effectiveDecision: "KEEP" };
    case "maybe": return { effectiveDecision: "MAYBE" };
    case "reject": return { effectiveDecision: "REJECT" };
    case "pending": return { effectiveDecision: "PENDING" };
    case "low_confidence": return { reasonCodes: { array_contains: REASON_CODES.LOW_CONFIDENCE } };
    case "duplicates": return { duplicateGroupId: { not: null } };
    case "best_of_burst": return { burstGroupId: { not: null }, isGroupBest: true };
    case "blur": return { OR: [{ reasonCodes: { array_contains: REASON_CODES.SEVERE_BLUR } }, { reasonCodes: { array_contains: REASON_CODES.SOFT_FOCUS } }] };
    // Every blink the AI flagged: the largest face's, or an important person's once the subject
    // stage has weighed eyes by who they belong to (it replaces the first with the second).
    case "closed_eyes": return { OR: [{ reasonCodes: { array_contains: REASON_CODES.PRIMARY_SUBJECT_BLINK } }, { reasonCodes: { array_contains: REASON_CODES.IMPORTANT_SUBJECT_BLINK } }] };
    case "unanalyzed": return { OR: [{ analyzedAt: null }, { reasonCodes: { array_contains: REASON_CODES.ANALYSIS_FAILED } }] };
    case "accidental": return { reasonCodes: { array_contains: REASON_CODES.ACCIDENTAL_FRAME } };
    case "cut_faces": return { reasonCodes: { array_contains: REASON_CODES.FACE_CUT_OFF } };
    default: return {};
  }
}

/** The review gallery's sort orders. `id` rides along as the stable tiebreak everywhere. */
function resultOrderBy(sort, order) {
  switch (sort) {
    case "score": return [{ finalScore: order }, { id: "asc" }];
    case "confidence": return [{ confidence: order }, { id: "asc" }];
    case "name": return [{ upload: { fileName: order } }, { id: "asc" }];
    default: return [{ upload: { capturedAt: order } }, { id: "asc" }];
  }
}

const sessionSelect = {
  id: true,
  projectId: true,
  folderId: true,
  folder: { select: { name: true } },
  status: true,
  mode: true,
  targetCount: true,
  totalImages: true,
  processedImages: true,
  keepCount: true,
  maybeCount: true,
  rejectCount: true,
  currentStage: true,
  progressPercent: true,
  engineVersion: true,
  scoringProfileVersion: true,
  providerRequestCount: true,
  analysisSource: true,
  awaitsUploads: true,
  engineVersions: true,
  error: true,
  startedAt: true,
  seededAt: true,
  completedAt: true,
  finalizedAt: true,
  createdByUserId: true,
  createdAt: true,
  updatedAt: true,
};

const resultSelect = {
  id: true,
  sessionId: true,
  uploadId: true,
  blurScore: true,
  exposureScore: true,
  technicalScore: true,
  faceCount: true,
  faceQualityScore: true,
  eyesOpenScore: true,
  expressionScore: true,
  similarityScore: true,
  aestheticScore: true,
  sceneLabel: true,
  sceneConfidence: true,
  compositionScore: true,
  uniquenessScore: true,
  finalScore: true,
  duplicateGroupId: true,
  burstGroupId: true,
  isGroupBest: true,
  duplicateRank: true,
  burstRank: true,
  similarGroupId: true,
  similarRank: true,
  aiDecision: true,
  userDecision: true,
  effectiveDecision: true,
  confidence: true,
  reasonCodes: true,
  analyzedAt: true,
  subjectScore: true,
  peopleCount: true,
  subjectPersonId: true,
  qualityScore: true,
  preferenceAdjustment: true,
  faceSharpnessScore: true,
  headPoseScore: true,
  expressionLabel: true,
  upload: { select: { id: true, fileName: true, folderId: true, capturedAt: true, thumbnailKey: true, previewKey: true, width: true, height: true } },
};

function createRepository(client = prisma) {
  // Shared by two methods below; a local rather than `this`, so the repository survives being
  // destructured or passed around as plain functions.
  const listFolders = (projectId) => client.imageSelectionFolder.findMany({ where: { projectId, deletedAt: null }, select: { id: true, parentId: true } });
  return {
    findProject: (projectId) => client.imageSelectionProject.findFirst({ where: { id: projectId, deletedAt: null }, select: { id: true, projectName: true } }),
    /**
     * One shoot folder and everything nested under it, as ids the scoped queries filter on —
     * the same walk the download manifest does. Null when the folder is not this project's,
     * so the caller can 404 instead of silently culling the wrong scope.
     */
    listFolders,
    folderSubtreeIds: async (projectId, folderId) => subtreeIds(await listFolders(projectId), folderId),
    // The scope's photos by upload status, as { STATUS: count }.
    countUploadsByStatus: async (projectId, folderIds = null) => {
      const rows = await client.imageSelectionUpload.groupBy({ by: ["status"], where: { projectId, ...(folderIds ? { folderId: { in: folderIds } } : {}) }, _count: { _all: true } });
      return Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
    },
    // Files still to come: for each batch in the scope that is still UPLOADING, what it announced
    // (`total_files`) less the uploads it has registered - two queries whatever the batch count.
    // A batch and its uploads carry the folder the uploader was opened on, so the scope reads the
    // batch's own folder. Stuck batches are closed as ABANDONED by the uploads module, so this
    // never counts a dead upload for ever.
    countAnnouncedUploads: async (projectId, folderIds = null) => {
      const batches = await client.imageSelectionUploadBatch.findMany({ where: { projectId, status: "UPLOADING", ...(folderIds ? { folderId: { in: folderIds } } : {}) }, select: { id: true, totalFiles: true } });
      if (!batches.length) return 0;
      const registered = await client.imageSelectionUpload.groupBy({ by: ["batchId"], where: { projectId, batchId: { in: batches.map((batch) => batch.id) } }, _count: { _all: true } });
      const counts = new Map(registered.map((row) => [row.batchId, row._count._all]));
      return batches.reduce((sum, batch) => sum + Math.max(0, batch.totalFiles - (counts.get(batch.id) || 0)), 0);
    },
    // Photos the desktop registered (`register-batch`: PROCESSING, no batch) that no upload batch
    // has claimed yet - the same files the batch then announces, so they are counted once as the
    // rows, never again as the announcement. A browser upload's rows carry their batch from the
    // start, so none of them is ever counted here.
    countPendingWithoutBatch: (projectId, folderIds = null) => client.imageSelectionUpload.count({ where: { projectId, status: { in: ["PENDING", "UPLOADING", "PROCESSING"] }, batchId: null, ...(folderIds ? { folderId: { in: folderIds } } : {}) } }),
    // A run's AI confidence spread over the photos it decided: high from CONFIDENCE_LINES.HIGH, low
    // below CONFIDENCE_LINES.LOW (the LOW_CONFIDENCE line), medium between; null when it decided
    // none. One pass over the session's rows (their (session_id, ...) index), values bound.
    confidenceSummary: async (sessionId) => {
      const [row] = await client.$queryRaw`
        SELECT COUNT(confidence) AS total,
               COALESCE(SUM(confidence >= ${CONFIDENCE_LINES.HIGH}), 0) AS high,
               COALESCE(SUM(confidence < ${CONFIDENCE_LINES.LOW}), 0) AS low,
               AVG(confidence) AS average
        FROM image_selection_culling_result
        WHERE session_id = ${sessionId}`;
      const total = Number(row?.total) || 0;
      if (!total) return null;
      const high = Number(row.high) || 0;
      const low = Number(row.low) || 0;
      return { high, medium: total - high - low, low, average: Math.round((Number(row.average) || 0) * 100) / 100 };
    },
    // Photos added through the AI Culling tab and not yet released (any upload status).
    countHeld: (projectId, folderIds = null) => client.imageSelectionUpload.count({ where: { projectId, cullingHoldAt: { not: null }, status: { notIn: ["CANCELLED"] }, ...(folderIds ? { folderId: { in: folderIds } } : {}) } }),
    countReadyImages: (projectId, folderIds = null) => client.imageSelectionUpload.count({ where: { projectId, status: "READY", ...(folderIds ? { folderId: { in: folderIds } } : {}) } }),
    // Photos in the scope that this session holds no result row for: everything processed after
    // the run seeded. Reported, never silently absorbed.
    countReadyNotInSession: (projectId, folderIds, sessionId) => client.imageSelectionUpload.count({ where: { projectId, status: "READY", ...(folderIds ? { folderId: { in: folderIds } } : {}), cullingResults: { none: { sessionId } } } }),
    // "Active" = a run that can still move on its own. One at a time per SCOPE — a shoot culls
    // independently of its neighbours, but two engines over the same photos would be a race.
    findActiveSession: (projectId, folderId = null) => client.imageSelectionCullingSession.findFirst({ where: { projectId, folderId, status: { in: ACTIVE_STATUSES } }, select: sessionSelect }),
    // Every run still moving in the project, with its scope, so a new run can refuse to overlap one.
    listActiveSessions: (projectId) => client.imageSelectionCullingSession.findMany({ where: { projectId, status: { in: ACTIVE_STATUSES } }, select: { id: true, folderId: true, folder: { select: { name: true } } } }),
    // The workspace shows the scope's most recent run whatever became of it, so a FAILED session
    // is seen rather than silently replaced by an empty intro panel.
    findLatestSession: (projectId, folderId = null) => client.imageSelectionCullingSession.findFirst({ where: { projectId, folderId }, orderBy: { createdAt: "desc" }, select: sessionSelect }),
    findSession: (projectId, sessionId) => client.imageSelectionCullingSession.findFirst({ where: sessionWhere(projectId, sessionId), select: sessionSelect }),
    findSessionById: (sessionId) => client.imageSelectionCullingSession.findUnique({ where: { id: sessionId }, select: sessionSelect }),
    createSession: (data) => client.imageSelectionCullingSession.create({ data, select: sessionSelect }),
    updateSession: (sessionId, data) => client.imageSelectionCullingSession.update({ where: { id: sessionId }, data, select: sessionSelect }),
    // Guarded write: only moves the session when it is still in one of `fromStatuses`, so a cancel
    // that lands mid-run and the worker's own completion cannot overwrite each other.
    transitionSession: (sessionId, fromStatuses, data) => client.imageSelectionCullingSession.updateMany({ where: { id: sessionId, status: { in: fromStatuses } }, data }),
    // A write that lands only on a run still waiting (QUEUED, never handed over): the hand-over mark
    // and a mode change both go through it, so a cancel or another hand-over in the same moment
    // cannot be written over - `count` says whether it landed.
    updateWaitingSession: (sessionId, data) => client.imageSelectionCullingSession.updateMany({ where: { id: sessionId, status: "QUEUED", startedAt: null }, data }),
    listSessionsForRecovery: () => client.imageSelectionCullingSession.findMany({ where: recoveryWhere(), select: { id: true } }),
    // Runs that began with an import and still wait for their photos: what the last landing photo hands over.
    listAwaitingSessions: (projectId) => client.imageSelectionCullingSession.findMany({ where: { projectId, status: "QUEUED", awaitsUploads: true, startedAt: null }, select: sessionSelect }),
    // The desktop hand-off. Pending: READY photos in scope this session holds no technical stamp
    // for, with the trail the workstation resolves against its own storage-root mapping. Keyset
    // paged on `id > cursor`, not Prisma's cursor: the workstation posts signals while it walks,
    // so the cursor row has usually left the set by the next page — a cursor-plus-skip would then
    // skip a photo that is still pending.
    listPendingUploads: (projectId, folderIds, sessionId, cursor, take) => client.imageSelectionUpload.findMany({
      where: { projectId, status: "READY", ...(folderIds ? { folderId: { in: folderIds } } : {}), ...(cursor ? { id: { gt: cursor } } : {}), OR: [{ cullingResults: { none: { sessionId } } }, { cullingResults: { some: { sessionId, analyzedAt: null } } }] },
      select: { id: true, fileName: true, folderId: true, originalPath: true, storageRootId: true, sizeBytes: true, sourceChecksum: true, capturedAt: true, faceScan: { select: { status: true } } },
      orderBy: { id: "asc" },
      take,
    }),
    // The subject stage's reads: the project's people with how many READY photos each is in and
    // the role the photographer gave them; a session's rows with the face stage's details; and
    // the People filter's mappings for a page of photos, grouped by photo.
    // Every person of the project with how many READY photos each is in, oldest first (the
    // numbering's tiebreak). `withCover` joins the cover face and the clearest remaining mapped
    // face (the gallery's own fallback) for the strip; the subject stage reads only roles and counts.
    listPersonsWithCounts: async (projectId, { withCover = false } = {}) => {
      const image = { select: { id: true, thumbnailKey: true, width: true, height: true } };
      const cover = withCover ? { coverBox: true, coverImage: image, mappings: { where: { image: { status: "READY" } }, orderBy: { quality: "desc" }, take: 1, select: { box: true, image } } } : {};
      const [persons, counts] = await Promise.all([
        client.imageSelectionFacePerson.findMany({ where: { projectId }, select: { id: true, role: true, createdAt: true, ...cover }, orderBy: { createdAt: "asc" } }),
        client.imageSelectionFaceMapping.groupBy({ by: ["personId"], where: { projectId, image: { status: "READY" } }, _count: { _all: true } }),
      ]);
      const photoCounts = new Map(counts.map((row) => [row.personId, row._count._all]));
      return persons.map((person) => ({ ...person, photoCount: photoCounts.get(person.id) || 0 }));
    },
    // The photos a run decided one way - its Keeps, usually - as ids, for the sends that take a
    // whole decision rather than ticks (AI Culling → AI Editing / Signature Album). The session
    // must be this project's; a decision not named reads as KEEP.
    // `limit`: only the first that many, in the run's own (result id) order - the same photos on
    // every ask, so a send asked for twice never picks a different set.
    listSessionUploadIds: async (projectId, sessionId, decision = "KEEP", { limit = null } = {}) => {
      const session = await client.imageSelectionCullingSession.findFirst({ where: sessionWhere(projectId, sessionId), select: { id: true } });
      if (!session) return null;
      // `decision: null` is every photo the run analysed, whatever its verdict.
      const rows = await client.imageSelectionCullingResult.findMany({ where: { sessionId: session.id, ...(decision ? { effectiveDecision: decision } : {}) }, select: { uploadId: true }, orderBy: { id: "asc" }, ...(limit ? { take: limit } : {}) });
      return rows.map((row) => row.uploadId);
    },
    // The CLIP scene label the latest culling run gave this photo (scene/engine.js), for AI
    // Editing's scene-aware auto edit; null when no run has read it or the read was unsure.
    findLatestSceneLabel: async (uploadId) => {
      const row = await client.imageSelectionCullingResult.findFirst({ where: { uploadId, sceneLabel: { not: null } }, orderBy: { id: "desc" }, select: { sceneLabel: true, sceneConfidence: true } });
      return row && (row.sceneConfidence == null || row.sceneConfidence >= 0.4) ? row.sceneLabel : null;
    },
    listResultsForSubjects: (sessionId, cursor, take) => client.imageSelectionCullingResult.findMany({ where: { sessionId, ...(cursor ? { id: { gt: cursor } } : {}) }, select: { id: true, uploadId: true, reasonCodes: true, eyesOpenScore: true, faceDetails: true }, orderBy: { id: "asc" }, take }),
    listMappingsForUploads: async (projectId, uploadIds) => {
      const rows = await client.imageSelectionFaceMapping.findMany({ where: { projectId, imageId: { in: uploadIds }, image: { status: "READY" } }, select: { imageId: true, personId: true, box: true, quality: true } });
      const grouped = {};
      for (const row of rows) (grouped[row.imageId] ||= []).push({ personId: row.personId, box: row.box, quality: row.quality });
      return grouped;
    },
    // Project-scoped: a person id from another gallery updates nothing, and the caller 404s.
    updatePersonRole: async (projectId, personId, role) => (await client.imageSelectionFacePerson.updateMany({ where: { id: personId, projectId }, data: { role } })).count,
    findUploadsForSignals: (projectId, uploadIds) => client.imageSelectionUpload.findMany({ where: { projectId, id: { in: uploadIds } }, select: { id: true, status: true, folderId: true } }),
    // The codes already on a session's rows, by upload, so a stage's new codes can be merged in.
    findResultCodes: async (sessionId, uploadIds) => Object.fromEntries((await client.imageSelectionCullingResult.findMany({ where: { sessionId, uploadId: { in: uploadIds } }, select: { uploadId: true, reasonCodes: true } })).map((row) => [row.uploadId, Array.isArray(row.reasonCodes) ? row.reasonCodes : []])),
    // One batch of signals, atomically — and only while the run is still waiting: the guarded
    // touch on the session row is re-checked inside the transaction, so a hand-over that landed
    // after the service's read makes the whole batch answer null instead of overwriting what the
    // worker is now stamping. Rows that do not exist yet are seeded (skipDuplicates keeps a
    // resend free), then each row takes its numbers and stamps. Up to 200 rows: the timeout is
    // sized for a slow server, not Prisma's default five seconds.
    upsertSignals: (sessionId, writes) =>
      client.$transaction(async (transaction) => {
        const waiting = await transaction.imageSelectionCullingSession.updateMany({ where: { id: sessionId, status: "QUEUED", analysisSource: "DESKTOP", startedAt: null }, data: { updatedAt: new Date() } });
        if (!waiting.count) return null;
        await transaction.imageSelectionCullingResult.createMany({ data: writes.map((write) => ({ sessionId, uploadId: write.uploadId })), skipDuplicates: true });
        for (const write of writes) await transaction.imageSelectionCullingResult.updateMany({ where: { sessionId, uploadId: write.uploadId }, data: write.data });
        return writes.length;
      }, { timeout: 30000 }),
    mergeEngineVersions: async (sessionId, versions) => {
      const current = await client.imageSelectionCullingSession.findUnique({ where: { id: sessionId }, select: { engineVersions: true } });
      const merged = { ...((current?.engineVersions && typeof current.engineVersions === "object") ? current.engineVersions : {}), ...versions };
      await client.imageSelectionCullingSession.update({ where: { id: sessionId }, data: { engineVersions: merged } });
    },
    // Cursor-paged READY uploads for the worker to seed result rows from, scoped to the
    // session's folder subtree when it has one. Ordered by id so the cursor is stable.
    listReadyUploadIds: (projectId, folderIds, cursor, take) => client.imageSelectionUpload.findMany({ where: { projectId, status: "READY", ...(folderIds ? { folderId: { in: folderIds } } : {}) }, select: { id: true }, orderBy: { id: "asc" }, take, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) }),
    // skipDuplicates makes seeding idempotent against the (sessionId, uploadId) unique key: a
    // retried job re-covers its range and creates nothing twice.
    createResults: (rows) => client.imageSelectionCullingResult.createMany({ data: rows, skipDuplicates: true }),
    countResults: (sessionId) => client.imageSelectionCullingResult.count({ where: { sessionId } }),
    // The analysis work queue: rows not yet stamped. No cursor — an analyzed row (stamped even on
    // per-photo failure) drops out of the where, so "take the next page" is simply this again.
    listUnanalyzedResults: (sessionId, take) => client.imageSelectionCullingResult.findMany({ where: { sessionId, analyzedAt: null }, select: { id: true, uploadId: true, upload: { select: { previewKey: true, processedName: true, fileName: true } } }, orderBy: { id: "asc" }, take }),
    updateResult: (resultId, data) => client.imageSelectionCullingResult.update({ where: { id: resultId }, data }),
    countAnalyzedResults: (sessionId) => client.imageSelectionCullingResult.count({ where: { sessionId, analyzedAt: { not: null } } }),
    // The face-stage work queue, stamped separately from the technical stage so each resumes on
    // its own after a retry.
    listUnfaceResults: (sessionId, take) => client.imageSelectionCullingResult.findMany({ where: { sessionId, faceAnalyzedAt: null }, select: { id: true, sessionId: true, uploadId: true, reasonCodes: true, upload: { select: { previewKey: true, processedName: true, fileName: true } } }, orderBy: { id: "asc" }, take }),
    countFaceAnalyzedResults: (sessionId) => client.imageSelectionCullingResult.count({ where: { sessionId, faceAnalyzedAt: { not: null } } }),
    // The cross-session cache: this photo's newest face verdict from the same provider, from any
    // earlier session — a re-run copies it instead of paying the provider again.
    findCachedFaceSignals: (uploadId, faceProvider, excludeSessionId) => client.imageSelectionCullingResult.findFirst({ where: { uploadId, faceProvider, faceAnalyzedAt: { not: null }, sessionId: { not: excludeSessionId } }, orderBy: { faceAnalyzedAt: "desc" }, select: { faceCount: true, faceSharpnessScore: true, headPoseScore: true, expressionLabel: true, faceQualityScore: true, eyesOpenScore: true, expressionScore: true, reasonCodes: true, faceDetails: true } }),
    incrementProviderRequests: (sessionId, count) => client.imageSelectionCullingSession.update({ where: { id: sessionId }, data: { providerRequestCount: { increment: count } } }),
    // Everything the grouping pass needs, paged by id — it holds the session's rows in memory
    // (a few dozen bytes each), never the images.
    listResultsForGrouping: (sessionId, cursor, take) => client.imageSelectionCullingResult.findMany({ where: { sessionId }, select: { id: true, uploadId: true, reasonCodes: true, perceptualHash: true, structureSignature: true, technicalScore: true, faceCount: true, faceQualityScore: true, eyesOpenScore: true, expressionScore: true, headPoseScore: true, subjectScore: true, upload: { select: { folderId: true, capturedAt: true, fileName: true } } }, orderBy: { id: "asc" }, take, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) }),
    createGroup: (data) => client.imageSelectionCullingGroup.create({ data, select: { id: true, type: true } }),
    // Everything the ranking pass blends, paged by id. Group context lives on the row itself
    // (isGroupBest and the two pointers), so no join is needed.
    listResultsForRanking: (sessionId, cursor, take) => client.imageSelectionCullingResult.findMany({ where: { sessionId }, select: { id: true, reasonCodes: true, technicalScore: true, faceCount: true, faceQualityScore: true, eyesOpenScore: true, expressionScore: true, subjectScore: true, aestheticScore: true, compositionScore: true, sceneLabel: true, sceneConfidence: true, subjectPersonId: true, isGroupBest: true, duplicateGroupId: true, burstGroupId: true, similarGroupId: true, similarRank: true, userDecision: true, faceSharpnessScore: true, headPoseScore: true, expressionLabel: true, blurScore: true, exposureScore: true, peopleCount: true, duplicateRank: true, burstRank: true, uploadId: true, upload: { select: { id: true, folderId: true, capturedAt: true } } }, orderBy: { id: "asc" }, take, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) }),
    // Regrouping starts clean: deleting the groups SetNulls every member's group pointer, so a
    // photo that no longer chains with anything is not left claiming it does.
    deleteSessionGroups: (sessionId) => client.imageSelectionCullingGroup.deleteMany({ where: { sessionId } }),
    // A regroup starts from nothing: the keeper flag and both ranks are cleared on every row that
    // carried any of them, so a frame that leaves every group keeps no stale rank.
    resetGroupFlags: (sessionId) => client.imageSelectionCullingResult.updateMany({ where: { sessionId, OR: [{ isGroupBest: true }, { duplicateRank: { not: null } }, { burstRank: { not: null } }, { similarRank: { not: null } }] }, data: { isGroupBest: false, duplicateRank: null, burstRank: null, similarRank: null } }),
    // Each photo's stored CLIP image embedding (the scene cache keeps one engine version per photo).
    listSceneEmbeddings: (uploadIds) => (uploadIds.length ? client.imageSelectionUploadScene.findMany({ where: { uploadId: { in: uploadIds }, embedding: { not: null } }, select: { uploadId: true, embedding: true } }) : []),
    countGroupsByType: async (sessionId) => { const rows = await client.imageSelectionCullingGroup.groupBy({ by: ["type"], where: { sessionId }, _count: { _all: true } }); return Object.fromEntries(rows.map((row) => [row.type, row._count._all])); },
    listGroups: (sessionId, { type, page, pageSize }) =>
      client.imageSelectionCullingGroup.findMany({
        where: { sessionId, ...(type ? { type } : {}) },
        select: {
          id: true,
          type: true,
          representativeUploadId: true,
          memberCount: true,
          groupScore: true,
          duplicateResults: { select: resultSelect },
          burstResults: { select: resultSelect },
          similarResults: { select: resultSelect },
        },
        orderBy: { id: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    countGroups: (sessionId, type) => client.imageSelectionCullingGroup.count({ where: { sessionId, ...(type ? { type } : {}) } }),
    listResults: (sessionId, { page, pageSize, filter, sort = "captured", order = "asc", scene = null }) =>
      client.imageSelectionCullingResult.findMany({
        where: { sessionId, ...resultFilterWhere(filter), ...(scene ? { sceneLabel: scene, sceneConfidence: { gte: 0.4 } } : {}) },
        select: resultSelect,
        orderBy: resultOrderBy(sort, order),
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    countResultsByFilter: (sessionId, filter, scene = null) => client.imageSelectionCullingResult.count({ where: { sessionId, ...resultFilterWhere(filter), ...(scene ? { sceneLabel: scene, sceneConfidence: { gte: 0.4 } } : {}) } }),
    // Phase 8: one photographer's learned-preference switch and reset point, their overrides of AI
    // calls (latest first, since the reset, bounded), and the profile a run snapshotted.
    findPreference: (userId) => client.imageSelectionCullingPreference.findUnique({ where: { userId } }),
    upsertPreference: (userId, data) => client.imageSelectionCullingPreference.upsert({ where: { userId }, create: { userId, ...data }, update: data }),
    // The photographer's overrides since their reset (latest per photo wins), and every photo of the
    // ten most recent runs they overrode in, with the AI's call: the baseline taste is read against.
    // Bounded: 5,000 overrides, 20,000 photos.
    listPreferenceRows: async (userId, since) => {
      // Prisma drops an undefined filter: without a user this would read everybody's decisions.
      if (userId === null || userId === undefined) return [];
      const feedback = await client.imageSelectionCullingFeedback.findMany({
        where: { userId, ...(since ? { createdAt: { gt: since } } : {}) },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 5000,
        select: { resultId: true, newDecision: true, result: { select: { sessionId: true } } },
      });
      const latest = new Map();
      const sessions = [];
      for (const row of feedback) {
        if (!latest.has(row.resultId)) latest.set(row.resultId, row.newDecision);
        const sessionId = row.result?.sessionId;
        if (sessionId && !sessions.includes(sessionId) && sessions.length < 10) sessions.push(sessionId);
      }
      if (!sessions.length) return [];
      const rows = await client.imageSelectionCullingResult.findMany({ where: { sessionId: { in: sessions }, aiDecision: { not: null } }, orderBy: { id: "asc" }, select: { id: true, aiDecision: true, effectiveDecision: true, duplicateGroupId: true, burstGroupId: true, reasonCodes: true, sceneLabel: true, sceneConfidence: true }, take: 20000 });
      // Culling V2: how each photo was decided (this photographer's decision events on it, oldest
      // first) weighs it as evidence, and a reject whose duplicate or burst twin was kept is relative.
      const events = await client.imageSelectionCullingDecisionEvent.findMany({
        where: { sessionId: { in: sessions }, userId, kind: { in: ["DECIDE", "CLEAR", "VIEWED"] }, resultId: { not: null }, ...(since ? { createdAt: { gt: since } } : {}) },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 60000,
        select: { resultId: true, kind: true, source: true, platform: true, batchSize: true, fromDecision: true, toDecision: true, createdAt: true },
      });
      const eventsOf = new Map();
      for (const event of events) { if (!eventsOf.has(event.resultId)) eventsOf.set(event.resultId, []); eventsOf.get(event.resultId).push(event); }
      const keptGroups = new Set();
      for (const row of rows) if (row.effectiveDecision === "KEEP") for (const groupId of [row.duplicateGroupId, row.burstGroupId]) if (groupId) keptGroups.add(groupId);
      return rows.map((row) => ({
        aiDecision: row.aiDecision,
        newDecision: latest.get(row.id) ?? null,
        reasonCodes: row.reasonCodes,
        sceneLabel: row.sceneLabel,
        sceneConfidence: row.sceneConfidence,
        events: eventsOf.get(row.id) || [],
        lostToTwin: [row.duplicateGroupId, row.burstGroupId].some((groupId) => groupId && keptGroups.has(groupId)),
      }));
    },
    // Culling V2: this photographer's burst-winner picks since their reset - the frame they made a
    // group's best and the AI's keeper it replaced (the group's first order before any change),
    // with the signals the keeper merit reads. Bounded to their latest 2,000 picks.
    listGroupChoices: async (userId, since) => {
      if (userId === null || userId === undefined) return [];
      const events = await client.imageSelectionCullingDecisionEvent.findMany({
        where: { userId, kind: "GROUP_BEST", groupId: { not: null }, ...(since ? { createdAt: { gt: since } } : {}) },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 2000,
        select: { sessionId: true, groupId: true, groupOrder: true, createdAt: true },
      });
      // Per group: the AI's keeper is the first "before" in time, the chosen frame the last "after".
      const byGroup = new Map();
      for (const event of [...events].reverse()) {
        const order = event.groupOrder || {};
        const entry = byGroup.get(event.groupId) || {};
        if (!entry.aiPick && Array.isArray(order.before) && order.before.length) entry.aiPick = order.before[0];
        if (Array.isArray(order.after) && order.after.length) entry.chosen = order.after[0];
        byGroup.set(event.groupId, entry);
      }
      const pairs = [...byGroup.values()].filter((entry) => entry.aiPick && entry.chosen && entry.aiPick !== entry.chosen);
      if (!pairs.length) return [];
      const ids = [...new Set(pairs.flatMap((entry) => [entry.aiPick, entry.chosen]))].filter((id) => typeof id === "string");
      // The ids were written by the server into the photographer's own events; the frames are still
      // read only inside the runs those picks were made in.
      const sessionIds = [...new Set(events.map((event) => event.sessionId).filter(Boolean))];
      const signals = await client.imageSelectionCullingResult.findMany({ where: { id: { in: ids }, sessionId: { in: sessionIds } }, select: { id: true, technicalScore: true, eyesOpenScore: true, expressionScore: true, faceQualityScore: true, faceCount: true } });
      const byId = new Map(signals.map((row) => [row.id, row]));
      return pairs.filter((entry) => byId.has(entry.aiPick) && byId.has(entry.chosen)).map((entry) => ({ chosen: byId.get(entry.chosen), aiPick: byId.get(entry.aiPick) }));
    },
    findSessionPreference: async (sessionId) => (await client.imageSelectionCullingSession.findUnique({ where: { id: sessionId }, select: { preferenceProfile: true } }))?.preferenceProfile || null,
    // Phase 7: the live story coverage of a settled run, from the EFFECTIVE decisions — per sure
    // scene (never an accidental one) how many photos and how many Keeps, and how many key people
    // (the subject stage's KEY_PEOPLE_PRESENT subjects) appear in the run and in a Keep.
    coverageCounts: async (sessionId, accidentalScenes = []) => {
      const sceneWhere = { sessionId, sceneLabel: { not: null, notIn: accidentalScenes }, sceneConfidence: { gte: 0.4 } };
      const peopleWhere = { sessionId, subjectPersonId: { not: null }, reasonCodes: { array_contains: REASON_CODES.KEY_PEOPLE_PRESENT } };
      const [scenesAll, scenesKept, peopleAll, peopleKept] = await Promise.all([
        client.imageSelectionCullingResult.groupBy({ by: ["sceneLabel"], where: sceneWhere, _count: { _all: true } }),
        client.imageSelectionCullingResult.groupBy({ by: ["sceneLabel"], where: { ...sceneWhere, effectiveDecision: "KEEP" }, _count: { _all: true } }),
        client.imageSelectionCullingResult.groupBy({ by: ["subjectPersonId"], where: peopleWhere }),
        client.imageSelectionCullingResult.groupBy({ by: ["subjectPersonId"], where: { ...peopleWhere, effectiveDecision: "KEEP" } }),
      ]);
      const kept = new Map(scenesKept.map((row) => [row.sceneLabel, row._count._all]));
      return { scenes: Object.fromEntries(scenesAll.map((row) => [row.sceneLabel, { total: row._count._all, kept: kept.get(row.sceneLabel) || 0 }])), people: { total: peopleAll.length, kept: peopleKept.length } };
    },
    // Phase 6: how many photos of a session each scene holds, for the review's scene picker.
    countScenes: async (sessionId, accidentalScenes = []) => { const rows = await client.imageSelectionCullingResult.groupBy({ by: ["sceneLabel"], where: { sessionId, sceneLabel: { not: null, notIn: accidentalScenes }, sceneConfidence: { gte: 0.4 } }, _count: { _all: true } }); return Object.fromEntries(rows.map((row) => [row.sceneLabel, row._count._all])); },
    // The scene stage's reads and the cross-session cache (image_selection_upload_scene).
    listResultsForScene: (sessionId, cursor, take) => client.imageSelectionCullingResult.findMany({ where: { sessionId, ...(cursor ? { id: { gt: cursor } } : {}) }, select: { id: true, uploadId: true, reasonCodes: true, faceDetails: true, upload: { select: { id: true, previewKey: true, processedName: true } } }, orderBy: { id: "asc" }, take }),
    findSceneCache: (uploadIds, engineVersion) => (uploadIds.length ? client.imageSelectionUploadScene.findMany({ where: { uploadId: { in: uploadIds }, engineVersion }, select: { uploadId: true, engineVersion: true, sceneLabel: true, sceneConfidence: true, accidental: true, aestheticRaw: true } }) : []),
    // A photo's readings from older engine versions are never read again (the cache key is the exact
    // version), so the stage drops them for the photos it just read: bounded by the page.
    pruneSceneCache: (uploadIds, engineVersion) => (uploadIds.length ? client.imageSelectionUploadScene.deleteMany({ where: { uploadId: { in: uploadIds }, engineVersion: { not: engineVersion } } }) : null),
    saveSceneCache: (rows) => client.imageSelectionUploadScene.createMany({ data: rows.map((row) => ({ uploadId: row.uploadId, engineVersion: row.engineVersion, sceneLabel: row.sceneLabel ?? null, sceneConfidence: row.sceneConfidence ?? null, accidental: Boolean(row.accidental), aestheticRaw: row.aestheticRaw ?? null, embedding: row.embedding ?? null })), skipDuplicates: true }),
    findResult: (sessionId, resultId) => client.imageSelectionCullingResult.findFirst({ where: { id: resultId, sessionId }, select: resultSelect }),
    /**
     * Photographer decisions, one or many, atomically: the rows move, one feedback row per photo
     * records what changed (the raw material for a later preference model), and the session's
     * counts are recounted inside the same transaction so the header can never drift from the
     * gallery. Returns null when any id is not this session's — nothing is half-applied.
     */
    // `meta.source`: how the decision was made, for the decision-event log (training-label
    // quality). One event per photo whose own decision changed - confirming the AI's call counts,
    // repeating the same decision does not - with the gap since this photographer's last event.
    applyDecisions: (sessionId, resultIds, decision, userId, meta = null) =>
      client.$transaction(async (transaction) => {
        const rows = await transaction.imageSelectionCullingResult.findMany({ where: { id: { in: resultIds }, sessionId }, select: { id: true, aiDecision: true, userDecision: true, effectiveDecision: true } });
        if (rows.length !== resultIds.length) return null;
        const feedback = [];
        const events = [];
        for (const row of rows) {
          const effective = decision || row.aiDecision || "PENDING";
          // Always written: clearing an override must null userDecision even when the effective
          // answer happens not to move (user said KEEP where the AI already had).
          await transaction.imageSelectionCullingResult.update({ where: { id: row.id }, data: { userDecision: decision, effectiveDecision: effective } });
          if (effective !== row.effectiveDecision) feedback.push({ resultId: row.id, userId: userId ?? null, previousDecision: row.effectiveDecision, newDecision: effective });
          if ((row.userDecision ?? null) !== (decision ?? null)) events.push({ sessionId, resultId: row.id, userId: userId ?? null, kind: decision ? "DECIDE" : "CLEAR", fromDecision: row.effectiveDecision, toDecision: effective, source: meta?.source || "UNKNOWN", platform: meta?.platform || "WEB", batchSize: resultIds.length });
        }
        if (feedback.length) await transaction.imageSelectionCullingFeedback.createMany({ data: feedback });
        if (events.length) {
          const last = userId ? await transaction.imageSelectionCullingDecisionEvent.findFirst({ where: { sessionId, userId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }) : null;
          const gap = last ? Math.min(2147483647, Math.max(0, Date.now() - new Date(last.createdAt).getTime())) : null;
          await transaction.imageSelectionCullingDecisionEvent.createMany({ data: events.map((event) => ({ ...event, msSincePrevious: gap })) });
        }
        const grouped = await transaction.imageSelectionCullingResult.groupBy({ by: ["effectiveDecision"], where: { sessionId }, _count: { _all: true } });
        const countOf = (value) => grouped.find((entry) => entry.effectiveDecision === value)?._count._all || 0;
        const counts = { keep: countOf("KEEP"), maybe: countOf("MAYBE"), reject: countOf("REJECT"), pending: countOf("PENDING") };
        await transaction.imageSelectionCullingSession.update({ where: { id: sessionId }, data: { keepCount: counts.keep, maybeCount: counts.maybe, rejectCount: counts.reject } });
        return { updated: rows.length, counts };
      }),
    findGroup: (sessionId, groupId) => client.imageSelectionCullingGroup.findFirst({ where: { id: groupId, sessionId }, select: { id: true, type: true, representativeUploadId: true, memberCount: true, groupScore: true, duplicateResults: { select: resultSelect }, burstResults: { select: resultSelect }, similarResults: { select: resultSelect } } }),
    // The compare view's swap: the group's representative changes and each member's flag and
    // group badges are rewritten to the plan the service computed.
    // `event`: the GROUP_BEST decision event (the group's order before and after), written with the change.
    // `recount`: the session id whose Keep / Maybe / Reject counts follow re-derived AI calls.
    applyGroupBest: (groupId, groupData, memberUpdates, event = null, { recount = null } = {}) =>
      client.$transaction(async (transaction) => {
        await transaction.imageSelectionCullingGroup.update({ where: { id: groupId }, data: groupData });
        for (const update of memberUpdates) await transaction.imageSelectionCullingResult.update({ where: { id: update.id }, data: update.data });
        if (event) await transaction.imageSelectionCullingDecisionEvent.create({ data: event });
        if (recount) {
          const grouped = await transaction.imageSelectionCullingResult.groupBy({ by: ["effectiveDecision"], where: { sessionId: recount }, _count: { _all: true } });
          const countOf = (value) => grouped.find((entry) => entry.effectiveDecision === value)?._count._all || 0;
          await transaction.imageSelectionCullingSession.update({ where: { id: recount }, data: { keepCount: countOf("KEEP"), maybeCount: countOf("MAYBE"), rejectCount: countOf("REJECT") } });
        }
      }),
    // Photos seen (grid) or opened (preview) during review: one VIEWED event per photo per source
    // per photographer per run (opening a photo already seen in the grid is a second, stronger
    // signal), only for photos of this run. Returns how many were new.
    recordViews: async (sessionId, userId, resultIds, source, platform = "WEB") => {
      const members = await client.imageSelectionCullingResult.findMany({ where: { sessionId, id: { in: resultIds } }, select: { id: true } });
      const seen = new Set((await client.imageSelectionCullingDecisionEvent.findMany({ where: { sessionId, userId: userId ?? null, kind: "VIEWED", source, resultId: { in: members.map((row) => row.id) } }, select: { resultId: true } })).map((row) => row.resultId));
      const fresh = members.filter((row) => !seen.has(row.id));
      if (fresh.length) await client.imageSelectionCullingDecisionEvent.createMany({ data: fresh.map((row) => ({ sessionId, resultId: row.id, userId: userId ?? null, kind: "VIEWED", source, platform })) });
      return fresh.length;
    },
    // A shadow model's verdicts on one run, replacing any earlier pass (a re-rank).
    replaceShadowResults: (sessionId, modelId, records) =>
      client.$transaction(async (transaction) => {
        await transaction.imageSelectionCullingShadowResult.deleteMany({ where: { sessionId, modelId } });
        for (let index = 0; index < records.length; index += 1000) {
          await transaction.imageSelectionCullingShadowResult.createMany({ data: records.slice(index, index + 1000).map((record) => ({ sessionId, modelId, ...record })) });
        }
      }),
    updateGroup: (id, data) => client.imageSelectionCullingGroup.update({ where: { id }, data }),
    findGroupsByIds: (ids) => client.imageSelectionCullingGroup.findMany({ where: { id: { in: ids } }, select: { id: true, type: true, representativeUploadId: true } }),
    findPublication: (projectId) => client.imageSelectionGalleryPublication.findUnique({ where: { projectId }, select: { status: true, selectionSubmittedAt: true } }),
    /**
     * Finalize, atomically: the guarded status move, then the stamps — on exactly the photos this
     * session analyzed, and nothing else. Any older stamp on those photos is cleared first (this
     * run's verdict is the newest word on them, whichever run hid them before), then every
     * non-KEEP is stamped with this session's id. A photo the client already selected — per-item
     * or the legacy flag — is NEVER stamped: hiding it would orphan the client's own picks. A
     * photo outside the session (uploaded after it seeded, or in another scope) is untouched.
     * Returns what happened, or null if the session had already moved (a race loses cleanly).
     */
    finalizeSession: (sessionId, projectId) =>
      client.$transaction(async (transaction) => {
        const moved = await transaction.imageSelectionCullingSession.updateMany({ where: { id: sessionId, projectId, status: "REVIEW_READY" }, data: { status: "FINALIZED", finalizedAt: new Date() } });
        if (!moved.count) return null;
        const analyzedHere = { cullingResults: { some: { sessionId } } };
        await transaction.imageSelectionUpload.updateMany({ where: { projectId, ...analyzedHere, cullRejectedAt: { not: null } }, data: { cullRejectedAt: null, cullRejectedSessionId: null } });
        // Photos imported for culling were held for this verdict. AI Culling is the stage before
        // AI Editing: the Keeps among them move into the editing bay (held for editing), and every
        // analyzed photo's culling hold is lifted - the rest are stamped below and stay hidden.
        // From the review a finalized run's Keeps can also be sent straight to Photo Selection
        // (service.sendKeepsToPhotoSelection), which is AI Editing's own release of each photo. A
        // photo culled where it already was (a Photo Selection upload) was never held and stays
        // where it is.
        const keeps = { cullingResults: { some: { sessionId, effectiveDecision: "KEEP" } } };
        await transaction.imageSelectionUpload.updateMany({ where: { projectId, ...keeps, cullingHoldAt: { not: null }, editingHoldAt: null }, data: { editingHoldAt: new Date() } });
        await transaction.imageSelectionUpload.updateMany({ where: { projectId, ...analyzedHere, cullingHoldAt: { not: null } }, data: { cullingHoldAt: null } });
        const notKeep = { cullingResults: { some: { sessionId, effectiveDecision: { not: "KEEP" } } } };
        const protectedCount = await transaction.imageSelectionUpload.count({ where: { projectId, ...notKeep, OR: [{ photoSelections: { some: {} } }, { selected: true }] } });
        const stamped = await transaction.imageSelectionUpload.updateMany({ where: { projectId, ...notKeep, photoSelections: { none: {} }, selected: false }, data: { cullRejectedAt: new Date(), cullRejectedSessionId: sessionId } });
        return { excluded: stamped.count, protected: protectedCount };
      }),
    /**
     * The controlled undo: the stamps this session left are cleared and the session goes back to
     * review. Each photo it settled then returns to the newest OTHER finalized run's verdict
     * (stampOwnership.olderVerdicts), so undoing a shoot cull never un-hides what an earlier
     * project-wide cull still rejects. A photo a later finalize owns is left to that run. Client
     * picks are never stamped. Project-scoped like every write here.
     */
    /**
     * Runs `work` with this project's row locked (SELECT … FOR UPDATE) inside one transaction,
     * handing it a repository bound to that transaction: a second caller waits for the first to
     * commit, then reads what it wrote. Used by start() so overlapping runs cannot both be made.
     */
    withProjectLock: (projectId, work) =>
      client.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT id FROM image_selection_project WHERE id = ${projectId} FOR UPDATE`;
        return work(createRepository(transaction));
      }, { timeout: 15000 }),
    reopenSession: (sessionId, projectId) =>
      client.$transaction(async (transaction) => {
        const moved = await transaction.imageSelectionCullingSession.updateMany({ where: { id: sessionId, projectId, status: "FINALIZED" }, data: { status: "REVIEW_READY", finalizedAt: null } });
        if (!moved.count) return null;
        const clearedIds = (await transaction.imageSelectionUpload.findMany({ where: { projectId, cullRejectedSessionId: sessionId }, select: { id: true } })).map((upload) => upload.id);
        await transaction.imageSelectionUpload.updateMany({ where: { projectId, cullRejectedSessionId: sessionId }, data: { cullRejectedAt: null, cullRejectedSessionId: null } });
        const released = await transaction.imageSelectionUpload.findMany({ where: { projectId, cullRejectedAt: null, cullingResults: { some: { sessionId } } }, select: { id: true } });
        for (let index = 0; index < released.length; index += REOPEN_CHUNK) {
          const ids = released.slice(index, index + REOPEN_CHUNK).map((upload) => upload.id);
          const rows = await transaction.imageSelectionCullingResult.findMany({
            where: { uploadId: { in: ids }, sessionId: { not: sessionId }, session: { projectId, status: "FINALIZED" } },
            select: { uploadId: true, sessionId: true, effectiveDecision: true, session: { select: { finalizedAt: true } } },
          });
          const owners = olderVerdicts(rows.map((row) => ({ ...row, finalizedAt: row.session.finalizedAt })));
          const bySession = new Map();
          for (const [uploadId, owner] of owners) bySession.set(owner, [...(bySession.get(owner) || []), uploadId]);
          for (const [owner, uploadIds] of bySession) {
            await transaction.imageSelectionUpload.updateMany({ where: { id: { in: uploadIds }, projectId, cullRejectedAt: null, photoSelections: { none: {} }, selected: false }, data: { cullRejectedAt: new Date(), cullRejectedSessionId: owner } });
          }
        }
        // Restored = the photos this run had hidden that are visible again.
        let restored = 0;
        for (let index = 0; index < clearedIds.length; index += REOPEN_CHUNK) {
          restored += await transaction.imageSelectionUpload.count({ where: { id: { in: clearedIds.slice(index, index + REOPEN_CHUNK) }, cullRejectedAt: null } });
        }
        return { restored };
      }),
  };
}

module.exports = createRepository();
module.exports.createRepository = createRepository;
module.exports.sessionSelect = sessionSelect;
module.exports.sessionWhere = sessionWhere;
module.exports.recoveryWhere = recoveryWhere;
module.exports.resultFilterWhere = resultFilterWhere;
module.exports.resultOrderBy = resultOrderBy;
