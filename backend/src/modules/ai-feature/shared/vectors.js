/**
 * Face vectors: how they travel and how they are compared.
 *
 * A vector is a unit-normalised Float32Array. At rest it is base64 of its little-endian bytes in a
 * TEXT column - 512 floats are 2.7 KB, against 6 KB as JSON - and it is decoded only here, in the
 * worker and the matcher. Nothing in this file touches the database or the network, so it is unit
 * tested on its own.
 */
function normalize(values) {
  const vector = values instanceof Float32Array ? values : Float32Array.from(values);
  let sum = 0;
  for (let index = 0; index < vector.length; index += 1) sum += vector[index] * vector[index];
  const norm = Math.sqrt(sum) || 1;
  const out = new Float32Array(vector.length);
  for (let index = 0; index < vector.length; index += 1) out[index] = vector[index] / norm;
  return out;
}

function encode(vector) {
  const unit = normalize(vector);
  return Buffer.from(unit.buffer, unit.byteOffset, unit.byteLength).toString("base64");
}

function decode(text) {
  const buffer = Buffer.from(String(text || ""), "base64");
  const aligned = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(aligned).set(buffer);
  return new Float32Array(aligned);
}

/** Cosine similarity of two unit vectors, which is their dot product. */
function similarity(a, b) {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  for (let index = 0; index < length; index += 1) dot += a[index] * b[index];
  return dot;
}

/** The running mean of `count` vectors, updated with one more. */
function updateCentroid(centroid, count, vector) {
  if (!centroid || !count) return normalize(vector);
  const out = new Float32Array(vector.length);
  for (let index = 0; index < vector.length; index += 1) out[index] = (centroid[index] * count + vector[index]) / (count + 1);
  return normalize(out);
}

/** The mean of a list of vectors. */
function mean(vectors) {
  if (!vectors.length) return null;
  const out = new Float32Array(vectors[0].length);
  for (const vector of vectors) for (let index = 0; index < out.length; index += 1) out[index] += vector[index];
  for (let index = 0; index < out.length; index += 1) out[index] /= vectors.length;
  return normalize(out);
}

/**
 * Which confidence band a similarity falls in against the event's thresholds, and what that band
 * means. `high` and `medium` are the two cut-offs; below `medium` is `LOW`.
 */
function bandFor(score, { high, medium }) {
  if (score >= high) return "HIGH";
  if (score >= medium) return "MEDIUM";
  return "LOW";
}

/** The `k` best of `candidates` (`{ id, vector }`) against `query`, above `floor`, best first. */
function topMatches(query, candidates, { k = 5, floor = 0 } = {}) {
  const scored = [];
  for (const candidate of candidates) {
    const score = similarity(query, candidate.vector);
    if (score >= floor) scored.push({ id: candidate.id, score, candidate });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

module.exports = { normalize, encode, decode, similarity, updateCentroid, mean, bandFor, topMatches };
