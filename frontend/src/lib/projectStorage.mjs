/**
 * The one place the app decides where a downloaded file goes.
 *
 * Everything the studio saves out of the app is filed under a single Target Download Path chosen in
 * ⋮ → Project Settings, and below it under the project it belongs to and the module that produced
 * it:
 *
 *     DBS-Downloads\John & Priya Wedding\Selected Images\Reception\photo.jpg
 *     └── target ─┘ └── project ───────┘ └── module ───┘ └── trail ──────┘
 *
 * No module builds that trail itself. A module asks `openProjectStorage()` for a writer and hands
 * it a blob, a file name and which folder it belongs in; the resolver below decides the rest, so
 * renaming a module folder is one change here rather than one per download.
 *
 * A browser cannot write to a path it was merely told about, so there is no path to type: the
 * Target Download Path *is* the folder the user picks once through the browser's own folder picker,
 * and the permission to write it comes with the pick. The picked folder is remembered per browser
 * (an IndexedDB handle survives a reload; a string path could never grant access on its own).
 * Choose nothing — or use a browser without the File System Access API, such as Firefox or Safari —
 * and files go to the ordinary Downloads folder with the trail folded into the file name.
 */

import { createZipArchive } from "./zipArchive.mjs";

export const PROJECT_FOLDERS = {
  imageSelection: "Image Selection",
  selectedImages: "Selected Images",
  retouches: "Retouches",
  frames: "Frames",
  calendar: "Calendar",
  downloads: "Downloads",
};

export const PROJECT_FOLDER_NAMES = Object.values(PROJECT_FOLDERS);

/** Where a file with no project of its own goes — a table export, a report. */
export const UNFILED_FOLDER = PROJECT_FOLDERS.downloads;
const FALLBACK_SEGMENT = "Unsorted";

// Windows rejects \ / : * ? " < > | in a name, along with control characters and trailing dots or
// spaces; these device names are reserved whatever the extension. Project, shoot and deliverable
// names are free text typed by the studio, so a name is cleaned rather than allowed to fail the
// whole download — except for the two that would climb out of the tree, which are refused outright.
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * One folder or file name, made safe to use as one. Returns the fallback for anything that would
 * escape the folder it is being created in: `.`, `..`, an embedded separator, or an empty name.
 * This is the only guard against `../` traversal in a name, so every segment goes through it.
 */
export function safePathSegment(value, fallback = FALLBACK_SEGMENT) {
  const raw = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "");
  if (raw.includes("/") || raw.includes("\\")) return safePathSegment(raw.replace(/[/\\]+/g, "-"), fallback);
  const cleaned = raw.replace(/[:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "");
  if (!cleaned || cleaned === "." || cleaned === "..") return fallback;
  return RESERVED_NAMES.test(cleaned) ? `_${cleaned}` : cleaned;
}

/**
 * How a path is spelled back to the person who is looking at it — `\` on Windows, `/` elsewhere.
 * Display only: the folders themselves are created one handle at a time, never from a joined
 * string, so nothing depends on getting this right.
 */
export function displaySeparator() {
  if (typeof navigator === "undefined") return "\\";
  const platform = navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || "";
  return /win/i.test(platform) ? "\\" : "/";
}

/**
 * Where one file belongs, as segments below the chosen folder plus the full path to show a human.
 *
 * `project` is optional: a file that belongs to no project — a table export — is filed directly
 * under the Downloads folder rather than inventing a project for it. `folderName` is the name of
 * the folder the user picked, and only decorates the path that is shown; leave it out and the
 * relative trail is the answer.
 */
export function resolveProjectPath({ folderName, projectName, folder, subPath = [], fileName, separator = displaySeparator() } = {}) {
  const trail = (Array.isArray(subPath) ? subPath : [subPath])
    .filter((part) => part !== null && part !== undefined && String(part).trim() !== "")
    .map((part) => safePathSegment(part));
  const segments = [
    ...(projectName ? [safePathSegment(projectName)] : []),
    ...(folder ? [safePathSegment(folder)] : projectName ? [] : [UNFILED_FOLDER]),
    ...trail,
  ];
  const safeFileName = fileName ? safePathSegment(fileName, "download") : "";
  const parts = [
    ...(folderName ? [safePathSegment(folderName, UNFILED_FOLDER)] : []),
    ...segments,
    ...(safeFileName ? [safeFileName] : []),
  ];
  return { segments, fileName: safeFileName, path: parts.join(separator) };
}

