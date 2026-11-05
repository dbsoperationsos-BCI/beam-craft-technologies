const repository = require("./repository");
const { finalizedSessionUploadIds } = require("./finalizedKeeps");
const defaultProgress = require("./progress");
const {
  SESSION_STATUSES,
  ACTIVE_STATUSES,
  STAGES,
  SUPPORTED_MODES,
  REASON_CODES,
  GROUP_TYPES,
  ANALYSIS_SOURCES,
  ENGINE_VERSION,
  SCORING_PROFILE_VERSION,
  MODES,
  DECISIONS,
  LOCAL_SOURCE_CODES,
} = require("./constants");

const { subtreeIds, scopesOverlap } = require("./scope");

function httpError(status, message, details) { const error = new Error(message); error.status = status; if (details) error.details = details; return error; }

/**
 * What a FAILED session says to the photographer. The raw error (a Prisma message, an AWS
 * throttle, a Redis address) goes to the server log; the session carries one line that says what
 * to do next. Pure, so the mapping is pinned by tests.
 */
function safeFailureMessage(error) {
  const text = String(error?.message ?? error ?? "");
  if (error?.name === "TimeoutError" || error?.name === "AbortError" || /preview fetch failed|no preview derivative/i.test(text)) {
    return "Some photo previews could not be read from storage. Check that the photos are processed, then start a new run.";
  }
  if (/shoot folder/i.test(text)) return "The shoot folder this run covered no longer exists. Start a new run over a folder that does.";
  return "Culling stopped because of a server error. Start a new run, and tell the studio's administrator if it happens again.";
}

// Off means "the routes answer honestly that the feature is unavailable", not "the module is
// absent" — a project that already holds sessions can still read them. Read at call time so a
// test (or an operator) can flip it without a restart.
const cullingEnabled = () => process.env.AI_CULLING_ENABLED !== "false";

// How many result rows one seeding page covers. Matches the recovery page size in processing.
const SEED_BATCH_SIZE = 500;

/**
 * May a new culling run start? Pure so the tests can hold the whole rulebook in one place.
 * One active run per project: two engines writing verdicts over the same photos is a race.
 * Zero processed photos is refused for the same reason publishing refuses it — a run over
 * nothing can only produce a confusing empty result. Unsupported modes are refused rather
 * than accepted-and-faked; the list grows as the analysis phases land.
 */
function startPlan({ enabled, activeSession, overlappingSession = null, readyCount, mode, targetCount = null, awaitUploads = false, expectedCount = null }) {
  if (!enabled) throw httpError(503, "AI culling is disabled on this server.");
  if (activeSession) throw httpError(409, "A culling run is already in progress for this project.");
  // Two runs whose photos meet — the whole project and one of its shoots, a shoot and one of its
  // cards — would each hand verdicts to the same photos; the second waits or cancels the first.
  if (overlappingSession) throw httpError(409, `A culling run is already in progress for ${overlappingSession.folder?.name || "the whole project"} — wait for it to finish or cancel it first.`);
  // A run that begins with the import is sized by what the import announced: its photos are
  // still arriving, and the one that has landed is not the measure of the shoot.
  const expected = awaitUploads ? Math.max(Number(readyCount) || 0, Number(expectedCount) || 0) : readyCount;
  if (!expected) throw httpError(409, awaitUploads ? "Nothing is being imported - add photos to start AI culling." : "Process at least one image before starting AI culling.");
  if (!SUPPORTED_MODES.includes(mode)) throw httpError(422, `Culling mode ${mode} is not available yet.`);
  checkTarget(mode, targetCount, expected);
  return { totalImages: expected, targetCount: mode === "TARGET_COUNT" ? targetCount : null, awaitsUploads: Boolean(awaitUploads) };
}

/** TARGET_COUNT needs a target below the photo count it will be measured against; said with both numbers. */
function checkTarget(mode, targetCount, photoCount) {
  if (mode !== "TARGET_COUNT") return;
  if (!targetCount) throw httpError(422, "Target count mode needs a target — how many photos should the cull aim for?");
  if (targetCount >= photoCount) throw httpError(422, `The target (${targetCount}) must be below the photo count (${photoCount}) — there is nothing to cull otherwise.`, { targetUnreachable: true, targetCount, photoCount });
}

/**
 * May this session be cancelled? Only a run that can still move on its own — cancelling a
 * finished or failed run would rewrite history the photographer may already be reading.
 */
function cancelPlan(session) {
  if (!session) throw httpError(404, "Culling session not found.");
  if (!ACTIVE_STATUSES.includes(session.status)) throw httpError(409, `A ${session.status.toLowerCase().replace(/_/g, " ")} session cannot be cancelled.`);
  return { fromStatuses: ACTIVE_STATUSES };
}

/**
 * May the photographer write decisions into this session? Only once the run is review-ready:
 * an active run's ranking pass would immediately overwrite the counts, and a finalized or
 * cancelled run is history.
 */
function decisionPlan(session) {
  if (!session) throw httpError(404, "Culling session not found.");
  if (ACTIVE_STATUSES.includes(session.status)) throw httpError(409, "The culling run is still processing — decisions open once it is review ready.");
  if (session.status !== SESSION_STATUSES.REVIEW_READY) throw httpError(409, `A ${session.status.toLowerCase().replace(/_/g, " ")} session no longer accepts decisions.`);
  return true;
}

/**
 * May this session be finalized, and does it need the high-impact acknowledgement first? The
 * hard refusals: only a review-ready session finalizes, and never one whose effective KEEPs
 * are zero — hiding every photo is not a cull, it is an accident. The acknowledgements: Maybe
 * and still-pending photos will be excluded (never silently converted — the photographer is
 * told and confirms), and finalizing under a currently PUBLISHED gallery changes what the
 * client sees mid-selection. The 409 carries the exact counts so the retry dialog can say them.
 */
function finalizePlan({ session, published, acknowledge }) {
  if (!session) throw httpError(404, "Culling session not found.");
  if (ACTIVE_STATUSES.includes(session.status)) throw httpError(409, "The culling run is still processing — it can be finalized once it is review ready.");
  if (session.status === SESSION_STATUSES.FINALIZED) throw httpError(409, "This culling session is already finalized.");
  if (session.status !== SESSION_STATUSES.REVIEW_READY) throw httpError(409, `A ${session.status.toLowerCase().replace(/_/g, " ")} session cannot be finalized.`);
  if (!session.keepCount) throw httpError(409, "Finalizing would send no photos on to AI Editing — mark at least one photo Keep first.");
  const pendingCount = Math.max(0, session.totalImages - session.keepCount - session.maybeCount - session.rejectCount);
  const undecidedCount = session.maybeCount + pendingCount;
  if ((undecidedCount > 0 || published) && !acknowledge) {
    throw httpError(409, "Finalizing needs confirmation.", {
      requiresAcknowledgement: true,
      undecidedCount,
      maybeCount: session.maybeCount,
      pendingCount,
      keepCount: session.keepCount,
      galleryPublished: Boolean(published),
    });
  }
  return true;
}

/**
 * May a finalized session be reopened? Only FINALIZED reopens, and doing it under a live
 * published gallery — where the hidden photos would reappear to the client — asks first.
 */
function reopenPlan({ session, published, acknowledge }) {
  if (!session) throw httpError(404, "Culling session not found.");
  if (session.status !== SESSION_STATUSES.FINALIZED) throw httpError(409, "Only a finalized session can be reopened.");
  if (published && !acknowledge) {
    throw httpError(409, "Reopening needs confirmation.", { requiresAcknowledgement: true, galleryPublished: true });
  }
  return true;
}

/**
 * The compare view's "mark another frame as best", as a pure plan over the group's members.
 * Badges follow the swap — in a DUPLICATE group the redundant frames carry the badge, in a
 * BURST group the best frame does — and `isGroupBest` is recomputed from BOTH of a member's
 * group memberships, so a frame that stays the best of its other group keeps its flag. The
 * AI's decisions are not rewritten: which frames to keep is exactly what the photographer is
 * in the middle of deciding.
 */
function groupBestPlan(group, members, targetResultId, otherGroupsById = new Map()) {
  if (!group) throw httpError(404, "Culling group not found.");
  const target = members.find((member) => member.id === targetResultId);
  if (!target) throw httpError(404, "That photo is not a member of this group.");
  // A similar series is relative only: the chosen frame ranks first and the others are its
  // alternates. Its keep/reject flag (`isGroupBest`) belongs to duplicates and bursts, untouched.
  if (group.type === GROUP_TYPES.SIMILAR) {
    const rest = members.map((member, index) => ({ member, index })).filter(({ member }) => member.id !== targetResultId);
    rest.sort((a, b) => ((a.member.similarRank ?? Number.MAX_SAFE_INTEGER) - (b.member.similarRank ?? Number.MAX_SAFE_INTEGER)) || a.index - b.index);
    const ordered = [target, ...rest.map(({ member }) => member)];
    return {
      groupData: { representativeUploadId: target.upload?.id || target.uploadId, groupScore: target.technicalScore ?? null },
      memberUpdates: ordered.map((member, index) => {
        const codes = (Array.isArray(member.reasonCodes) ? member.reasonCodes : []).filter((code) => code !== REASON_CODES.ALTERNATE_FRAME);
        if (index > 0) codes.push(REASON_CODES.ALTERNATE_FRAME);
        return { id: member.id, data: { similarRank: index + 1, reasonCodes: codes } };
      }),
    };
  }
  // The chosen frame is rank 1; the others keep their order behind it.
  const rankKey = group.type === GROUP_TYPES.DUPLICATE ? "duplicateRank" : "burstRank";
  const rest = members.map((member, index) => ({ member, index })).filter(({ member }) => member.id !== targetResultId);
  // Rows from before ranks have none: they keep their stored order (a rank-less pair must not compare as NaN).
  rest.sort((a, b) => ((a.member[rankKey] ?? Number.MAX_SAFE_INTEGER) - (b.member[rankKey] ?? Number.MAX_SAFE_INTEGER)) || a.index - b.index);
  const ordered = [target, ...rest.map(({ member }) => member)];
  const ranks = new Map(ordered.map((member, index) => [member.id, index + 1]));
  const updates = members.map((member) => {
    const otherGroupId = group.type === GROUP_TYPES.DUPLICATE ? member.burstGroupId : member.duplicateGroupId;
    const otherGroup = otherGroupId ? otherGroupsById.get(otherGroupId) : null;
    const bestHere = member.id === targetResultId;
    const bestElsewhere = Boolean(otherGroup && otherGroup.representativeUploadId === member.uploadId);
    const codes = (Array.isArray(member.reasonCodes) ? member.reasonCodes : []).filter((code) => code !== REASON_CODES.DUPLICATE && code !== REASON_CODES.BEST_IN_BURST);
    const inDuplicate = group.type === GROUP_TYPES.DUPLICATE ? true : Boolean(otherGroup && otherGroup.type === GROUP_TYPES.DUPLICATE);
    const bestOfDuplicate = group.type === GROUP_TYPES.DUPLICATE ? bestHere : bestElsewhere;
    if (inDuplicate && !bestOfDuplicate) codes.push(REASON_CODES.DUPLICATE);
    const inBurst = group.type === GROUP_TYPES.BURST ? true : Boolean(otherGroup && otherGroup.type === GROUP_TYPES.BURST);
    const bestOfBurst = group.type === GROUP_TYPES.BURST ? bestHere : bestElsewhere;
    if (inBurst && bestOfBurst) codes.push(REASON_CODES.BEST_IN_BURST);
    return { id: member.id, data: { isGroupBest: bestHere || bestElsewhere, reasonCodes: codes, [rankKey]: ranks.get(member.id) } };
  });
  return {
    groupData: { representativeUploadId: target.upload?.id || target.uploadId, groupScore: target.technicalScore ?? null },
    memberUpdates: updates,
  };
}

/**
 * What "this one is the keeper" means for the AI's recommendations - the photographer's own
 * decisions are never touched. Marking a frame as a group's best is an explicit statement about
 * that group, so the AI's call for its members is re-derived as if the AI had picked that frame:
 *  - BALANCED / STRICT: every member is re-scored by the same rules with its new group flags
 *    (the chosen frame is no longer a "redundant duplicate"; the old keeper now is).
 *  - TARGET_COUNT: the run's count is the photographer's target, so the chosen frame and the
 *    previous keeper trade the AI's calls - the selected set keeps its size.
 *  - ASSISTED: the AI made no calls; nothing to re-derive.
 * `members` carry their scoring signals and their NEW group flags. Returns one update per member
 * whose AI call is re-derived: { id, aiDecision, confidence, finalScore, qualityScore,
 * effectiveDecision, rankingCodes }, where effectiveDecision keeps any photographer decision.
 */
