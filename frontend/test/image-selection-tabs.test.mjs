import test from "node:test";
import assert from "node:assert/strict";

import { WORKSPACE_TABS, linkedWorkspaceTabIds, tabShoots } from "../src/lib/imageSelectionTabs.mjs";

// One allocated service as `GET /allocated-services` answers it: `selectable` is the backend's
// Selection Items rule (allocated, master answers Yes, not one of the three tab services).
const service = (name, { enabled = true, selectable = false, shoots = [] } = {}) => ({ key: name.toLowerCase().replace(/[^a-z0-9]/g, ""), name, imageSelectionEnabled: enabled, selectable, shoots });
const wedding = { id: "s1", shootId: "DBS-SID-1", shoot: "Wedding" };
const engagement = { id: "s2", shootId: "DBS-SID-2", shoot: "Engagement" };

test("no deliverables: AI Culling and AI Editing, in that order", () => {
  assert.deepEqual(linkedWorkspaceTabIds([]), ["culling", "editing"]);
});

test("the tabs are the flow: cull, edit, select, album", () => {
  assert.deepEqual(WORKSPACE_TABS.map((tab) => tab.id), ["culling", "editing", "photos", "album"]);
  assert.deepEqual(WORKSPACE_TABS.map((tab) => tab.label), ["AI Culling", "AI Editing", "Photo Selection", "Signature Album"]);
  // The rename is a label: the deliverable the table holds is still "Photo Culling", and both spellings match.
  assert.equal(WORKSPACE_TABS[0].deliverableName, "Photo Culling");
  assert.deepEqual(tabShoots([service("AI Culling", { shoots: [wedding] })], "culling"), [wedding]);
});

test("a deliverable answered Yes and allocated to this project earns Photo Selection", () => {
  assert.deepEqual(linkedWorkspaceTabIds([service("Retouches", { selectable: true })]), ["culling", "editing", "photos"]);
  assert.deepEqual(linkedWorkspaceTabIds([service("Retouches", { selectable: true }), service("Frames", { selectable: true })]), ["culling", "editing", "photos"]);
  // Retouches + Painting (No): Retouches is enough.
  assert.deepEqual(linkedWorkspaceTabIds([service("Retouches", { selectable: true }), service("Painting", { enabled: false })]), ["culling", "editing", "photos"]);
});

test("a deliverable answered No earns nothing, and Photo Culling stays", () => {
  assert.deepEqual(linkedWorkspaceTabIds([service("Painting", { enabled: false })]), ["culling", "editing"]);
  // A Photo Selection service allocated with no selection items is no longer a tab on its own.
  assert.deepEqual(linkedWorkspaceTabIds([service("Photo Selection")]), ["culling", "editing"]);
});

test("Signature Album is earned exactly as before, and never by Photo Selection", () => {
  assert.deepEqual(linkedWorkspaceTabIds([service("Retouches", { selectable: true })]).includes("album"), false);
  assert.deepEqual(linkedWorkspaceTabIds([service("Signature Album (Soft Copy)")]), ["culling", "editing", "album"]);
  assert.deepEqual(linkedWorkspaceTabIds([service("Signature Album", { enabled: false })]), ["culling", "editing"]);
  assert.deepEqual(linkedWorkspaceTabIds([service("Signature Album", { enabled: null })]), ["culling", "editing"], "never answered keeps it off");
});

test("a tab allocated to shoots shows those shoots; without that allocation it shows them all", () => {
  const services = [service("Photo Culling", { shoots: [wedding] }), service("Retouches", { selectable: true, shoots: [wedding, engagement] }), service("Signature Album", { shoots: [engagement] })];
  assert.deepEqual(tabShoots(services, "culling"), [wedding]);
  assert.deepEqual(tabShoots(services, "album"), [engagement]);
  assert.equal(tabShoots(services, "photos"), null, "no Photo Selection allocation: every shoot folder");
  assert.equal(tabShoots([service("Retouches", { selectable: true })], "culling"), null);
  // Allocated but not answered Yes counts as not allocated, as it always did.
  assert.equal(tabShoots([service("Photo Culling", { enabled: false, shoots: [wedding] })], "culling"), null);
});

test("a shoot sold no Photo Selection is on none of the three tabs - AI Culling and AI Editing follow Photo Selection", () => {
  const haldi = { id: "s3", shootId: "DBS-SID-3", shoot: "Haldi + Bride Haldi" };
  // Photo Selection is allocated to the Wedding and the Engagement; the Haldi was added with no deliverables.
  const services = [service("Photo Selection", { shoots: [wedding, engagement] }), service("Retouches", { selectable: true, shoots: [wedding, engagement] })];
  for (const tab of ["culling", "editing", "photos"]) {
    const shoots = tabShoots(services, tab);
    assert.deepEqual(shoots.map((shoot) => shoot.id), ["s1", "s2"], `${tab}: the Photo Selection shoots`);
    assert.equal(shoots.some((shoot) => shoot.id === haldi.id), false, `${tab}: the Haldi is not shown`);
  }
  // Allocate Photo Selection to the Haldi in Project Management and it is on all three.
  const allocated = [service("Photo Selection", { shoots: [wedding, engagement, haldi] })];
  for (const tab of ["culling", "editing", "photos"]) assert.ok(tabShoots(allocated, tab).some((shoot) => shoot.id === haldi.id));
});

test("a tab's own allocation still decides it, and with no Photo Selection anywhere every shoot shows as before", () => {
  const services = [service("Photo Culling", { shoots: [engagement] }), service("Photo Selection", { shoots: [wedding] })];
  assert.deepEqual(tabShoots(services, "culling"), [engagement], "AI Culling allocated to a shoot shows that shoot");
  assert.deepEqual(tabShoots(services, "editing"), [wedding], "AI Editing allocated nowhere follows Photo Selection");
  assert.equal(tabShoots([], "culling"), null);
  assert.equal(tabShoots([service("Retouches", { selectable: true, shoots: [wedding] })], "editing"), null);
  // Photo Selection allocated but answered No counts as not allocated, as for every tab.
  assert.equal(tabShoots([service("Photo Selection", { enabled: false, shoots: [wedding] })], "culling"), null);
});