/**
 * A file name not already used in the folder it is going into: `photo.jpg`, then `photo (1).jpg`.
 * `taken` is per folder rather than per download — the same name under two different selection
 * items is not a clash.
 */
export function uniqueFileName(taken, fileName) {
  const name = safePathSegment(fileName, "download");
  if (!taken.has(name)) { taken.add(name); return name; }
  const dot = name.lastIndexOf(".");
  const base = dot <= 0 ? name : name.slice(0, dot);
  const extension = dot <= 0 ? "" : name.slice(dot);
  let index = 1;
  let candidate = `${base} (${index})${extension}`;
  while (taken.has(candidate)) { index += 1; candidate = `${base} (${index})${extension}`; }
  taken.add(candidate);
  return candidate;
}

// ---------------------------------------------------------------------------
// The browser half: remembering the picked folder and writing into it.
// Everything below is a no-op outside a browser, so this module stays importable by tests.
// ---------------------------------------------------------------------------

const DB_NAME = "dbs-operations-os";
const DB_VERSION = 1;
const STORE = "storage-roots";
const FOLDER_KEY = "download-folder";
// What the Root Path era left behind: a handle picked for a typed path, and the path itself. Both
// are meaningless now, and the handle is a standing grant, so they are dropped rather than left.
const LEGACY_ROOT_KEY = "project-root";
const LEGACY_PATH_KEY = "dbs.projectRootPath";

export const supportsFolderSelection = () => typeof window !== "undefined" && "showDirectoryPicker" in window;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function withStore(mode, run) {
  return openDatabase().then((db) => new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = run(transaction.objectStore(STORE));
    transaction.oncomplete = () => { db.close(); resolve(request?.result); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
  }));
}

async function forgetLegacyRoot() {
  try { await withStore("readwrite", (store) => store.delete(LEGACY_ROOT_KEY)); } catch { /* nothing to drop */ }
  try { window.localStorage.removeItem(LEGACY_PATH_KEY); } catch { /* private mode */ }
}

/** The folder this browser was given, as `{ handle, name }`, or null when it has not been given one. */
export async function readDownloadFolder() {
  if (!supportsFolderSelection() || typeof window.indexedDB === "undefined") return null;
  try { return (await withStore("readonly", (store) => store.get(FOLDER_KEY))) || null; }
  catch { return null; }
}

/**
 * The full path the studio typed to say where the picked folder lives — `D:\Studio\Compression
 * Test` where the handle can only say `Compression Test`. Display only, because a browser never
 * reveals where a picked folder is and a typed path could never grant access to one: files go to
 * the granted folder whatever is written here. Kept on the same record so Change Folder, which
 * stores a fresh record, naturally drops a label that no longer applies.
 */
export async function labelDownloadFolder(label) {
  const stored = await readDownloadFolder();
  if (!stored) return null;
  const next = { ...stored, label: String(label ?? "").trim() };
  try { await withStore("readwrite", (store) => store.put(next, FOLDER_KEY)); } catch { /* private mode: this session only */ }
  return next;
}

/** How the chosen folder is spelled back to the studio: the typed full path when one was given,
 *  otherwise the only thing the browser will say — the folder's own name. */
export const downloadFolderDisplayName = (stored) => stored?.label || stored?.name || "";

export async function forgetDownloadFolder() {
  if (typeof window === "undefined" || typeof window.indexedDB === "undefined") return;
  try { await withStore("readwrite", (store) => store.delete(FOLDER_KEY)); } catch { /* nothing to forget */ }
  await forgetLegacyRoot();
}

/**
 * Ask for the folder downloads should go into and remember it. Must be called from a click:
 * browsers only open the picker, and only grant write permission, in response to a real user
 * gesture.
 */
export async function pickDownloadFolder() {
  if (!supportsFolderSelection()) throw new Error("This browser cannot choose a folder. Use Chrome or Edge, or files will go to your Downloads folder.");
  const handle = await window.showDirectoryPicker({ mode: "readwrite", id: "dbs-download-folder", startIn: "downloads" });
  const stored = { handle, name: handle.name };
  try { await withStore("readwrite", (store) => store.put(stored, FOLDER_KEY)); } catch { /* private mode: this session only */ }
  await forgetLegacyRoot();
  return stored;
}

const permissionOf = async (handle, request) => {
  if (typeof handle?.queryPermission !== "function") return "granted"; // older implementations grant on pick
  const state = await handle.queryPermission({ mode: "readwrite" });
  if (state === "granted" || !request || typeof handle.requestPermission !== "function") return state;
  return handle.requestPermission({ mode: "readwrite" });
};

