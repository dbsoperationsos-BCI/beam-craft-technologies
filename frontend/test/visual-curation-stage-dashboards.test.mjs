import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SIDEBAR_MODULES, sidebarLabelForRoute } from "../src/constants/navigation.mjs";
import { permissionForRoute } from "../src/constants/modulePermissions.js";
import { LADDER_FILTERS, STAGE_ROUTES, createdProjectsText, linkedModuleOptions, projectHasStage, stageLadderOf, stageSidebarStatuses, rowsForView, stageDashboard, stageProjectsHref, stageRowHref, stageSections, stageStatusByProject, viewLabel } from "../src/lib/stageDashboards.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.join(here, "..", relative), "utf8");
const pageExists = (route) => fs.existsSync(path.join(here, "..", "src", "app", "(app)", ...route.split("/").filter(Boolean), "page.js"));
const group = SIDEBAR_MODULES.find((entry) => entry.id === "visual-curation");
const item = (id) => group.items.find((entry) => entry.id === id);

test("AI Culling, AI Editing and Signature Album are modules of their own, each with a Dashboard and a Projects page on its own permission", () => {
  const expected = { "ai-culling": ["culling", "AI Culling"], "ai-editing": ["editing", "AI Editing"], "signature-album": ["album", "Signature Album"] };
  for (const [id, [stage, feature]] of Object.entries(expected)) {
    const entry = item(id);
    const routes = STAGE_ROUTES[stage];
    assert.equal(entry.label, feature);
    assert.equal(entry.children, undefined);
    assert.equal(entry.href, routes.dashboard);
    assert.equal(entry.activePath, routes.base);
    assert.equal(sidebarLabelForRoute(entry.href), feature);
    for (const route of [routes.dashboard, routes.projects, `${routes.projects}?projectId=p1`]) {
      assert.deepEqual(permissionForRoute(route), { module: "IMAGE_SELECTION", feature }, route);
    }
    for (const route of [routes.base, routes.dashboard, routes.projects]) assert.ok(pageExists(route), route);
    // Lit by its own entry, never Photo Selection's: its prefix is longer than /image-selection.
    assert.ok(routes.base.startsWith(`${item("image-selection").activePath}/`));
    assert.deepEqual(stageSections(stage).map((section) => section.value), [routes.dashboard, routes.projects]);
  }
  // Photo Selection itself is untouched: once in the menu, still on Project Management.
  assert.equal(group.items.filter((entry) => entry.label === "Photo Selection").length, 1);
  assert.deepEqual(permissionForRoute("/image-selection/projects"), { module: "IMAGE_SELECTION", feature: "Project Management" });
});

