const { z } = require("zod");
const { MODES, DECISIONS, LOCAL_SOURCE_CODES } = require("./constants");

const projectParamsSchema = z.object({ projectId: z.string().trim().min(1).max(191) });
const sessionParamsSchema = projectParamsSchema.extend({ sessionId: z.string().trim().min(1).max(191) });

// The mode is validated as a known name here; whether the pairing makes sense (TARGET_COUNT
// needs a target below the photo count) is the service's startPlan.
const startSchema = z.object({
  mode: z.enum([MODES.ASSISTED, MODES.BALANCED, MODES.STRICT, MODES.TARGET_COUNT]).default(MODES.ASSISTED),
  targetCount: z.coerce.number().int().min(1).max(1_000_000).nullish().transform((value) => value || null),
  // The shoot folder this run covers; omitted means the whole project.
  folderId: z.string().trim().min(1).max(191).nullish().transform((value) => value || null),
  // The desktop app's ask: analyze the originals on this workstation and post the numbers; the
  // server then waits for `run` instead of reading previews. Honoured only behind DESKTOP_AI_ENABLED.
  localAnalysis: z.boolean().default(false),
  // A run that begins with the import: created while the photos are still arriving, with how many
  // the import announced (`expectedCount`), so the mode and the target are chosen once and the
  // run waits for the last photo instead of the photographer waiting for the run.
  awaitUploads: z.boolean().default(false),
  expectedCount: z.coerce.number().int().min(1).max(1_000_000).nullish().transform((value) => value || null),
});
// The mode may change while a run is still waiting for its photos; nothing else about a run may.
const updateSessionSchema = z.object({
  mode: z.enum([MODES.ASSISTED, MODES.BALANCED, MODES.STRICT, MODES.TARGET_COUNT]),
  targetCount: z.coerce.number().int().min(1).max(1_000_000).nullish().transform((value) => value || null),
}).strict();
// The hand-over may be forced past photos still arriving ("let the server finish now"): they are
// then photos added after the run, as any late photo is.
const runSchema = z.object({ force: z.boolean().optional().default(false) });
// A finalized run's Keeps straight to Photo Selection: the first `limit` of them, or all; `force`
// re-sends an edited photo already sent once, as AI Editing's own send does.
const sendToPhotosSchema = z.object({ limit: z.coerce.number().int().min(1).max(20000).optional(), force: z.boolean().optional().default(false) }).strict();

