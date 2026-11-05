const crypto = require("crypto");

function getKey() {
  const raw = String(process.env.GOOGLE_OAUTH_ENCRYPTION_KEY || "").trim();
  if (!raw) {
    throw new Error("GOOGLE_OAUTH_ENCRYPTION_KEY is not configured.");
  }

  let keyBuffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    keyBuffer = Buffer.from(raw, "hex");
  } else if (/^[A-Za-z0-9+/=]+$/.test(raw)) {
    keyBuffer = Buffer.from(raw, "base64");
  } else {
    keyBuffer = Buffer.from(raw, "utf8");
  }

  if (keyBuffer.length !== 32) {
    throw new Error(
      "GOOGLE_OAUTH_ENCRYPTION_KEY must decode to 32 bytes. Use a 64-char hex string or base64-encoded 32-byte key."
    );
  }
  return keyBuffer;
}

function encryptText(value) {
  if (value === undefined || value === null || value === "") return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const plaintext = Buffer.from(String(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

function decryptText(value) {
  if (!value) return null;
  const data = Buffer.from(String(value), "base64");
  const iv = data.subarray(0, 12);
  const authTag = data.subarray(12, 28);
  const ciphertext = data.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

function hashState(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function generateStateToken() {
  return crypto.randomBytes(32).toString("base64url");
}

module.exports = {
  decryptText,
  encryptText,
  generateStateToken,
  hashState,
};
