const test = require("node:test");
const assert = require("node:assert/strict");
const { derivativeSchema } = require("../src/modules/image-selection/uploads/validation");

// The derivatives route is the one way a photo arrives; what a client claims about the original it
// kept is checked here, including the identity the desktop records for it.
const base = { fileName: "photo.jpg", relativePath: "shoot/photo.jpg", sizeBytes: 1024, width: 6000, height: 4000, batchId: "batch-1", folderId: null };

test("accepts only supported image MIME types for Image Selection uploads", () => {
  assert.equal(derivativeSchema.safeParse({ ...base, mimeType: "image/jpeg" }).success, true);
  assert.equal(derivativeSchema.safeParse({ ...base, mimeType: "image/heic" }).success, true);
  assert.equal(derivativeSchema.safeParse({ ...base, mimeType: "image/gif" }).success, false);
});

test("the original's checksum is optional and, when sent, a 64-character lowercase BLAKE3 hex", () => {
  const good = "a".repeat(32) + "0123456789abcdef0123456789abcdef";
  assert.equal(derivativeSchema.safeParse({ ...base, mimeType: "image/jpeg" }).data.checksum, undefined, "a browser never has one");
  assert.equal(derivativeSchema.safeParse({ ...base, mimeType: "image/jpeg", checksum: good }).data.checksum, good);
  assert.equal(derivativeSchema.safeParse({ ...base, mimeType: "image/jpeg", checksum: good.toUpperCase() }).success, false, "lowercase only, so one file has one spelling");
  assert.equal(derivativeSchema.safeParse({ ...base, mimeType: "image/jpeg", checksum: "abc" }).success, false);
  assert.equal(derivativeSchema.safeParse({ ...base, mimeType: "image/jpeg", checksum: `${good}0` }).success, false);
});