/**
 * The folder to write into, or why there isn't one. `request: true` may show a permission prompt,
 * so it is only passed from a click.
 */
export async function resolveDownloadFolder({ request = false } = {}) {
  if (!supportsFolderSelection()) return { handle: null, reason: "unsupported" };
  const stored = await readDownloadFolder();
  if (!stored?.handle) return { handle: null, reason: "unset" };
  const permission = await permissionOf(stored.handle, request);
  if (permission !== "granted") return { handle: null, reason: permission === "denied" ? "denied" : "prompt", stored };
  // The folder was granted once and could have been renamed, moved or unplugged since. Reading one
  // entry is the cheapest way to find that out here rather than half-way through a download.
  try { await stored.handle.entries().next(); }
  catch { return { handle: null, reason: "missing", stored }; }
  return { handle: stored.handle, reason: "ready", stored };
}

// The stamp a fresh download root carries: `02-Sep-2026`. Written out by hand rather than through
// Intl, whose en-GB short month is "Sept" — a folder name wants the same spelling every time.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function downloadDateStamp(date = new Date()) {
  return `${String(date.getDate()).padStart(2, "0")}-${MONTHS[date.getMonth()]}-${date.getFullYear()}`;
}

/**
 * A folder name not already used under `root` — `Name`, then `Name (1)`, `Name (2)` — the way
 * Windows names a second "New folder". Chosen, not created: the first write creates it, so a
 * download that turns out to have nothing to save leaves no empty folder behind. Existing names
 * are matched without case: the disk underneath is usually case-insensitive, and `Name` opening
 * an existing `name` would quietly merge two downloads that were meant to stay apart.
 */
async function uniqueDirectoryName(root, baseName) {
  const existing = new Set();
  try { for await (const key of root.keys()) existing.add(String(key).toLocaleLowerCase()); }
  catch { return baseName; /* an implementation without keys(): the base name, merging as before */ }
  let name = baseName;
  let index = 1;
  while (existing.has(name.toLocaleLowerCase())) { name = `${baseName} (${index})`; index += 1; }
  return name;
}

/** Walks — and creates — the folders below the chosen one, reusing a handle already opened this run. */
async function directoryFor(root, segments, cache) {
  let handle = root;
  let trail = "";
  for (const segment of segments) {
    trail = `${trail}/${segment}`;
    const existing = cache.get(trail);
    handle = existing || (await handle.getDirectoryHandle(segment, { create: true }));
    if (!existing) cache.set(trail, handle);
  }
  return handle;
}

/** The ordinary browser download, used when there is no chosen folder to write into. */
export function saveToDownloads(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = safePathSegment(fileName, "download");
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return { location: "downloads", path: link.download };
}

/**
 * A writer for one project, opened once and then handed every file of a download.
 *
 * `available` says whether files will land in the chosen folder. When it is false the files still
 * arrive, in the browser's Downloads folder, and there are two ways they can:
 *
 * - Pass `archiveName` and they go into one ZIP of that name, carrying the whole folder tree inside
 *   it — the same `Project ▸ Selection item ▸ Shoot ▸ Folder` shape the chosen folder would have
 *   been given. `finish()` writes it. This is what a batch of photos wants: a page cannot create
 *   folders in the Downloads folder, so an archive is the only way the structure survives, and it is
 *   also one saved file instead of hundreds.
 * - Leave it out and each file saves on its own with the trail folded into its name, which is what a
 *   single-file download wants — one CSV should not arrive as a zip holding one CSV.
 *
 * Callers report `reason` to the studio rather than failing the download: a photographer waiting on
 * originals is better served by files in Downloads than by an error.
 */