function groupDecisionPlan(members, { mode, previousBestId = null, targetId = null } = {}) {
  const { scorePhoto } = require("./analysis/scoring");
  const effective = (member, aiDecision) => member.userDecision || aiDecision || DECISIONS.PENDING;
  if (mode === MODES.BALANCED || mode === MODES.STRICT) {
    return members.map((member) => {
      const scored = scorePhoto(member, mode);
      return { id: member.id, aiDecision: scored.aiDecision, confidence: scored.confidence, finalScore: scored.finalScore, qualityScore: scored.qualityScore, rankingCodes: scored.rankingCodes, effectiveDecision: effective(member, scored.aiDecision) };
    });
  }
  if (mode === MODES.TARGET_COUNT) {
    const chosen = members.find((member) => member.id === (targetId || members.find((other) => other.isGroupBest && other.id !== previousBestId)?.id));
    const previous = members.find((member) => member.id === previousBestId);
    if (!chosen || !previous || chosen.id === previous.id || chosen.aiDecision === previous.aiDecision) return [];
    const swap = (member, from) => ({ id: member.id, aiDecision: from.aiDecision, confidence: from.confidence ?? null, rankingCodes: [], effectiveDecision: effective(member, from.aiDecision) });
    return [swap(chosen, previous), swap(previous, chosen)];
  }
  return [];
}

/**
 * One desktop-analyzed photo's face columns. A desktop running the shared face engine posts its
 * raw readings (`faces.engine`), and they are read with the very functions a server run uses -
 * one face intelligence, two places it runs. An older desktop's own numbers are taken as they
 * are, eyes unknown. Returns { data, reasonCodes }.
 */
function desktopFaceWrite(faces) {
  if (faces.engine) {
    const { engineFacesToFaceDetails } = require("./providers/insightface.provider");
    const { faceSignals, faceDetailsOf } = require("./analysis/faces");
    const details = engineFacesToFaceDetails(faces.engine);
    const signals = faceSignals(details);
    return {
      data: { faceCount: signals.faceCount, faceQualityScore: signals.faceQualityScore, eyesOpenScore: signals.eyesOpenScore, expressionScore: signals.expressionScore, faceSharpnessScore: signals.faceSharpnessScore, headPoseScore: signals.headPoseScore, expressionLabel: signals.expressionLabel, faceDetails: faceDetailsOf(details) },
      reasonCodes: signals.reasonCodes,
    };
  }
  const data = { faceCount: faces.faceCount, faceQualityScore: faces.faceQualityScore, eyesOpenScore: faces.eyesOpenScore, expressionScore: faces.expressionScore };
  // The face stage's own shape (analysis/faces.js faceDetailsOf), eyes unknown.
  if (faces.details) data.faceDetails = faces.details.map((face) => ({ box: face.box, confidence: face.confidence, eyesOpen: null }));
  return { data, reasonCodes: faces.reasonCodes || [] };
}

// `sceneWarmup`: what reads the scene of photos held for culling as they land (scene/backfill
// `heldForCulling`); null switches it off, undefined resolves the real one lazily.
// `photoSelectionSender`: what carries photos into Photo Selection - AI Editing's own send, the
// one release every photo takes on that way; undefined builds the real service lazily.
// AI Editing's send takes a slice at a time (its SEND_MAX_PER_REQUEST); the Keeps go in slices of this many.
const PHOTO_SELECTION_SEND_SLICE = 100;