// What a workstation may post about one photo: the same numbers the server's stages compute
// from a preview, in the same ranges, with the same reason-code vocabulary — nothing free-form.
const score = z.number().min(0).max(100);
const TECHNICAL_CODES = ["SHARP", "SOFT_FOCUS", "SEVERE_BLUR", "OVEREXPOSED", "UNDEREXPOSED", "ANALYSIS_FAILED"];
const FACE_CODES = ["EYES_OPEN", "PRIMARY_SUBJECT_BLINK", "GOOD_EXPRESSION", "LOW_FACE_QUALITY", "FACE_OCCLUDED", "FACE_ANALYSIS_FAILED"];
const technicalSignalSchema = z.object({
  blurScore: score,
  exposureScore: score,
  technicalScore: score,
  perceptualHash: z.string().regex(/^[0-9a-f]{16}$/).nullable(),
  // Similarity v2 (analysis/structure.js): 64 hex characters, or null for a flat frame. Optional so
  // an older desktop engine keeps posting.
  structureSignature: z.string().regex(/^[0-9a-f]{64}$/).nullable().optional(),
  reasonCodes: z.array(z.enum(TECHNICAL_CODES)).max(6).default([]),
});
const fraction = z.number().min(0).max(1);
// Face signals v2: one face as the shared engine measured it on the workstation (face_engine.py
// describe), without its embedding - the server derives every culling signal from these numbers
// with the same code it uses for its own runs (providers/insightface.provider.js, analysis/faces.js).
const EXPRESSION_LABELS = ["neutral", "happiness", "surprise", "sadness", "anger", "disgust", "fear", "contempt"];
const probability = z.number().min(0).max(1);
const EYE_RATIO_LIMIT = 20;
const eyeRatio = z.number().min(0).nullable().optional().transform((value) => (typeof value === "number" && value > EYE_RATIO_LIMIT ? null : value));
const engineFaceSchema = z.object({
  box: z.array(z.number().min(0).max(100000)).length(4),
  detScore: probability,
  quality: probability.optional(),
  sharpness: z.number().min(0).max(100).nullable().optional(),
  brightness: z.number().min(0).max(100).nullable().optional(),
  // An eye aspect ratio is ~0.1-0.4 on a frontal face; a face turned away can measure anything (a
  // real profile face read 23.4). The server's own face stage ignores a ratio past 0.6, so one past
  // EYE_RATIO_LIMIT is taken as no reading rather than refusing the workstation's whole batch -
  // which is what kept a desktop run from meaning what the server's run means. Still a finite number.
  eyes: z.object({ left: eyeRatio, right: eyeRatio }).optional(),
  pose: z.object({ pitch: z.number().min(-180).max(180), yaw: z.number().min(-180).max(180), roll: z.number().min(-180).max(180) }).optional(),
  expression: z.object(Object.fromEntries(EXPRESSION_LABELS.map((label) => [label, probability.optional()]))).optional(),
});
const engineAnswerSchema = z.object({
  width: z.number().int().min(1).max(100000),
  height: z.number().int().min(1).max(100000),
  signals: z.string().trim().max(30).optional(),
  capabilities: z.array(z.string().trim().max(20)).max(8).optional(),
  faces: z.array(engineFaceSchema).max(50),
});
const faceSignalSchema = z.object({
  faceCount: z.number().int().min(0).max(500),
  faceQualityScore: score.nullable(),
  eyesOpenScore: score.nullable(),
  expressionScore: score.nullable(),
  reasonCodes: z.array(z.enum(FACE_CODES)).max(6).default([]),
  // Phase 6: each confident face's box (frame fractions) and detection confidence, so composition
  // and the subject stage see a desktop-analyzed photo's faces. Eyes are not claimed: the local
  // engine has no eye model. Optional, so an older desktop engine keeps posting.
  details: z.array(z.object({
    box: z.object({ x: fraction, y: fraction, w: fraction, h: fraction }).refine((box) => box.x + box.w <= 1.0001 && box.y + box.h <= 1.0001, { message: "a face box must lie inside the frame" }),
    confidence: score,
  })).max(50).optional(),
  // Face signals v2: the engine's own readings. When present the server derives the face signals
  // from them; the numbers above stay for a server that predates v2.
  engine: engineAnswerSchema.optional(),
});
const signalsSchema = z.object({
  // `name@version` is stored as the row's face provider (30 characters), so the pair is bounded
  // together, not only apart.
  engine: z.object({
    name: z.string().trim().min(1).max(40),
    version: z.string().trim().min(1).max(30),
    preprocessVersion: z.string().trim().min(1).max(40).optional(),
  }).refine((engine) => `${engine.name}@${engine.version}`.length <= 30, { message: "engine name@version must be at most 30 characters." }),
  items: z.array(z.object({
    uploadId: z.string().trim().min(1).max(191),
    technical: technicalSignalSchema.optional(),
    faces: faceSignalSchema.optional(),
    // The workstation could not use this photo's original (constants.LOCAL_SOURCE_CODES): no
    // numbers, only the reason. The server stamps both stages so no stage reads the preview in
    // the original's place; the photographer decides this one.
    localSource: z.enum(LOCAL_SOURCE_CODES).optional(),
  }).refine((item) => item.technical || item.faces || item.localSource, { message: "An item must carry technical or face signals, or a local-source state." })).min(1).max(200),
});
// A person's role to the shoot, in the studio's generic words; null hands the decision back to
// the photographs (frequency).
const personParamsSchema = projectParamsSchema.extend({ personId: z.string().trim().min(1).max(191) });
const personRoleSchema = z.object({ role: z.enum(["PRIMARY", "FAMILY", "IMPORTANT", "BACKGROUND"]).nullable() });
const pendingQuerySchema = z.object({
  cursor: z.string().trim().min(1).max(191).nullish().transform((value) => value || null),
  take: z.coerce.number().int().min(1).max(500).default(200),
});