export async function openProjectStorage({ projectName, request = false, archiveName = "", freshRoot = false } = {}) {
  const { handle, reason, stored } = await resolveDownloadFolder({ request });
  // Kept even when the folder turned out to be unusable, so the message can name the one the studio
  // thought it was writing to.
  const folderName = stored?.name || "";
  const directories = new Map();
  const takenPerDirectory = new Map();
  /*
   * `freshRoot` gives every download a root of its own instead of updating the last one in place:
   * the project folder is stamped with the day — `John & Priya Wedding - 02-Sep-2026` — and a
   * second download that day gets ` (1)`, ` (2)` after it, the way Windows names a second "New
   * folder". Only the root is renamed; everything inside keeps the same
   * Project ▸ Selection item ▸ Shoot ▸ Folder trail. On the archive route the stamp goes on the
   * ZIP's name and the browser's own download numbering supplies the counter, so both routes obey
   * the same rule. Off by default: a CSV export or a single retouch has no history to keep.
   */
  let rootName = projectName;
  let zipName = archiveName;
  if (freshRoot && projectName) {
    const stamped = `${safePathSegment(projectName)} - ${downloadDateStamp()}`;
    if (handle) rootName = await uniqueDirectoryName(handle, stamped);
    else if (archiveName) zipName = `${archiveName} - ${downloadDateStamp()}`;
  }
  const archive = !handle && zipName ? createZipArchive() : null;

  async function write({ blob, fileName, folder, subPath = [] }) {
    const target = resolveProjectPath({ folderName, projectName: rootName, folder, subPath, fileName });
    if (archive) {
      // The trail becomes real folders inside the archive, so it is deduplicated per directory
      // exactly as it would be on disk — two photos of the same name under one shoot cannot share an
      // entry, and the same name under a different selection item is not a clash.
      const name = uniqueFileName(takenOf(target.segments.join("/")), target.fileName);
      await archive.add({ blob, segments: target.segments, fileName: name });
      return { location: "archive", path: [...target.segments, name].join("/") };
    }
    if (!handle) {
      const flattened = [...target.segments, target.fileName].join(" - ");
      return saveToDownloads(blob, uniqueFileName(takenOf(""), flattened));
    }
    const directory = await directoryFor(handle, target.segments, directories);
    const name = uniqueFileName(takenOf(target.segments.join("/")), target.fileName);
    const file = await directory.getFileHandle(name, { create: true });
    const writable = await file.createWritable();
    try { await writable.write(blob); } finally { await writable.close(); }
    return { location: "folder", path: resolveProjectPath({ folderName, projectName: rootName, folder, subPath, fileName: name }).path };
  }

  /**
   * Closes an archive and saves it. A no-op for every other route — writing into the chosen folder
   * and saving files one at a time have both already finished by the time `write` returns — so a
   * caller can always call this and never has to know which route it took.
   */
  async function finish() {
    if (!archive || !archive.count) return null;
    const fileName = safePathSegment(`${zipName}.zip`, "download.zip");
    saveToDownloads(archive.finish(), fileName);
    return { location: "downloads", path: fileName, entries: archive.count };
  }

  function takenOf(key) {
    if (!takenPerDirectory.has(key)) takenPerDirectory.set(key, new Set());
    return takenPerDirectory.get(key);
  }

  // `projectFolderName` is the root this download actually wrote — with `freshRoot`, the stamped
  // and numbered name — so a caller's "Saved into …" message can point at the right folder.
  return { available: Boolean(handle), archived: Boolean(archive), reason, folderName, projectFolderName: rootName, write, finish };
}

/**
 * One file, one call — the whole of the download for anything that saves a single file. Batches
 * open the writer themselves so a hundred photos share one set of folder handles.
 */
export async function saveProjectFile({ blob, fileName, projectName, folder, subPath, request = false }) {
  const storage = await openProjectStorage({ projectName, request });
  const result = await storage.write({ blob, fileName, folder, subPath });
  return { ...result, available: storage.available, reason: storage.reason };
}

// ---------------------------------------------------------------------------
// The source folder: where a project's photos are, on this computer.
// ---------------------------------------------------------------------------

/**
 * The folder a project's photos were added from, remembered per project.
 *
 * There is no path to store and none to configure. A browser will not tell anyone where a folder
 * is — it hands over `Wedding/Day 1/IMG_0001.JPG` and never the drive it sits on — so what is kept
 * is the *grant* itself: the handle the picker returned, which is the only thing that can turn that
 * trail back into a file. It lives in this browser, exactly as the download folder does, and the
 * database stores only the trail.
 *
 * This is what lets **Download Selected** copy a master from where it already is into the Target
 * Download Path without a byte of it ever reaching a server.
 */
const sourceKeyFor = (projectId) => `source-folder:${projectId}`;

export async function readSourceFolder(projectId) {
  if (!projectId || !supportsFolderSelection() || typeof window.indexedDB === "undefined") return null;
  try { return (await withStore("readonly", (store) => store.get(sourceKeyFor(projectId)))) || null; }
  catch { return null; }
}

/** Remembers the folder the studio just picked for this project. Never throws: a browser in private
 *  mode simply keeps it for the session, which is still enough to finish the upload in hand. */
export async function rememberSourceFolder(projectId, handle) {
  if (!projectId || !handle) return null;
  const stored = { handle, name: handle.name, savedAt: Date.now() };
  try { await withStore("readwrite", (store) => store.put(stored, sourceKeyFor(projectId))); } catch { /* this session only */ }
  return stored;
}

