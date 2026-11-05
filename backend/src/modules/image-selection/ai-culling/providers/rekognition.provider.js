const { RekognitionClient, DetectFacesCommand } = require("@aws-sdk/client-rekognition");

/**
 * Amazon Rekognition as a face-signal provider. Deliberately narrow: the one thing AWS is asked
 * for is DetectFaces over the PREVIEW bytes (≤200KB JPEG, far inside the 5MB inline limit) — the
 * original never leaves the studio, nothing is copied into S3, and Rekognition storage APIs are
 * never used. Ranking stays the engine's job; this provider only reports what it saw.
 *
 * Credentials live in backend env vars and are read at call time, never logged, never sent to
 * the frontend. `version` is stamped on every result row it produced, so a model/provider change
 * invalidates the cross-session cache by itself.
 */

const NAME = "aws-rekognition";
const VERSION = "aws-rekognition@1";

function createRekognitionProvider({ client } = {}) {
  let instance = client || null;
  const isConfigured = () => Boolean(process.env.AWS_REGION && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
  function getClient() {
    if (!instance) instance = new RekognitionClient({ region: process.env.AWS_REGION });
    return instance;
  }
  return {
    name: NAME,
    version: VERSION,
    isConfigured,
    missingConfig: () => ["AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"].filter((key) => !process.env[key]),
    /** Raw FaceDetails for one preview. Attributes: ALL is what carries eyes/smile/quality/occlusion. */
    async detectFaces(bytes) {
      const response = await getClient().send(new DetectFacesCommand({ Image: { Bytes: bytes }, Attributes: ["ALL"] }));
      return response.FaceDetails || [];
    },
  };
}

module.exports = { createRekognitionProvider, NAME, VERSION };