const overviewQuerySchema = z.object({
  folderId: z.string().trim().min(1).max(191).nullish().transform((value) => value || null),
});

const resultsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(60),
  filter: z.enum(["all", "keep", "maybe", "reject", "pending", "low_confidence", "duplicates", "best_of_burst", "blur", "closed_eyes", "unanalyzed", "accidental", "cut_faces"]).default("all"),
  // Phase 6: one scene of the profile (scene/profiles/*.json ids), combined with the filter.
  scene: z.string().regex(/^[A-Z][A-Z0-9_]{1,29}$/).optional(),
  sort: z.enum(["score", "captured", "name", "confidence"]).default("captured"),
  order: z.enum(["asc", "desc"]).default("asc"),
});

const resultParamsSchema = sessionParamsSchema.extend({ resultId: z.string().trim().min(1).max(191) });
const groupParamsSchema = sessionParamsSchema.extend({ groupId: z.string().trim().min(1).max(191) });
// `decision: null` clears the photographer's override, handing the photo back to the AI's answer.
// `source` says how the decision was made (a key, a click, the preview panel...): training-label
// quality only, never a different decision. Optional, so an older app keeps working.
const { SOURCES: DECISION_SOURCES, VIEW_SOURCES, PLATFORMS } = require("./learning/labels");
// Which app sent a review action (the desktop says so; anything that says nothing is the web).
const platformField = z.enum(PLATFORMS).default("WEB");
const decisionSchema = z.object({ decision: z.enum([DECISIONS.KEEP, DECISIONS.MAYBE, DECISIONS.REJECT]).nullable(), source: z.enum(DECISION_SOURCES).default("UNKNOWN"), platform: platformField });
// Photos the photographer had on screen (the grid) or opened (the preview), batched by the app:
// weak evidence that an untouched AI call was seen and accepted. Repeats collapse.
const viewsSchema = z.object({ resultIds: z.array(z.string().trim().min(1).max(191)).min(1).max(200).transform((ids) => [...new Set(ids)]), source: z.enum(VIEW_SOURCES), platform: platformField }).strict();
// Repeats collapse before the membership check, so a photo ticked twice is one decision, not a refusal.
const bulkDecisionSchema = decisionSchema.extend({ resultIds: z.array(z.string().trim().min(1).max(191)).min(1).max(500).transform((ids) => [...new Set(ids)]) });
const groupBestSchema = z.object({ resultId: z.string().trim().min(1).max(191), platform: platformField });
// The retry flag after a 409 whose details said requiresAcknowledgement — the same escalation
// shape project/folder deletion uses.
const acknowledgeSchema = z.object({ acknowledge: z.boolean().default(false) });

const groupsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  type: z.enum(["DUPLICATE", "BURST", "SIMILAR"]).nullish().transform((value) => value || null),
});

// Phase 8: the photographer's own switch; strict, so nobody names another photographer.
const preferenceToggleSchema = z.object({ enabled: z.boolean() }).strict();

// Send the photos held for culling in a scope (a folder's subtree, or the whole project) to Photo Selection.
module.exports = { preferenceToggleSchema, projectParamsSchema, sessionParamsSchema, resultParamsSchema, groupParamsSchema, startSchema, overviewQuerySchema, resultsQuerySchema, groupsQuerySchema, decisionSchema, viewsSchema, bulkDecisionSchema, groupBestSchema, acknowledgeSchema, signalsSchema, pendingQuerySchema, personParamsSchema, personRoleSchema, updateSessionSchema, runSchema, sendToPhotosSchema };
