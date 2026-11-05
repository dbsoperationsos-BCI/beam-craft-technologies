const { config, AiError } = require("../ollamaClient");

/**
 * Turning text into vectors, on this machine.
 *
 * A separate model from the one that answers: a chat model does not produce embeddings, and asking
 * this Ollama build for one returns "This server does not support embeddings". `nomic-embed-text` is
 * small - a few hundred megabytes against the chat model's gigabytes - so it costs little to keep
 * alongside.
 *
 * Nothing leaves the machine. That is most of the point of doing retrieval this way: a studio's
 * procedures, its pricing and its HR policies are exactly the documents that should not be posted to
 * an embedding API.
 */

const DEFAULT_MODEL = "nomic-embed-text";

function embeddingModel() {
  return String(process.env.AI_EMBEDDING_MODEL || DEFAULT_MODEL).trim();
}

/**
 * Embeddings for a batch of passages.
 *
 * Batched because embedding is cheap per call and the overhead is the round trip - a document of
 * forty passages should not be forty requests.
 */
async function embed(texts) {
  const inputs = (Array.isArray(texts) ? texts : [texts])
    .map((text) => String(text || "").trim())
    .filter(Boolean);
  if (!inputs.length) return [];

  const { baseUrl, timeoutMs } = config();
  const model = embeddingModel();

  let response;
  try {
    response = await fetch(`${baseUrl}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, input: inputs }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error.name === "TimeoutError") {
      throw new AiError("AI_TIMEOUT", "The embedding model did not answer in time.", { status: 504 });
    }
    throw new AiError("AI_UNAVAILABLE", "The embedding service is not running.", { retryable: true, status: 503 });
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    // A model that is not pulled is a person's job, not a retry's.
    if (response.status === 404 || detail.includes("not found")) {
      throw new AiError("AI_MODEL_MISSING", `The embedding model '${model}' is not installed. Run: ollama pull ${model}`);
    }
    throw new AiError("AI_FAILED", `The embedding service responded ${response.status}.`, { retryable: response.status >= 500 });
  }

  const payload = await response.json();
  const vectors = payload?.embeddings;
  if (!Array.isArray(vectors) || vectors.length !== inputs.length) {
    throw new AiError("AI_BAD_RESPONSE", "The embedding service returned an unexpected shape.", { retryable: true });
  }
  return vectors;
}

/** One embedding, for a question. */
async function embedOne(text) {
  const [vector] = await embed([text]);
  return vector || null;
}

/**
 * How alike two vectors are, between -1 and 1.
 *
 * Plain cosine similarity. Written here rather than pulled in as a dependency because it is six
 * lines, and because a dependency for six lines is a dependency to keep updated.
 */
function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return 0;
  let dot = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    magnitudeA += a[index] * a[index];
    magnitudeB += b[index] * b[index];
  }
  const magnitude = Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB);
  return magnitude ? dot / magnitude : 0;
}

module.exports = { embed, embedOne, cosineSimilarity, embeddingModel, DEFAULT_MODEL };
