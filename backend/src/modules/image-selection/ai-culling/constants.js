// The vocabulary of one AI culling run. Statuses and stages are VarChar strings in the database,
// matching every other Image Selection status; these constants exist so the service, worker,
// tests and frontend all spell them one way.

const SESSION_STATUSES = Object.freeze({
  QUEUED: "QUEUED",
  ANALYZING: "ANALYZING",
  GROUPING: "GROUPING",
  RANKING: "RANKING",
  REVIEW_READY: "REVIEW_READY",
  FINALIZED: "FINALIZED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
});

// Statuses a session can still move out of on its own — what "there is already a run happening"
// means, and what recoverPending() re-enqueues after a restart.
const ACTIVE_STATUSES = Object.freeze([
  SESSION_STATUSES.QUEUED,
  SESSION_STATUSES.ANALYZING,
  SESSION_STATUSES.GROUPING,
  SESSION_STATUSES.RANKING,
]);

const STAGES = Object.freeze({
  PREPARING: "PREPARING",
  TECHNICAL_ANALYSIS: "TECHNICAL_ANALYSIS",
  FACE_ANALYSIS: "FACE_ANALYSIS",
  SUBJECTS: "SUBJECTS",
  // Phase 6: scene, aesthetic and composition (scene/scene_engine.py over previews).
  SCENE: "SCENE",
  SIMILARITY: "SIMILARITY",
  GROUPING: "GROUPING",
  RANKING: "RANKING",
  FINALIZING: "FINALIZING",
});

// ASSISTED scores without deciding; BALANCED and STRICT assign KEEP/MAYBE/REJECT; TARGET_COUNT
// aims near a photographer-chosen count. Only the session field exists in Phase 1 — the engine
// behaviours arrive with the analysis phases, and the API refuses modes it cannot honour yet.
const MODES = Object.freeze({
  ASSISTED: "ASSISTED",
  BALANCED: "BALANCED",
  STRICT: "STRICT",
  TARGET_COUNT: "TARGET_COUNT",
});
const SUPPORTED_MODES = Object.freeze([MODES.ASSISTED, MODES.BALANCED, MODES.STRICT, MODES.TARGET_COUNT]);

const DECISIONS = Object.freeze({
  KEEP: "KEEP",
  MAYBE: "MAYBE",
  REJECT: "REJECT",
  PENDING: "PENDING",
});

const GROUP_TYPES = Object.freeze({ DUPLICATE: "DUPLICATE", BURST: "BURST", SIMILAR: "SIMILAR" });

// Where a session's technical signals come from. SERVER: the worker reads previews. DESKTOP: the
// workstation analyzes the originals where they live and posts numbers; the server fills any gap
// from previews, then groups and ranks the same way.
const ANALYSIS_SOURCES = Object.freeze({ SERVER: "SERVER", DESKTOP: "DESKTOP" });

// Machine-readable explanations stored on result rows and rendered as badges. Grows a few codes
// per phase; never free text, so the UI and any later preference model can rely on the spelling.
const REASON_CODES = Object.freeze({
  SHARP: "SHARP",
  SOFT_FOCUS: "SOFT_FOCUS",
  SEVERE_BLUR: "SEVERE_BLUR",
  OVEREXPOSED: "OVEREXPOSED",
  UNDEREXPOSED: "UNDEREXPOSED",
  ANALYSIS_FAILED: "ANALYSIS_FAILED",
  EYES_OPEN: "EYES_OPEN",
  PRIMARY_SUBJECT_BLINK: "PRIMARY_SUBJECT_BLINK",
  // Face V2: the main face's eyes half closed or looking down (not a blink), and a face turned away.
  HALF_CLOSED_EYES: "HALF_CLOSED_EYES",
  LOOKING_AWAY: "LOOKING_AWAY",
  GOOD_EXPRESSION: "GOOD_EXPRESSION",
  LOW_FACE_QUALITY: "LOW_FACE_QUALITY",
  FACE_OCCLUDED: "FACE_OCCLUDED",
  FACE_ANALYSIS_FAILED: "FACE_ANALYSIS_FAILED",
  DUPLICATE: "DUPLICATE",
  BEST_IN_BURST: "BEST_IN_BURST",
  // Culling V2: a frame of a visually similar series (the same set-up or pose) that another
  // frame of the series ranks above - relative, never a penalty.
  ALTERNATE_FRAME: "ALTERNATE_FRAME",
  LOW_CONFIDENCE: "LOW_CONFIDENCE",
  // A photo kept for story coverage rather than raw score: its time segment or shoot had
  // nothing better, and dropping it would leave a hole in the story.
  UNIQUE_FRAME: "UNIQUE_FRAME",
  // The subject stage: the most important person in the frame blinked (weighted by role and
  // presence — a background guest's blink earns nothing), and a key person is in the frame.
  IMPORTANT_SUBJECT_BLINK: "IMPORTANT_SUBJECT_BLINK",
  KEY_PEOPLE_PRESENT: "KEY_PEOPLE_PRESENT",
  // Phase 6: an accidental-looking frame that is also technically poor; a face the frame edge cuts.
  ACCIDENTAL_FRAME: "ACCIDENTAL_FRAME",
  FACE_CUT_OFF: "FACE_CUT_OFF",
  // The positive side, so a nudge up is explained too: framing and taste in the top band.
  WELL_COMPOSED: "WELL_COMPOSED",
  STRIKING_LOOK: "STRIKING_LOOK",
  // Phase 7: kept by Target Count's story coverage — a key person's best frame, a scene's best frame.
  COVERS_PERSON: "COVERS_PERSON",
  COVERS_SCENE: "COVERS_SCENE",
  // Phase 8: the photographer's own learned taste moved this photo (analysis/preferences.js).
  TASTE_UP: "TASTE_UP",
  TASTE_DOWN: "TASTE_DOWN",
  // Strict local source: the desktop could not open the original it was asked to analyze -
  // unmapped or offline root, or a missing file; a file whose size or checksum differs from the
  // one recorded; a file that matches but the local decoder cannot read. Technical-stage codes:
  // such a photo is stamped ANALYSIS_FAILED beside the code and no server stage reads its preview
  // in its place - the photographer decides, and the badge says why.
  LOCAL_SOURCE_UNAVAILABLE: "LOCAL_SOURCE_UNAVAILABLE",
  LOCAL_SOURCE_CHANGED: "LOCAL_SOURCE_CHANGED",
  LOCAL_SOURCE_UNREADABLE: "LOCAL_SOURCE_UNREADABLE",
});

