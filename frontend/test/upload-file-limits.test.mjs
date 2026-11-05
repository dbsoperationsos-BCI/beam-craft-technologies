import test from "node:test";
import assert from "node:assert/strict";
import { MAX_DOCUMENT_BYTES, MAX_PICTURE_BYTES, fileSizeLimit, leftOutNotice, splitBySize } from "../src/lib/uploadFileLimits.mjs";

const MB = 1024 * 1024;

test("a phone photo of a ticket over 5 MB still fits; a PDF is held to 5 MB", () => {
  const photo = { name: "ticket.jpg", type: "image/jpeg", size: 8 * MB };
  const pdf = { name: "train.pdf", type: "application/pdf", size: 6 * MB };
  assert.equal(fileSizeLimit(photo), MAX_PICTURE_BYTES);
  assert.equal(fileSizeLimit(pdf), MAX_DOCUMENT_BYTES);
  assert.deepEqual(splitBySize([photo, pdf]), { fitting: [photo], oversized: [pdf] });
});

test("a photo over 10 MB is left out too", () => {
  const huge = { name: "raw.png", type: "image/png", size: 11 * MB };
  assert.deepEqual(splitBySize([huge]).oversized, [huge]);
});

test("files left out are said, not dropped in silence", () => {
  assert.equal(leftOutNotice(0), "");
  assert.match(leftOutNotice(1), /^1 file was not added/);
  assert.match(leftOutNotice(3), /^3 files were not added/);
});
