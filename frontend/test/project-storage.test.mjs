import assert from "node:assert/strict";
import test from "node:test";
import {
  PROJECT_FOLDERS,
  resolveProjectPath,
  safePathSegment,
  uniqueFileName,
} from "../src/lib/projectStorage.mjs";

// The separator only spells the path back to a human, and the answer depends on the machine the
// browser is running on, so every path assertion below pins it rather than inheriting it.
const windows = { separator: "\\" };
const posix = { separator: "/" };

// The resolver is the only thing standing between a free-text project name and the file system, so
// these cover the names a studio actually types as well as the ones an attacker would.
test("cleans a folder name without failing the download that needs it", () => {
  assert.equal(safePathSegment("John & Priya Wedding"), "John & Priya Wedding");
  assert.equal(safePathSegment("Reception: Day 1"), "Reception- Day 1");
  assert.equal(safePathSegment('Shoot "A" <final>'), "Shoot -A- -final-");
  // Windows drops trailing dots and spaces silently, so they are removed rather than relied on.
  assert.equal(safePathSegment("Album v2. "), "Album v2");
  assert.equal(safePathSegment("  "), "Unsorted");
});

test("refuses any name that would climb out of the folder it is written in", () => {
  assert.equal(safePathSegment(".."), "Unsorted");
  assert.equal(safePathSegment("."), "Unsorted");
  // A separator inside a name is not an invitation to make folders: it becomes part of the name.
  assert.equal(safePathSegment("../../Windows"), "..-..-Windows");
  assert.equal(safePathSegment("..\\..\\secrets"), "..-..-secrets");
  assert.ok(!safePathSegment("../etc/passwd").includes("/"));
  assert.ok(!safePathSegment("..\\etc\\passwd").includes("\\"));
  // Reserved device names are still legal-looking text, so they are prefixed rather than dropped.
  assert.equal(safePathSegment("CON"), "_CON");
  assert.equal(safePathSegment("lpt1"), "_lpt1");
});

test("files a project download under the chosen folder, project and module folder", () => {
  const resolved = resolveProjectPath({
    ...windows,
    folderName: "DBS-Downloads",
    projectName: "John & Priya Wedding",
    folder: PROJECT_FOLDERS.selectedImages,
    subPath: ["Candid", "Reception"],
    fileName: "DSC_0001.jpg",
  });
  // The segments are the folders created below the chosen one, so the chosen folder is not among
  // them — it is only the head of the path that gets shown.
  assert.deepEqual(resolved.segments, ["John & Priya Wedding", "Selected Images", "Candid", "Reception"]);
  assert.equal(resolved.path, "DBS-Downloads\\John & Priya Wedding\\Selected Images\\Candid\\Reception\\DSC_0001.jpg");
});

test("drops empty trail steps", () => {
  const resolved = resolveProjectPath({
    ...posix,
    folderName: "Downloads",
    projectName: "Corp Offsite",
    folder: PROJECT_FOLDERS.frames,
    subPath: ["Day 1", "", null, undefined],
    fileName: "frame.png",
  });
  assert.equal(resolved.path, "Downloads/Corp Offsite/Frames/Day 1/frame.png");
});

test("names the trail on its own when no folder has been chosen", () => {
  const resolved = resolveProjectPath({ ...windows, projectName: "Corp Offsite", folder: PROJECT_FOLDERS.frames, fileName: "frame.png" });
  assert.deepEqual(resolved.segments, ["Corp Offsite", "Frames"]);
  assert.equal(resolved.path, "Corp Offsite\\Frames\\frame.png");
});

test("sends a file that belongs to no project to the Downloads folder", () => {
  const resolved = resolveProjectPath({ ...windows, folderName: "DBS-Downloads", fileName: "sales-export-2026-08-15.csv" });
  assert.deepEqual(resolved.segments, ["Downloads"]);
  assert.equal(resolved.path, "DBS-Downloads\\Downloads\\sales-export-2026-08-15.csv");
});

test("a traversal in the project name lands inside the chosen folder, not above it", () => {
  const resolved = resolveProjectPath({ ...windows, folderName: "DBS-Downloads", projectName: "..", folder: "..", fileName: "../evil.exe" });
  assert.deepEqual(resolved.segments, ["Unsorted", "Unsorted"]);
  assert.ok(resolved.path.startsWith("DBS-Downloads\\"));
  // The dots survive inside the file's own name — what must not survive is a step of its own.
  assert.equal(resolved.fileName, "..-evil.exe");
  assert.ok(!resolved.path.split(/[/\\]/).includes(".."));
});

test("a traversal in the chosen folder's own name cannot climb out either", () => {
  const resolved = resolveProjectPath({ ...windows, folderName: "..", projectName: "Corp Offsite", fileName: "frame.png" });
  assert.ok(!resolved.path.split(/[/\\]/).includes(".."));
  assert.equal(resolved.path, "Downloads\\Corp Offsite\\frame.png");
});

test("gives a repeated file name a numbered suffix within its own folder", () => {
  const taken = new Set();
  assert.equal(uniqueFileName(taken, "DSC_0001.jpg"), "DSC_0001.jpg");
  assert.equal(uniqueFileName(taken, "DSC_0001.jpg"), "DSC_0001 (1).jpg");
  assert.equal(uniqueFileName(taken, "DSC_0001.jpg"), "DSC_0001 (2).jpg");
  // A different folder starts its own tally, which is why callers keep one set per directory.
  assert.equal(uniqueFileName(new Set(), "DSC_0001.jpg"), "DSC_0001.jpg");
});
