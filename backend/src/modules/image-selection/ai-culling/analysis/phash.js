/**
 * 64-bit DCT perceptual hash: the standard pHash construction. A 32×32 greyscale thumbnail is
 * transformed with a 2D DCT-II, the top-left 8×8 of low-frequency coefficients (minus the DC
 * term) are thresholded against their median, and the 64 bits become 16 hex characters. Two
 * frames of the same moment hash within a few bits of each other whatever the JPEG quality or a
 * small crop did; two different frames land far apart. Hamming distance over these is the cheap
 * first pass of duplicate/burst screening — nothing heavier runs until this says "candidates".
 */

const HASH_SIZE = 32; // input thumbnail edge
const DCT_LOW = 8; // low-frequency block kept

// Cosine tables are the whole cost of a DCT this small; computed once.
const COSINES = (() => {
  const table = [];
  for (let k = 0; k < DCT_LOW; k += 1) {
    table[k] = new Float64Array(HASH_SIZE);
    for (let n = 0; n < HASH_SIZE; n += 1) table[k][n] = Math.cos(((2 * n + 1) * k * Math.PI) / (2 * HASH_SIZE));
  }
  return table;
})();

/** 64-bit pHash of a raw 32×32 greyscale buffer, as 16 lowercase hex characters. */
function perceptualHash(pixels) {
  if (!pixels || pixels.length < HASH_SIZE * HASH_SIZE) return null;
  // Only the low 8×8 of the full DCT is needed, so only those coefficients are computed:
  // rows first (32→8 per row), then columns over the 8-wide intermediate.
  const rows = new Float64Array(HASH_SIZE * DCT_LOW);
  for (let y = 0; y < HASH_SIZE; y += 1) {
    for (let k = 0; k < DCT_LOW; k += 1) {
      let sum = 0;
      for (let x = 0; x < HASH_SIZE; x += 1) sum += pixels[y * HASH_SIZE + x] * COSINES[k][x];
      rows[y * DCT_LOW + k] = sum;
    }
  }
  const coefficients = [];
  for (let k = 0; k < DCT_LOW; k += 1) {
    for (let j = 0; j < DCT_LOW; j += 1) {
      let sum = 0;
      for (let y = 0; y < HASH_SIZE; y += 1) sum += rows[y * DCT_LOW + j] * COSINES[k][y];
      coefficients.push(sum);
    }
  }
  // The DC term is overall brightness, which a hash of *structure* must ignore.
  const ac = coefficients.slice(1);
  const median = [...ac].sort((a, b) => a - b)[Math.floor(ac.length / 2)];
  let bits = 0n;
  for (let index = 0; index < ac.length; index += 1) {
    bits <<= 1n;
    if (ac[index] > median) bits |= 1n;
  }
  // 63 AC bits; one padding shift keeps the hash a whole 16 hex characters.
  bits <<= 1n;
  return bits.toString(16).padStart(16, "0");
}

/** Bits differing between two hex hashes; 64 (nothing alike) when either is missing. */
function hammingDistance(a, b) {
  if (!a || !b) return 64;
  let bits = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let distance = 0;
  while (bits) { distance += Number(bits & 1n); bits >>= 1n; }
  return distance;
}

module.exports = { HASH_SIZE, perceptualHash, hammingDistance };
