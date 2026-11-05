/**
 * The Virtual Curation desktop app's switches, read on every call so a test can flip them.
 *
 * Both default OFF. With a switch off, the route it guards answers the same 404 an unknown path
 * gets, so a server that has not opted in is exactly the web application it was: no new endpoint
 * is reachable, and nothing an existing client calls is changed.
 *
 * - `DESKTOP_VIRTUAL_CURATION_ENABLED=true` opens `GET /api/desktop/capabilities`, the one call
 *   the desktop makes first to learn which extras this server offers.
 * - `DESKTOP_AI_ENABLED=true` (with the first) opens the two face hand-off routes, which accept
 *   face descriptors the desktop computed locally with the same engine the server runs, and makes
 *   the uploads' deferral fields (`deferFaceScan`, `deferAi`) mean something.
 */
const { createRateLimiter } = require("../../middleware/rateLimit");

const flag = (name) => String(process.env[name] || "").trim().toLowerCase() === "true";

const virtualCurationEnabled = () => flag("DESKTOP_VIRTUAL_CURATION_ENABLED");
const desktopAiEnabled = () => virtualCurationEnabled() && flag("DESKTOP_AI_ENABLED");
/** Whether a desktop may run the engine locally at all: its switch, and the server's own engine switch, so the two never disagree on the model. */
const localAiOffered = () => flag("DESKTOP_AI_ENABLED") && flag("AI_FACE_ENGINE_ENABLED");

/** The model name every descriptor must come from - the one the server's own engine is configured with (`face-engine/engine.js`). */
const expectedFaceModel = () => process.env.AI_FACE_MODEL_NAME || "buffalo_l";
/** ArcFace `w600k_r50` answers 512 floats; nothing else is stored beside the server's own vectors. */
const EMBEDDING_DIMENSION = 512;

/**
 * Whether an upload's "I will describe this photo myself" field is honoured: only with both desktop
 * switches on, and only when the field says exactly "true". With the switches off the field is
 * ignored and the upload is queued for the server's worker as it always was, so a desktop talking
 * to a server that has not opted in changes nothing about it.
 */
const deferralRequested = (value) => desktopAiEnabled() && String(value ?? "").trim().toLowerCase() === "true";

/**
 * Express middleware: the route exists only while `isOn()` says so. Off, it answers the JSON 404
 * every unmatched path gets (`server.js`), so a probe cannot tell a disabled route from a missing one.
 */
const gate = (isOn) => (req, res, next) => (isOn() ? next() : res.status(404).json({ message: "Not found" }));

/**
 * The face hand-off is the one desktop call that costs CPU per request (up to a hundred faces, each
 * thumbnail re-encoded), so it is bounded per signed-in person: 600 a minute is ten photographs a
 * second, several times what one workstation's engine can describe, and far below what a leaked
 * credential could otherwise make the API process chew through.
 */
const ingestLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 600,
  keys: (req) => [`desktop-ingest:${req.user?.id || "anonymous"}`],
  message: (minutes) => `Too many face hand-offs. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
});

/**
 * The AI Editing drain and the local-source report are the desktop's other per-photo calls: a
 * drain page is a query per 200 edits and a report is one row written, so the same ceiling as the
 * face hand-off - far above one workstation's pace, far below what a leaked credential could make
 * the API chew through. Its own limiter, so a busy editing drain never starves the face hand-off.
 */
const editingLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 600,
  keys: (req) => [`desktop-editing:${req.user?.id || "anonymous"}`],
  message: (minutes) => `Too many requests. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
});

/**
 * A model download is a resumable transfer of a 174 MB file, so one install issues several Range
 * requests and a retry a few more; 120 in fifteen minutes is dozens of installs per person, and
 * well below what a leaked credential could otherwise pull off the disk.
 */
const runtimeModelLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 120,
  keys: (req) => [`desktop-model:${req.user?.id || "anonymous"}`],
  message: (minutes) => `Too many model downloads. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
});

module.exports = { virtualCurationEnabled, desktopAiEnabled, localAiOffered, expectedFaceModel, deferralRequested, EMBEDDING_DIMENSION, gate, ingestLimiter, editingLimiter, runtimeModelLimiter };