export async function forgetSourceFolder(projectId) {
  if (!projectId || typeof window === "undefined" || typeof window.indexedDB === "undefined") return;
  try { await withStore("readwrite", (store) => store.delete(sourceKeyFor(projectId))); } catch { /* nothing to forget */ }
}

/**
 * Opens the picker for a project's photos. Must be called from a click — a browser only opens the
 * picker, and only grants access, in response to a real user gesture. Read-only: the app has no
 * business writing to the studio's masters, and asking for less is one fewer thing to go wrong.
 */
export async function pickSourceFolder(projectId) {
  if (!supportsFolderSelection()) throw new Error("This browser cannot read a folder of photos. Use Chrome or Edge.");
  const handle = await window.showDirectoryPicker({ mode: "read", id: "dbs-image-source" });
  return rememberSourceFolder(projectId, handle);
}

/** The remembered folder, ready to read, or why it is not. `request: true` may prompt, so it is
 *  only passed from a click. */
export async function resolveSourceFolder(projectId, { request = false } = {}) {
  if (!supportsFolderSelection()) return { handle: null, reason: "unsupported" };
  const stored = await readSourceFolder(projectId);
  if (!stored?.handle) return { handle: null, reason: "unset" };
  const query = typeof stored.handle.queryPermission === "function" ? await stored.handle.queryPermission({ mode: "read" }) : "granted";
  const state = query === "granted" || !request || typeof stored.handle.requestPermission !== "function"
    ? query
    : await stored.handle.requestPermission({ mode: "read" });
  if (state !== "granted") return { handle: null, reason: state === "denied" ? "denied" : "prompt", stored };
  return { handle: stored.handle, reason: "ready", stored };
}

/**
 * One file inside the remembered folder, found by the trail stored against it. Walks the tree a
 * handle at a time, because that is the only way a directory handle can be navigated; a segment
 * that is missing means the studio moved or renamed something since the photos were added.
 */
async function readTrail(root, segments) {
  const fileName = segments[segments.length - 1];
  let directory = root;
  for (const segment of segments.slice(0, -1)) directory = await directory.getDirectoryHandle(segment);
  return (await directory.getFileHandle(fileName)).getFile();
}

export async function readSourceFile(root, relativePath) {
  const segments = String(relativePath || "").split(/[/\\]+/).filter(Boolean);
  if (!segments.length) throw new Error("This photo has no recorded location.");
  // The stored trail and the folder the studio picked do not have to start at the same place. A row
  // written before folders were remembered holds a whole absolute path — `C:\…\images\Folder 2\a.jpg`
  // — of which only the tail means anything inside a chosen folder; and picking a parent or a child
  // of the folder the photos were added from is an easy thing to do.
  //
  // So the longest trail is tried first and then progressively shorter tails, which makes the
  // deepest — and therefore least ambiguous — match win. Only if nothing matches at any depth is
  // the photo reported as missing.
  let failure = null;
  for (let start = 0; start < segments.length; start += 1) {
    try { return await readTrail(root, segments.slice(start)); }
    catch (error) { failure = error; }
  }
  throw failure || new Error("This photo could not be found in the chosen folder.");
}

/** Why the originals could not be read, in words the studio can act on. */
export function sourceReasonMessage(reason, folderName) {
  if (reason === "unsupported") return "This browser cannot read the photo folder. Use Chrome or Edge.";
  if (reason === "unset") return "This browser does not know where these photos are. Add photos to the project from this computer, or use the computer they were added from.";
  if (reason === "denied" || reason === "prompt") return "Permission to read the photo folder was not granted.";
  return `The photo folder ${folderName ? `"${folderName}" ` : ""}could not be opened — check it still exists on this computer.`;
}

/** Why a download did not reach the chosen folder, in words the studio can act on. */
export function storageReasonMessage(reason, folderName) {
  if (reason === "unsupported") return "This browser cannot save into a chosen folder, so files went to Downloads. Chrome or Edge can.";
  if (reason === "unset") return "Choose a Target Download Path in Project Settings to file downloads there. For now they went to Downloads.";
  if (reason === "missing") return `The download folder could not be opened — check that ${folderName ? `"${folderName}"` : "it"} still exists, then choose it again in Project Settings. Files went to Downloads.`;
  if (reason === "denied" || reason === "prompt") return "Permission to write to the download folder was not granted, so files went to Downloads.";
  return "";
}
