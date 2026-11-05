const path = require("path");

/**
 * Keeps the Image Selection upload root off the public `/uploads` static route.
 *
 * `/uploads` is served statically because sales project attachments link there. Image Selection's
 * own root sits under it (`uploads/image-selection`, the default `IMAGE_SELECTION_UPLOAD_ROOT`) and
 * once held originals the retired chunked uploader assembled, plus whatever a legacy row still has
 * on disk. None of that is anyone's to fetch by URL: every Image Selection byte a client may see is
 * served by a guarded route or from R2. So any request for a path under `/uploads/image-selection`
 * answers the same JSON 404 an unknown path does, before `express.static` can look at the disk.
 *
 * The judgement is made on the decoded, forward-slashed, dot-normalized, lower-cased path, with
 * trailing dots and spaces stripped from each name, so `%2Fimage-selection`, `Image-Selection`,
 * `image-selection\\x`, `./image-selection`, `image-selection.` (Windows opens that as the folder)
 * and a double-encoded `%252F` are all the same path to it - the shapes express.static itself
 * would resolve onto that directory on a Windows or case-insensitive filesystem.
 */
const PRIVATE_PREFIX = "/image-selection";

function normalizeRequestPath(url) {
  let pathname = String(url || "").split(/[?#]/)[0];
  // Two passes: a double-encoded %252F is %2F after one and / after two. A malformed escape is
  // left as it is - still a path to judge, never a reason to let it through.
  for (let pass = 0; pass < 2; pass += 1) {
    try { pathname = decodeURIComponent(pathname); } catch { break; }
  }
  // Windows ignores trailing dots and spaces in a name; a lone `.` or `..` is left for normalize.
  const slashed = pathname.replace(/\\/g, "/").split("/").map((segment) => segment.replace(/^(.*?[^. ])[. ]+$/, "$1")).join("/");
  return path.posix.normalize(slashed.startsWith("/") ? slashed : `/${slashed}`).toLowerCase();
}

function isPrivateUploadPath(url) {
  const normalized = normalizeRequestPath(url);
  return normalized === PRIVATE_PREFIX || normalized.startsWith(`${PRIVATE_PREFIX}/`);
}

// Mounted at `/uploads`, so `req.path` is what follows that prefix.
function refusePrivateUploadRoot(req, res, next) {
  if (isPrivateUploadPath(req.path)) return res.status(404).json({ message: "Not found" });
  return next();
}

module.exports = { refusePrivateUploadRoot, isPrivateUploadPath, normalizeRequestPath };