test("a project opens in a module's own Projects page, never on a Photo Selection tab", () => {
  assert.equal(stageRowHref("culling", { projectId: "p1" }, 7), "/image-selection/ai-culling/projects?projectId=p1&at=7");
  assert.equal(stageProjectsHref("album", { projectId: "p1", folderId: "f1", at: 7 }), "/image-selection/signature-album/projects?projectId=p1&folderId=f1&at=7");
  assert.equal(stageProjectsHref("photos", { projectId: "p1", at: 7 }), "/image-selection/projects?projectId=p1&at=7");
  const workspace = read("src/components/image-selection/ImageSelectionProjectWorkspace.js");
  assert.match(workspace, /const activeTab = stage;/);
  assert.doesNotMatch(workspace, /<Tabs /);
  assert.doesNotMatch(workspace, /setActiveTab/);
  // "Open AI Editing" and the like go to that module's page, and only to a module the project has.
  assert.match(workspace, /const openStage = \(id\) => \(hasTab\(id\) && onOpenStage \?/);
  assert.match(workspace, /onOpenEditing=\{openStage\("editing"\)\}/);
  assert.match(workspace, /onOpenAlbum=\{openStage\("album"\)\}/);
  // The sends themselves are unchanged: each destination by its own permission and the project having it.
  assert.match(workspace, /canSendToEditing=\{linkedTo\("culling", "editing"\) && editingAccess\.canWrite\}/);
  assert.match(workspace, /canSendToAlbum=\{linkedTo\("culling", "album"\) && albumAccess\.canWrite\}/);
});

test("a module lists the projects it belongs to, each with its own status", () => {
  assert.equal(projectHasStage("culling", { photoCullingTab: null }), true);
  assert.equal(projectHasStage("culling", { photoCullingTab: false }), false);
  assert.equal(projectHasStage("album", { signatureAlbumTab: null }), false);
  assert.equal(projectHasStage("album", { signatureAlbumTab: false, salesProjectId: "s1" }), true);
  assert.deepEqual(stageStatusByProject("culling", [{ projectId: "p1", group: "finalized" }, { projectId: "p1", group: "failed" }, { projectId: "p2", group: "reviewReady" }]), { p1: "failed", p2: "reviewReady" });
  assert.deepEqual(stageStatusByProject("editing", [{ projectId: "p1", totalPhotos: 4, edited: 4, failed: 0 }, { projectId: "p2", totalPhotos: 4, edited: 1, failed: 0 }, { projectId: "p3", totalPhotos: 4, edited: 0, failed: 0 }]), { p1: "edited", p2: "partial", p3: "inProgress" });
  assert.deepEqual(stageStatusByProject("album", [{ projectId: "p1", status: "PUBLISHED" }]), { p1: "PUBLISHED" });
  const page = read("src/components/image-selection/stage-dashboard/StageProjectsPage.js");
  // The module's own records, under the module's own permission - nothing of Photo Selection's.
  assert.match(page, /listModuleProjects\(stage, \{ search \}\)/);
  assert.doesNotMatch(page, /"Project Management"/);
  assert.match(page, /const \{ canWrite: canManage \} = useRouteAccess\(\);/);
  assert.match(page, /canWrite=\{canManage\}/);
  // Delete: only this module's project when it was made with others, the photos too when alone.
  assert.match(page, /setRemoval\(\{ mode: modules\.length > 1 \? "module" : "project", project \}\)/);
  assert.match(page, /<CreateImageSelectionProject module=\{stage\} onCreate=\{createProject\} \/>/);
  // No linking after creation: the Link Existing Project popup is gone.
  assert.equal(fs.existsSync(path.join(here, "..", "src", "components", "image-selection", "stage-dashboard", "LinkExistingProjectDialog.js")), false);
});

test("Linked Modules offer only the other modules the viewer may create projects in", () => {
  const grants = (...features) => (module, feature, level) => module === "IMAGE_SELECTION" && features.includes(feature) && level === "READ_WRITE";
  // AI Culling + AI Editing: AI Culling's form offers AI Editing alone, and AI Editing's AI Culling.
  assert.deepEqual(linkedModuleOptions("culling", grants("AI Culling", "AI Editing")), ["editing"]);
  assert.deepEqual(linkedModuleOptions("editing", grants("AI Culling", "AI Editing")), ["culling"]);
  // Photo Selection's own permission is Project Management.
  assert.deepEqual(linkedModuleOptions("album", grants("Signature Album", "AI Culling", "Project Management")), ["culling", "photos"]);
  assert.deepEqual(linkedModuleOptions("photos", grants("AI Culling", "AI Editing", "Project Management", "Signature Album")), ["culling", "editing", "album"]);
  // Read alone creates nothing, and the form's own module is never offered.
  assert.deepEqual(linkedModuleOptions("culling", (module, feature, level) => level === "READ"), []);
  assert.equal(createdProjectsText([{ module: "editing", projectCode: "DBS-VCAE-000004" }, { module: "culling", projectCode: "DBS-VCAC-000004" }]), "Created AI Culling DBS-VCAC-000004, AI Editing DBS-VCAE-000004.");
});

test("every module sorts by the same four rungs, the dot keeping the module's own word", () => {
  assert.deepEqual(LADDER_FILTERS.map(([, label]) => label), ["Yet to Start", "In Progress", "Partially Completed", "Completed"]);
  assert.equal(stageLadderOf("culling", "finalized"), "completed");
  assert.equal(stageLadderOf("culling", "reviewReady"), "partiallyCompleted");
  assert.equal(stageLadderOf("editing", "inProgress"), "inProgress");
  assert.equal(stageLadderOf("album", "PUBLISHED"), "completed");
  assert.equal(stageLadderOf("album", "unknown"), "notStarted");
  const statuses = stageSidebarStatuses("album", { w1: "READY" });
  assert.equal(statuses.of({ id: "w1" }), "partiallyCompleted");
  assert.equal(statuses.titleOf({ id: "w1" }), "Ready to publish");
  assert.equal(statuses.of({ id: "w2" }), "notStarted");
  // The sidebar puts them under one Sort entry, opened in place, beside Expand where the page has it.
  const sidebar = read("src/components/image-selection/ProjectSidebar.js");
  assert.match(sidebar, /<span className="flex-1">Sort<\/span>/);
  assert.match(sidebar, /\{sortOpen && <div role="group" aria-label="Sort projects by status"/);
  assert.ok(sidebar.indexOf('<span className="flex-1">Expand</span>') < sidebar.indexOf('<span className="flex-1">Sort</span>'));
});

test("each card narrows the table to the rows it counted", () => {
  const runs = [{ id: "a", group: "failed" }, { id: "b", group: "reviewReady" }];
  assert.deepEqual(rowsForView("culling", runs, "failed").map((row) => row.id), ["a"]);
  const projects = [{ id: "p1", failed: 2 }, { id: "p2", failed: 0 }];
  assert.deepEqual(rowsForView("editing", projects, "failed").map((row) => row.id), ["p1"]);
  const albums = [{ id: "x", status: "PUBLISHED", expiringSoon: true }, { id: "y", status: "DRAFT", expiringSoon: false }];
  assert.deepEqual(rowsForView("album", albums, "expiringSoon").map((row) => row.id), ["x"]);
  assert.equal(viewLabel("album", "READY"), "Ready to Publish");
  for (const stage of ["culling", "editing", "album"]) {
    const keys = stageDashboard(stage).cards.map((card) => card.key);
    assert.equal(new Set(keys).size, keys.length, stage);
  }
});
