/**
 * Builds one versioned training dataset from finalized culling runs (phases 2 and 4).
 *
 * Reads production through Prisma, writes only files: examples.jsonl.gz (one photo of one run),
 * groups.jsonl.gz (one duplicate or burst group, members with graded relevance), pairs.jsonl.gz
 * (derived comparisons) and manifest.json (counts, class balance, versions, checksums). Never
 * an image, a path, a name, a face vector or a real id: projects, runs, photos, groups and
 * photographers are HMAC pseudonyms (pseudonym.js).
 *
 * Refuses unless the studio has opted in (image_selection_settings.culling_training_consent).
 * Takes only runs finalized at least `minAgeDays` ago, so late reopens have settled. A photo in
 * several finalized runs is kept once, from its latest. A run whose analysis failed on more than
 * 20% of its photos is dropped, as is any example with a feature outside its declared range.
 *
 * Group features are taken as the AI saw them: when the photographer changed a group's best
 * frame, the order before the change is restored from the decision events, so the photographer's
 * choice never leaks into the inputs it is meant to teach.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { FEATURE_SET_VERSION, FEATURE_NAMES, extractFeatures, groupContext, groupIdOf, outOfRange } = require("./featureSet");
const { changeType, decisionTrail, labelWeight, isRubberStamped, relativeRejects, relevanceOf } = require("./labels");
const { pseudonym, splitOf } = require("./pseudonym");

const EXPORT_VERSION = "export_v1";
const MAX_FAILED_SHARE = 0.2;
const LABELS = { KEEP: 1, REJECT: 0 };

const resultFields = {
  id: true, uploadId: true, blurScore: true, exposureScore: true, technicalScore: true, faceCount: true, faceQualityScore: true,
  eyesOpenScore: true, expressionScore: true, subjectScore: true, peopleCount: true, aestheticScore: true, compositionScore: true,
  sceneLabel: true, sceneConfidence: true, duplicateGroupId: true, burstGroupId: true, duplicateRank: true, burstRank: true,
  faceSharpnessScore: true, headPoseScore: true, expressionLabel: true, similarGroupId: true, similarRank: true,
  isGroupBest: true, reasonCodes: true, aiDecision: true, userDecision: true, effectiveDecision: true, finalScore: true, confidence: true,
};

/** Where a run's signals were computed: the desktop app on the workstation, or the server. */
const inferenceLocation = (run) => (run.analysisSource === "DESKTOP" ? "DESKTOP" : "SERVER");

