import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { ALL_SCENES, activeScene, sceneLabel, sceneOptions, sceneQuery } from "../src/lib/clientGalleryScenes.mjs";
import { CULLING_ALL_SCENES } from "../src/lib/imageSelectionCulling.mjs";

/*
 * The client gallery's Scene filter: one compact "All scenes" switch on the People tab that opens
 * to a row per scene the culling run read in the shoot's photos, each with its count, and narrows
 * the same grid. These pin what is decided without the DOM, and that the screen is wired to the
 * same rows, the same switch and the same listing the rest of the gallery already uses.
 */

const SCENES = [{ id: "GROOM_PORTRAIT", label: "Groom portrait", count: 1 }, { id: "FAMILY", label: "Family", count: 8 }, { id: "DETAILS", label: "Details", count: 12 }];

test("the rows are the culling review's own: All scenes, then each scene with its count, in the server's order", () => {
  assert.equal(ALL_SCENES, CULLING_ALL_SCENES, "one value for 'every scene' across the review and the gallery");
  assert.deepEqual(sceneOptions(SCENES), [
    { value: ALL_SCENES, label: "All scenes" },
    { value: "GROOM_PORTRAIT", label: "Groom portrait · 1" },
    { value: "FAMILY", label: "Family · 8" },
    { value: "DETAILS", label: "Details · 12" },
  ]);
  assert.deepEqual(sceneOptions([]), [], "no rows at all when the shoot's photos were never culled - the switch is absent, not empty");
});

test("a scene the re-counted list no longer holds reads as all scenes, never as an empty grid under a missing row", () => {
  assert.equal(activeScene("FAMILY", SCENES), "FAMILY");
  assert.equal(activeScene(ALL_SCENES, SCENES), ALL_SCENES);
  assert.equal(activeScene(undefined, SCENES), ALL_SCENES);
  assert.equal(activeScene("CEREMONY", SCENES), ALL_SCENES, "chosen for the shoot, then gone once the chosen people narrowed it to none");
  assert.equal(activeScene("FAMILY", []), ALL_SCENES);
});

test("the listing is asked for nothing under all scenes and for the id otherwise", () => {
  assert.equal(sceneQuery(ALL_SCENES, SCENES), undefined);
  assert.equal(sceneQuery("FAMILY", SCENES), "FAMILY");
  assert.equal(sceneQuery("CEREMONY", SCENES), undefined);
  assert.equal(sceneLabel("FAMILY", SCENES), "Family");
  assert.equal(sceneLabel(ALL_SCENES, SCENES), "");
});

const HERE = import.meta.dirname;
const src = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");
const PANEL = src("components", "image-selection", "client-gallery", "PeoplePanel.js");
const CARDS = src("components", "image-selection", "client-gallery", "FolderCards.js");
const GALLERY = src("components", "image-selection", "PublicGallery.js");
const SERVICE = src("services", "image-selection", "public-gallery.service.js");
const DROPDOWN = src("components", "shared", "Dropdown.js");

test("the People tab draws the shared switch, unsorted, and only when there is a scene to offer", () => {
  assert.match(PANEL, /import Dropdown from "@\/components\/shared\/Dropdown";/, "the culling review's own control, not a menu of its own");
  assert.match(PANEL, /\{sceneRows\.length > 0 && \(/, "no scene, no switch");
  assert.match(PANEL, /<Dropdown ariaLabel=\{filtering && personLabel \? `Scene, in the photos of \$\{personLabel\}` : "Scene"\} mode="switch" options=\{sceneRows\} value=\{scene\} sorted=\{false\} onChange=\{onSceneChange\} \/>/, "rows in the profile's order, never alphabetised, and named for the people it counts");
  assert.match(PANEL, /<p role="status" aria-live="polite"/, "the count is announced as the filters change");
  assert.match(PANEL, /<Button variant="secondary" size="sm" onClick=\{\(\) => onSceneChange\?\.\(ALL_SCENES\)\}>Show all scenes<\/Button>/, "an empty scene offers the way back where the client is looking");
  assert.match(PANEL, /resetKey: `\$\{activePersonIds\.join\(","\)\}\|\$\{scene\}`/, "a new scene starts the infinite scroll's page count again, as a new person does");
  assert.match(CARDS, /scenes=\{people\.scenes\}/, "the cards pass the filter through to the panel");
});

test("the gallery counts the scenes for the chosen people and asks the same listing for the scene", () => {
  assert.match(GALLERY, /loadScenes\(activePersonIds, activeFolderGroupId \|\| undefined\)/, "re-counted whenever the people or the shoot change");
  assert.match(GALLERY, /loadPeoplePhotos\(activePersonIds, 1, activeFolderGroupId \|\| undefined, peopleSceneId\)/, "the grid's own request, one more condition on it");
  assert.match(GALLERY, /loadPeoplePhotos\(activePersonIds, peoplePhotos\.page \+ 1, activeFolderGroupId \|\| undefined, peopleSceneId\)/, "and the next page under the same scene");
  assert.match(GALLERY, /const next = activeScene\(current, list\);\n\s+if \(next !== current\) \{[\s\S]*?chooseScene\(next\);\n\s+setError\(/, "a scene the new count leaves out comes off, and the notice says so");
  assert.match(GALLERY, /setScenes\(list\);\n\s+setScenesProcessing\([^\n]*\n\s+\} catch \{ \/\*[^*]*\*\/ \}/, "a count that cannot be read keeps the rows and the chosen scene");
  assert.match(GALLERY, /peopleKnown\.current\.clear\(\);\n\s+\/\/[^\n]*\n\s+chooseScene\(ALL_SCENES\);/, "another shoot starts from all of its scenes");
  assert.match(SERVICE, /export function listGalleryScenes\(token, sessionToken, \{ folderGroupId, personId \} = \{\}\)/);
  assert.match(SERVICE, /\.\.\.\(sceneId \? \{ sceneId \} : \{\}\)/, "the listing carries the scene only when one is chosen");
});

test("while photos are still being read for their scene, the tab says so and asks again", () => {
  assert.match(GALLERY, /setScenesProcessing\(Boolean\(response\.data\?\.processing\)\)/);
  assert.match(GALLERY, /if \(!scenesProcessing \|\| homeTab !== "people" \|\| activeFolderId\) return undefined;\n\s+const timer = setTimeout\(\(\) => loadScenes\(activePersonIds, activeFolderGroupId \|\| undefined\), SCENES_POLL_MS\);/, "asked again only while there is more to come, and only on the tab");
  assert.match(PANEL, /\{scenesProcessing && <p className=\{`text-xs text-slate-400 [^`]*`\}>Organizing scenes\.\.\.<\/p>\}/);
});

test("the switch's arrow turns with the list", () => {
  assert.match(DROPDOWN, /<ChevronIcon direction=\{open \? "up" : "down"\} size=\{isInput \? 20 : compact \? 18 : 24\}/);
});
