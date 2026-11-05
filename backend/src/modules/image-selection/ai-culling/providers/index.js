const { createRekognitionProvider, NAME: REKOGNITION } = require("./rekognition.provider");
const { createInsightfaceProvider, NAME: INSIGHTFACE } = require("./insightface.provider");

/**
 * Which face provider a run should use, or null for "run without face analysis". Null is a
 * normal answer, not an error: the technical stages are complete on their own, and a session
 * that runs while AWS is unconfigured simply finishes with face scores unset. Read at call time
 * so tests and operators can switch without a restart.
 *
 * AI_CULLING_PROVIDER names the provider: "insightface" is the server's own face engine (no
 * AWS: eyes, head pose, expression and face sharpness from local models), "aws-rekognition" the
 * AWS service, "none" turns face analysis off. Unset ("auto"), the local engine is used when it is
 * switched on (AI_FACE_ENGINE_ENABLED) - the same engine the desktop app runs, so both platforms
 * read faces alike - then Rekognition when AWS is configured, then none.
 */
const providers = { [REKOGNITION]: createRekognitionProvider, [INSIGHTFACE]: createInsightfaceProvider };

function activeFaceProvider() {
  const name = (process.env.AI_CULLING_PROVIDER || "auto").trim().toLowerCase();
  if (name === "none") return null;
  if (name === "auto") {
    for (const factory of [createInsightfaceProvider, createRekognitionProvider]) {
      const provider = factory();
      if (provider.isConfigured()) return provider;
    }
    return null;
  }
  const factory = providers[name];
  if (!factory) return null;
  const provider = factory();
  return provider.isConfigured() ? provider : null;
}

module.exports = { activeFaceProvider };
