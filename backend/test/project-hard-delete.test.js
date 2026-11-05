const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * Deleting a project - the ⋯ menu's Delete or the tick boxes - moves it to Resource Management →
 * Recycling Bin; the bin's Delete permanently is the only hard delete. Read from the source, because
 * what matters is the order of the steps and which route takes which path; the behaviour against a
 * database is `project-recycling-bin.test.js`.
 */
const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", "src", "modules", ...parts), "utf8");
const routes = read("sales", "projects", "routes.js");
const controller = read("sales", "projects", "controller.js");
const service = read("assets", "recycling-bin.service.js");
const binRoutes = read("assets", "recycling-bin.routes.js");
const hard = service.slice(service.indexOf("async function purgeDeletedProject"), service.indexOf("module.exports"));

test("a selection and the single Delete both move the project to the bin", () => {
  assert.match(routes, /path: "\/projects\/bulk",[\s\S]*?deleteOne: \(id, req\) => deleteProjectRecord\(req, String\(id\)\)/);
  assert.match(routes, /router\.delete\("\/projects\/:id", answersForAProject, requireProjectDeleter, deleteProject\);/);
  assert.doesNotMatch(controller, /salesProject\.delete\(/, "nothing on the projects side erases a project any more");
});

test("the permanent delete is the bin's, behind ASSET / Recycling Bin, and only for a project in the bin", () => {
  assert.match(binRoutes, /router\.use\(protect\);/);
  assert.match(binRoutes, /router\.use\(requireModule\("ASSET", "Recycling Bin"\)\);/);
  assert.match(binRoutes, /router\.delete\("\/projects\/:id", controller\.deleteProjectPermanently\);/);
  assert.ok(hard.indexOf("await binnedProject(userId, id)") < hard.indexOf("salesProject.deleteMany"));
  // Claimed (`purgingAt`) before any photo is purged, and the row goes only while that claim holds.
  assert.ok(hard.indexOf("data: { purgingAt: now }") < hard.indexOf("imageSelectionProjects.purgeData"));
  assert.match(hard, /salesProject\.deleteMany\(\{ where: \{ id: project\.id, deletedAt: \{ not: null \}, purgingAt: \{ not: null \} \} \}\)/);
});

test("the row goes in one transaction, with the gallery's key cleared first and files removed after", () => {
  const body = hard.slice(hard.indexOf("prisma.$transaction"));
  assert.ok(body.indexOf("imageSelectionProject.updateMany({ where: { salesProjectId: project.id }, data: { salesProjectId: null } })") < body.indexOf("salesProject.deleteMany"));
  assert.ok(body.indexOf("imageSelectionWhatsAppNotification.deleteMany") < body.indexOf("salesProject.deleteMany"));
  // Files after the commit: a disc or bucket failure must not bring a deleted project back.
  assert.ok(hard.indexOf("fs.promises.unlink") > hard.indexOf("}, { timeout"));
  assert.ok(hard.indexOf("objectStorage.deleteObject") > hard.indexOf("}, { timeout"));
});
