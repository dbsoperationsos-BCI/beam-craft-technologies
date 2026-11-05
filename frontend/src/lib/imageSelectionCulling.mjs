/**
 * Pure helpers for the Photo Culling workspace. Plain module (no React) so `node --test` can
 * exercise the state machine the UI renders from, the same way the folder-tree helpers are tested.
 * The status and stage strings mirror backend/src/modules/image-selection/ai-culling/constants.js.
 */

import { PROGRESS_COLORS } from "./progressStatus.mjs";

export const CULLING_STATUS_LABELS = {
  QUEUED: "Waiting to start",
  ANALYZING: "Analyzing photos",
  GROUPING: "Grouping similar photos",
  RANKING: "Ranking photos",
  REVIEW_READY: "Review ready",
  FINALIZED: "Finalized",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

const STAGE_LABELS = {
  PREPARING: "Preparing photos",
  TECHNICAL_ANALYSIS: "Technical analysis",
  FACE_ANALYSIS: "Face analysis",
  SUBJECTS: "Who is in each photo",
  SCENE: "Scenes and framing",
  SIMILARITY: "Similarity analysis",
  GROUPING: "Grouping",
  RANKING: "Ranking",
  FINALIZING: "Finalizing",
};

// Statuses a session can still move out of on its own — while one of these is showing, the
// workspace polls for progress and offers Cancel instead of Start.
const ACTIVE_STATUSES = ["QUEUED", "ANALYZING", "GROUPING", "RANKING"];

export const isCullingSessionActive = (session) => Boolean(session && ACTIVE_STATUSES.includes(session.status));

export const cullingStatusLabel = (status) => CULLING_STATUS_LABELS[status] || status || "";
export const cullingStageLabel = (stage) => (stage ? STAGE_LABELS[stage] || stage : "");

/**
 * Whether the Start button should be offered, and if not, why — one answer the intro panel and
 * the button's disabled state both read, so they can never disagree.
 */
export function cullingStartAvailability({ enabled, session, readyCount, canWrite }) {
  if (!enabled) return { canStart: false, reason: "AI culling is disabled on this server." };
  if (isCullingSessionActive(session)) return { canStart: false, reason: "A culling run is already in progress." };
  if (!canWrite) return { canStart: false, reason: "You have read-only access to Image Selection." };
  if (!readyCount) return { canStart: false, reason: "Process at least one image before starting AI culling." };
  return { canStart: true, reason: null };
}

/** The modes a run can start in, in the order the picker offers them. */
export const CULLING_MODES = [
  { id: "ASSISTED", label: "Assisted", description: "Score and group only — every decision stays yours." },
  { id: "BALANCED", label: "Balanced", description: "AI recommends Keep / Maybe / Reject for you to review." },
  { id: "STRICT", label: "Strict", description: "Stronger duplicate removal and a higher technical bar." },
  { id: "TARGET_COUNT", label: "Target count", description: "Aim for about N keeps, spread across every shoot and hour of the story.", needsTarget: true },
];

/** TARGET_COUNT needs a target between 1 and one below the photo count; other modes need none. */
export function cullingTargetValidity(mode, targetCount, readyCount) {
  if (mode !== "TARGET_COUNT") return { valid: true, reason: null };
  const value = Number(targetCount);
  if (!Number.isInteger(value) || value < 1) return { valid: false, reason: "Enter how many photos the cull should aim for." };
  if (value >= readyCount) return { valid: false, reason: "The target must be below the photo count — there is nothing to cull otherwise." };
  return { valid: true, reason: null };
}

/** The review gallery's facet chips, in display order. Ids mirror the backend's filter enum. */
export const CULLING_FILTERS = [
  { id: "all", label: "All" },
  { id: "keep", label: "Keep" },
  { id: "maybe", label: "Maybe" },
  { id: "reject", label: "Reject" },
  { id: "pending", label: "Pending" },
  { id: "low_confidence", label: "Low confidence" },
  { id: "duplicates", label: "Duplicates" },
  { id: "best_of_burst", label: "Best of burst" },
  { id: "blur", label: "Blur" },
  { id: "closed_eyes", label: "Closed eyes" },
  { id: "unanalyzed", label: "Unanalyzed" },
  { id: "accidental", label: "Likely accidental", hint: "Frames that look like the floor, a pocket or a lens cap AND are soft, blurred or badly exposed — the AI's suggestion, never a verdict" },
  { id: "cut_faces", label: "Face cut off", hint: "A face touches the edge of the frame" },
];

export const CULLING_SORTS = [
  { id: "captured", label: "Captured time" },
  { id: "score", label: "AI score" },
  { id: "confidence", label: "Confidence" },
  { id: "name", label: "Filename" },
];

/**
 * A chip's count. The decision chips read the session's own counters, the facet chips the
 * overview's facet counts; null means "no number to show", never zero.
 */
export function cullingFilterCount(filterId, session, filterCounts) {
  if (!session) return null;
  switch (filterId) {
    case "all": return session.totalImages;
    case "keep": return session.keepCount;
    case "maybe": return session.maybeCount;
    case "reject": return session.rejectCount;
    case "pending": return Math.max(0, session.totalImages - session.keepCount - session.maybeCount - session.rejectCount);
    default: return filterCounts ? filterCounts[filterId] ?? null : null;
  }
}

/** Decision badge styling, one place, so a KEEP is the same green everywhere. */
export const CULLING_DECISION_STYLES = {
  KEEP: { label: "Keep", className: "bg-emerald-100 text-emerald-700" },
  MAYBE: { label: "Maybe", className: "bg-amber-100 text-amber-700" },
  REJECT: { label: "Reject", className: "bg-red-100 text-red-700" },
  PENDING: { label: "Pending", className: "bg-slate-100 text-slate-600" },
};

const REASON_LABELS = {
  SHARP: "Sharp",
  SOFT_FOCUS: "Soft focus",
  SEVERE_BLUR: "Severe blur",
  OVEREXPOSED: "Overexposed",
  UNDEREXPOSED: "Underexposed",
  EYES_OPEN: "Eyes open",
  PRIMARY_SUBJECT_BLINK: "Subject blink",
  HALF_CLOSED_EYES: "Eyes half closed or looking down",
  LOOKING_AWAY: "Looking away",
  GOOD_EXPRESSION: "Good expression",
  LOW_FACE_QUALITY: "Low face quality",
  FACE_OCCLUDED: "Face occluded",
  DUPLICATE: "Duplicate",
  BEST_IN_BURST: "Best of burst",
  ALTERNATE_FRAME: "Alternate frame",
  LOW_CONFIDENCE: "Low confidence",
  ANALYSIS_FAILED: "Analysis failed",
  FACE_ANALYSIS_FAILED: "Face analysis failed",
  // The desktop app could not open the original on its workstation - the same three states the
  // backend and the desktop name (`LOCAL_SOURCE_CODES`); the photo is left to the photographer.
  LOCAL_SOURCE_UNAVAILABLE: "Original unavailable on workstation",
  LOCAL_SOURCE_CHANGED: "Original changed since it was added",
  LOCAL_SOURCE_UNREADABLE: "Original could not be decoded",
  // Read from the photo itself (analysis/subjects.js): a large, central face - not a person's label.
  KEY_PEOPLE_PRESENT: "Clear main subject",
  IMPORTANT_SUBJECT_BLINK: "Main face's eyes closed",
  ACCIDENTAL_FRAME: "Accidental frame",
  FACE_CUT_OFF: "Face cut off",
  WELL_COMPOSED: "Well composed",
  STRIKING_LOOK: "Striking look",
  UNIQUE_FRAME: "Covers this hour",
  COVERS_PERSON: "Keeps a key person",
  COVERS_SCENE: "Covers a moment",
  TASTE_UP: "You usually keep these",
  TASTE_DOWN: "You usually reject these",
};
export const cullingReasonLabel = (code) => REASON_LABELS[code] || code;

/**
 * The run's scenes for the review's scene picker: the overview sends `[{ id, label, count }]` in
 * the profile's order with the studio's words, so no label is written here. The "all" row is a
 * real option (a picker needs one); nothing is offered when the run has no scenes.
 */
export const CULLING_ALL_SCENES = "ALL";
export const cullingSceneOptions = (scenes = []) => (scenes.length ? [{ value: CULLING_ALL_SCENES, label: "All scenes" }, ...scenes.map((scene) => ({ value: scene.id, label: `${scene.label} · ${scene.count}` }))] : []);
// A scene is the AI's guess: below this confidence the card shows nothing rather than a likely
// wrong label, and every shown label says how sure it is on hover.
const SCENE_SHOWN_FROM = 0.4;
export const cullingSceneLabel = (id, scenes = [], confidence = null) => {
  if (!id || (typeof confidence === "number" && confidence < SCENE_SHOWN_FROM)) return "";
  return scenes.find((scene) => scene.id === id)?.label || "";
};
export const cullingSceneHint = (confidence) => (typeof confidence === "number" ? `The AI's guess · ${Math.round(confidence * 100)}% sure` : "The AI's guess");

/**
 * The story coverage of a settled run, as the overview sends it (following the photographer's
 * overrides): "Your Keeps cover 9 of 10 moments · 3 of 3 key people", and the moments with no Keep.
 */
export function cullingCoverageLine(coverage) {
  if (!coverage) return "";
  const parts = [];
  if (coverage.moments?.total) parts.push(`${coverage.moments.kept} of ${coverage.moments.total} scene${coverage.moments.total === 1 ? "" : "s"}`);
  if (coverage.keyPeople?.total) parts.push(`${coverage.keyPeople.kept} of ${coverage.keyPeople.total} key ${coverage.keyPeople.total === 1 ? "person" : "people"}`);
  return parts.length ? `Your Keeps cover ${parts.join(" · ")}` : "";
}
// The scenes with no Keep yet, each a way into the review on that scene.
export const cullingCoverageMissing = (coverage) => coverage?.moments?.missing || [];

/**
 * What culling has learned from one photographer (the preferences route): one line per learned
 * feature in the studio's words — a reason badge or a scene — and which way it leans, plus a
 * summary that says how much it has seen and whether it is in use.
 */
export const cullingPreferenceFeatureLabel = (feature, scenes = []) => {
  const sceneName = (id) => scenes.find((scene) => scene.id === id)?.label || id;
  // A "context" feature is a badge learned in one kind of scene only: "Soft focus in Candid guests".
  const name = feature.kind === "scene" ? sceneName(feature.id) : feature.kind === "context" ? `${cullingReasonLabel(feature.id)} in ${sceneName(feature.scene)}` : cullingReasonLabel(feature.id);
  return `${name} — you ${feature.weight > 0 ? "keep" : "reject"} these ${Math.abs(feature.weight) >= 3 ? "clearly" : "a little"} more often`;
};
// Culling V2: which frame the photographer picks as the best of a burst, from their own picks over
// the AI's keeper - the parts of the keeper merit their picks moved up, and the one moved down most.
const GROUP_TASTE_WORDS = { technical: "sharpness", eyes: "open eyes", expression: "expression", face: "face quality" };
const GROUP_TASTE_DEFAULT = { technical: 0.35, eyes: 0.3, expression: 0.2, face: 0.15 };
export function cullingGroupTasteLabel(groupTaste) {
  if (!groupTaste?.weights) return "";
  const shifts = Object.keys(GROUP_TASTE_WORDS).map((key) => ({ key, shift: (groupTaste.weights[key] ?? GROUP_TASTE_DEFAULT[key]) - GROUP_TASTE_DEFAULT[key] }));
  const up = shifts.filter((item) => item.shift >= 0.03).sort((a, b) => b.shift - a.shift);
  const down = shifts.filter((item) => item.shift <= -0.03).sort((a, b) => a.shift - b.shift);
  if (!up.length) return "";
  return `Choosing the best of a group, you favour ${up.map((item) => GROUP_TASTE_WORDS[item.key]).join(" and ")}${down.length ? ` over ${GROUP_TASTE_WORDS[down[0].key]}` : ""} (learned from ${groupTaste.choices} ${groupTaste.choices === 1 ? "pick" : "picks"})`;
}
export const CULLING_PREFERENCE_PRIVACY = "Private to you, learned from your own Keep and Reject changes across your projects. It moves a photo a few points at most, and the photo says why.";
// The policy, in the panel's words: the per-photo nudge waits for `minimum` corrections' worth
// of Keep and Reject changes (a bulk change counts less); the burst-winner taste stands on its
// own five picks and applies before that; both obey the one switch and the one reset.
export const CULLING_PREFERENCE_BURST_POLICY = "Which frame you pick as the best of a burst is learned on its own, after five picks, and applies with the same switch.";
export function cullingPreferenceSummary(preferences) {
  if (!preferences) return "";
  const tasteInUse = Boolean(preferences.groupTaste) && preferences.enabled !== false;
  if (preferences.decisions < preferences.minimum) return `Preference learning becomes active after ${preferences.minimum} corrections' worth of Keep and Reject changes (a bulk change counts less) — ${preferences.decisions} so far, ${preferences.minimum - preferences.decisions} to go.${tasteInUse ? " Your burst picks already count." : ""}`;
  if (!preferences.enabled) return `Learned from ${preferences.decisions} corrections' worth of your Keep and Reject changes. Switched off: it is still learning, but your runs do not use it.`;
  return `Learned from ${preferences.decisions} corrections' worth of your Keep and Reject changes. Runs you start use it.`;
}
/** Whether anything learned is in use or could be: the switch and the burst line show from the first correction or pick. */
export const cullingPreferenceHasLearning = (preferences) => Boolean(preferences && (preferences.decisions > 0 || preferences.groupTaste));

// Culling V2: the group a photo is compared in - its duplicate group, else its burst, else its
// series of similar frames (relative only: an alternate is never rejected for being one) - with
// its rank there.
export function cullingGroupOf(item) {
  if (item?.duplicateGroupId) return { id: item.duplicateGroupId, type: "DUPLICATE", rank: item.duplicateRank ?? null, noun: "duplicates" };
  if (item?.burstGroupId) return { id: item.burstGroupId, type: "BURST", rank: item.burstRank ?? null, noun: "burst" };
  if (item?.similarGroupId) return { id: item.similarGroupId, type: "SIMILAR", rank: item.similarRank ?? null, noun: "similar frames" };
  return null;
}
export function cullingGroupTitle(group) {
  const count = Array.isArray(group?.members) ? group.members.length : group?.memberCount ?? 0;
  const name = group?.type === "SIMILAR" ? "Similar frames" : group?.type === "BURST" ? "Burst group" : "Duplicate group";
  return `${name} — ${count} frame${count === 1 ? "" : "s"}`;
}
// How each kind of group is ranked - the backend's balanced keeper merit (analysis/duplicates.js).
export const CULLING_RANKED_ON = "sharpness, open eyes, expression and face quality";
const KEEPER_RANKING = `Best first, judged on ${CULLING_RANKED_ON}. The best is starred; mark another frame as best to make it #1.`;
export const CULLING_GROUP_RANKING = {
  DUPLICATE: KEEPER_RANKING,
  BURST: KEEPER_RANKING,
  SIMILAR: `${KEEPER_RANKING} The others are alternates and are never rejected for it.`,
};
// The measured signals the explanation lists (0-100), in reading order; a photo shows the ones it has.
export const CULLING_SIGNAL_SCORES = [["technicalScore", "Technical"], ["faceSharpnessScore", "Face sharpness"], ["eyesOpenScore", "Eyes open"], ["expressionScore", "Expression"], ["headPoseScore", "Facing the camera"], ["subjectScore", "People"], ["aestheticScore", "Look"], ["compositionScore", "Composition"]];
// The face engine's expression classes in the studio's words.
const EXPRESSION_WORDS = { happiness: "smiling", neutral: "neutral", surprise: "surprised", sadness: "sad", anger: "angry", disgust: "displeased", fear: "fearful", contempt: "displeased" };
/** One measured signal's value as the explanation shows it: "82", or "82, smiling" for the expression. */
export function cullingSignalValue(item, key) {
  const value = Math.round(item[key]);
  return key === "expressionScore" && EXPRESSION_WORDS[item.expressionLabel] ? `${value}, ${EXPRESSION_WORDS[item.expressionLabel]}` : String(value);
}
/**
 * Culling V2 notes from a photo's stored fields: the expression the engine read when it has no
 * score row to sit in, its place among similar frames, and - when they differ - its own quality
 * beside the decision score, saying what moved it (the photographer's learned taste, else its
 * place in its group).
 */
export function cullingSignalNotes(item) {
  const notes = [];
  if (EXPRESSION_WORDS[item?.expressionLabel] && typeof item.expressionScore !== "number") notes.push(`Expression: ${EXPRESSION_WORDS[item.expressionLabel]}`);
  if (item?.similarGroupId && Number.isInteger(item.similarRank) && item.similarRank > 0) notes.push(`#${item.similarRank} among similar frames`);
  const quality = typeof item?.qualityScore === "number" ? Math.round(item.qualityScore) : null;
  const score = typeof item?.finalScore === "number" ? Math.round(item.finalScore) : null;
  if (quality !== null && score !== null && quality !== score) {
    const taste = typeof item.preferenceAdjustment === "number" ? Math.round(item.preferenceAdjustment) : 0;
    notes.push(taste
      ? `Photo quality ${quality}. Your learned taste ${taste > 0 ? "added" : "took off"} ${Math.abs(taste)}.`
      : `Photo quality ${quality}. Its place in its group moved the score to ${score}.`);
  }
  return notes;
}

/** Where a frame stands in its duplicate or burst group: "#2 of 5"; empty for a run from before ranks. */
export const cullingRankLabel = (rank, memberCount) => (Number.isInteger(rank) && rank > 0 ? `#${rank}${memberCount ? ` of ${memberCount}` : ""}` : "");

/**
 * Keys the review grid must leave alone: anything typed into a control, a button's own Enter or
 * Space, and modifier chords (Ctrl+1 is the browser's tab switch, not a Keep). Takes the event
 * target's shape rather than a DOM node so it is testable without a browser.
 */
export function cullingKeyIgnored(target, event) {
  if (event?.ctrlKey || event?.metaKey || event?.altKey) return true;
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tagName = String(target.tagName || "").toUpperCase();
  if (["INPUT", "SELECT", "TEXTAREA"].includes(tagName)) return true;
  // Focus rests on a button after a click, so only its own Enter and Space are left to it;
  // digits and arrows keep working from there.
  // A menu trigger (a Dropdown) owns every key — a digit is its type-ahead, not a decision.
  if (typeof target.getAttribute === "function" && target.getAttribute("aria-haspopup")) return true;
  if (["BUTTON", "A"].includes(tagName)) return event?.key === "Enter" || event?.key === " ";
  const role = typeof target.getAttribute === "function" ? target.getAttribute("role") : null;
  if (["textbox", "combobox", "listbox", "menu", "menuitem"].includes(role)) return true;
  // Any other dialog owns its keys; the culling preview (marked data-culling-keys) lets them through.
  return typeof target.closest === "function" && Boolean(target.closest('[role="dialog"]:not([data-culling-keys])'));
}

/**
 * The finalize confirmation's first line, with the numbers: how many photos will be hidden and
 * how many stay. Assisted mode decided nothing, so it says what that means for pending photos.
 */
export function cullingFinalizeMessage(session) {
  const total = Number(session?.totalImages) || 0;
  const keep = Number(session?.keepCount) || 0;
  const hidden = Math.max(0, total - keep);
  const figures = `${hidden} of ${total} photo${total === 1 ? "" : "s"} will be hidden; ${keep} stay as Keep and go on to AI Editing.`;
  const undecided = Math.max(0, total - keep - (Number(session?.rejectCount) || 0));
  const undecidedLine = undecided ? ` ${undecided} of the hidden ${undecided === 1 ? "is" : "are"} Maybe or still pending.` : "";
  if (session?.mode === "ASSISTED") return `In Assisted mode the AI decided nothing, so every photo you have not marked Keep — including the pending ones — counts as hidden: ${figures}${undecidedLine}`;
  return `${figures}${undecidedLine}`;
}

/**
 * Photos processed after the run seeded: reported, never silently absorbed. Null when there are
 * none; the tense follows the session (before finalize they would stay visible, after it they do).
 */
/** What finalizing never does, listed under the finalize figures. */
// A failed run applied nothing: culling only ever hides photos when a run is finalized, so Photo
// Selection is exactly as it was. AI Culling is a stage no photo skips, so the one way on is a new run.
export const CULLING_FAILED_ASSURANCE = "This run changed nothing. Start a new run below.";

/**
 * Photos imported for culling wait here before they go on: finalizing a run moves its Keeps into
 * AI Editing, and nothing goes straight to Photo Selection. The line that says so (null when there
 * are none).
 */
export function cullingHeldLine(held) {
  const count = Number(held) || 0;
  if (!count) return null;
  return `${count} photo${count === 1 ? " imported here waits" : "s imported here wait"} for culling. Finalizing a run sends the photos it kept on to AI Editing.`;
}

export const CULLING_FINALIZE_ASSURANCES = [
  "Your own decisions count exactly as you made them.",
  "Photos the client already selected always stay.",
  "Nothing is deleted — you can reopen later.",
];

export function cullingNewPhotosNotice(count, status) {
  const value = Number(count) || 0;
  if (value <= 0) return null;
  const one = value === 1;
  const head = `${value} photo${one ? " was" : "s were"} added after this run started and ${one ? "is" : "are"} not included.`;
  if (status === "FINALIZED") return `${head} ${one ? "It is" : "They are"} still visible in Photo Selection; start a new run to cull ${one ? "it" : "them"}.`;
  return `${head} Finalizing leaves ${one ? "it" : "them"} visible; start a new run to cull ${one ? "it" : "them"}.`;
}

/** "Balanced", or "Target count · aiming for 600" — the header's one-line reminder of how the run was asked to behave. Never a raw enum. */
export function cullingModeSummary(session) {
  const mode = CULLING_MODES.find((option) => option.id === session?.mode);
  if (!mode) return "";
  return mode.id === "TARGET_COUNT" && session.targetCount ? `${mode.label} · aiming for ${session.targetCount}` : mode.label;
}

/** Confidence as the photographer reads it: a percentage, or nothing when the run did not decide. */
export function cullingConfidenceLabel(confidence) {
  if (confidence === null || confidence === undefined) return null;
  const value = Number(confidence);
  if (!Number.isFinite(value)) return null;
  return `${Math.round(value * 100)}%`;
}

/** A run the desktop app is analyzing on the computer that holds the originals, not yet handed to the server (`startedAt` is the hand-over mark). */
export const cullingWaitingForDesktop = (session) => Boolean(session && session.analysisSource === "DESKTOP" && session.status === "QUEUED" && !session.startedAt);
/** A run that began with the import and is still waiting for its photos to land - the server's stages follow by themselves. */
export const cullingImporting = (session) => Boolean(session && session.awaitsUploads && session.status === "QUEUED" && !session.startedAt);

/** The mode an import starts in when the project has no remembered choice. */
export const CULLING_IMPORT_DEFAULT_MODE = "BALANCED";

/**
 * The one progress of an import that culls itself, from the three places its facts live: the
 * upload run (`run`: the desktop's ledger - total, compressed, ready, duplicates, failed; null on
 * the web), the local analysis (`local`: analyzed, faces, skipped), and the server (`importing`
 * from the overview: analyzed signals it holds, photos in flight, photos READY; `counts` the
 * scope's photoCounts).
 *
 * Overall progress is the share of settled UNITS over the whole pipeline, never an average of
 * percentages. Each photo is three units when this computer analyzes it - landed (uploaded, or
 * found already there, or failed for good), analyzed (its signals on the server) and ranked (the
 * server's own pass: who is in it, scenes, groups, the decision) - and two (landed, ranked) when
 * the server analyzes after the last photo lands. A failed photo settles its import units: it is
 * not coming, and the panel says so beside the count. The ranked unit fills with the server's
 * stage progress once the run is handed over (`session.startedAt`), and only a run that reached
 * its review is 100: until then the bar stops at 99, whatever the sum says.
 *
 * From the hand-over the total is the run's own scope (`session.totalImages`, what the server
 * ranks), every photo of it has landed and been measured - the run only goes over once nothing is
 * on the way, or by force, and then the stragglers are a later run's - and "analyzed" is the
 * server's count of measured photos, stamped by the workstation or read from previews.
 */
export function cullingImportProgress({ run = null, local = null, importing = null, counts = null, localAnalysis = false, session = null } = {}) {
  const n = (value) => Math.max(0, Number(value) || 0);
  const handedOver = Boolean(session?.startedAt);
  const finished = Boolean(session && (session.status === "REVIEW_READY" || session.status === "FINALIZED"));
  const serverReady = n(importing?.ready ?? counts?.ready);
  const inFlight = importing ? n(importing.inFlight) : n(counts?.processing) + n(counts?.uploading);
  // The total: this import's - the ledger's when it is on this computer, else what the server
  // counts - until the hand-over, and the run's own scope from then on.
  const importTotal = run ? n(run.total) : serverReady + inFlight + n(counts?.failed);
  const total = handedOver && n(session.totalImages) ? n(session.totalImages) : importTotal;
  const failed = run ? n(run.failed) : n(counts?.failed);
  const uploaded = handedOver ? total : run ? n(run.ready) + n(run.duplicates) : serverReady;
  const compressed = handedOver ? total : run ? Math.min(n(run.compressed), total) : uploaded;
  const landed = handedOver ? total : Math.min(total, uploaded + failed);
  // Analyzed: what this computer has posted (it knows first), else what the server holds; after
  // the hand-over the server's own count.
  const analyzedLocal = Math.min(total, Math.max(n(local?.analyzed) + n(local?.skipped), n(importing?.analyzed)));
  const analyzed = handedOver ? Math.min(total, Math.max(analyzedLocal, n(session.processedImages))) : analyzedLocal;
  const serverPercent = finished ? 100 : handedOver ? cullingProgressPercent(session) : 0;
  const unitsPerPhoto = (localAnalysis ? 2 : 1) + 1;
  const analyzedUnits = localAnalysis ? (handedOver ? total : Math.min(total, analyzed + failed)) : 0;
  const serverUnits = finished ? total : (total * serverPercent) / 100;
  const settled = landed + analyzedUnits + serverUnits;
  const totalUnits = total * unitsPerPhoto;
  const percent = finished ? 100 : totalUnits ? Math.min(99, Math.floor((settled / totalUnits) * 100)) : 0;
  const remaining = Math.max(0, totalUnits - settled);
  const stage = handedOver && !finished ? session.currentStage || "PREPARING" : null;
  return { total, discovered: total, compressed, uploaded, landed, failed, analyzed, faces: n(local?.faces), ready: serverReady, remaining, percent, unitsPerPhoto, handedOver, finished, stage, serverPercent, complete: finished, paused: Boolean(run?.paused || local?.paused) };
}

/**
 * The import panel's status word, from the facts: what is happening to most of the photos now.
 * Paused and Failed win; then Discovering (nothing registered yet), Compressing, Uploading,
 * Analyzing, Finishing (the server's own pass, after the hand-over) and Ready once the review is.
 */
export function cullingImportStatus(progress, { run = null, local = null } = {}) {
  if (progress.paused) return "Paused";
  if (run && run.status === "CANCELLED") return "Cancelled";
  if (progress.complete) return progress.failed ? "Ready, with failures" : "Ready";
  if (progress.handedOver) return "Finishing";
  if (!progress.total) return "Discovering";
  if (progress.compressed < progress.total) return "Compressing";
  if (progress.landed < progress.total) return "Uploading";
  return local?.active || progress.unitsPerPhoto === 2 ? "Analyzing" : "Waiting";
}

/**
 * A remaining-time estimate only when the rate so far supports one: at least a few units settled
 * over at least a few seconds; null otherwise, and the panel says nothing rather than a guess.
 */
export function cullingImportEta(progress, startedAt, now = Date.now()) {
  const elapsed = (now - (Number(startedAt) || now)) / 1000;
  const settled = progress.total * progress.unitsPerPhoto - progress.remaining;
  if (progress.complete || elapsed < 5 || settled < 3) return null;
  const rate = settled / elapsed;
  if (!(rate > 0)) return null;
  return Math.ceil(progress.remaining / rate);
}

/** Progress percent clamped to what a bar can draw, never trusting a raw server number. */
export function cullingProgressPercent(session) {
  const value = Number(session?.progressPercent);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Which state the Photo Culling tab draws, from the overview alone. Before any run the scope's
 * photo counts decide (an empty folder, photos still uploading or processing, photos that could
 * not be processed, photos ready); after it the run's own status does. An older server that sends
 * no `photoCounts` falls back to `readyCount`.
 */
export function cullingWorkspaceState(overview) {
  const session = overview?.session || null;
  if (session) {
    if (cullingImporting(session)) return "importing";
    if (cullingWaitingForDesktop(session)) return "waiting";
    if (isCullingSessionActive(session)) return "running";
    if (session.status === "REVIEW_READY" || session.status === "FINALIZED") return overview.stale ? "stale" : session.status === "FINALIZED" ? "finalized" : "review";
    if (session.status === "FAILED") return "failed";
    return "cancelled";
  }
  const counts = overview?.photoCounts;
  const ready = Number(counts ? counts.ready : overview?.readyCount) || 0;
  if (ready > 0) return "ready";
  if (!counts || !counts.total) return "empty";
  if (counts.processing > 0) return "processing";
  if (counts.uploading > 0) return "uploading";
  return "unprocessable";
}

// The analysis the photographer sees, in run order. SIMILARITY folds into Similar photos.
const STAGE_STEPS = [
  { id: "TECHNICAL_ANALYSIS", label: "Technical", hint: "Sharpness and exposure" },
  { id: "FACE_ANALYSIS", label: "Faces", hint: "Eyes, expressions and face quality" },
  { id: "SUBJECTS", label: "People", hint: "Who is in each photo, weighed by their role" },
  { id: "SCENE", label: "Scene and framing", hint: "The moment, the look and the composition" },
  { id: "GROUPING", label: "Similar photos", hint: "Duplicates and bursts, ranked" },
  { id: "RANKING", label: "Ranking and story", hint: "Keep, Maybe or Reject, covering the whole story" },
];
const STAGE_ORDER = ["PREPARING", "TECHNICAL_ANALYSIS", "FACE_ANALYSIS", "SUBJECTS", "SCENE", "SIMILARITY", "GROUPING", "RANKING", "FINALIZING"];

/**
 * The stage list beside the progress bar: each step done, current, pending or skipped. A run in
 * progress reads the server's engines (`engines` from the overview: is a face provider or the scene
 * engine on); a finished run reads what it actually ran (`engineVersions`), so a stage that never
 * ran is never ticked. People needs faces, so it is skipped with them.
 */
export function cullingStageSteps(session, engines = null) {
  const settled = session && (session.status === "REVIEW_READY" || session.status === "FINALIZED");
  const versions = session?.engineVersions || {};
  const desktop = session?.analysisSource === "DESKTOP";
  const facesRan = settled ? Boolean(versions.serverFaces || versions.faces) : desktop || engines?.faces !== false;
  const sceneRan = settled ? Boolean(versions.scene) : engines?.scene !== false;
  const stageIndex = (stage) => STAGE_ORDER.indexOf(stage === "SIMILARITY" ? "GROUPING" : stage);
  const current = settled ? STAGE_ORDER.length : stageIndex(session?.currentStage || "PREPARING");
  return STAGE_STEPS.map((step) => {
    const skipped = (step.id === "FACE_ANALYSIS" || step.id === "SUBJECTS") ? !facesRan : step.id === "SCENE" ? !sceneRan : false;
    const at = stageIndex(step.id);
    const state = skipped ? "skipped" : at < current ? "done" : at === current ? "current" : "pending";
    return { ...step, state };
  });
}

/** The settled run's confidence spread as the summary draws it, or null when the server sent none. */
export function cullingConfidenceBands(confidence) {
  if (!confidence) return null;
  return {
    bands: [
      { id: "high", label: "High", count: Number(confidence.high) || 0 },
      { id: "medium", label: "Medium", count: Number(confidence.medium) || 0 },
      { id: "low", label: "Low", count: Number(confidence.low) || 0 },
    ],
    average: cullingConfidenceLabel(confidence.average),
  };
}

// Which stored reason codes speak for a photo and which against it; the rest are notes.
const POSITIVE_REASONS = new Set(["SHARP", "EYES_OPEN", "GOOD_EXPRESSION", "BEST_IN_BURST", "KEY_PEOPLE_PRESENT", "WELL_COMPOSED", "STRIKING_LOOK", "UNIQUE_FRAME", "COVERS_PERSON", "COVERS_SCENE", "TASTE_UP"]);
const CONCERN_REASONS = new Set(["SOFT_FOCUS", "SEVERE_BLUR", "OVEREXPOSED", "UNDEREXPOSED", "PRIMARY_SUBJECT_BLINK", "HALF_CLOSED_EYES", "LOOKING_AWAY", "LOW_FACE_QUALITY", "FACE_OCCLUDED", "DUPLICATE", "IMPORTANT_SUBJECT_BLINK", "ACCIDENTAL_FRAME", "FACE_CUT_OFF", "TASTE_DOWN"]);

/** A photo's "why", from its stored reason codes only: what speaks for it, against it, and notes. */
export function cullingReasonGroups(codes) {
  const groups = { positives: [], concerns: [], notes: [] };
  for (const code of Array.isArray(codes) ? codes : []) {
    const bucket = POSITIVE_REASONS.has(code) ? groups.positives : CONCERN_REASONS.has(code) ? groups.concerns : groups.notes;
    bucket.push(cullingReasonLabel(code));
  }
  return groups;
}

/** A reason code's tone for its badge: "positive", "concern" or "note". */
export const cullingReasonTone = (code) => (POSITIVE_REASONS.has(code) ? "positive" : CONCERN_REASONS.has(code) ? "concern" : "note");

const AI_STATUS = {
  empty: { label: "Waiting for photos", color: PROGRESS_COLORS.notStarted },
  uploading: { label: "Waiting for uploads", color: PROGRESS_COLORS.inProgress },
  processing: { label: "Waiting for processing", color: PROGRESS_COLORS.inProgress },
  unprocessable: { label: "Waiting for photos", color: PROGRESS_COLORS.notStarted },
  ready: { label: "Ready", color: PROGRESS_COLORS.notStarted },
  waiting: { label: "On the desktop", color: PROGRESS_COLORS.inProgress },
  importing: { label: "Importing", color: PROGRESS_COLORS.inProgress },
  running: { label: "Analyzing", color: PROGRESS_COLORS.inProgress },
  review: { label: "Complete", color: PROGRESS_COLORS.completed },
  finalized: { label: "Finalized", color: PROGRESS_COLORS.completed },
  stale: { label: "Out of date", color: PROGRESS_COLORS.partiallyCompleted },
  failed: { label: "Failed", color: PROGRESS_COLORS.partiallyCompleted },
  cancelled: { label: "Cancelled", color: PROGRESS_COLORS.notStarted },
};

/** The header's one chip: what the AI is doing, in plain words (and the stage while it runs). */
export function cullingAiStatus(state, session = null) {
  const status = AI_STATUS[state] || AI_STATUS.empty;
  return { ...status, detail: state === "running" && session?.currentStage ? cullingStageLabel(session.currentStage) : "" };
}

/** The finalize confirmation's numbers: how many photos stay for the next stage and how many are hidden. */
export function cullingFinalizeFigures(session) {
  const total = Number(session?.totalImages) || 0;
  const stay = Number(session?.keepCount) || 0;
  return { total, stay, hidden: Math.max(0, total - stay) };
}

/**
 * The score lines each deciding mode uses - the backend's `THRESHOLDS` (analysis/scoring.js),
 * copied so the explanation can name them; a test keeps the two identical.
 */
// The measured face sharpness at which severe blur no longer rejects - scoring.js's SHARP_FACE.
export const CULLING_SHARP_FACE = 55;
export const CULLING_SCORE_LINES = {
  BALANCED: { reject: 40, keep: 62 },
  STRICT: { reject: 50, keep: 70 },
};

/**
 * What the AI's call on one photo rested on, in one sentence, from the backend's fixed rules
 * (scoring.js, coverage.js) and the photo's stored fields - or null when those fields cannot
 * explain it. A photo the run rejected as a non-best duplicate whose group best has since been
 * changed says so, since the call was made before the change.
 */
export function cullingDecisionBasis(item, session) {
  if (!item?.aiDecision) return null;
  const codes = Array.isArray(item.reasonCodes) ? item.reasonCodes : [];
  const mode = session?.mode;
  const modeLabel = CULLING_MODES.find((option) => option.id === mode)?.label || "";
  const score = item.finalScore;
  // The workstation could not open the original (unmapped or offline root, a changed file, a format
  // it cannot decode): the desktop stamps the photo instead of analysing it, and the server does
  // not read its preview in that photo's place - the photographer decides, whatever the decision
  // the scoring then landed on.
  if (codes.some((code) => code === "LOCAL_SOURCE_UNAVAILABLE" || code === "LOCAL_SOURCE_CHANGED" || code === "LOCAL_SOURCE_UNREADABLE")) return "The original could not be opened on the workstation, so the AI leaves this one to you. Reconnect the storage drive or NAS (or remap its storage root) in the desktop app and run again to measure it.";
  if (codes.includes("ANALYSIS_FAILED") && item.aiDecision === "MAYBE") return "This photo could not be measured, so the AI leaves it to you.";
  if (item.aiDecision === "REJECT" && item.duplicateGroupId && !item.isGroupBest) return "Another frame of this duplicate is the one to keep.";
  if (mode === "TARGET_COUNT") {
    const target = session?.targetCount ? `the ${session.targetCount}` : "the photos";
    if (item.aiDecision === "KEEP") return `The run kept it as one of ${target} it was asked for.`;
    if (item.aiDecision === "REJECT" && !item.duplicateGroupId) return `It fell outside ${target} the run was asked to keep.`;
  }
  if (item.aiDecision === "REJECT" && mode === "STRICT" && item.burstGroupId && !item.isGroupBest) return "Strict keeps only the best frame of a burst.";
  if (item.aiDecision === "REJECT" && codes.includes("SEVERE_BLUR")) return "Severe blur.";
  if (codes.includes("SEVERE_BLUR") && typeof item.faceSharpnessScore === "number" && item.faceSharpnessScore >= CULLING_SHARP_FACE) return "The photo is blurred, but the faces are sharp, so blur alone does not reject it.";
  // A run the studio's trained model decided was scored on that model's own scale and lines.
  const ranker = session?.engineVersions?.ranker;
  if (ranker && typeof score === "number") {
    const version = String(ranker).split("@")[1];
    return `Scored ${score} by the culling model trained on this studio's own Keep and Reject decisions${version ? ` (version ${version})` : ""}.`;
  }
  const lines = CULLING_SCORE_LINES[mode];
  if (lines && typeof score === "number") {
    const band = score < lines.reject ? "REJECT" : score >= lines.keep ? "KEEP" : "MAYBE";
    if (band === item.aiDecision) {
      if (band === "REJECT") return `Score ${score} is below ${modeLabel}'s Reject line of ${lines.reject}.`;
      if (band === "KEEP") return `Score ${score} reaches ${modeLabel}'s Keep line of ${lines.keep}.`;
      return `Score ${score} is between ${modeLabel}'s Reject line (${lines.reject}) and Keep line (${lines.keep}).`;
    }
  }
  if (item.aiDecision === "REJECT" && (item.duplicateGroupId || item.burstGroupId) && item.isGroupBest) return "The run rejected it with its group when it ranked; the group's best frame has changed since.";
  return null;
}
