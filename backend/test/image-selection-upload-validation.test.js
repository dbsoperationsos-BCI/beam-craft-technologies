const test = require("node:test");
const assert = require("node:assert/strict");
const { initiateUploadSchema } = require("../src/modules/image-selection/uploads/validation");

test("accepts only supported image MIME types for Image Selection uploads", () => {
  const base = { fileName: "photo.jpg", sizeBytes: 1024, batchId: "batch-1", folderId: null };
  assert.equal(initiateUploadSchema.safeParse({ ...base, mimeType: "image/jpeg" }).success, true);
  assert.equal(initiateUploadSchema.safeParse({ ...base, mimeType: "image/heic" }).success, true);
  assert.equal(initiateUploadSchema.safeParse({ ...base, mimeType: "image/gif" }).success, false);
});