function createAiCullingService(repo = repository, { queue, progress = defaultProgress, desktopAiEnabled, engines, sceneWarmup, photoSelectionSender } = {}) {
  const jobQueue = queue || require("./queue");
  const sceneWarmupOf = () => (sceneWarmup !== undefined ? sceneWarmup : require("./scene/backfill").heldForCulling);
  let realSender = null;
  const senderOf = () => photoSelectionSender || realSender || (realSender = require("../ai-editing/service").createAiEditingService());
  // Which optional engines a run started now would use — plain yes/no for the workspace's stage
  // list, never a model name or a reason. Injectable for the tests.
  const engineAvailability = engines || (() => {
    try {
      return { faces: Boolean(require("./providers").activeFaceProvider()), scene: require("./scene/engine").sceneEngine.health().status !== "disabled" };
    } catch {
      // A provider that cannot even be asked is not one a run would use; the overview still answers.
      return { faces: false, scene: false };
    }
  });
  const r2 = require("../storage/r2");
  // The desktop switch, read at call time like every other flag; injectable for the tests.
  const localAnalysisOffered = desktopAiEnabled || (() => require("../../desktop/flags").desktopAiEnabled());

  // A session the workstation is still analyzing: desktop-sourced, still QUEUED and — unless the
  // caller is the hand-over itself — not yet handed over (`startedAt` is the hand-over mark, set
  // by `run` before the worker ever moves the status, so there is no in-between).
  async function requireDesktopWaiting(projectId, sessionId, { handedOver = false } = {}) {
    const session = await repo.findSession(projectId, sessionId);
    if (!session) throw httpError(404, "Culling session not found.");
    // A run that began with the import waits the same way whichever side measures its photos; only
    // the hand-over may take a server-analyzed one, since nobody posts signals for it.
    if (session.analysisSource !== ANALYSIS_SOURCES.DESKTOP && !(handedOver && session.awaitsUploads)) throw httpError(409, "This run is analyzed on the server, not on a workstation.");
    if (session.status !== SESSION_STATUSES.QUEUED || (!handedOver && session.startedAt)) throw httpError(409, "The server has this run now — the workstation's signals are no longer accepted.");
    return session;
  }

  async function requireProject(projectId) {
    const project = await repo.findProject(projectId);
    if (!project) throw httpError(404, "Image Selection project not found.");
    return project;
  }

  // Photos of a scope still on their way: announced by an upload batch and not registered, or
  // registered and not yet READY. A run that began with the import is handed over only at zero.
  async function scopeInFlight(projectId, folderIds) {
    const [byStatus, announced, unclaimed] = await Promise.all([
      repo.countUploadsByStatus ? repo.countUploadsByStatus(projectId, folderIds) : {},
      repo.countAnnouncedUploads ? repo.countAnnouncedUploads(projectId, folderIds) : 0,
      repo.countPendingWithoutBatch ? repo.countPendingWithoutBatch(projectId, folderIds) : 0,
    ]);
    const of = (...statuses) => statuses.reduce((sum, status) => sum + (Number(byStatus[status]) || 0), 0);
    // Files a batch announced and has not registered are on their way - unless the desktop already
    // registered them as PENDING originals (register-batch, before the batch): those are the same
    // files, counted once as the rows, not again as the announcement.
    const stillToCome = Math.max(0, (Number(announced) || 0) - (Number(unclaimed) || 0));
    return { uploading: of("UPLOADING", "PENDING") + stillToCome, processing: of("PROCESSING"), ready: of("READY"), failed: of("PROCESSING_FAILED") };
  }

  // A culling scope: null folder means the whole project; a folder means that shoot's subtree,
  // 404ing when the folder is not this project's.
  async function resolveScope(projectId, folderId) {
    if (!folderId) return null;
    const folderIds = await repo.folderSubtreeIds(projectId, folderId);
    if (!folderIds) throw httpError(404, "Folder not found in this project.");
    return folderIds;
  }

  // R2 keys become URLs here, exactly the way the gallery serializes its images: the public
  // bucket URL when the derivative lives in R2, else the authenticated API media route.
  function serializeResult(projectId, result) {
    if (!result || !result.upload) return result;
    const { upload, ...rest } = result;
    const base = `/api/image-selection/projects/${encodeURIComponent(projectId)}/gallery/${encodeURIComponent(upload.id)}`;
    const { thumbnailKey, previewKey, ...uploadRest } = upload;
    return { ...rest, upload: { ...uploadRest, thumbnailUrl: r2.publicUrl(thumbnailKey) || `${base}/thumbnail`, previewUrl: r2.publicUrl(previewKey) || `${base}/preview` } };
  }

  // A group's members best first, each carrying its `rank` in this group (1 = the keeper). Rows
  // from before similarity v2 have no rank: they keep their stored order and say null.
  function groupMembers(projectId, group, members) {
    const rankOf = (member) => (group.type === GROUP_TYPES.DUPLICATE ? member.duplicateRank : group.type === GROUP_TYPES.SIMILAR ? member.similarRank : member.burstRank) ?? null;
    return members
      .map((member, index) => ({ member, index, rank: rankOf(member) }))
      .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.index - b.index)
      .map(({ member, rank }) => ({ ...serializeResult(projectId, member), rank }));
  }

  // Phase 8. One photographer's profile since their last reset: every photo of the runs they
  // overrode in, with the AI's call and their latest override of it (or none), so taste is read
  // against their own baseline rather than as "what they touched".
  // Fitting reads up to 25,000 rows, so a profile is reused for a minute per photographer (the
  // panel and the next start share it) and recomputed at once when they reset or record a
  // decision of their own; a start with the switch off reads nothing at all.
  const profileCache = new Map();
  async function learnedProfileOf(userId, { skipWhenOff = false } = {}) {
    const { learnProfile, learnGroupTaste, preferenceRowOf } = require("./analysis/preferences");
    const preference = repo.findPreference ? await repo.findPreference(userId) : null;
    if (skipWhenOff && preference?.enabled === false) return { preference, profile: null };
    const key = preference?.resetAt ? new Date(preference.resetAt).toISOString() : "";
    const cached = profileCache.get(userId);
    if (cached && cached.key === key && Date.now() - cached.at < PROFILE_CACHE_MS) return { preference, profile: cached.profile };
    const rows = repo.listPreferenceRows ? await repo.listPreferenceRows(userId, preference?.resetAt ?? null) : [];
    // Culling V2: each photo weighted by how it was decided, a lost-to-its-twin reject set aside,
    // and the photographer's burst-winner picks learned on their own (relative, never quality).
    const profile = learnProfile(rows.map(preferenceRowOf));
    const choices = repo.listGroupChoices ? await repo.listGroupChoices(userId, preference?.resetAt ?? null) : [];
    profile.groupTaste = learnGroupTaste(choices);
    profileCache.set(userId, { key, at: Date.now(), profile });
    return { preference, profile };
  }

  async function requireReviewableSession(projectId, sessionId) {
    const session = await repo.findSession(projectId, sessionId);
    decisionPlan(session);
    return session;
  }

  return {
    // Everything the culling workspace needs in one read: the newest session whatever its state,
    // the photo count a fresh run would cover, and whether starting is possible at all.
    // Scoped to one shoot folder when `folderId` is given — each shoot culls on its own.
    async overview(projectId, folderId = null) {
      await requireProject(projectId);
      const folderIds = await resolveScope(projectId, folderId);
      const [session, readyCount, flight] = await Promise.all([repo.findLatestSession(projectId, folderId), repo.countReadyImages(projectId, folderIds), scopeInFlight(projectId, folderIds)]);
      // Where the scope's photos are in the upload lifecycle (files an upload batch announced but
      // has not registered yet are on their way too - without them the tab would call a folder
      // Ready between two files of the same upload), so an empty folder, a folder still uploading
      // or processing, and a folder ready to cull each say so. Cancelled and abandoned uploads are
      // not photos the studio has.
      const photoCounts = { ready: flight.ready, processing: flight.processing, uploading: flight.uploading, failed: flight.failed };
      photoCounts.total = photoCounts.ready + photoCounts.processing + photoCounts.uploading + photoCounts.failed;
      // Of those, the ones added through this tab and still waiting for culling before Photo Selection.
      photoCounts.held = repo.countHeld ? Number(await repo.countHeld(projectId, folderIds)) || 0 : 0;
      // The settled run's AI confidence spread (high / medium / low and the average).
      let confidence = null;
      // A session's keep/maybe/reject live as stored counters, but its substance is the result
      // rows — and deleting the photos cascade-deletes those. A settled session whose rows are
      // all gone is STALE: its numbers describe photos that no longer exist, and showing them
      // as live (with a Finalize button and an empty gallery under counted chips) is a lie.
      // The flag lets the workspace say so instead.
      let stale = false;
      let filterCounts = null;
      // Photos processed after the run seeded are not part of it: they are neither analyzed nor
      // hidden by finalize, and the workspace says so rather than letting the numbers drift.
      let newPhotoCount = 0;
      // Phase 6: the run's scenes with the studio's words and counts, for the review's scene picker;
      // empty when no scene ran.
      let scenes = [];
      // Phase 7: the live story coverage (follows overrides); null when there is nothing to say.
      let coverage = null;
      if (session && (session.status === SESSION_STATUSES.REVIEW_READY || session.status === SESSION_STATUSES.FINALIZED)) {
        const resultCount = await repo.countResults(session.id);
        stale = session.totalImages > 0 && resultCount === 0;
        if (!stale) {
          const facets = ["low_confidence", "duplicates", "best_of_burst", "blur", "closed_eyes", "unanalyzed", "accidental", "cut_faces"];
          const values = await Promise.all(facets.map((facet) => repo.countResultsByFilter(session.id, facet)));
          filterCounts = Object.fromEntries(facets.map((facet, index) => [facet, values[index]]));
          newPhotoCount = await repo.countReadyNotInSession(projectId, folderIds, session.id);
          const profile = require("./scene/profile");
          scenes = profile.scenesOf(repo.countScenes ? await repo.countScenes(session.id, profile.accidentalSceneIds()) : {});
          coverage = repo.coverageCounts ? profile.coverageOf(await repo.coverageCounts(session.id, profile.uncountedSceneIds())) : null;
          confidence = repo.confidenceSummary ? await repo.confidenceSummary(session.id) : null;
        }
      }
      // Group rows carry no FK to uploads, so they outlive the photos — never shown for a
      // stale session, where "18 duplicate groups" would describe nothing.
      const counts = session && !stale ? await repo.countGroupsByType(session.id) : {};
      const { total, ready, processing, uploading, failed, held } = photoCounts;
      // A run that began with the import, still waiting: how many of its photos carry technical
      // signals already, so both apps can say "analyzed 12 of 54" while the rest arrive.
      let importing = null;
      if (session && session.status === SESSION_STATUSES.QUEUED && !session.startedAt && session.awaitsUploads) {
        const analyzed = repo.countAnalyzedResults ? Number(await repo.countAnalyzedResults(session.id)) || 0 : 0;
        importing = { analyzed, inFlight: processing + uploading, ready, settled: processing + uploading === 0, problem: null };
        if (importing.settled && session.mode === "TARGET_COUNT" && Number(session.targetCount) >= ready) importing.problem = ready ? `The target (${session.targetCount}) must be below the ${ready} photo${ready === 1 ? "" : "s"} that landed - there is nothing to cull otherwise.` : "None of the imported photos could be processed, so there is nothing to cull.";
        // A server-analyzed import run whose scope settled without a landing to announce it (the
        // last photo failed, a batch was abandoned) is handed over by the next read of this tab.
        if (importing.settled && ready && !importing.problem && session.analysisSource !== ANALYSIS_SOURCES.DESKTOP) {
          this.run(projectId, session.id).then(() => progress.publish(session.id, repo)).catch(() => {});
        }
      }
      return { session, readyCount, enabled: cullingEnabled(), stale, groupCounts: { duplicate: counts.DUPLICATE || 0, burst: counts.BURST || 0 }, filterCounts, newPhotoCount, scenes, coverage, photoCounts: { total, ready, processing, uploading, failed, held }, importing, confidence, engines: engineAvailability() };
    },

    async start(projectId, { mode, targetCount = null, folderId = null, localAnalysis = false, awaitUploads = false, expectedCount = null }, userId) {
      await requireProject(projectId);
      // Analysis on the workstation is an offer the server makes, never a thing a client decides
      // alone: refused outright when the desktop switch is off, so a run is never left waiting
      // for signals nobody may send.
      if (localAnalysis && !localAnalysisOffered()) throw httpError(409, "Analysis on this computer is not switched on for this server (DESKTOP_AI_ENABLED). Start a run analyzed on the server instead.");
      const folderIds = await resolveScope(projectId, folderId);
      // Phase 8: the starter's learned preferences, snapshotted so the run is reproducible — only
      // with the switch on and enough evidence to mean something. Read before the lock below.
      let preferenceProfile;
      if (userId) {
        const { MIN_DECISIONS } = require("./analysis/preferences");
        const { preference, profile } = await learnedProfileOf(userId, { skipWhenOff: true });
        if (preference?.enabled !== false && profile && profile.decisions >= MIN_DECISIONS) preferenceProfile = { userId, decisions: profile.decisions, weights: profile.weights, ...(profile.groupTaste ? { groupTaste: profile.groupTaste } : {}) };
        // A burst-winner taste stands on its own evidence (its own five picks), even before enough corrections for the per-photo nudge.
        else if (preference?.enabled !== false && profile?.groupTaste) preferenceProfile = { userId, decisions: profile.decisions, weights: {}, groupTaste: profile.groupTaste };
      }
      // The overlap check and the create hold the project's row lock together, so two Starts at
      // the same moment (a double click, the web and the desktop) make one run, never two.
      const withProjectLock = repo.withProjectLock ? repo.withProjectLock.bind(repo) : (id, work) => work(repo);
      const session = await withProjectLock(projectId, async (locked) => {
        const [activeSession, readyCount, activeSessions] = await Promise.all([locked.findActiveSession(projectId, folderId), locked.countReadyImages(projectId, folderIds), locked.listActiveSessions(projectId)]);
        // Another run still moving whose photos meet this scope's: the whole project meets every
        // shoot, a shoot meets its own cards. Folder rows are read once for every comparison.
        let overlappingSession = null;
        if (activeSessions.length) {
          const folders = await locked.listFolders(projectId);
          // A run whose folder has since been deleted still covers that folder, nothing wider — it
          // must never read as "the whole project" and block every other scope for good.
          overlappingSession = activeSessions.find((other) => scopesOverlap(folderIds, other.folderId ? (subtreeIds(folders, other.folderId) ?? [other.folderId]) : null)) || null;
        }
        const plan = startPlan({ enabled: cullingEnabled(), activeSession, overlappingSession, readyCount, mode, targetCount, awaitUploads, expectedCount });
        return locked.createSession({
          projectId,
          folderId,
          mode,
          targetCount: plan.targetCount,
          status: SESSION_STATUSES.QUEUED,
          totalImages: plan.totalImages,
          engineVersion: ENGINE_VERSION,
          scoringProfileVersion: SCORING_PROFILE_VERSION,
          analysisSource: localAnalysis ? ANALYSIS_SOURCES.DESKTOP : ANALYSIS_SOURCES.SERVER,
          awaitsUploads: plan.awaitsUploads,
          createdByUserId: userId ?? null,
          ...(preferenceProfile ? { preferenceProfile } : {}),
        });
      });
      // A desktop-analyzed run waits, unqueued, for the workstation's signals and its `run`; a run
      // that began with the import waits for its photos the same way, whichever side measures them.
      if (!localAnalysis && !session.awaitsUploads) await jobQueue.enqueue(session.id);
      return session;
    },

    /**
     * The mode of a run that is still waiting - for its photos, or for the workstation - may
     * change until the hand-over: the import asked once, and a second thought costs nothing yet.
     * Checked against what the run will be measured on: the photos that have landed, or the
     * number the import announced while they are still arriving.
     */
    async update(projectId, sessionId, { mode, targetCount = null }) {
      const session = await repo.findSession(projectId, sessionId);
      if (!session) throw httpError(404, "Culling session not found.");
      if (session.status !== SESSION_STATUSES.QUEUED || session.startedAt) throw httpError(409, "The run has started - its mode can no longer change. Start a new run to cull differently.");
      if (!SUPPORTED_MODES.includes(mode)) throw httpError(422, `Culling mode ${mode} is not available yet.`);
      const folderIds = await resolveScope(projectId, session.folderId);
      const flight = await scopeInFlight(projectId, folderIds);
      // Against the import's announcement while photos are still arriving; against what landed once they all have.
      const measure = session.awaitsUploads && flight.uploading + flight.processing > 0 ? Math.max(flight.ready, Number(session.totalImages) || 0) : flight.ready;
      checkTarget(mode, targetCount, measure);
      const data = { mode, targetCount: mode === "TARGET_COUNT" ? targetCount : null };
      // Landed only while the run still waits: a hand-over in the same moment wins, and the
      // caller is told the run has started rather than having its mode changed under it.
      if (repo.updateWaitingSession) {
        const moved = await repo.updateWaitingSession(sessionId, data);
        if (!moved.count) throw httpError(409, "The run has started - its mode can no longer change. Start a new run to cull differently.");
        return repo.findSession(projectId, sessionId);
      }
      return repo.updateSession(sessionId, data);
    },

    /**
     * The desktop hand-off, part one: which photos in the run's scope still have no technical
     * signals, with the trail the workstation resolves against its own storage-root mapping.
     * Cursor-paged by id so a 50,000-photo shoot is walked, never loaded.
     */
    async pending(projectId, sessionId, { cursor = null, take = 200 } = {}) {
      const session = await requireDesktopWaiting(projectId, sessionId);
      const folderIds = await resolveScope(projectId, session.folderId);
      const rows = await repo.listPendingUploads(projectId, folderIds, sessionId, cursor, take);
      // `facesIndexed`: the people index already holds this photo (a scan that did not fail), so a
      // workstation describing it locally must not post its faces again — a re-post re-clusters.
      // `sizeBytes`: the original's recorded size, so the workstation opens exactly that file and
      // never a same-named one elsewhere under the root. A stored 0 means the size was never
      // known (an older register-batch), never a zero-byte file, so it goes out as null and the
      // workstation skips its size check. `sourceChecksum`: the BLAKE3 the desktop recorded when
      // it added the photo; the workstation verifies the file against it before analyzing.
      const items = rows.map(({ faceScan, ...item }) => ({ ...item, sizeBytes: Number(item.sizeBytes) > 0 ? Number(item.sizeBytes) : null, sourceChecksum: item.sourceChecksum || null, facesIndexed: Boolean(faceScan) && faceScan.status !== "FAILED" }));
      return { items, nextCursor: items.length === take ? items[items.length - 1].id : null };
    },

    /**
     * The desktop hand-off, part two: one batch of numbers. Every item is checked against the
     * run's own scope — a READY photo of this project inside the folder subtree — and anything
     * else is skipped by name rather than refusing the batch. Technical signals stamp the
     * technical stage, face signals the face stage; the engine that produced them is recorded on
     * the session so no later model change can silently reinterpret this run.
     */
    async ingestSignals(projectId, sessionId, { engine, items }) {
      const session = await requireDesktopWaiting(projectId, sessionId);
      const folderIds = await resolveScope(projectId, session.folderId);
      // The same photo twice in one batch is one write — the last one, as a resend would be.
      const unique = [...new Map(items.map((item) => [item.uploadId, item])).values()];
      const uploads = new Map((await repo.findUploadsForSignals(projectId, unique.map((item) => item.uploadId))).map((upload) => [upload.id, upload]));
      // Each stage owns its codes: a faces-only item leaves the technical badges in place and
      // vice versa — the worker's own stages keep exactly this discipline.
      const existingCodes = await repo.findResultCodes(sessionId, unique.map((item) => item.uploadId));
      const engineLabel = `${engine.name}@${engine.version}`;
      const writes = [];
      const skipped = [];
      const stamped = { technical: false, faces: false };
      for (const item of unique) {
        const upload = uploads.get(item.uploadId);
        if (!upload || upload.status !== "READY" || (folderIds && !folderIds.includes(upload.folderId))) { skipped.push({ uploadId: item.uploadId, reason: "not a processed photo of this scope" }); continue; }
        const data = {};
        let codes = Array.isArray(existingCodes?.[item.uploadId]) ? existingCodes[item.uploadId] : [];
        if (item.localSource) {
          // The workstation could not use the original (unmapped or offline root, a file that is
          // not the one recorded, a file its decoder cannot read): no numbers exist for this
          // photo, and none are to be made up from the preview in the original's place. Both
          // stages are stamped so the technical and face passes leave it alone, the scene stage
          // skips it by its code, and scoring reads ANALYSIS_FAILED as "the photographer decides"
          // (MAYBE, low confidence) with the badge saying why.
          const now = new Date();
          Object.assign(data, { analyzedAt: now, analysisSource: ANALYSIS_SOURCES.DESKTOP, faceAnalyzedAt: now, faceProvider: LOCAL_SOURCE_FACE_PROVIDER });
          data.reasonCodes = [...codes.filter((code) => !TECHNICAL_REASON_CODES.includes(code)), REASON_CODES.ANALYSIS_FAILED, item.localSource];
          writes.push({ uploadId: item.uploadId, data });
          continue;
        }
        if (item.technical) {
          // The signature travels with the hash: a re-post from an engine without it clears both to
          // that engine's answer, so a row never mixes two engines' technical signals.
          Object.assign(data, { blurScore: item.technical.blurScore, exposureScore: item.technical.exposureScore, technicalScore: item.technical.technicalScore, perceptualHash: item.technical.perceptualHash, structureSignature: item.technical.structureSignature ?? null, analyzedAt: new Date(), analysisSource: ANALYSIS_SOURCES.DESKTOP });
          codes = [...codes.filter((code) => !TECHNICAL_REASON_CODES.includes(code)), ...item.technical.reasonCodes];
          stamped.technical = true;
        }
        if (item.faces) {
          const faces = desktopFaceWrite(item.faces);
          Object.assign(data, faces.data, { faceAnalyzedAt: new Date(), faceProvider: engineLabel });
          codes = withFaceCodes(codes, faces.reasonCodes);
          stamped.faces = true;
        }
        data.reasonCodes = codes;
        writes.push({ uploadId: item.uploadId, data });
      }
      // The write re-checks, inside its transaction, that the run is still waiting: a hand-over
      // landing between the check above and the write loses nothing to a late batch.
      if (writes.length && (await repo.upsertSignals(sessionId, writes)) === null) throw httpError(409, "The server has this run now — the workstation's signals are no longer accepted.");
      const versions = {};
      if (stamped.technical) versions.technical = engineLabel;
      if (engine.preprocessVersion) versions.preprocess = engine.preprocessVersion;
      if (stamped.faces) versions.faces = engineLabel;
      if (Object.keys(versions).length) await repo.mergeEngineVersions(sessionId, versions);
      return { accepted: writes.length, skipped };
    },

    /**
     * The desktop hand-off, part three — and the "let the server finish" fallback from any app:
     * the worker takes the run from here. It seeds whatever rows are missing, reads previews only
     * for photos the workstation left unstamped, then groups and ranks exactly as a server run.
     */
    async run(projectId, sessionId, { force = false } = {}) {
      const session = await requireDesktopWaiting(projectId, sessionId, { handedOver: true });
      const handOverData = { startedAt: new Date(), currentStage: STAGES.PREPARING };
      // A run that began with the import is handed over once every photo of its scope has landed
      // - or on an explicit "let the server finish now", when what is still arriving becomes a
      // late photo. Its target is re-checked against the photos that actually landed: a target
      // the shoot cannot meet is said, with both numbers, and the run keeps waiting for a new one.
      if (session.awaitsUploads && !session.startedAt) {
        const folderIds = await resolveScope(projectId, session.folderId);
        const flight = await scopeInFlight(projectId, folderIds);
        if (!force && flight.uploading + flight.processing > 0) throw httpError(409, `${flight.uploading + flight.processing} photo${flight.uploading + flight.processing === 1 ? " is" : "s are"} still arriving - the run starts on its own when the last one lands.`, { importInProgress: true, ...flight });
        if (!flight.ready) throw httpError(409, "None of the imported photos could be processed, so there is nothing to cull.", { nothingReady: true, ...flight });
        checkTarget(session.mode, session.targetCount, flight.ready);
        handOverData.totalImages = flight.ready;
      }
      // The hand-over mark goes on the session before the queue: from here the workstation's
      // signals are refused, both apps stop showing "waiting", and asking again (a job lost to a
      // Redis flush) only re-enqueues the same job id. Written only onto a run still waiting: a
      // cancel landing in the same moment keeps its cancel, and the second of two hand-overs
      // finds the mark already there and simply re-enqueues the same job.
      if (!session.startedAt) {
        const moved = repo.updateWaitingSession ? await repo.updateWaitingSession(sessionId, handOverData) : await repo.updateSession(sessionId, handOverData).then(() => ({ count: 1 }));
        if (!moved.count) {
          const fresh = await repo.findSession(projectId, sessionId);
          if (!fresh || fresh.status !== SESSION_STATUSES.QUEUED) throw httpError(409, `The run was ${fresh ? fresh.status.toLowerCase().replace(/_/g, " ") : "removed"} before it could be handed over.`);
        }
      }
      await jobQueue.enqueue(session.id);
      return repo.findSession(projectId, sessionId);
    },

    async get(projectId, sessionId) {
      const session = await repo.findSession(projectId, sessionId);
      if (!session) throw httpError(404, "Culling session not found.");
      return session;
    },

    /**
     * A photo landed (or settled) in the project: every run that began with an import and still
     * waits is handed over if its scope has nothing left on the way - the server-analyzed ones
     * here, since nobody else would; a desktop-analyzed one is the workstation's to hand over
     * once its own analysis is done (the gate in `run` holds it the same way). Answers which runs
     * it handed over; never throws for one that could not go (a target the shoot cannot meet is
     * said on the run's own hand-over instead).
     */
    async uploadsLanded(projectId) {
      if (!repo.listAwaitingSessions) return [];
      const waiting = await repo.listAwaitingSessions(projectId);
      // Photos that landed for a run still importing get their scene read now, in the background,
      // so the run's own scene stage is a cache hit; a reader that is off or down answers false
      // and the stage reads them later, as it always could.
      if (waiting.length) {
        const warmup = sceneWarmupOf();
        if (warmup) Promise.resolve().then(() => warmup.pending(projectId)).catch((error) => console.warn(`[ai-culling] could not read scenes ahead of the import run of project ${projectId}: ${error.message}`));
      }
      const handed = [];
      for (const session of waiting) {
        if (session.analysisSource === ANALYSIS_SOURCES.DESKTOP) continue;
        try {
          const folderIds = await resolveScope(projectId, session.folderId);
          const flight = await scopeInFlight(projectId, folderIds);
          if (flight.uploading + flight.processing > 0 || !flight.ready) continue;
          await this.run(projectId, session.id);
          handed.push(session.id);
        } catch (error) {
          if (error.status !== 409 && error.status !== 422) throw error;
        }
      }
      return handed;
    },

    /**
     * A finalized run's Keeps straight to Photo Selection, from the review: the first `limit` of
     * them (or all) in the run's own order, carried by the one path every photo takes into Photo
     * Selection - AI Editing's send, which releases a photo as it is (its own record, its own
     * previews, nothing copied) or compresses its edit, skips one already there, and declines one
     * still waiting for its cull. Only a finalized run: its Keeps have had their verdict, and a
     * run still under review would send the AI's suggestions on unreviewed - and its photos still
     * carry the culling hold, which the send would refuse anyway. Idempotent: asked again, the
     * same photos answer "already there". Returns the send's own counts plus `total` asked for.
     */
    async sendKeepsToPhotoSelection(projectId, sessionId, { limit = null, force = false } = {}, userId) {
      const ids = await finalizedSessionUploadIds(repo, projectId, sessionId, "KEEP", { limit });
      const result = { total: ids.length, created: 0, released: 0, alreadyVisible: 0, alreadySent: [], skipped: 0, notCulled: 0 };
      const sender = senderOf();
      for (let index = 0; index < ids.length; index += PHOTO_SELECTION_SEND_SLICE) {
        const answer = await sender.sendToPhotoSelection(projectId, ids.slice(index, index + PHOTO_SELECTION_SEND_SLICE), { force }, userId);
        for (const [key, value] of Object.entries(answer || {})) {
          if (Array.isArray(value)) result[key] = [...(result[key] || []), ...value];
          else if (typeof value === "number") result[key] = (result[key] || 0) + value;
        }
      }
      return result;
    },

    async cancel(projectId, sessionId) {
      const session = await repo.findSession(projectId, sessionId);
      const plan = cancelPlan(session);
      // Guarded: if the worker finished between the read and this write, the run stays finished
      // and the caller is told what it became instead of a silent half-cancel.
      const moved = await repo.transitionSession(sessionId, plan.fromStatuses, { status: SESSION_STATUSES.CANCELLED, completedAt: new Date(), currentStage: null });
      const fresh = await repo.findSession(projectId, sessionId);
      if (!moved.count) throw httpError(409, `The session finished as ${fresh.status.toLowerCase().replace(/_/g, " ")} before it could be cancelled.`);
      await progress.publish(sessionId, repo);
      return fresh;
    },

    async results(projectId, sessionId, { page = 1, pageSize = 60, filter = "all", sort = "captured", order = "asc", scene = null } = {}) {
      const session = await repo.findSession(projectId, sessionId);
      if (!session) throw httpError(404, "Culling session not found.");
      const [items, total] = await Promise.all([
        repo.listResults(sessionId, { page, pageSize, filter, sort, order, scene }),
        repo.countResultsByFilter(sessionId, filter, scene),
      ]);
      return { items: items.map((item) => serializeResult(projectId, item)), total, page, pageSize };
    },

    // Duplicate/burst groups with their member results, for the compare-and-review surface. A
    // group's members live on the relation matching its type; the other relation stays empty.
    async groups(projectId, sessionId, { type = null, page = 1, pageSize = 20 } = {}) {
      const session = await repo.findSession(projectId, sessionId);
      if (!session) throw httpError(404, "Culling session not found.");
      const [rows, total] = await Promise.all([repo.listGroups(sessionId, { type, page, pageSize }), repo.countGroups(sessionId, type)]);
      const items = rows.map(({ duplicateResults, burstResults, similarResults, ...group }) => ({ ...group, members: groupMembers(projectId, group, group.type === "DUPLICATE" ? duplicateResults : group.type === "SIMILAR" ? similarResults || [] : burstResults) }));
      return { items, total, page, pageSize };
    },

    async getGroup(projectId, sessionId, groupId) {
      const session = await repo.findSession(projectId, sessionId);
      if (!session) throw httpError(404, "Culling session not found.");
      const group = await repo.findGroup(sessionId, groupId);
      if (!group) throw httpError(404, "Culling group not found.");
      const { duplicateResults, burstResults, similarResults, ...rest } = group;
      return { ...rest, members: groupMembers(projectId, group, group.type === "DUPLICATE" ? duplicateResults : group.type === "SIMILAR" ? similarResults || [] : burstResults) };
    },

    /** One photo's decision. `decision: null` clears the override. Returns the fresh row + counts. */
    // `meta.source`: how the decision was made, for the decision-event log only.
    async setDecision(projectId, sessionId, resultId, decision, userId, meta = {}) {
      await requireReviewableSession(projectId, sessionId);
      const applied = await repo.applyDecisions(sessionId, [resultId], decision, userId, { source: meta.source || "UNKNOWN", platform: meta.platform || "WEB" });
      if (!applied) throw httpError(404, "Culling result not found.");
      profileCache.delete(userId);
      const result = await repo.findResult(sessionId, resultId);
      return { result: serializeResult(projectId, result), counts: applied.counts };
    },

    /**
     * Photos seen during review (the grid) or opened (the preview), for the training labels:
     * recorded only while the run is under review, once per photo, source and photographer.
     */
    async recordViews(projectId, sessionId, resultIds, userId, source, platform = "WEB") {
      const session = await repo.findSession(projectId, sessionId);
      if (!session) throw httpError(404, "Culling session not found.");
      if (session.status !== SESSION_STATUSES.REVIEW_READY) return { recorded: 0 };
      return { recorded: await repo.recordViews(sessionId, userId ?? null, resultIds, source, platform) };
    },

    /** Many photos, one decision — the bulk bar. All-or-nothing on membership. */
    // Several photos at once is always a BULK decision, whatever the app called it.
    async bulkDecision(projectId, sessionId, resultIds, decision, userId, meta = {}) {
      await requireReviewableSession(projectId, sessionId);
      const applied = await repo.applyDecisions(sessionId, resultIds, decision, userId, { source: resultIds.length > 1 ? "BULK" : meta.source || "UNKNOWN", platform: meta.platform || "WEB" });
      if (!applied) throw httpError(404, "One or more photos are not part of this culling session.");
      // Their own new override is evidence: the next panel read or Start learns from it at once.
      profileCache.delete(userId);
      return applied;
    },

    /**
     * Finalize: from here on, Photo Selection — studio gallery, client gallery, publish guard
     * and counts — sees only this session's effective KEEPs (plus any photo the client already
     * selected, which is never hidden). Nothing is deleted; the Reopen below restores it all.
     */
    async finalize(projectId, sessionId, { acknowledge = false } = {}) {
      const session = await repo.findSession(projectId, sessionId);
      const publication = await repo.findPublication(projectId);
      finalizePlan({ session, published: publication?.status === "PUBLISHED", acknowledge });
      // A stale session (its photos deleted since the run) has nothing to finalize: the stored
      // counters would flip a FINALIZED badge over an empty verdict. Refused honestly instead.
      if (!(await repo.countResults(sessionId))) throw httpError(409, "The photos this run analyzed are no longer in the project — start a new culling run over the current photos.");
      // Finalize settles the photos this session analyzed and nothing else, so it needs no
      // scope: the result rows are the scope.
      const outcome = await repo.finalizeSession(sessionId, projectId);
      if (!outcome) throw httpError(409, "The session changed state before it could be finalized.");
      // Finalizing releases the kept photos to Photo Selection and hides the rejected: the gallery is
      // published or held by what the client can see now.
      require("../publication/service").syncAvailabilitySoon(projectId);
      const fresh = await repo.findSession(projectId, sessionId);
      await progress.publish(sessionId, repo);
      return { session: fresh, excluded: outcome.excluded, protected: outcome.protected };
    },

    async reopen(projectId, sessionId, { acknowledge = false } = {}) {
      const session = await repo.findSession(projectId, sessionId);
      const publication = await repo.findPublication(projectId);
      reopenPlan({ session, published: publication?.status === "PUBLISHED", acknowledge });
      // Reopen clears exactly the stamps this session left, so it works even after the shoot
      // folder it covered was removed — the stamps must never be stranded.
      const outcome = await repo.reopenSession(sessionId, projectId);
      if (!outcome) throw httpError(409, "The session changed state before it could be reopened.");
      require("../publication/service").syncAvailabilitySoon(projectId);
      const fresh = await repo.findSession(projectId, sessionId);
      await progress.publish(sessionId, repo);
      return { session: fresh, restored: outcome.restored };
    },

    /**
     * The people of the project as the culling workspace shows them — ranked by how many
     * READY photos each is in (the whole project, never one folder), numbered like the client gallery's People row, with the cover
     * face and the role the photographer gave them. Roles reach the next run's subject stage.
     */
    async people(projectId) {
      await requireProject(projectId);
      // The gallery's own numbering and face circle, so Person 3 here is Person 3 there.
      const { peopleIndex, coverOf } = require("../faces/service");
      // Oldest first before numbering: the tiebreak between two people seen equally often is who
      // the scan found first, whatever order the rows arrived in.
      const persons = (await repo.listPersonsWithCounts(projectId, { withCover: true })).slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      const byId = new Map(persons.map((person) => [person.id, person]));
      const base = `/api/image-selection/projects/${encodeURIComponent(projectId)}/gallery`;
      return peopleIndex(persons, persons.map((person) => ({ personId: person.id, _count: { _all: person.photoCount } })))
        .map((person) => ({ ...person, role: byId.get(person.id).role || null, cover: coverOf(byId.get(person.id), base) }));
    },

    // Kept for desktop builds that still offer the old role picker: the label is stored as it always
    // was (and still keeps a labelled person from being swept by the face clustering), but culling
    // no longer reads it - the subject stage weighs every face by how it appears in its photo.
    async setPersonRole(projectId, personId, role) {
      await requireProject(projectId);
      const changed = await repo.updatePersonRole(projectId, personId, role);
      if (!changed) throw httpError(404, "Person not found in this project.");
      return { id: personId, role };
    },

    /**
     * Phase 8: the caller's own learned preferences — what culling has learned from their
     * overrides, strongest first, whether it is switched on, and how many overrides it has seen
     * against the minimum it needs. Always the signed-in photographer's own: no id is taken.
     */
    async preferences(projectId, userId) {
      await requireProject(projectId);
      const { MIN_DECISIONS } = require("./analysis/preferences");
      const { preference, profile } = await learnedProfileOf(userId);
      const features = Object.entries(profile.weights)
        .map(([feature, value]) => {
          if (feature.startsWith("scene:")) return { feature, kind: "scene", id: feature.slice("scene:".length), weight: value.weight, up: value.up, down: value.down };
          const [id, scene] = feature.split("@");
          return { feature, kind: scene ? "context" : "code", id, ...(scene ? { scene } : {}), weight: value.weight, up: value.up, down: value.down };
        })
        .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight) || a.feature.localeCompare(b.feature))
        .slice(0, PREFERENCE_FEATURES_SHOWN);
      return { enabled: preference?.enabled !== false, resetAt: preference?.resetAt ?? null, decisions: profile.decisions, minimum: MIN_DECISIONS, features, groupTaste: profile.groupTaste ?? null };
    },

    async setPreferencesEnabled(projectId, userId, enabled) {
      await requireProject(projectId);
      await repo.upsertPreference(userId, { enabled });
      return this.preferences(projectId, userId);
    },

    /** Forget what was learned: overrides before now no longer teach. Nothing is deleted. */
    async resetPreferences(projectId, userId) {
      await requireProject(projectId);
      await repo.upsertPreference(userId, { resetAt: new Date() });
      return this.preferences(projectId, userId);
    },

    /** The compare view's "this one is the keeper". */
    async setGroupBest(projectId, sessionId, groupId, resultId, userId = null, platform = "WEB") {
      const session = await requireReviewableSession(projectId, sessionId);
      const group = await repo.findGroup(sessionId, groupId);
      if (!group) throw httpError(404, "Culling group not found.");
      const members = group.type === "DUPLICATE" ? group.duplicateResults : group.type === "SIMILAR" ? group.similarResults : group.burstResults;
      const otherIds = group.type === "SIMILAR" ? [] : [...new Set(members.map((member) => (group.type === "DUPLICATE" ? member.burstGroupId : member.duplicateGroupId)).filter(Boolean))];
      const otherGroups = otherIds.length ? await repo.findGroupsByIds(otherIds) : [];
      const plan = groupBestPlan(group, members, resultId, new Map(otherGroups.map((other) => [other.id, other])));
      // The group's order before and after, for the decision-event log: the photographer's
      // choice is the burst ranker's best label, and the order before is what the AI proposed.
      const rankKey = group.type === "DUPLICATE" ? "duplicateRank" : group.type === "SIMILAR" ? "similarRank" : "burstRank";
      const orderBy = (rankOf) => members.map((member, index) => ({ id: member.id, index, rank: rankOf(member) })).sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.index - b.index).map((entry) => entry.id);
      const plannedRank = new Map(plan.memberUpdates.map((update) => [update.id, update.data[rankKey]]));
      const event = { sessionId, resultId, groupId, userId: userId ?? null, kind: "GROUP_BEST", source: "COMPARE_DIALOG", platform, batchSize: 1, groupOrder: { before: orderBy((member) => member[rankKey]), after: orderBy((member) => plannedRank.get(member.id)) } };
      // The AI's calls for this group follow the new keeper (never a photographer's decision):
      // members re-scored with their new flags, or - for a target count - the two frames trade.
      const previousBestId = orderBy((member) => member[rankKey])[0] || null;
      const planned = new Map(plan.memberUpdates.map((update) => [update.id, update.data]));
      const regrouped = members.map((member) => ({ ...member, ...(planned.get(member.id) || {}) }));
      const decisions = new Map(groupDecisionPlan(regrouped, { mode: session?.mode, previousBestId, targetId: resultId }).map((update) => [update.id, update]));
      const memberUpdates = plan.memberUpdates.map((update) => {
        const decided = decisions.get(update.id);
        if (!decided) return update;
        const { id: _id, rankingCodes, ...fields } = decided;
        const codes = (update.data.reasonCodes || []).filter((code) => code !== REASON_CODES.LOW_CONFIDENCE);
        return { ...update, data: { ...update.data, ...fields, reasonCodes: [...codes, ...(rankingCodes || [])] } };
      });
      await repo.applyGroupBest(groupId, plan.groupData, memberUpdates, event, { recount: decisions.size > 0 ? sessionId : null });
      // Their pick is burst-winner evidence: the next panel read or Start learns from it at once.
      if (userId) profileCache.delete(userId);
      return this.getGroup(projectId, sessionId, groupId);
    },
  };
}

