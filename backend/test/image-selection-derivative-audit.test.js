const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { STATUS, SOURCE, classifyRow, summarize, isAbsolutePath, sourcePath } = require("../src/modules/image-selection/processing/derivativeAudit");

/*
 * The decisions behind scripts/auditImageSelectionDerivatives.js, with plain objects standing in for
 * the bucket listing and the filesystem: a photo is whole only when both of its keys are still in the
 * bucket, and a photo that lost an object is sent back to wherever its original still is.
 */
const has = (present) => (key) => present.includes(key);
const context = (reachable = []) => ({
  originalRoot: "D:\\Originals",
  uploadRoot: "/srv/uploads",
  exists: (file) => reachable.includes(file),
  isInsideRoot: (candidate, root) => String(candidate).toLowerCase().startsWith(`${root.toLowerCase()}\\`),
});

const row = (overrides = {}) => ({ id: "u1", projectId: "p-aaaaaa", fileName: "A.JPG", thumbnailKey: "t/a.webp", previewKey: "p/a.jpg", originalPath: null, storageRootId: null, storageName: "store-a", project: { projectName: "Wedding" }, ...overrides });

test("both keys in the bucket is whole, neither is missing, one is partial, none is legacy", () => {
  assert.equal(classifyRow(row(), has(["t/a.webp", "p/a.jpg"]), context()).status, STATUS.PRESENT);
  assert.equal(classifyRow(row(), has([]), context()).status, STATUS.MISSING);
  assert.equal(classifyRow(row(), has(["t/a.webp"]), context()).status, STATUS.PARTIAL);
  assert.equal(classifyRow(row({ thumbnailKey: null, previewKey: null }), has([]), context()).status, STATUS.LEGACY);
  assert.equal(classifyRow(row(), has(["t/a.webp", "p/a.jpg"]), context()).source, null);
});

test("a lost photo is traced to where its original is", () => {
  const lost = has([]);
  assert.equal(classifyRow(row({ storageRootId: "root-1", originalPath: "shoot/A.JPG" }), lost, context()).source, SOURCE.STORAGE_ROOT);
  assert.equal(classifyRow(row({ originalPath: "baby shoot/A.JPG" }), lost, context()).source, SOURCE.BROWSER);
  assert.equal(classifyRow(row({ originalPath: "D:\\Originals\\shoot\\A.JPG" }), lost, context(["D:\\Originals\\shoot\\A.JPG"])).source, SOURCE.REDERIVABLE);
  assert.equal(classifyRow(row({ originalPath: "D:\\Originals\\shoot\\A.JPG" }), lost, context()).source, SOURCE.UNREACHABLE);
  assert.equal(classifyRow(row({ originalPath: "E:\\Elsewhere\\A.JPG" }), lost, context(["E:\\Elsewhere\\A.JPG"])).source, SOURCE.UNREACHABLE);
  assert.equal(classifyRow(row(), lost, context([path.join("/srv/uploads", "store-a")])).source, SOURCE.REDERIVABLE);
  assert.equal(classifyRow(row(), lost, context()).source, SOURCE.UNREACHABLE);
  // A photo that kept one of its two objects is traced the same way as one that lost both.
  assert.equal(classifyRow(row({ originalPath: "baby shoot/A.JPG" }), has(["t/a.webp"]), context()).source, SOURCE.BROWSER);
});

test("absolute paths are Windows drives, UNC shares and POSIX roots; a trail is not", () => {
  assert.equal(isAbsolutePath("C:\\x\\y.jpg"), true);
  assert.equal(isAbsolutePath("\\\\nas\\share\\y.jpg"), true);
  assert.equal(isAbsolutePath("/mnt/originals/y.jpg"), true);
  assert.equal(isAbsolutePath("baby shoot/y.jpg"), false);
  assert.equal(isAbsolutePath(""), false);
});

test("the summary counts per project in the order first seen", () => {
  const rows = [
    row(),
    row({ id: "u2", previewKey: "p/b.jpg", thumbnailKey: "t/b.webp", originalPath: "baby shoot/B.JPG" }),
    row({ id: "u3", projectId: "p-bbbbbb", project: { projectName: "Birthday" }, thumbnailKey: null, previewKey: null }),
  ];
  const verdicts = rows.map((item) => classifyRow(item, has(["t/a.webp", "p/a.jpg"]), context()));
  assert.deepEqual(summarize(rows, verdicts), [
    { project: "Wedding (aaaaaa)", photos: 2, present: 1, missing: 1, partial: 0, legacy: 0, rebuildable: 0, desktop: 0, browser: 1, unreachable: 0 },
    { project: "Birthday (bbbbbb)", photos: 1, present: 0, missing: 0, partial: 0, legacy: 1, rebuildable: 0, desktop: 0, browser: 0, unreachable: 0 },
  ]);
});

test("a stored path that steps out of its root is never read, even when the file is there", () => {
  const escaped = "D:\Originals\..\secret.jpg";
  assert.equal(sourcePath(row({ originalPath: escaped }), context([escaped])), null);
  const outside = path.join("/srv/uploads", "..", "etc", "passwd");
  assert.equal(sourcePath(row({ storageName: "../etc/passwd" }), context([outside])), null);
  assert.equal(sourcePath(row({ storageName: "store-a" }), context([path.join("/srv/uploads", "store-a")])), path.join("/srv/uploads", "store-a"));
});
