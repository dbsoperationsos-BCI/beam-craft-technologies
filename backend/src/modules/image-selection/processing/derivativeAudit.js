/*
 * The pure half of scripts/auditImageSelectionDerivatives.js and of recovery.js beside it: given a
 * READY upload row and what the bucket still holds, say whether the photo is whole, and - when it is
 * not - where its bytes could come from again. Kept free of Prisma, R2 and the filesystem so the
 * decisions can be tested with plain objects; the callers supply `has(key)` and `exists(path)`.
 */
const path = require("path");

const STATUS = {
  // Both derivatives are in the bucket under the keys on the row.
  PRESENT: "present",
  // Neither derivative is in the bucket: the gallery shows a broken image for this photo.
  MISSING: "missing",
  // One of the two is in the bucket. Rare, and it means an upload was interrupted midway.
  PARTIAL: "partial",
  // No keys at all: processed before the move to object storage and served from this server's
  // disk by the API routes, which this audit does not check.
  LEGACY: "legacy",
};

const SOURCE = {
  // This server can read the original, so the processing worker could derive it again.
  REDERIVABLE: "server can rebuild",
  // Registered by the desktop app against a storage root: the server never resolves that path,
  // the desktop makes the derivatives. The photo comes back by re-registering it there.
  STORAGE_ROOT: "re-register from the desktop",
  // Uploaded through the browser drop zone, which cut the derivatives itself and only reported a
  // folder trail. The original never reached this server; it comes back through the browser.
  BROWSER: "re-upload from the browser",
  // An original this server once read, but which it cannot find or may not read now.
  UNREACHABLE: "original not reachable",
};

const isAbsolutePath = (value) => /^[A-Za-z]:[\\/]|^\\\\|^\//.test(String(value || ""));
// A `..` step anywhere in a stored path: the containment check below compares strings, so a path
// that climbs out of its root would pass it and be read. Such a path is never one this server wrote.
const stepsOut = (value) => /(^|[\\/])\.\.([\\/]|$)/.test(String(value || ""));

function status(row, has) {
  if (!row.thumbnailKey && !row.previewKey) return STATUS.LEGACY;
  const thumbnail = Boolean(row.thumbnailKey) && has(row.thumbnailKey);
  const preview = Boolean(row.previewKey) && has(row.previewKey);
  if (thumbnail && preview) return STATUS.PRESENT;
  if (!thumbnail && !preview) return STATUS.MISSING;
  return STATUS.PARTIAL;
}

/**
 * The file this server would read the original from, or null when it has none: an absolute
 * `originalPath` inside the studio's Original Storage Path, or a browser upload whose bytes are
 * still under the upload root. A storage-root trail and a drop-zone trail are never resolved here,
 * and neither is a path that steps out of its root.
 */
function sourcePath(row, { originalRoot, uploadRoot, exists, isInsideRoot }) {
  if (row.storageRootId) return null;
  if (row.originalPath) {
    if (!isAbsolutePath(row.originalPath) || stepsOut(row.originalPath)) return null;
    return originalRoot && isInsideRoot(row.originalPath, originalRoot) && exists(row.originalPath) ? row.originalPath : null;
  }
  if (!row.storageName || !uploadRoot) return null;
  // join() collapses any `..`, so what comes back must still sit under the root.
  const kept = path.join(uploadRoot, row.storageName);
  if (!kept.startsWith(path.join(uploadRoot, path.sep))) return null;
  return exists(kept) ? kept : null;
}

function source(row, context) {
  if (row.storageRootId) return SOURCE.STORAGE_ROOT;
  if (row.originalPath && !isAbsolutePath(row.originalPath)) return SOURCE.BROWSER;
  return sourcePath(row, context) ? SOURCE.REDERIVABLE : SOURCE.UNREACHABLE;
}

/** One verdict per row: `{ status, source }`, where `source` is only asked for a photo that lost something. */
function classifyRow(row, has, context) {
  const verdict = status(row, has);
  return { status: verdict, source: verdict === STATUS.MISSING || verdict === STATUS.PARTIAL ? source(row, context) : null };
}

/** Per-project counts, in the order projects are first seen, ready for console.table. */
function summarize(rows, verdicts) {
  const projects = new Map();
  rows.forEach((row, index) => {
    const key = row.projectId;
    if (!projects.has(key)) projects.set(key, { project: `${row.project?.projectName || "?"} (${String(row.projectId).slice(-6)})`, photos: 0, present: 0, missing: 0, partial: 0, legacy: 0, rebuildable: 0, desktop: 0, browser: 0, unreachable: 0 });
    const line = projects.get(key);
    const { status: verdict, source: origin } = verdicts[index];
    line.photos += 1;
    line[verdict] += 1;
    if (origin === SOURCE.REDERIVABLE) line.rebuildable += 1;
    else if (origin === SOURCE.STORAGE_ROOT) line.desktop += 1;
    else if (origin === SOURCE.BROWSER) line.browser += 1;
    else if (origin === SOURCE.UNREACHABLE) line.unreachable += 1;
  });
  return [...projects.values()];
}

module.exports = { STATUS, SOURCE, isAbsolutePath, sourcePath, classifyRow, summarize };