// How many photos one analysis page covers, and how many are in flight at once inside a page.
// Small on purpose: each analysis decodes a preview through sharp, and the worker may share its
// process with the API. The face stage keeps the same shape, which also holds provider calls
// comfortably inside Rekognition's default rate limits.
const ANALYSIS_PAGE_SIZE = 24;
const ANALYSIS_CONCURRENCY = 4;

// The reason codes the technical stage owns, for the same strip-then-reapply discipline when a
// workstation posts them. The LOCAL_SOURCE_* codes belong here too: a workstation that later
// finds the original and posts real numbers clears the earlier "could not open it" verdict.
const TECHNICAL_REASON_CODES = [REASON_CODES.SHARP, REASON_CODES.SOFT_FOCUS, REASON_CODES.SEVERE_BLUR, REASON_CODES.OVEREXPOSED, REASON_CODES.UNDEREXPOSED, REASON_CODES.ANALYSIS_FAILED, ...LOCAL_SOURCE_CODES];
// The face "provider" stamped on a photo the workstation could not open: no engine measured it,
// and the server's face stage must not read its preview in the original's place.
const LOCAL_SOURCE_FACE_PROVIDER = "desktop-local@none";
const hasLocalSourceCode = (codes) => (Array.isArray(codes) ? codes : []).some((code) => LOCAL_SOURCE_CODES.includes(code));

