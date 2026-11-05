import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LINKED_MODULES_NOTE, linkChanges, linkChangesText, linkEntriesOf, modulePairKey, modulesLinked } from "../src/lib/stageDashboards.mjs";

/*
 * Edit Project's Linked Modules on screen (the server's `projects/moduleLinks.js`): the same boxes as
 * Create Project, ticked where linked, greyed where the viewer may only read; only what changed is
 * sent; and a send between two modules is offered only while they are linked.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.join(here, "..", relative), "utf8");

const ROW = {
  unlinkedPairs: ["culling:editing"],
  moduleLinks: [
    { module: "album", member: false, linked: false, projectCode: null, canChange: true },
    { module: "photos", member: true, linked: true, projectCode: "DBS-VCIS-000083", canChange: false },
    { module: "editing", member: true, linked: false, projectCode: "DBS-VCAE-000006", canChange: true },
  ],
};

test("two modules are linked unless their pair was unticked, whichever way round they are named", () => {
  assert.equal(modulePairKey("editing", "culling"), "culling:editing");
  assert.equal(modulesLinked(ROW, "editing", "culling"), false);
  assert.equal(modulesLinked(ROW, "culling", "photos"), true);
  assert.equal(modulesLinked({}, "culling", "editing"), true, "a row with no pairs - made together, or from Project Management - is linked");
});

test("the boxes are listed in the form's order, and only a changed box the viewer may change is sent", () => {
  assert.deepEqual(linkEntriesOf(ROW).map((entry) => entry.module), ["editing", "photos", "album"]);
  assert.deepEqual(linkChanges(linkEntriesOf(ROW), { editing: true, photos: true, album: false }), { editing: true });
  // Photo Selection is read only here: unticking it on screen sends nothing for it.
  assert.deepEqual(linkChanges(linkEntriesOf(ROW), { editing: false, photos: false, album: true }), { album: true });
  assert.deepEqual(linkChanges(linkEntriesOf(ROW), { editing: false, photos: true, album: false }), {});
});

test("a save that changed links says which, and that an unlinked project is kept", () => {
  assert.equal(linkChangesText({ linked: ["editing", "album"], unlinked: [], created: [{ module: "album", projectCode: "DBS-VCSA-000003" }] }), "Linked AI Editing, Signature Album DBS-VCSA-000003 (new project).");
  assert.equal(linkChangesText({ linked: [], unlinked: ["photos"], created: [] }), "Unlinked Photo Selection - its project is kept.");
  assert.equal(linkChangesText(null), "");
});

test("Edit Project draws the boxes from the row and sends the changes with the name", () => {
  const form = read("src/components/image-selection/CreateImageSelectionProject.js");
  assert.match(form, /const linkEntries = editing \? linkEntriesOf\(project\) : \[\];/);
  assert.match(form, /disabled=\{busy \|\| !entry\.canChange\}/);
  assert.match(form, /const links = linkChanges\(linkEntries, ticks\);/);
  assert.match(form, /onSave\(\{ projectName, \.\.\.payload, \.\.\.\(Object\.keys\(links\)\.length \? \{ links \} : \{\}\) \}\)/);
  // A client's link stops an unlink: the form offers that module's project to unpublish it in.
  assert.match(form, /details\?\.code === "CLIENT_LINK_ACTIVE"/);
  assert.match(form, /href=\{stageProjectsHref\(blockedModule, \{ projectId: project\.id \}\)\}/);
  assert.match(read("src/components/image-selection/stage-dashboard/ProjectModuleLinks.js"), /\{LINKED_MODULES_NOTE\}/);
  assert.equal(LINKED_MODULES_NOTE, "Projects created or linked in other modules. Images can be transferred only to active linked projects.");
});

test("a send is offered only between linked modules", () => {
  const workspace = read("src/components/image-selection/ImageSelectionProjectWorkspace.js");
  assert.match(workspace, /const linkedTo = \(source, destination\) => hasTab\(destination\) && modulesLinked\(project, source, destination\);/);
  assert.match(workspace, /canSendToEditing=\{linkedTo\("culling", "editing"\) && editingAccess\.canWrite\}/);
  assert.match(workspace, /canSendToAlbum=\{linkedTo\("culling", "album"\) && albumAccess\.canWrite\}/);
  assert.match(workspace, /canSyncEditsToAlbum=\{linkedTo\("editing", "album"\)\}/);
  assert.match(workspace, /canSendToAlbum=\{linkedTo\("editing", "album"\) && albumAccess\.canWrite\}/);
  assert.match(read("src/components/image-selection/culling/CullingKeepsActions.js"), /const canSendToEditingAlbum = canSendToEditing && canSendToAlbum && canSyncEditsToAlbum;/);
});
