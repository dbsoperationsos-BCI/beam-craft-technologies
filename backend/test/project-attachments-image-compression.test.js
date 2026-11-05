const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { compressStoredImage } = require("../src/modules/sales/project-attachments/controller");

/*
 * `compressStoredImage` runs after multer has already written the upload to disk: it reads that
 * file back, re-encodes it to WebP the way every other image in the app is, and leaves the result
 * under a `.webp` name - `express.static` serves this folder straight off disk and reads its
 * `Content-Type` from the extension, so the name has to agree with the bytes it now holds.
 */

const DIR = path.join(os.tmpdir(), `project-attachments-test-${process.pid}`);
test.before(() => fs.mkdirSync(DIR, { recursive: true }));
test.after(() => fs.rmSync(DIR, { recursive: true, force: true }));

// A 1x1 PNG - real bytes `sharp` can decode, so this exercises `compressImage` itself.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

function writeFixture(name, buffer) {
  const filePath = path.join(DIR, name);
  fs.writeFileSync(filePath, buffer);
  return { fieldname: "file", originalname: name, mimetype: "image/png", filename: name, path: filePath, size: buffer.length };
}

test("an image is re-encoded to WebP, renamed, and the original is removed", async () => {
  const file = writeFixture("photo-1.png", PNG);
  const result = await compressStoredImage(file);
  assert.equal(result.filename, "photo-1.webp");
  assert.equal(result.mimetype, "image/webp");
  assert.equal(path.basename(result.path), "photo-1.webp");
  assert.ok(fs.existsSync(result.path), "the compressed file is on disk");
  assert.equal(fs.existsSync(file.path), false, "the original PNG is removed");
  assert.notEqual(fs.readFileSync(result.path).toString("base64"), PNG.toString("base64"));
});

test("a non-image file is left exactly as multer wrote it", async () => {
  const buffer = Buffer.from("not an image");
  const filePath = path.join(DIR, "notes.txt");
  fs.writeFileSync(filePath, buffer);
  const file = { fieldname: "file", originalname: "notes.txt", mimetype: "text/plain", filename: "notes.txt", path: filePath, size: buffer.length };
  const result = await compressStoredImage(file);
  assert.equal(result, file);
  assert.equal(fs.readFileSync(filePath).toString(), "not an image");
});

test("an image compressImage cannot read is kept exactly as received, not lost", async () => {
  const file = writeFixture("broken.png", Buffer.from("this is not a real image"));
  const result = await compressStoredImage(file);
  assert.equal(result, file);
  assert.ok(fs.existsSync(file.path), "the original file is still on disk");
  assert.equal(fs.readFileSync(file.path).toString(), "this is not a real image");
});