// The reason codes the face stage owns. Merging a fresh face verdict into a row strips these
// first, so a resumed or cached verdict never doubles a badge and never touches the technical
// stage's codes.
const FACE_REASON_CODES = [
  REASON_CODES.EYES_OPEN,
  REASON_CODES.PRIMARY_SUBJECT_BLINK,
  REASON_CODES.HALF_CLOSED_EYES,
  REASON_CODES.LOOKING_AWAY,
  REASON_CODES.GOOD_EXPRESSION,
  REASON_CODES.LOW_FACE_QUALITY,
  REASON_CODES.FACE_OCCLUDED,
  REASON_CODES.FACE_ANALYSIS_FAILED,
];
const withFaceCodes = (existing, faceCodes) => [...(Array.isArray(existing) ? existing : []).filter((code) => !FACE_REASON_CODES.includes(code)), ...faceCodes];
const faceCodesOf = (codes) => (Array.isArray(codes) ? codes : []).filter((code) => FACE_REASON_CODES.includes(code));

// The grouping stage's own codes, stripped-then-reapplied the same way, so regrouping never
// doubles a badge and never disturbs the technical or face stages' codes.
const GROUP_REASON_CODES = [REASON_CODES.DUPLICATE, REASON_CODES.BEST_IN_BURST, REASON_CODES.ALTERNATE_FRAME];
const withGroupCodes = (existing, groupCodes) => [...(Array.isArray(existing) ? existing : []).filter((code) => !GROUP_REASON_CODES.includes(code)), ...groupCodes];

// And the ranking stage's.
const RANKING_REASON_CODES = [REASON_CODES.LOW_CONFIDENCE, REASON_CODES.UNIQUE_FRAME, REASON_CODES.COVERS_PERSON, REASON_CODES.COVERS_SCENE, REASON_CODES.TASTE_UP, REASON_CODES.TASTE_DOWN];
const withRankingCodes = (existing, rankingCodes) => [...(Array.isArray(existing) ? existing : []).filter((code) => !RANKING_REASON_CODES.includes(code)), ...rankingCodes];

// And the subject stage's.
const SUBJECT_REASON_CODES = [REASON_CODES.IMPORTANT_SUBJECT_BLINK, REASON_CODES.KEY_PEOPLE_PRESENT];
// The face stage's eye badges speak for the largest face; once the subject stage has weighed eyes
// by who they belong to, those two are replaced by the weighted answer.
const FACE_EYE_CODES = [REASON_CODES.EYES_OPEN, REASON_CODES.PRIMARY_SUBJECT_BLINK];
// Culling V2: the largest face's half-closed and looking-away badges, which a weighted "eyes open"
// answer replaces too - the frame never says both.
const FACE_GAZE_CODES = [REASON_CODES.HALF_CLOSED_EYES, REASON_CODES.LOOKING_AWAY];
const EYES_OPEN_BADGE_SCORE = 70;
const withSubjectCodes = (existing, subjectCodes, { eyesOpenScore = null } = {}) => {
  const eyes = eyesOpenScore !== null && eyesOpenScore >= EYES_OPEN_BADGE_SCORE && !subjectCodes.includes(REASON_CODES.IMPORTANT_SUBJECT_BLINK) ? [REASON_CODES.EYES_OPEN] : [];
  const dropped = [...SUBJECT_REASON_CODES, ...(eyesOpenScore === null ? [] : FACE_EYE_CODES), ...(eyes.length ? FACE_GAZE_CODES : [])];
  const kept = (Array.isArray(existing) ? existing : []).filter((code) => !dropped.includes(code));
  return [...kept, ...eyes, ...subjectCodes];
};

