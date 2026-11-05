const path = require("path");

/**
 * Every filesystem path the Image Selection module touches is resolved here.
 *
 * The rule the rest of the module relies on: a path is only usable if it resolves *inside* one of
 * the two configured roots — the Original Storage Path it is read from, or the Selected Output Path
 * a copy is written to. Nothing else on the server is reachable, however the value arrived.
 *
 * Nothing here trusts input from a browser. The client sends image ids; the path comes back from
 * the database, and is still checked against the root before it is opened, because a row written
 * when the root was `D:\Originals` must not be read once the root is `\\NAS\Originals`.
 */

const MAX_PATH_LENGTH = 1024;

/** Windows uses `\`, everything else `/`; a drive letter or a UNC prefix settles it on its own. */
function separatorFor(root) {
  const value = String(root ?? "");
  return value.includes("\\") || /^[A-Za-z]:/.test(value) ? "\\" : "/";
}

/**
 * A configured root, stored and compared in one spelling: trimmed, repeated separators collapsed,
 * no trailing separator. A UNC share keeps the two separators it opens with, because it means
 * nothing without them.
 */
function normalizeRoot(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  const separator = separatorFor(trimmed);
  const unc = /^[/\\]{2}[^/\\]/.test(trimmed);
  const body = unc ? trimmed.slice(2) : trimmed;
  const collapsed = body.replace(/[/\\]+/g, separator);
  if (!unc && /^[A-Za-z]:[/\\]?$/.test(collapsed)) return `${collapsed.slice(0, 2)}${separator}`;
  const withoutTrailing = collapsed.replace(/[/\\]+$/, "");
  return unc ? `${separator}${separator}${withoutTrailing}` : withoutTrailing || separator;
}

/**
 * Why a root cannot be used, or "" when it can. Only absolute locations qualify: a relative path
 * has no fixed meaning on a server, and a `.` or `..` step is a traversal however it is joined.
 */
function rootPathError(value) {
  const root = normalizeRoot(value);
  if (!root) return "";
  if (root.length > MAX_PATH_LENGTH) return "That path is too long.";
  const windowsDrive = /^[A-Za-z]:[/\\]/.test(root);
  const windowsShare = /^\\\\[^\\]+\\[^\\]+/.test(root);
  const posix = root.startsWith("/");
  if (!windowsDrive && !windowsShare && !posix) return "Enter a full folder path, such as D:\\DBS-Originals or \\\\DBS-NAS\\DBS-Originals.";
  if (root.split(/[/\\]/).some((segment) => segment === "." || segment === "..")) return "A folder path cannot contain . or .. steps.";
  if (/[*?"<>|]/.test(root.replace(/^[A-Za-z]:/, ""))) return 'A folder path cannot contain * ? " < > or |.';
  return "";
}

const isValidRootPath = (value) => !rootPathError(value);

/** Comparable form: separators unified and case folded, since Windows and SMB are case-insensitive. */
const comparable = (value) => String(value ?? "").replace(/[/\\]+/g, "\\").replace(/\\+$/, "").toLowerCase();

/**
 * True when `candidate` is the root itself or something beneath it. Compared segment by segment so
 * `D:\Originals-Archive` is not mistaken for a child of `D:\Originals`.
 */
function isInsideRoot(candidate, root) {
  const normalizedRoot = comparable(normalizeRoot(root));
  const normalizedCandidate = comparable(candidate);
  if (!normalizedRoot || !normalizedCandidate) return false;
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}\\`);
}

/**
 * Joins user-supplied segments onto a configured root and refuses anything that escapes it.
 *
 * Resolution is done by `path.win32` or `path.posix` to match the root's own flavour, so a `..`
 * hidden in a segment collapses the way the filesystem would collapse it — and is then caught by
 * the containment check rather than trusted.
 */
function resolveWithinRoot(root, segments = []) {
  const normalizedRoot = normalizeRoot(root);
  if (!normalizedRoot) throw Object.assign(new Error("No storage path is configured for Image Selection."), { status: 409 });
  const parts = (Array.isArray(segments) ? segments : [segments])
    .filter((segment) => segment !== null && segment !== undefined && String(segment).trim() !== "")
    .map((segment) => String(segment));
  const engine = separatorFor(normalizedRoot) === "\\" ? path.win32 : path.posix;
  const resolved = engine.resolve(normalizedRoot, ...parts);
  if (!isInsideRoot(resolved, normalizedRoot))
    throw Object.assign(new Error("That location is outside the configured storage path."), { status: 400 });
  if (resolved.length > MAX_PATH_LENGTH)
    throw Object.assign(new Error("That location is too long to store."), { status: 400 });
  return resolved;
}

/**
 * A stored `originalPath` checked before it is opened. The row is trusted to be the studio's own
 * record, but it is still confirmed to sit under the root configured *now* — a path that no longer
 * does is reported as unavailable rather than read from wherever it points.
 */
function assertReadable(originalPath, root) {
  if (!originalPath) throw Object.assign(new Error("This photo has no original file recorded."), { status: 409 });
  if (!isInsideRoot(originalPath, root))
    throw Object.assign(new Error("The original file is outside the configured Original Storage Path."), { status: 409 });
  return originalPath;
}

// Windows rejects \ / : * ? " < > | in a name, along with trailing dots and spaces. Project,
// shoot and selection-item names are free text, so they are cleaned before being used as folder
// names rather than failing the whole copy; `.` and `..` are refused outright.
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
function safeSegment(value, fallback = "Unsorted") {
  const raw = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/[/\\]+/g, "-");
  const cleaned = raw.replace(/[:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "");
  if (!cleaned || cleaned === "." || cleaned === "..") return fallback;
  return RESERVED_NAMES.test(cleaned) ? `_${cleaned}` : cleaned;
}

/** `photo.CR3`, then `photo (1).CR3` — used per destination folder, not across a whole copy. */
function uniqueName(taken, fileName) {
  const name = safeSegment(fileName, "file");
  if (!taken.has(name.toLowerCase())) { taken.add(name.toLowerCase()); return name; }
  const dot = name.lastIndexOf(".");
  const base = dot <= 0 ? name : name.slice(0, dot);
  const extension = dot <= 0 ? "" : name.slice(dot);
  let index = 1;
  let candidate = `${base} (${index})${extension}`;
  while (taken.has(candidate.toLowerCase())) { index += 1; candidate = `${base} (${index})${extension}`; }
  taken.add(candidate.toLowerCase());
  return candidate;
}

module.exports = { normalizeRoot, rootPathError, isValidRootPath, isInsideRoot, resolveWithinRoot, assertReadable, safeSegment, uniqueName, separatorFor, MAX_PATH_LENGTH };
