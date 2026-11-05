/**
 * The one place faces/ reaches outside Image Selection: the AI Feature's face engine (a Python
 * sidecar running InsightFace) and its vector helpers. One engine process per server serves both
 * modules - a second copy of the models would be another gigabyte of RAM for the same answers.
 *
 * Loaded inside try/catch so that a server without the AI Feature module reports the engine as
 * unavailable rather than failing to boot; every caller already treats "unavailable" as "wait".
 */
let engine = null;
let vectors = null;
let loadError = null;
try {
  engine = require("../../ai-feature/face-engine/engine");
  vectors = require("../../ai-feature/shared/vectors");
} catch (error) {
  loadError = error.message;
}

const UNAVAILABLE = "FACE_ENGINE_UNAVAILABLE";

async function isReady() { return engine ? engine.isReady() : false; }
function unavailableReason() { return engine ? engine.unavailableReason() : `The face engine module is not installed (${loadError}).`; }
function unavailableError() { return Object.assign(new Error(`Face engine unavailable: ${unavailableReason()}`), { code: UNAVAILABLE }); }
// Faces only: People groups by box, embedding and quality, and never reads the culling signals.
async function describe(buffer) { if (!engine) throw unavailableError(); return engine.describe(buffer, { signals: false }); }
function checkFaceEngineReady() { if (engine) engine.checkFaceEngineReady(); }
function getVectors() { if (!vectors) throw unavailableError(); return vectors; }

module.exports = { UNAVAILABLE, isReady, unavailableReason, unavailableError, describe, checkFaceEngineReady, getVectors };