/** A gzip JSON-lines writer that also hashes what it wrote. */
function jsonlWriter(file) {
  const gzip = zlib.createGzip();
  // Datasets are personal-data-adjacent: readable by the server's own user only.
  const out = fs.createWriteStream(file, { mode: 0o600 });
  gzip.pipe(out);
  let count = 0;
  return {
    write(record) { gzip.write(`${JSON.stringify(record)}\n`); count += 1; },
    async close() {
      await new Promise((resolve, reject) => { out.on("finish", resolve); out.on("error", reject); gzip.end(); });
      return { count, sha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") };
    },
  };
}

/**
 * The group view the AI produced: for each group whose best the photographer changed, the
 * order before the first change. Returns { originalOrder: Map(groupId -> [resultIds]),
 * chosenBest: Map(groupId -> resultId) }.
 */
function groupHistory(events) {
  const originalOrder = new Map();
  const chosenBest = new Map();
  for (const event of events.filter((item) => item.kind === "GROUP_BEST" && item.groupId)) {
    const order = event.groupOrder || {};
    if (!originalOrder.has(event.groupId) && Array.isArray(order.before)) originalOrder.set(event.groupId, order.before);
    if (Array.isArray(order.after) && order.after.length) chosenBest.set(event.groupId, order.after[0]);
  }
  return { originalOrder, chosenBest };
}

/** Rows with their group fields put back to the AI's own order where the photographer moved them. */
function asTheAiSawThem(rows, originalOrder) {
  return rows.map((row) => {
    const id = groupIdOf(row);
    const order = id ? originalOrder.get(id) : null;
    if (!order || !order.includes(row.id)) return row;
    const position = order.indexOf(row.id) + 1;
    return { ...row, isGroupBest: position === 1, ...(row.duplicateGroupId ? { duplicateRank: position } : { burstRank: position }) };
  });
}

function createExporter({ client, now = () => new Date() } = {}) {
  async function consentGiven() {
    const settings = await client.imageSelectionSettings.findUnique({ where: { id: "default" }, select: { cullingTrainingConsent: true } });
    return Boolean(settings?.cullingTrainingConsent);
  }

  async function finalizedRuns(minAgeDays) {
    const cutoff = new Date(now().getTime() - minAgeDays * 864e5);
    return client.imageSelectionCullingSession.findMany({
      where: { status: "FINALIZED", finalizedAt: { lte: cutoff }, project: { deletedAt: null } },
      orderBy: { finalizedAt: "asc" },
      select: { id: true, projectId: true, mode: true, targetCount: true, createdByUserId: true, completedAt: true, finalizedAt: true, totalImages: true, engineVersions: true, analysisSource: true, project: { select: { salesProject: { select: { verticalRef: { select: { code: true } } } } } } },
    });
  }

  /**
   * Writes dataset `datasetVersion` under `outDir`. Returns the manifest. `key` is the HMAC key
   * (pseudonym.trainingKey()).
   */
  async function exportDataset({ outDir, datasetVersion, minAgeDays = 14, key }) {
    if (!key) throw new Error("An HMAC key is required.");
    if (!/^[A-Za-z0-9_.-]{1,80}$/.test(datasetVersion)) throw new Error("The dataset version may use letters, digits, '.', '_' and '-' only.");
    if (!(await consentGiven())) throw new Error("The studio has not opted in to culling training (Image Selection settings). Nothing exported.");
    const dir = path.join(outDir, datasetVersion);
    fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
    try { fs.mkdirSync(dir, { mode: 0o700 }); } catch (error) {
      if (error.code === "EEXIST") throw new Error(`Dataset ${datasetVersion} already exists; datasets are immutable. Choose a new version.`);
      throw error;
    }

    const runs = await finalizedRuns(minAgeDays);
    // "Forget what it learned" holds for training too: a photographer's decisions and burst picks
    // from before their reset are not evidence of them, so those events (and the legacy feedback
    // rows) are left out, and the photo reads as an AI call left standing.
    const resets = new Map((await client.imageSelectionCullingPreference.findMany({ where: { resetAt: { not: null } }, select: { userId: true, resetAt: true } })).map((row) => [row.userId, new Date(row.resetAt).getTime()]));
    const sinceReset = (row) => !row.userId || !resets.has(row.userId) || new Date(row.createdAt).getTime() > resets.get(row.userId);
    // A photo in several finalized runs is learned from its latest one only.
    const latestRunOfUpload = new Map();
    for (const run of runs) {
      const uploads = await client.imageSelectionCullingResult.findMany({ where: { sessionId: run.id }, select: { uploadId: true } });
      for (const { uploadId } of uploads) latestRunOfUpload.set(uploadId, run.id);
    }

    const examples = jsonlWriter(path.join(dir, "examples.jsonl.gz"));
    const groups = jsonlWriter(path.join(dir, "groups.jsonl.gz"));
    const pairs = jsonlWriter(path.join(dir, "pairs.jsonl.gz"));
    const stats = { platforms: { review: {}, inference: {} }, runs: 0, runsDropped: { analysisFailed: 0 }, examples: 0, dropped: { pending: 0, outOfRange: 0, duplicateOfLaterRun: 0 }, labels: { KEEP: 0, MAYBE: 0, REJECT: 0 }, relativeRejects: 0, changeTypes: {}, explicit: 0, gold: 0, clientPicked: 0, splits: { train: 0, validation: 0, test: 0 }, projects: new Set(), photographers: new Set(), groups: 0, pairs: 0 };
    const studio = pseudonym("studio", "default", key);

    for (const run of runs) {
      const rows = await client.imageSelectionCullingResult.findMany({ where: { sessionId: run.id }, select: resultFields });
      if (!rows.length) continue;
      const failed = rows.filter((row) => Array.isArray(row.reasonCodes) && row.reasonCodes.includes("ANALYSIS_FAILED")).length;
      if (failed / rows.length > MAX_FAILED_SHARE) { stats.runsDropped.analysisFailed += 1; continue; }
      const events = (await client.imageSelectionCullingDecisionEvent.findMany({ where: { sessionId: run.id }, orderBy: { createdAt: "asc" } })).filter(sinceReset);
      const legacy = new Set((await client.imageSelectionCullingFeedback.findMany({ where: { result: { sessionId: run.id } }, select: { resultId: true, userId: true, createdAt: true } })).filter(sinceReset).map((row) => row.resultId));
      const picked = new Set((await client.imageSelectionPhotoSelection.findMany({ where: { imageSelectionUploadId: { in: rows.map((row) => row.uploadId) } }, select: { imageSelectionUploadId: true } })).map((row) => row.imageSelectionUploadId));
      const eventsByResult = new Map();
      for (const event of events) if (event.resultId) { if (!eventsByResult.has(event.resultId)) eventsByResult.set(event.resultId, []); eventsByResult.get(event.resultId).push(event); }
      const decisionCount = events.filter((event) => event.kind === "DECIDE" || event.kind === "CLEAR").length + legacy.size;
      const rubberStamped = isRubberStamped(run, decisionCount);
      const { originalOrder, chosenBest } = groupHistory(events);
      const aiRows = asTheAiSawThem(rows, originalOrder);
      const context = groupContext(aiRows);
      const finals = aiRows.map((row) => ({ ...row, finalDecision: row.effectiveDecision }));
      const relative = relativeRejects(finals, groupIdOf);
      const project = pseudonym("project", run.projectId, key);
      const session = pseudonym("run", run.id, key);
      const photographer = pseudonym("photographer", run.createdByUserId, key);
      const split = splitOf(project);
      const eventType = run.project?.salesProject?.verticalRef?.code || null;
      const gold = run.mode === "ASSISTED";
      const groupMembers = new Map();
      stats.runs += 1;
      stats.projects.add(project);
      if (photographer) stats.photographers.add(photographer);

      for (const row of finals) {
        if (latestRunOfUpload.get(row.uploadId) !== run.id) { stats.dropped.duplicateOfLaterRun += 1; continue; }
        if (!LABELS.hasOwnProperty(row.finalDecision) && row.finalDecision !== "MAYBE") { stats.dropped.pending += 1; continue; }
        const features = extractFeatures(row, context);
        if (outOfRange(features).length) { stats.dropped.outOfRange += 1; continue; }
        const trail = decisionTrail(eventsByResult.get(row.id) || []);
        const weight = labelWeight({ trail, legacyChange: !trail.explicit && legacy.has(row.id), rubberStamped });
        const id = pseudonym("photo", `${run.id}:${row.id}`, key);
        const group = groupIdOf(row);
        const isRelative = relative.has(row.id);
        const type = changeType(row.aiDecision, row.finalDecision);
        examples.write({
          id, run: session, project, photographer, studio, split, eventType, mode: run.mode, gold,
          scene: row.sceneLabel || null, features,
          aiDecision: row.aiDecision, aiScore: row.finalScore, aiConfidence: row.confidence,
          finalDecision: row.finalDecision, label: LABELS[row.finalDecision] ?? null,
          changeType: type, weight: Math.round(weight * 1000) / 1000, explicit: trail.explicit, source: trail.source,
          relativeReject: isRelative, clientPicked: picked.has(row.uploadId),
          // Where the review happened and where the signals were computed: metadata for reading
          // the evaluation per environment - never a feature, never a different weight.
          reviewPlatform: trail.platform, inferenceLocation: inferenceLocation(run),
          group: group ? pseudonym("group", group, key) : null, groupType: row.duplicateGroupId ? "DUPLICATE" : row.burstGroupId ? "BURST" : null,
          // The month only: with few studios a day could single a shoot out.
          finalizedOn: new Date(run.finalizedAt).toISOString().slice(0, 7),
        });
        stats.examples += 1;
        stats.platforms.review[trail.platform || "UNSEEN"] = (stats.platforms.review[trail.platform || "UNSEEN"] || 0) + 1;
        stats.platforms.inference[inferenceLocation(run)] = (stats.platforms.inference[inferenceLocation(run)] || 0) + 1;
        stats.labels[row.finalDecision] += 1;
        stats.changeTypes[type] = (stats.changeTypes[type] || 0) + 1;
        if (isRelative) stats.relativeRejects += 1;
        if (trail.explicit) stats.explicit += 1;
        if (gold) stats.gold += 1;
        if (picked.has(row.uploadId)) stats.clientPicked += 1;
        stats.splits[split] += 1;
        if (group) {
          if (!groupMembers.has(group)) groupMembers.set(group, []);
          groupMembers.get(group).push({ example: id, relevance: relevanceOf(row.finalDecision, chosenBest.get(group) === row.id), weight, clientPicked: picked.has(row.uploadId) });
        }
      }

      for (const [group, members] of groupMembers) {
        if (members.length < 2) continue;
        groups.write({ group: pseudonym("group", group, key), run: session, project, photographer, split, type: rows.find((row) => groupIdOf(row) === group)?.duplicateGroupId ? "DUPLICATE" : "BURST", members: members.map(({ example, relevance }) => ({ example, relevance })) });
        stats.groups += 1;
        for (let i = 0; i < members.length; i += 1) {
          for (let j = 0; j < members.length; j += 1) {
            const a = members[i]; const b = members[j];
            if (a.relevance > b.relevance) { pairs.write({ winner: a.example, loser: b.example, source: "GROUP_DECISION", split, weight: Math.min(a.weight, b.weight) }); stats.pairs += 1; }
            else if (a.relevance === b.relevance && a.clientPicked && !b.clientPicked) { pairs.write({ winner: a.example, loser: b.example, source: "CLIENT_PICK", split, weight: 0.5 }); stats.pairs += 1; }
          }
        }
      }
    }

    const files = { examples: await examples.close(), groups: await groups.close(), pairs: await pairs.close() };
    const manifest = {
      datasetVersion, exportVersion: EXPORT_VERSION, featureSetVersion: FEATURE_SET_VERSION, featureNames: FEATURE_NAMES,
      createdAt: now().toISOString(), minAgeDays,
      counts: { runs: stats.runs, projects: stats.projects.size, photographers: stats.photographers.size, examples: stats.examples, groups: stats.groups, pairs: stats.pairs, explicitDecisions: stats.explicit, goldExamples: stats.gold, clientPicked: stats.clientPicked, relativeRejects: stats.relativeRejects },
      labels: stats.labels, changeTypes: stats.changeTypes, platforms: stats.platforms, splits: stats.splits, dropped: { ...stats.dropped, runsWithFailedAnalysis: stats.runsDropped.analysisFailed },
      files: Object.fromEntries(Object.entries(files).map(([name, info]) => [name, { file: `${name}.jsonl.gz`, records: info.count, sha256: info.sha256 }])),
    };
    fs.writeFileSync(path.join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    return manifest;
  }

  return { exportDataset, consentGiven };
}

/** Deletes dataset folders older than `retentionDays` (by their manifest's createdAt). Returns the removed versions. */
function pruneDatasets(outDir, retentionDays, now = new Date()) {
  if (!fs.existsSync(outDir)) return [];
  const removed = [];
  for (const name of fs.readdirSync(outDir)) {
    const manifestFile = path.join(outDir, name, "manifest.json");
    if (!fs.existsSync(manifestFile)) continue;
    const { createdAt } = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    if (now - new Date(createdAt) > retentionDays * 864e5) { fs.rmSync(path.join(outDir, name), { recursive: true, force: true }); removed.push(name); }
  }
  return removed;
}

module.exports = { createExporter, pruneDatasets, groupHistory, asTheAiSawThem, EXPORT_VERSION };