// The three states a workstation reports about an original it could not use, shared with the web
// and the desktop by spelling (the same strings on all three sides), and the studio's words for
// each - what the web shows under a failed edit and what a culling badge explains.
const LOCAL_SOURCE_CODES = Object.freeze([REASON_CODES.LOCAL_SOURCE_UNAVAILABLE, REASON_CODES.LOCAL_SOURCE_CHANGED, REASON_CODES.LOCAL_SOURCE_UNREADABLE]);
const LOCAL_SOURCE_MESSAGES = Object.freeze({
  [REASON_CODES.LOCAL_SOURCE_UNAVAILABLE]: "Original file is unavailable on this workstation. Reconnect the storage/NAS or remap the storage root, then try again.",
  [REASON_CODES.LOCAL_SOURCE_CHANGED]: "The original on this workstation is not the file that was added (its size or checksum differs). Check the file, then try again.",
  [REASON_CODES.LOCAL_SOURCE_UNREADABLE]: "The original could not be decoded on this workstation, so it was not analysed.",
});

// Who a person is to the shoot, in the photographer's words — generic on purpose so a wedding, a
// birthday and a corporate event all fit: main subject(s), family, other important people, and
// faces that belong to the background. Null means "let the photographs decide" (frequency).
const SUBJECT_ROLES = Object.freeze({ PRIMARY: "PRIMARY", FAMILY: "FAMILY", IMPORTANT: "IMPORTANT", BACKGROUND: "BACKGROUND" });

// Stamped on every session so results from an older engine are distinguishable from current ones.
// 1.1.0: technical analysis — whole-frame blur, exposure, perceptual hash.
// 1.2.0: face analysis via provider (Rekognition) — eyes, expression, face quality.
// 1.3.0: duplicate/burst grouping — time windows + perceptual similarity, best-in-group.
// 1.4.0: DBS ranking — explainable finalScore, KEEP/MAYBE/REJECT with confidence.
// 1.5.0: story coverage — TARGET_COUNT with per-shoot quotas and time-segment guarantees.
// 1.6.0: subjects — who is in the frame (the People filter's clusters), roles, importance-weighted
//        eyes, a subject score the ranking reads.
// 1.7.0: similarity v2 - the structure signature beside the hash, people-aware duplicate/burst
//        links, and a rank per group member.
// 1.8.0: scene, aesthetic and composition (Phase 6).
// Confidence bands. A call below LOW is badged LOW_CONFIDENCE (scoring, coverage) and counted as
// low by the workspace; HIGH is where the workspace's "high" band starts.
const CONFIDENCE_LINES = Object.freeze({ LOW: 0.55, HIGH: 0.8 });

const ENGINE_VERSION = "1.8.0";
const SCORING_PROFILE_VERSION = "dbs-1";

module.exports = {
  SESSION_STATUSES,
  ACTIVE_STATUSES,
  STAGES,
  MODES,
  SUPPORTED_MODES,
  DECISIONS,
  GROUP_TYPES,
  ANALYSIS_SOURCES,
  SUBJECT_ROLES,
  REASON_CODES,
  LOCAL_SOURCE_CODES,
  LOCAL_SOURCE_MESSAGES,
  ENGINE_VERSION,
  SCORING_PROFILE_VERSION,
  CONFIDENCE_LINES,
};
