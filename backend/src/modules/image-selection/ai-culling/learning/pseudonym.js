const crypto = require("crypto");

/**
 * Pseudonymous ids for training data: an HMAC of the kind and the real id under a secret key that
 * lives only in the server environment (AI_CULLING_TRAINING_HMAC_KEY). A dataset cannot be joined
 * back to a project, studio or photographer without the key; the server can recompute a
 * photographer's pseudonym at scoring time to find their personalization.
 */
const MIN_KEY_LENGTH = 32;
// A key of 32 characters drawn from a handful of letters is guessable; `openssl rand -hex 32`
// gives 64 characters over 16.
const MIN_DISTINCT = 12;

function trainingKey(env = process.env) {
  const key = env.AI_CULLING_TRAINING_HMAC_KEY || "";
  if (key.length < MIN_KEY_LENGTH) throw new Error(`AI_CULLING_TRAINING_HMAC_KEY must be set to a secret of at least ${MIN_KEY_LENGTH} characters.`);
  if (new Set(key).size < MIN_DISTINCT) throw new Error("AI_CULLING_TRAINING_HMAC_KEY looks guessable; set it to a random secret (openssl rand -hex 32).");
  return key;
}

/** `kind:` + a 20-hex HMAC-SHA256 of `kind:id`; null for a missing id. */
function pseudonym(kind, id, key) {
  if (id === null || id === undefined || id === "") return null;
  return `${kind}:${crypto.createHmac("sha256", key).update(`${kind}:${id}`).digest("hex").slice(0, 20)}`;
}

/** The split bucket of a pseudonymous project: train 70%, validation 15%, test 15%, stable. */
function splitOf(projectPseudonym) {
  const bucket = parseInt(crypto.createHash("sha256").update(projectPseudonym).digest("hex").slice(0, 8), 16) % 100;
  return bucket < 70 ? "train" : bucket < 85 ? "validation" : "test";
}

module.exports = { pseudonym, trainingKey, splitOf, MIN_KEY_LENGTH };