/**
 * The subject stage: who is in each photo, from the People filter's clusters (identity only), and
 * how prominent each face is in that frame. Writes the subject score and the people count,
 * re-weights the eye score by prominence where the face stage left per-face details, and badges a
 * prominent face's blink. A photo with nobody from the People filter in it is left as it was
 * (codes of an earlier run aside): the stage says nothing rather than something empty. Wholesale
 * and idempotent like grouping.
 */
async function runSubjectStage(sessionId, repo, progress) {
  const session = await repo.findSessionById(sessionId);
  if (!session) return;
  // A run cancelled (or failed) meanwhile is not written to: the transition is the check.
  const moved = await repo.transitionSession(sessionId, [SESSION_STATUSES.ANALYZING], { currentStage: STAGES.SUBJECTS });
  if (!moved?.count) return;
  await progress.publish(sessionId, repo);
  // A person merged or deleted in the People filter mid-run would make the link's foreign key
  // refuse the row. The link is dropped for that photo, the scores stay.
  const write = async (id, data) => {
    try { await repo.updateResult(id, data); } catch (error) {
      if (error?.code !== "P2003" || !data.subjectPersonId) throw error;
      await repo.updateResult(id, { ...data, subjectPersonId: null });
    }
  };
  // Each face is weighed by how it appears in its photo (analysis/subjects.js) - never by a role
  // given to the person or by how often they appear across the shoot.
  const { subjectSignals } = require("./analysis/subjects");
  let cursor;
  while (true) {
    if (cursor) { const current = await repo.findSessionById(sessionId); if (!current || current.status === SESSION_STATUSES.CANCELLED) return; }
    const rows = await repo.listResultsForSubjects(sessionId, cursor, SEED_BATCH_SIZE);
    if (!rows.length) break;
    const mappings = await repo.listMappingsForUploads(session.projectId, rows.map((row) => row.uploadId));
    const writes = rows.flatMap((row) => {
      const signals = subjectSignals({ mappings: mappings[row.uploadId] || [], faceDetails: row.faceDetails });
      // Nobody known in the photo and nothing of ours on the row: nothing to write.
      if (!signals.peopleCount && !(row.reasonCodes || []).some((code) => SUBJECT_REASON_CODES.includes(code))) return [];
      const data = { subjectScore: signals.subjectScore, peopleCount: signals.peopleCount, subjectPersonId: signals.subjectPersonId, reasonCodes: withSubjectCodes(row.reasonCodes, signals.reasonCodes, { eyesOpenScore: signals.eyesOpenScore }) };
      if (signals.eyesOpenScore !== null) data.eyesOpenScore = signals.eyesOpenScore;
      return [{ id: row.id, data }];
    });
    for (let index = 0; index < writes.length; index += 50) await Promise.all(writes.slice(index, index + 50).map((row) => write(row.id, row.data)));
    cursor = rows[rows.length - 1].id;
    if (rows.length < SEED_BATCH_SIZE) break;
  }
  await repo.updateSession(sessionId, { progressPercent: 92 });
  await progress.publish(sessionId, repo);
}

/**
 * Analyze one photo, tolerantly. A transient failure (an R2 blip, mostly) gets one in-run retry;
 * a photo that still fails is stamped ANALYSIS_FAILED with `analyzedAt` set, so it drops out of
 * the work queue and the session finishes with that one photo visibly unanalyzed — one corrupt
 * preview must never wedge an 8,000-photo run. Only infrastructure errors (the repository
 * throwing) escape to fail the job and trigger BullMQ's own retry.
 */
async function analyzeResult(result, analyze, repo) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const scores = await analyze(result.upload);
      await repo.updateResult(result.id, { ...scores, analyzedAt: new Date(), analysisSource: ANALYSIS_SOURCES.SERVER });
      return;
    } catch (error) {
      if (attempt === 0) { await new Promise((resolve) => setTimeout(resolve, 500)); continue; }
      await repo.updateResult(result.id, { analyzedAt: new Date(), analysisSource: ANALYSIS_SOURCES.SERVER, reasonCodes: [REASON_CODES.ANALYSIS_FAILED] });
      return;
    }
  }
}

/**
 * Analyze one photo's faces, cache-first and tolerantly. The cross-session cache is the cost
 * control: a photo the same provider already answered for in an earlier run is copied, not
 * re-billed. A transient provider failure (throttle, network) gets one in-run retry; a photo
 * that still fails is stamped FACE_ANALYSIS_FAILED so it can never wedge the run — and the
 * technical scores it already earned stay. Returns how many provider requests were spent.
 */
async function faceAnalyzeResult(result, faces, repo) {
  const cached = await repo.findCachedFaceSignals(result.uploadId, faces.provider.version, result.sessionId);
  if (cached) {
    await repo.updateResult(result.id, {
      faceCount: cached.faceCount,
      faceQualityScore: cached.faceQualityScore,
      eyesOpenScore: cached.eyesOpenScore,
      expressionScore: cached.expressionScore,
      faceSharpnessScore: cached.faceSharpnessScore ?? null,
      headPoseScore: cached.headPoseScore ?? null,
      expressionLabel: cached.expressionLabel ?? null,
      reasonCodes: withFaceCodes(result.reasonCodes, faceCodesOf(cached.reasonCodes)),
      faceDetails: cached.faceDetails ?? null,
      faceAnalyzedAt: new Date(),
      faceProvider: faces.provider.version,
    });
    return 0;
  }
  let requests = 0;
  for (let attempt = 0; ; attempt += 1) {
    try {
      const bytes = await faces.loadBytes(result.upload);
      requests += 1;
      const detected = await faces.provider.detectFaces(bytes);
      const { faceSignals, faceDetailsOf } = require("./analysis/faces");
      const signals = faceSignals(detected);
      await repo.updateResult(result.id, {
        faceCount: signals.faceCount,
        faceQualityScore: signals.faceQualityScore,
        eyesOpenScore: signals.eyesOpenScore,
        expressionScore: signals.expressionScore,
        faceSharpnessScore: signals.faceSharpnessScore,
        headPoseScore: signals.headPoseScore,
        expressionLabel: signals.expressionLabel,
        reasonCodes: withFaceCodes(result.reasonCodes, signals.reasonCodes),
        // Kept per face so the subject stage can weigh a blink by who blinked.
        faceDetails: faceDetailsOf(detected),
        faceAnalyzedAt: new Date(),
        faceProvider: faces.provider.version,
      });
      return requests;
    } catch (error) {
      if (attempt === 0) { await new Promise((resolve) => setTimeout(resolve, 1000)); continue; }
      await repo.updateResult(result.id, {
        reasonCodes: withFaceCodes(result.reasonCodes, [REASON_CODES.FACE_ANALYSIS_FAILED]),
        faceAnalyzedAt: new Date(),
        faceProvider: faces.provider.version,
      });
      return requests;
    }
  }
}


// ---------------------------------------------------------------------------------------------
// Phase 6: scene, aesthetic and composition
// ---------------------------------------------------------------------------------------------
const SCENE_CODES = [REASON_CODES.ACCIDENTAL_FRAME, REASON_CODES.FACE_CUT_OFF, REASON_CODES.WELL_COMPOSED, REASON_CODES.STRIKING_LOOK];
// The top band of each score earns its explanation badge.
const POSITIVE_BAND = 85;
const POOR_TECHNICAL_CODES = [REASON_CODES.SOFT_FOCUS, REASON_CODES.SEVERE_BLUR, REASON_CODES.OVEREXPOSED, REASON_CODES.UNDEREXPOSED];
// Phase 8: how many learned features the panel shows, and how long a fitted profile is reused.
const PREFERENCE_FEATURES_SHOWN = 8;
const PROFILE_CACHE_MS = 60000;
// How long a run waits for an engine that is still starting before it goes on without scenes.
const SCENE_READY_WAIT_MS = Number.parseInt(process.env.AI_SCENE_READY_WAIT_MS || "60000", 10);
// The scene stage's slice of the progress bar (subjects end at 92, grouping takes 95).
const SCENE_PROGRESS_START = 92;
const SCENE_PROGRESS_END = 94;
const SCENE_BATCH = 8;

/**
 * The scene stage. Composition is pure maths over the face stage's boxes and always runs; the
 * scene and aesthetic readings come from the scene engine (scene/engine.js) over each photo's
 * PREVIEW, cache-first: a photo the same engine already described in any earlier run is read
 * from image_selection_upload_scene, never embedded twice. An engine that is off, not ready, or
 * that dies mid-run costs the photos their scene and nothing else — the run goes on, and the
 * session only records an engine it actually used. Idempotent: the stage's own codes are
 * stripped and re-derived.
 */
async function runSceneStage(sessionId, repo, progress, scene = null) {
  const session = await repo.findSessionById(sessionId);
  if (!session) return;
  const moved = await repo.transitionSession(sessionId, [SESSION_STATUSES.ANALYZING], { currentStage: STAGES.SCENE });
  if (!moved?.count) return;
  await progress.publish(sessionId, repo);
  const { aestheticScoreOf, sceneSignals } = require("./analysis/scene");
  const { compositionOf } = require("./analysis/composition");
  const engine = scene?.engine || null;
  // An engine still starting (the first model download) does not hold the run: after a short wait
  // this run goes on with framing only, and the engine keeps starting for the next one.
  let version = null;
  if (engine) {
    const waitMs = scene.readyWaitMs ?? SCENE_READY_WAIT_MS;
    let timer;
    try {
      const ready = await Promise.race([Promise.resolve(engine.isReady()).catch(() => false), new Promise((resolve) => { timer = setTimeout(() => resolve(false), waitMs); })]);
      if (ready) version = engine.version();
    } finally { clearTimeout(timer); }
  }
  let describing = Boolean(version);
  let wroteReadings = false;
  const cancelled = async () => { const current = await repo.findSessionById(sessionId); return !current || current.status === SESSION_STATUSES.CANCELLED; };
  // One retry when the shared engine was stopped under another session (its timeout restarts it).
  const describe = async (buffers) => {
    try { return await engine.describeBatch(buffers); } catch (error) {
      if (!/stopped/i.test(error.message || "")) throw error;
      return engine.describeBatch(buffers);
    }
  };
  const total = Math.max(1, session.totalImages || 0);
  let done = 0;
  const report = async () => { await repo.updateSession(sessionId, { progressPercent: Math.min(SCENE_PROGRESS_END, SCENE_PROGRESS_START + Math.floor((done / total) * (SCENE_PROGRESS_END - SCENE_PROGRESS_START))) }); await progress.publish(sessionId, repo); };
  let cursor;
  while (true) {
    if (cursor && (await cancelled())) return;
    const rows = await repo.listResultsForScene(sessionId, cursor, SEED_BATCH_SIZE);
    if (!rows.length) break;
    const readings = new Map();
    if (version) {
      // The cache is read whenever the engine is known, even after it failed mid-run.
      for (const cached of await repo.findSceneCache(rows.map((row) => row.uploadId), version)) readings.set(cached.uploadId, cached);
      // A photo the workstation could not open (a LOCAL_SOURCE_* code) is never described from
      // its preview here either: the rule is that nothing stands in for the original.
      const missing = rows.filter((row) => !readings.has(row.uploadId) && !hasLocalSourceCode(row.reasonCodes));
      for (let index = 0; index < missing.length && describing; index += SCENE_BATCH) {
        // Embedding is the slow part: a cancel is honoured between batches, not only between pages.
        if (index > 0 && (await cancelled())) return;
        const loaded = (await Promise.all(missing.slice(index, index + SCENE_BATCH).map(async (row) => {
          try { return { row, bytes: await scene.loadBytes(row.upload) }; } catch { return null; }
        }))).filter(Boolean);
        if (loaded.length) {
          let answers;
          try { answers = await describe(loaded.map((entry) => entry.bytes)); } catch (error) {
            console.warn(`[ai-culling] scene engine failed mid-run (${error.message}); the rest of session ${sessionId} goes on with cached scenes and framing only`);
            describing = false;
            break;
          }
          const fresh = [];
          loaded.forEach((entry, position) => {
            const answer = answers[position];
            if (!answer || answer.error) return;
            const reading = { uploadId: entry.row.uploadId, engineVersion: version, sceneLabel: answer.scene, sceneConfidence: answer.confidence, accidental: Boolean(answer.accidental), aestheticRaw: answer.aesthetic, embedding: answer.embedding || null };
            readings.set(reading.uploadId, reading);
            fresh.push(reading);
          });
          if (fresh.length) await repo.saveSceneCache(fresh);
        }
        done += Math.min(SCENE_BATCH, missing.length - index);
        await report();
      }
      if (repo.pruneSceneCache) await repo.pruneSceneCache(rows.map((row) => row.uploadId), version);
    }
    const writes = rows.flatMap((row) => {
      const reading = readings.get(row.uploadId) || null;
      const signals = sceneSignals(reading ? { scene: reading.sceneLabel, confidence: reading.sceneConfidence, accidental: reading.accidental } : null, row.reasonCodes);
      const composition = compositionOf(row.faceDetails);
      const current = Array.isArray(row.reasonCodes) ? row.reasonCodes : [];
      const aestheticScore = reading ? aestheticScoreOf(reading.aestheticRaw) : null;
      // The positive badges explain a nudge up, and a technically poor frame is never nudged up.
      const poor = current.some((code) => POOR_TECHNICAL_CODES.includes(code));
      const positive = poor ? [] : [
        ...(composition.compositionScore !== null && composition.compositionScore >= POSITIVE_BAND ? [REASON_CODES.WELL_COMPOSED] : []),
        ...(aestheticScore !== null && aestheticScore >= POSITIVE_BAND ? [REASON_CODES.STRIKING_LOOK] : []),
      ];
      const codes = [...current.filter((code) => !SCENE_CODES.includes(code)), ...signals.reasonCodes, ...composition.reasonCodes, ...positive];
      const codesChanged = codes.length !== current.length || codes.some((code, position) => code !== current[position]);
      if (!reading && !version && composition.compositionScore === null && !codesChanged) return [];
      const data = { compositionScore: composition.compositionScore, reasonCodes: codes };
      // With the engine known, a photo without a reading says so (a retry never keeps a stale scene).
      if (reading) { Object.assign(data, { sceneLabel: signals.sceneLabel, sceneConfidence: signals.sceneConfidence, aestheticScore }); wroteReadings = true; }
      else if (version) Object.assign(data, { sceneLabel: null, sceneConfidence: null, aestheticScore: null });
      return [{ id: row.id, data }];
    });
    for (let index = 0; index < writes.length; index += 50) await Promise.all(writes.slice(index, index + 50).map((write) => repo.updateResult(write.id, write.data)));
    cursor = rows[rows.length - 1].id;
    if (rows.length < SEED_BATCH_SIZE) break;
  }
  // The session names the engine whenever any of its readings landed, even if it died later.
  if (version && wroteReadings && repo.mergeEngineVersions) await repo.mergeEngineVersions(sessionId, { scene: version });
  await repo.updateSession(sessionId, { progressPercent: SCENE_PROGRESS_END });
  await progress.publish(sessionId, repo);
}

