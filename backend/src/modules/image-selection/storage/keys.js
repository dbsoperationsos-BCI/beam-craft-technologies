// Builds R2 object keys for image derivatives.
//
// Shape:  image-selection/photo-selection/<project>/<folder>/<subfolder>/preview/<file>.jpg
//         image-selection/photo-selection/<project>/<folder>/<subfolder>/thumbnail/<file>.webp
//
// Keys are readable so the bucket can be browsed by a human, but every segment is
// slugified because project and folder names contain spaces, pipes, ampersands and
// non-ASCII characters that make for fragile URLs.
//
// A key is a permanent address, not a live mirror of the current names: renaming a
// project or folder later does NOT rewrite keys already stored in the database. The
// object still resolves, its path just reflects the name it had when it was uploaded.

const KEY_ROOT = "image-selection/photo-selection";
const MAX_SEGMENT = 60;
const VARIANTS = { preview: "jpg", thumbnail: "webp" };

// Lowercase ASCII slug. Returns "" when nothing usable survives, so callers can fall back.
function slugify(value) {
  return String(value == null ? "" : value)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining accent marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SEGMENT)
    .replace(/-+$/g, "");
}

// Every segment must be non-empty, otherwise a name like "***" would collapse the path.
function segment(value, fallback) {
  return slugify(value) || fallback;
}

// Names are not unique across projects, so a short id keeps two identically named
// projects from sharing a folder in the bucket.
function projectSegment(projectName, projectId) {
  const suffix = String(projectId || "").slice(-6).toLowerCase();
  const name = segment(projectName, "project");
  return suffix ? `${name}-${suffix}` : name;
}

// folders is the ancestor chain, outermost first: [{ name }, { name }, ...]
function folderSegments(folders) {
  return (folders || []).map((folder, index) => segment(folder && folder.name, `folder-${index + 1}`));
}

// Keeps the photographer's original filename visible, with a short suffix from the
// storage UUID so two files called DSC_0001.jpg in the same folder cannot collide.
function fileSegment(fileName, storageName, extension) {
  const base = String(fileName || "").replace(/\.[^./\\]+$/, "");
  const suffix = String(storageName || "").replace(/-/g, "").slice(0, 8).toLowerCase() || "file";
  return `${segment(base, "photo")}-${suffix}.${extension}`;
}

function buildDerivativeKey({ projectName, projectId, folders, variant, fileName, storageName }) {
  const extension = VARIANTS[variant];
  if (!extension) throw new Error(`Unknown derivative variant: ${variant}`);
  return [
    KEY_ROOT,
    projectSegment(projectName, projectId),
    ...folderSegments(folders),
    variant,
    fileSegment(fileName, storageName, extension),
  ].join("/");
}

// A photo uploaded to a Signature Album alone - never a project photo, so never under the
// photo-selection root:  image-selection/signature-album/<project>/<variant>/<file>.
const ALBUM_KEY_ROOT = "image-selection/signature-album";

function buildAlbumPhotoKey({ projectName, projectId, variant, fileName, storageName }) {
  const extension = VARIANTS[variant];
  if (!extension) throw new Error(`Unknown derivative variant: ${variant}`);
  return [ALBUM_KEY_ROOT, projectSegment(projectName, projectId), variant, fileSegment(fileName, storageName, extension)].join("/");
}

// AI Editing's own objects - the edit master, its display pair and a reference photo - under the
// edit's own prefix, versioned so a render never overwrites what an earlier one made and a send
// that is still reading v2 is untouched by v3 landing:
//   image-selection/ai-editing/<project>/<file>-<8hex>/v<version>/output.jpg | preview.jpg | thumbnail.webp
//   image-selection/ai-editing/<project>/<file>-<8hex>/reference-<8hex>.jpg
const EDIT_KEY_ROOT = "image-selection/ai-editing";
const EDIT_VARIANTS = { output: "output.jpg", preview: "preview.jpg", thumbnail: "thumbnail.webp" };

function editPrefix({ projectName, projectId, fileName, storageName }) {
  const base = String(fileName || "").replace(/\.[^./\\]+$/, "");
  const suffix = String(storageName || "").replace(/-/g, "").slice(0, 8).toLowerCase() || "file";
  return [EDIT_KEY_ROOT, projectSegment(projectName, projectId), `${segment(base, "photo")}-${suffix}`].join("/");
}
function buildEditKey({ projectName, projectId, fileName, storageName, version, variant }) {
  const name = EDIT_VARIANTS[variant];
  if (!name) throw new Error(`Unknown edit variant: ${variant}`);
  return `${editPrefix({ projectName, projectId, fileName, storageName })}/v${Math.max(1, Number(version) || 1)}/${name}`;
}
function buildEditReferenceKey({ projectName, projectId, fileName, storageName, token }) {
  const suffix = String(token || "").replace(/-/g, "").slice(0, 8).toLowerCase() || "ref";
  return `${editPrefix({ projectName, projectId, fileName, storageName })}/reference-${suffix}.jpg`;
}

module.exports = { KEY_ROOT, ALBUM_KEY_ROOT, EDIT_KEY_ROOT, VARIANTS, EDIT_VARIANTS, slugify, projectSegment, folderSegments, fileSegment, buildDerivativeKey, buildAlbumPhotoKey, buildEditKey, buildEditReferenceKey };
