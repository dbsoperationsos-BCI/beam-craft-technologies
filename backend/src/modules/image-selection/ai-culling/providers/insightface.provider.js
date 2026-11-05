/**
 * The server's own face engine (InsightFace SCRFD + ArcFace, the one the People filter and the AI
 * Feature run) as a culling face-signal provider — face quality without AWS. The engine answers
 * boxes and a detection score, and - with face signals v2 - measured face sharpness, eye aspect
 * ratios and head pose (68-point landmarks) and FER+ expression probabilities. What it cannot
 * measure is absent, and the face stage scores that neutral (50) and awards no badge.
 * The provider speaks the same FaceDetails shape Rekognition does, so `analysis/faces.js` stays
 * one function. Configured exactly when the engine is switched on (`AI_FACE_ENGINE_ENABLED`); the
 * preview bytes are what it reads, never an original.
 */
const NAME = "insightface";
// @2: face signals v2 (landmark eyes and pose, FER+ expression, measured face sharpness).
const VERSION = "insightface-buffalo_l@2";

const boxLeft = (box) => (Array.isArray(box) ? Math.max(0, box[0]) : Number(box?.x ?? box?.left ?? 0));
const boxTop = (box) => (Array.isArray(box) ? Math.max(0, box[1]) : Number(box?.y ?? box?.top ?? 0));
const boxWidth = (box) => (Array.isArray(box) ? Math.max(0, box[2] - box[0]) : Number(box?.w ?? box?.width ?? 0));
const boxHeight = (box) => (Array.isArray(box) ? Math.max(0, box[3] - box[1]) : Number(box?.h ?? box?.height ?? 0));

/**
 * The face engine's answer (`face_engine.py describe`) as the FaceDetails shape `analysis/faces.js`
 * reads - the ONE mapping, used for the server's own runs and for faces a desktop analyzed on its
 * own runtime with the same engine, so a measurement means the same thing wherever it was made.
 * A v2 engine (`signals: "face-v2@1"`) adds measured sharpness and brightness inside the face,
 * the eye aspect ratios and head pose from the 68-point landmarks, and FER+ expression
 * probabilities; an older engine answers boxes and its usability score only, which is never
 * passed off as sharpness (`SharpnessMeasured: false`).
 */
function engineFacesToFaceDetails(described) {
  const width = Number(described?.width) || 0;
  const height = Number(described?.height) || 0;
  return (described?.faces || []).map((face) => {
    const measured = typeof face.sharpness === "number";
    return {
      // Position as well as size: without Left/Top every face read as sitting in the frame's
      // corner - cut off by the edge, and matched to nobody in the People index.
      BoundingBox: { Left: width ? boxLeft(face.box) / width : 0, Top: height ? boxTop(face.box) / height : 0, Width: width ? boxWidth(face.box) / width : 0, Height: height ? boxHeight(face.box) / height : 0 },
      Confidence: Math.round((Number(face.detScore) || 0) * 100),
      Quality: { Sharpness: measured ? face.sharpness : Math.round((Number(face.quality) || 0) * 100), Brightness: typeof face.brightness === "number" ? face.brightness : 60 },
      SharpnessMeasured: measured,
      ...(face.eyes && (typeof face.eyes.left === "number" || typeof face.eyes.right === "number") ? { EyeAspect: { left: face.eyes.left ?? null, right: face.eyes.right ?? null } } : {}),
      ...(face.pose ? { Pose: { Pitch: Number(face.pose.pitch) || 0, Yaw: Number(face.pose.yaw) || 0, Roll: Number(face.pose.roll) || 0 } } : {}),
      ...(face.expression && typeof face.expression === "object" ? { Expression: face.expression } : {}),
    };
  });
}

function createInsightfaceProvider({ engine } = {}) {
  // Lazy: requiring the engine module reads the Python configuration; a server without the engine
  // never pays that just because the provider registry was loaded.
  const getEngine = () => engine || require("../../../ai-feature/face-engine/engine");
  const isConfigured = () => String(process.env.AI_FACE_ENGINE_ENABLED || "").trim().toLowerCase() === "true";
  return {
    name: NAME,
    version: VERSION,
    isConfigured,
    missingConfig: () => (isConfigured() ? [] : ["AI_FACE_ENGINE_ENABLED"]),
    async detectFaces(bytes) {
      return engineFacesToFaceDetails(await getEngine().describe(bytes));
    },
  };
}

module.exports = { createInsightfaceProvider, engineFacesToFaceDetails, NAME, VERSION };