/**
 * The grouping stage: rebuild the session's duplicate and burst groups wholesale from the
 * per-photo facts already in hand — capture time, folder, filename, perceptual hash, and the
 * scores that pick a group's best frame. Wholesale because it is cheap (an in-memory pass over
 * a few fields per photo, never the images) and rebuilding from nothing is what makes a retry
 * or a partially-dead previous attempt trivially correct: old groups are deleted first, which
 * SetNulls every stale pointer.
 */
async function runGroupingStage(sessionId, repo, progress) {
  await repo.transitionSession(sessionId, [SESSION_STATUSES.ANALYZING], { currentStage: STAGES.GROUPING });
  await progress.publish(sessionId, repo);
  await repo.deleteSessionGroups(sessionId);
  await repo.resetGroupFlags(sessionId);

  const rows = [];
  let cursor;
  while (true) {
    const page = await repo.listResultsForGrouping(sessionId, cursor, SEED_BATCH_SIZE);
    if (!page.length) break;
    rows.push(...page);
    cursor = page[page.length - 1].id;
    if (page.length < SEED_BATCH_SIZE) break;
  }
  const current = await repo.findSessionById(sessionId);
  if (!current || current.status === SESSION_STATUSES.CANCELLED) return;

  // Culling V2: each frame's CLIP image embedding (the scene engine's, when it ran), for the
  // visually similar series. Absent, no similar group is formed - nothing is guessed.
  const embeddings = new Map();
  if (repo.listSceneEmbeddings) {
    const { decodeEmbedding } = require("./analysis/duplicates");
    for (let index = 0; index < rows.length; index += SEED_BATCH_SIZE) {
      const found = await repo.listSceneEmbeddings(rows.slice(index, index + SEED_BATCH_SIZE).map((row) => row.uploadId));
      for (const entry of found) { const vector = decodeEmbedding(entry.embedding); if (vector) embeddings.set(entry.uploadId, vector); }
    }
  }

  // Similarity v2: who is in each frame (the People filter's clusters), read a page at a time.
  const session = current;
  const personIds = new Map();
  for (let index = 0; index < rows.length; index += SEED_BATCH_SIZE) {
    const uploadIds = rows.slice(index, index + SEED_BATCH_SIZE).map((row) => row.uploadId);
    const mappings = await repo.listMappingsForUploads(session.projectId, uploadIds);
    for (const uploadId of uploadIds) personIds.set(uploadId, (mappings[uploadId] || []).map((mapping) => mapping.personId).filter(Boolean));
  }
  // Culling V2: the starter's burst-winner taste from the run's snapshot moves the keeper-merit
  // shares (each by at most 0.1); without one the default balanced merit ranks.
  const preference = repo.findSessionPreference ? await repo.findSessionPreference(sessionId) : null;
  const plans = require("./analysis/duplicates").buildGroups(rows.map((row) => ({
    resultId: row.id,
    uploadId: row.uploadId,
    folderId: row.upload.folderId,
    capturedAt: row.upload.capturedAt,
    fileName: row.upload.fileName,
    perceptualHash: row.perceptualHash,
    structureSignature: row.structureSignature ?? null,
    technicalScore: row.technicalScore,
    faceQualityScore: row.faceQualityScore,
    eyesOpenScore: row.eyesOpenScore,
    expressionScore: row.expressionScore ?? null,
    headPoseScore: row.headPoseScore ?? null,
    faceCount: row.faceCount ?? 0,
    subjectScore: row.subjectScore ?? null,
    personIds: personIds.get(row.uploadId) || null,
    embedding: embeddings.get(row.uploadId) || null,
  })), undefined, { meritWeights: preference?.groupTaste?.weights || undefined });

  // One patch per touched row, accumulated across both group types before writing.
  const patches = new Map();
  const patchFor = (resultId) => { if (!patches.has(resultId)) patches.set(resultId, { codes: [] }); return patches.get(resultId); };
  for (const plan of plans) {
    const group = await repo.createGroup({ sessionId, type: plan.type, representativeUploadId: plan.representativeUploadId, memberCount: plan.memberCount, groupScore: plan.groupScore });
    const rankedIds = plan.rankedResultIds || plan.memberResultIds;
    for (const memberId of plan.memberResultIds) {
      const patch = patchFor(memberId);
      const rank = rankedIds.indexOf(memberId) + 1;
      if (plan.type === GROUP_TYPES.SIMILAR) {
        // Relative only: the series' best is ranked first, the others are its alternates; the
        // duplicate/burst keeper flag below is not this group's to set.
        patch.similarGroupId = group.id;
        patch.similarRank = rank;
        if (memberId !== plan.bestResultId) patch.codes.push(REASON_CODES.ALTERNATE_FRAME);
        continue;
      }
      if (plan.type === GROUP_TYPES.DUPLICATE) {
        patch.duplicateGroupId = group.id;
        patch.duplicateRank = rank;
        // The badge goes on the frames the engine would drop, not the keeper.
        if (memberId !== plan.bestResultId) patch.codes.push(REASON_CODES.DUPLICATE);
      } else {
        patch.burstGroupId = group.id;
        patch.burstRank = rank;
        if (memberId === plan.bestResultId) patch.codes.push(REASON_CODES.BEST_IN_BURST);
      }
      if (memberId === plan.bestResultId) patch.isGroupBest = true;
    }
  }

  // Write assignments; also strip stale group codes from rows that left every group.
  const writes = [];
  for (const row of rows) {
    const patch = patches.get(row.id);
    const currentCodes = Array.isArray(row.reasonCodes) ? row.reasonCodes : [];
    const nextCodes = withGroupCodes(currentCodes, patch ? patch.codes : []);
    const codesChanged = nextCodes.length !== currentCodes.length || nextCodes.some((code, index) => code !== currentCodes[index]);
    if (!patch && !codesChanged) continue;
    writes.push({ id: row.id, data: { duplicateGroupId: patch?.duplicateGroupId ?? null, burstGroupId: patch?.burstGroupId ?? null, duplicateRank: patch?.duplicateRank ?? null, burstRank: patch?.burstRank ?? null, similarGroupId: patch?.similarGroupId ?? null, similarRank: patch?.similarRank ?? null, isGroupBest: patch?.isGroupBest ?? false, reasonCodes: nextCodes } });
  }
  for (let index = 0; index < writes.length; index += 50) {
    await Promise.all(writes.slice(index, index + 50).map((write) => repo.updateResult(write.id, write.data)));
  }
  await repo.updateSession(sessionId, { progressPercent: 95 });
  await progress.publish(sessionId, repo);
}

/**
 * The ranking stage: turn the session's accumulated facts into the DBS score and — in a
 * deciding mode — KEEP/MAYBE/REJECT with confidence. Pure maths in analysis/scoring.js; this
 * only loads rows, writes verdicts, and keeps the session's counts agreeing with the effective
 * decisions. Wholesale like grouping: re-running re-derives the same answers, and an existing
 * photographer override always survives as the effective decision.
 */
// `learning`: the learning layer's runtime (learning/runtime.js) - shadow models score the run
// into their own table, and a serving model (off unless switched on and promoted) decides through
// today's decision code. Injectable for the tests; anything it throws falls back to the formula.
async function runRankingStage(sessionId, repo, progress, session, learning = null) {
  const runtime = learning || require("./learning/runtime").learningRuntime();
  const { FEATURE_SET_VERSION } = require("./learning/featureSet");
  await repo.transitionSession(sessionId, [SESSION_STATUSES.ANALYZING], { currentStage: STAGES.RANKING });
  await progress.publish(sessionId, repo);

  const rows = [];
  let cursor;
  while (true) {
    const page = await repo.listResultsForRanking(sessionId, cursor, SEED_BATCH_SIZE);
    if (!page.length) break;
    rows.push(...page);
    cursor = page[page.length - 1].id;
    if (page.length < SEED_BATCH_SIZE) break;
  }
  {
    const current = await repo.findSessionById(sessionId);
    if (!current || current.status === SESSION_STATUSES.CANCELLED) return;
  }

  // Phase 8: the starter's learned taste, from the snapshot the run took when it started.
  const preference = repo.findSessionPreference ? await repo.findSessionPreference(sessionId) : null;
  const tasteCodes = new Map();
  if (preference) {
    const { adjustmentOf } = require("./analysis/preferences");
    for (let index = 0; index < rows.length; index += 1) {
      const { adjustment, codes } = adjustmentOf(rows[index], preference);
      rows[index] = { ...rows[index], preferenceAdjustment: adjustment };
      if (codes.length) tasteCodes.set(rows[index].id, codes);
    }
  }

  const accidentalScenes = require("./scene/profile").accidentalSceneIds();
  // A learned model, when one serves this run (phase 10). Anything it throws leaves the run on
  // the fixed formula below, exactly as today.
  let learned = null;
  const prepared = await runtime.servingFor(session);
  if (prepared) {
    // One switch for everything learned about the starter: "Use it in my runs" off means the
    // learned ranker's own photographer layer stays off too, not only the formula's nudge.
    const starterPreference = session.createdByUserId && repo.findPreference ? await repo.findPreference(session.createdByUserId) : null;
    const personalize = starterPreference?.enabled !== false;
    try { learned = runtime.decide(rows, prepared, session, { accidentalScenes, personalize }); } catch (error) { console.warn(`[culling-learning] serving model not used for run ${sessionId}: ${error.message}`); learned = null; }
    if (learned) learned.personalized = personalize;
  }
  // TARGET_COUNT goes through the story-coverage layer — per-folder quotas and time-segment
  // guarantees — instead of flat thresholds; the other modes score photo by photo.
  const { updates, counts } = learned || (session.mode === "TARGET_COUNT"
    ? require("./analysis/coverage").coverageSession(rows.map((row) => ({ ...row, folderId: row.upload?.folderId ?? null, capturedAt: row.upload?.capturedAt ?? null })), session.targetCount, { accidentalScenes, unvalidatedScenes: require("./scene/profile").unvalidatedSceneIds() })
    : require("./analysis/scoring").scoreSession(rows, session.mode));
  const groupWrites = learned?.groups?.results || new Map();
  const codesById = new Map(rows.map((row) => [row.id, groupWrites.get(row.id)?.reasonCodes || row.reasonCodes]));
  for (let index = 0; index < updates.length; index += 50) {
    await Promise.all(updates.slice(index, index + 50).map(({ id, rankingCodes, ...data }) => {
      const { reasonCodes: _groupCodes, ...groupFields } = groupWrites.get(id) || {};
      return repo.updateResult(id, { ...data, ...groupFields, reasonCodes: withRankingCodes(codesById.get(id), [...rankingCodes, ...(learned ? [] : tasteCodes.get(id) || [])]) });
    }));
  }
  if (learned && repo.updateGroup) {
    for (const [groupId, representativeUploadId] of learned.groups?.representatives || []) await repo.updateGroup(groupId, { representativeUploadId });
  }
  await repo.updateSession(sessionId, { keepCount: counts.keep, maybeCount: counts.maybe, rejectCount: counts.reject, progressPercent: 99 });
  // A learned model that decided records itself and the signal definitions it read; a run the
  // formula decided records nothing new.
  if (learned && repo.mergeEngineVersions) await repo.mergeEngineVersions(sessionId, { featureSet: FEATURE_SET_VERSION, ranker: learned.label, ...(learned.personalized === false ? { personalization: "off" } : {}) });
  // Shadow models (phase 9): their own table only, never this run's numbers.
  if (repo.replaceShadowResults || learning) {
    try { await runtime.shadow(session, rows, repo, { accidentalScenes }); } catch (error) { console.warn(`[culling-learning] shadow scoring skipped for run ${sessionId}: ${error.message}`); }
  }
  await progress.publish(sessionId, repo);
}

/**
 * The worker's job body: seed one result row per READY photo, run technical analysis over every
 * unanalyzed row — blur, exposure and perceptual hash from the preview derivative — then face
 * analysis through the configured provider, then duplicate/burst grouping, then DBS ranking.
 * No provider configured is a normal, quieter run: the session completes on its technical
 * stages with face scores unset, because AI culling must never depend on AWS being up.
 *
 * Idempotent throughout: a retried job re-covers seeding (skipDuplicates makes the second pass
 * free) and each analysis stage re-enters where it left off — a row stamped even on per-photo
 * failure drops out of its stage's queue. A cancel that lands mid-run is honoured at the next
 * page boundary, and the final transition is guarded so a cancelled run can never be promoted
 * to REVIEW_READY. `processedImages` means photos through technical analysis.
 *
 * `facesOverride`: undefined resolves the real provider from env; null forces the stage off;
 * `{ provider, loadBytes }` injects fakes for tests.
 */
async function processSession(sessionId, repo = repository, progress = defaultProgress, analyzer = null, facesOverride = undefined, sceneOverride = undefined) {
  const session = await repo.findSessionById(sessionId);
  if (!session) return;
  // Only QUEUED (first attempt) and ANALYZING (a retry resuming) may run; anything else is a
  // job that outlived its session — cancelled, failed and completed runs are left alone.
  if (session.status !== SESSION_STATUSES.QUEUED && session.status !== SESSION_STATUSES.ANALYZING) return;
  // Lazy so requiring this service (tests, controller) never loads sharp or the AWS SDK.
  const analyze = analyzer || require("./analysis/analyzer").analyzeUpload;
  let faces = facesOverride;
  if (faces === undefined) {
    const provider = require("./providers").activeFaceProvider();
    faces = provider ? { provider, loadBytes: require("./analysis/analyzer").loadPreviewBytes } : null;
  }
  // Progress shares per stage: technical, then faces (when a provider is up), then grouping
  // takes the last stretch — it is fast, so it gets a sliver.
  const technicalShare = faces ? 60 : 85;
  // A shoot-scoped session seeds only its folder subtree. A scope that no longer resolves (the
  // shoot folder soft-deleted mid-run) fails the session honestly instead of silently widening
  // to the whole project.
  let folderIds = null;
  if (session.folderId) {
    folderIds = await repo.folderSubtreeIds(session.projectId, session.folderId);
    if (!folderIds) { await failSession(sessionId, "The shoot folder this run covered no longer exists.", repo, progress); return; }
  }
  await repo.transitionSession(sessionId, [SESSION_STATUSES.QUEUED], {
    status: SESSION_STATUSES.ANALYZING,
    startedAt: session.startedAt || new Date(),
    currentStage: STAGES.PREPARING,
    error: null,
  });
  await progress.publish(sessionId, repo);

  // Seeding happens once. A retry that arrives after `seededAt` analyzes the rows it has; a photo
  // processed after that point is "not in this session" (the overview counts it), never pulled
  // in mid-run where half the stages would miss it. A retry that died mid-seed re-covers its
  // pages, which skipDuplicates makes free.
  if (!session.seededAt) {
    let cursor;
    while (true) {
      const uploads = await repo.listReadyUploadIds(session.projectId, folderIds, cursor, SEED_BATCH_SIZE);
      if (!uploads.length) break;
      await repo.createResults(uploads.map((upload) => ({ sessionId, uploadId: upload.id })));
      cursor = uploads[uploads.length - 1].id;
      const current = await repo.findSessionById(sessionId);
      if (!current || current.status === SESSION_STATUSES.CANCELLED) return;
      const total = Math.max(current.totalImages, await repo.countResults(sessionId));
      await repo.updateSession(sessionId, { totalImages: total });
      await progress.publish(sessionId, repo);
      if (uploads.length < SEED_BATCH_SIZE) break;
    }
    await repo.updateSession(sessionId, { seededAt: new Date() });
  }

  await repo.transitionSession(sessionId, [SESSION_STATUSES.ANALYZING], { currentStage: STAGES.TECHNICAL_ANALYSIS });
  await progress.publish(sessionId, repo);
  while (true) {
    const pending = await repo.listUnanalyzedResults(sessionId, ANALYSIS_PAGE_SIZE);
    if (!pending.length) break;
    for (let index = 0; index < pending.length; index += ANALYSIS_CONCURRENCY) {
      await Promise.all(pending.slice(index, index + ANALYSIS_CONCURRENCY).map((result) => analyzeResult(result, analyze, repo)));
    }
    const current = await repo.findSessionById(sessionId);
    if (!current || current.status === SESSION_STATUSES.CANCELLED) return;
    const analyzed = await repo.countAnalyzedResults(sessionId);
    const total = Math.max(current.totalImages, analyzed);
    await repo.updateSession(sessionId, {
      processedImages: analyzed,
      progressPercent: total ? Math.min(technicalShare, Math.round((analyzed / total) * technicalShare)) : technicalShare,
    });
    await progress.publish(sessionId, repo);
  }
  // A run the workstation stamped in full has nothing left for the loop above, so the count of
  // analyzed photos is written here as well: the apps read `processedImages` against
  // `totalImages`, and "0 of 54 analyzed" beside a bar at 93% was this number never set.
  {
    const current = await repo.findSessionById(sessionId);
    if (!current || current.status === SESSION_STATUSES.CANCELLED) return;
    const analyzed = await repo.countAnalyzedResults(sessionId);
    if (analyzed !== current.processedImages) { await repo.updateSession(sessionId, { processedImages: analyzed }); await progress.publish(sessionId, repo); }
  }

  if (faces) {
    await repo.transitionSession(sessionId, [SESSION_STATUSES.ANALYZING], { currentStage: STAGES.FACE_ANALYSIS });
    await progress.publish(sessionId, repo);
    while (true) {
      const pending = await repo.listUnfaceResults(sessionId, ANALYSIS_PAGE_SIZE);
      if (!pending.length) break;
      let requests = 0;
      for (let index = 0; index < pending.length; index += ANALYSIS_CONCURRENCY) {
        const spent = await Promise.all(pending.slice(index, index + ANALYSIS_CONCURRENCY).map((result) => faceAnalyzeResult(result, faces, repo)));
        requests += spent.reduce((sum, value) => sum + value, 0);
      }
      if (requests) await repo.incrementProviderRequests(sessionId, requests);
      const current = await repo.findSessionById(sessionId);
      if (!current || current.status === SESSION_STATUSES.CANCELLED) return;
      const faced = await repo.countFaceAnalyzedResults(sessionId);
      const total = Math.max(current.totalImages, faced);
      await repo.updateSession(sessionId, { progressPercent: total ? Math.min(90, 60 + Math.round((faced / total) * 30)) : 90 });
      await progress.publish(sessionId, repo);
    }
  }

  // The server's engines go on the session beside any the workstation recorded, so a mixed run
  // says which side stamped what.
  if (repo.mergeEngineVersions) await repo.mergeEngineVersions(sessionId, { serverTechnical: ENGINE_VERSION, ...(faces ? { serverFaces: faces.provider.version } : {}) });

  await runSubjectStage(sessionId, repo, progress);
  {
    const current = await repo.findSessionById(sessionId);
    if (!current || current.status === SESSION_STATUSES.CANCELLED) return;
  }

  // Phase 6. Lazy, so a run with the switch off never loads the engine module's interpreter search.
  const sceneDeps = sceneOverride !== undefined ? sceneOverride : { engine: require("./scene/engine").sceneEngine, loadBytes: (upload) => require("./analysis/analyzer").loadPreviewBytes(upload) };
  await runSceneStage(sessionId, repo, progress, sceneDeps);
  {
    const current = await repo.findSessionById(sessionId);
    if (!current || current.status === SESSION_STATUSES.CANCELLED) return;
  }

  await runGroupingStage(sessionId, repo, progress);
  {
    const current = await repo.findSessionById(sessionId);
    if (!current || current.status === SESSION_STATUSES.CANCELLED) return;
  }

  await runRankingStage(sessionId, repo, progress, session);
  {
    const current = await repo.findSessionById(sessionId);
    if (!current || current.status === SESSION_STATUSES.CANCELLED) return;
  }

  const analyzed = await repo.countAnalyzedResults(sessionId);
  const moved = await repo.transitionSession(sessionId, [SESSION_STATUSES.ANALYZING], {
    status: SESSION_STATUSES.REVIEW_READY,
    completedAt: new Date(),
    currentStage: null,
    processedImages: analyzed,
    totalImages: analyzed,
    progressPercent: 100,
  });
  if (moved.count) await progress.publish(sessionId, repo);
}

// Called by the worker only after the final retry: transient failures retry silently, and a
// session a photographer cancelled keeps saying CANCELLED rather than becoming FAILED.
async function failSession(sessionId, error, repo = repository, progress = defaultProgress) {
  const moved = await repo.transitionSession(sessionId, ACTIVE_STATUSES, {
    status: SESSION_STATUSES.FAILED,
    completedAt: new Date(),
    currentStage: null,
    error: safeFailureMessage(error),
  });
  if (moved.count) {
    // Name, message and stack — not the whole object, which for a Prisma error carries the query.
    console.error(`AI culling session ${sessionId} failed: ${error?.name || "Error"}: ${error?.message || error}`, error?.stack || "");
    await progress.publish(sessionId, repo);
  }
}

module.exports = createAiCullingService();
module.exports.createAiCullingService = createAiCullingService;
module.exports.processSession = processSession;
module.exports.failSession = failSession;
module.exports.startPlan = startPlan;
module.exports.cancelPlan = cancelPlan;
module.exports.decisionPlan = decisionPlan;
module.exports.groupBestPlan = groupBestPlan;
module.exports.groupDecisionPlan = groupDecisionPlan;
module.exports.desktopFaceWrite = desktopFaceWrite;
module.exports.finalizePlan = finalizePlan;
module.exports.reopenPlan = reopenPlan;
module.exports.cullingEnabled = cullingEnabled;
module.exports.safeFailureMessage = safeFailureMessage;
module.exports.subtreeIds = subtreeIds;
module.exports.scopesOverlap = scopesOverlap;
module.exports.SEED_BATCH_SIZE = SEED_BATCH_SIZE;
module.exports.ANALYSIS_PAGE_SIZE = ANALYSIS_PAGE_SIZE;
module.exports.faceAnalyzeResult = faceAnalyzeResult;
module.exports.runGroupingStage = runGroupingStage;
module.exports.runSceneStage = runSceneStage;
module.exports.runRankingStage = runRankingStage;
module.exports.runSubjectStage = runSubjectStage;
