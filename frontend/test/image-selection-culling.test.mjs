import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { CULLING_ALL_SCENES, CULLING_FILTERS, CULLING_MODES, cullingConfidenceLabel, cullingCoverageLine, cullingGroupTasteLabel, cullingCoverageMissing, cullingFilterCount, cullingPreferenceFeatureLabel, cullingPreferenceSummary, CULLING_PREFERENCE_PRIVACY, CULLING_FINALIZE_ASSURANCES, cullingFinalizeMessage, cullingKeyIgnored, cullingModeSummary, cullingNewPhotosNotice, cullingProgressPercent, cullingRankLabel, cullingReasonLabel, cullingSceneHint, cullingSceneLabel, cullingSceneOptions, cullingStageLabel, cullingStartAvailability, cullingStatusLabel, cullingTargetValidity, cullingWaitingForDesktop, isCullingSessionActive, cullingPreferenceHasLearning, CULLING_PREFERENCE_BURST_POLICY } from "../src/lib/imageSelectionCulling.mjs";

const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");

// The Photo Culling tab renders entirely from this little state machine, so it is pinned here the
// way the folder-tree helpers are: the intro panel's Start button and its explanation line read
// the same answer, and a progress bar can never be handed a width outside 0-100.

test("only statuses a run can move out of count as active", () => {
  for (const status of ["QUEUED", "ANALYZING", "GROUPING", "RANKING"]) {
    assert.equal(isCullingSessionActive({ status }), true);
  }
  for (const status of ["REVIEW_READY", "FINALIZED", "FAILED", "CANCELLED"]) {
    assert.equal(isCullingSessionActive({ status }), false);
  }
  assert.equal(isCullingSessionActive(null), false);
});

test("start availability explains each refusal and allows the happy path", () => {
  assert.equal(cullingStartAvailability({ enabled: false, session: null, readyCount: 5, canWrite: true }).canStart, false);
  assert.match(cullingStartAvailability({ enabled: false, session: null, readyCount: 5, canWrite: true }).reason, /disabled/);
  assert.match(cullingStartAvailability({ enabled: true, session: { status: "ANALYZING" }, readyCount: 5, canWrite: true }).reason, /already in progress/);
  assert.match(cullingStartAvailability({ enabled: true, session: null, readyCount: 5, canWrite: false }).reason, /read-only/);
  assert.match(cullingStartAvailability({ enabled: true, session: null, readyCount: 0, canWrite: true }).reason, /at least one image/);
  // A finished run does not block a new one — only an active one does.
  assert.deepEqual(cullingStartAvailability({ enabled: true, session: { status: "REVIEW_READY" }, readyCount: 5, canWrite: true }), { canStart: true, reason: null });
});

test("progress percent is clamped and never NaN", () => {
  assert.equal(cullingProgressPercent({ progressPercent: 47 }), 47);
  assert.equal(cullingProgressPercent({ progressPercent: 250 }), 100);
  assert.equal(cullingProgressPercent({ progressPercent: -3 }), 0);
  assert.equal(cullingProgressPercent({ progressPercent: "nope" }), 0);
  assert.equal(cullingProgressPercent(null), 0);
});

test("the mode picker offers every live mode, and only Target count demands a number", () => {
  assert.deepEqual(CULLING_MODES.map((mode) => mode.id), ["ASSISTED", "BALANCED", "STRICT", "TARGET_COUNT"]);
  assert.ok(CULLING_MODES.every((mode) => mode.label && mode.description));
  assert.deepEqual(CULLING_MODES.filter((mode) => mode.needsTarget).map((mode) => mode.id), ["TARGET_COUNT"]);
});

test("target validity mirrors the backend's rules: required, integral, and below the photo count", () => {
  assert.equal(cullingTargetValidity("BALANCED", "", 100).valid, true);
  assert.equal(cullingTargetValidity("TARGET_COUNT", "", 100).valid, false);
  assert.equal(cullingTargetValidity("TARGET_COUNT", "0", 100).valid, false);
  assert.equal(cullingTargetValidity("TARGET_COUNT", "2.5", 100).valid, false);
  assert.equal(cullingTargetValidity("TARGET_COUNT", "100", 100).valid, false);
  assert.equal(cullingTargetValidity("TARGET_COUNT", "99", 100).valid, true);
});

test("filter chips count from the right source: decisions from the session, facets from the overview", () => {
  const session = { totalImages: 100, keepCount: 60, maybeCount: 10, rejectCount: 25 };
  const filterCounts = { low_confidence: 7, duplicates: 12 };
  assert.equal(cullingFilterCount("all", session, filterCounts), 100);
  assert.equal(cullingFilterCount("keep", session, filterCounts), 60);
  assert.equal(cullingFilterCount("pending", session, filterCounts), 5);
  assert.equal(cullingFilterCount("low_confidence", session, filterCounts), 7);
  assert.equal(cullingFilterCount("blur", session, filterCounts), null, "an uncounted facet shows no number, never zero");
  assert.equal(cullingFilterCount("all", null, filterCounts), null);
  // Every declared filter id resolves to something renderable.
  for (const filter of CULLING_FILTERS) assert.notEqual(cullingFilterCount(filter.id, session, filterCounts), undefined);
});

test("reason codes render as words and unknown codes fall back to themselves", () => {
  assert.equal(cullingReasonLabel("PRIMARY_SUBJECT_BLINK"), "Subject blink");
  assert.equal(cullingReasonLabel("BEST_IN_BURST"), "Best of burst");
  assert.equal(cullingReasonLabel("SOMETHING_NEW"), "SOMETHING_NEW");
});

test("labels fall back to the raw value rather than an empty badge", () => {
  assert.equal(cullingStatusLabel("REVIEW_READY"), "Review ready");
  assert.equal(cullingStatusLabel("SOMETHING_NEW"), "SOMETHING_NEW");
  assert.equal(cullingStageLabel("PREPARING"), "Preparing photos");
  assert.equal(cullingStageLabel(null), "");
});

// ---------------------------------------------------------------------------
// V2 phase 1 — the review surface stops stealing keys, works without a mouse hover, and says
// what the numbers mean
// ---------------------------------------------------------------------------
test("review shortcuts stay out of form controls and modifier chords, and only a button's own Enter/Space are left to it", () => {
  const plain = { ctrlKey: false, metaKey: false, altKey: false, key: "1" };
  for (const tagName of ["INPUT", "SELECT", "TEXTAREA"]) assert.equal(cullingKeyIgnored({ tagName, isContentEditable: false }, plain), true, tagName);
  assert.equal(cullingKeyIgnored({ tagName: "DIV", isContentEditable: true }, plain), true);
  assert.equal(cullingKeyIgnored({ tagName: "DIV", isContentEditable: false }, plain), false);
  assert.equal(cullingKeyIgnored({ tagName: "DIV", isContentEditable: false }, { ...plain, ctrlKey: true }), true);
  assert.equal(cullingKeyIgnored({ tagName: "DIV", isContentEditable: false }, { ...plain, metaKey: true }), true);
  // Focus stays on a button after a click: digits and arrows must keep working from there.
  for (const tagName of ["BUTTON", "A"]) {
    assert.equal(cullingKeyIgnored({ tagName, isContentEditable: false }, plain), false, `${tagName} + digit`);
    assert.equal(cullingKeyIgnored({ tagName, isContentEditable: false }, { ...plain, key: "ArrowRight" }), false);
    assert.equal(cullingKeyIgnored({ tagName, isContentEditable: false }, { ...plain, key: "Enter" }), true, `${tagName} + Enter activates the button`);
    assert.equal(cullingKeyIgnored({ tagName, isContentEditable: false }, { ...plain, key: " " }), true);
  }
  // Custom widgets and anything inside another dialog are theirs, not the grid's.
  assert.equal(cullingKeyIgnored({ tagName: "DIV", isContentEditable: false, getAttribute: () => "combobox" }, plain), true);
  assert.equal(cullingKeyIgnored({ tagName: "DIV", isContentEditable: false, closest: (selector) => (selector === '[role="dialog"]:not([data-culling-keys])' ? {} : null) }, plain), true);
  assert.equal(cullingKeyIgnored(null, plain), false);
  // The culling preview lets the review's keys through: 1/2/3 decide the photo it shows.
  assert.equal(cullingKeyIgnored({ tagName: "DIV", isContentEditable: false, getAttribute: () => null, closest: (selector) => (selector === '[role="dialog"]:not([data-culling-keys])' ? null : {}) }, plain), false);
});

test("the finalize confirmation spells out what Assisted mode hides, with the numbers", () => {
  const assisted = { mode: "ASSISTED", totalImages: 10, keepCount: 3, maybeCount: 0, rejectCount: 0 };
  assert.match(cullingFinalizeMessage(assisted), /not marked Keep/);
  assert.match(cullingFinalizeMessage(assisted), /pending/i);
  assert.match(cullingFinalizeMessage(assisted), /7 of 10 photos will be hidden/);
  assert.match(cullingFinalizeMessage(assisted), /3 stay as Keep/);
  const balanced = { mode: "BALANCED", totalImages: 100, keepCount: 60, maybeCount: 10, rejectCount: 30 };
  assert.match(cullingFinalizeMessage(balanced), /40 of 100 photos will be hidden/);
  assert.match(cullingFinalizeMessage(balanced), /60 stay as Keep/);
  // What finalizing never does is listed under the figures, once.
  assert.ok(CULLING_FINALIZE_ASSURANCES.some((line) => /Nothing is deleted/.test(line)));
  assert.ok(CULLING_FINALIZE_ASSURANCES.some((line) => /Your own decisions count/.test(line)));
  assert.match(cullingFinalizeMessage({ ...balanced, keepCount: 60, maybeCount: 10, rejectCount: 30 }), /10 of the hidden are Maybe or still pending/);
});

test("photos processed after the run are reported, never silently absorbed", () => {
  assert.equal(cullingNewPhotosNotice(0, "REVIEW_READY"), null);
  assert.match(cullingNewPhotosNotice(1, "REVIEW_READY"), /^1 photo was added after this run started and is not included/);
  assert.match(cullingNewPhotosNotice(12, "REVIEW_READY"), /^12 photos were added after this run started and are not included/);
  assert.match(cullingNewPhotosNotice(12, "REVIEW_READY"), /Finalizing leaves them visible/);
  assert.match(cullingNewPhotosNotice(12, "FINALIZED"), /They are still visible in Photo Selection/);
  assert.match(cullingNewPhotosNotice(1, "FINALIZED"), /It is still visible/);
});

test("the header names the mode, with the target when there is one, and confidence reads as a percentage", () => {
  assert.equal(cullingModeSummary({ mode: "BALANCED" }), "Balanced");
  assert.equal(cullingModeSummary({ mode: "TARGET_COUNT", targetCount: 600 }), "Target count · aiming for 600");
  assert.equal(cullingModeSummary({ mode: "SOMETHING_NEW" }), "", "never a raw enum on screen");
  assert.equal(cullingConfidenceLabel(0.91), "91%");
  assert.equal(cullingConfidenceLabel(0), "0%");
  assert.equal(cullingConfidenceLabel(null), null);
});

test("the review gallery's controls do not depend on a mouse hover, and its keys consult the guard", () => {
  const gallery = read("components", "image-selection", "culling", "CullingReviewGallery.js");
  assert.doesNotMatch(gallery, /group-hover/, "touch users have no hover: decide buttons and checkboxes are always there");
  assert.match(gallery, /cullingKeyIgnored\(event\.target, event\)/);
  assert.match(gallery, /keysPaused/, "the workspace pauses the keys while its own dialog is open");
  assert.match(gallery, /<IconButton[^>]*ariaLabel=\{`Preview \$\{item\.upload\.fileName\}`\}/, "a visible preview control on every card");
  assert.match(gallery, /touch-manipulation/, "double-tap zoom never swallows the card's gestures");
  assert.doesNotMatch(gallery, /text-slate-400/, "no low-contrast text at tiny sizes");
  assert.match(gallery, /sr-only/, "the override marker has a text alternative");
  assert.match(gallery, /cullingConfidenceLabel\(item\.confidence\)/, "confidence is shown beside the score");
  assert.match(gallery, /item\.aiDecision/, "an override shows what the AI said");
});

test("the workspace tells its parent when a finalize or reopen settled, pauses polling while hidden, and reports late photos", () => {
  const workspace = read("components", "image-selection", "culling", "CullingWorkspace.js");
  const parent = read("components", "image-selection", "ImageSelectionProjectWorkspace.js");
  assert.match(workspace, /onSessionSettled\?\.\(\)/);
  assert.match(parent, /onSessionSettled=\{\(\) => setGalleryRevision\(\(value\) => value \+ 1\)\}/);
  assert.match(workspace, /document\.hidden/);
  assert.match(workspace, /visibilitychange/, "coming back to the tab refreshes at once");
  assert.match(workspace, /cullingNewPhotosNotice\(overview\.newPhotoCount, session\.status\)/);
  assert.match(workspace, /cullingFinalizeMessage\(session\)/);
  assert.match(workspace, /cullingModeSummary\(session\)/);
  assert.match(workspace, /keysPaused=\{Boolean\(confirmAction\)\}/);
});

test("a run the desktop app is analyzing is recognised, and the web offers to let the server finish it", () => {
  assert.equal(cullingWaitingForDesktop({ analysisSource: "DESKTOP", status: "QUEUED" }), true);
  assert.equal(cullingWaitingForDesktop({ analysisSource: "DESKTOP", status: "ANALYZING" }), false);
  assert.equal(cullingWaitingForDesktop({ analysisSource: "DESKTOP", status: "QUEUED", startedAt: "2026-10-02T10:00:00Z" }), false, "handed over: the server has it, whatever the queue says");
  assert.equal(cullingWaitingForDesktop({ analysisSource: "SERVER", status: "QUEUED" }), false);
  assert.equal(cullingWaitingForDesktop(null), false);
  const workspace = read("components", "image-selection", "culling", "CullingWorkspace.js");
  assert.match(workspace, /cullingWaitingForDesktop\(session\)/);
  assert.match(workspace, /Let the server finish/);
  assert.match(read("services", "image-selection", "image-selection.service.js"), /ai-culling\/sessions\/\$\{encodeURIComponent\(sessionId\)\}\/run/);
});

test("there are no people roles to give: the badges speak of the photo, not of a person's label", () => {
  const lib = read("lib", "imageSelectionCulling.mjs");
  assert.doesNotMatch(lib, /CULLING_ROLES|CULLING_ROLE_OPTIONS|cullingRoleLabel|cullingRoleFromOption/, "the role vocabulary is gone from the screens");
  assert.equal(cullingReasonLabel("KEY_PEOPLE_PRESENT"), "Clear main subject");
  assert.equal(cullingReasonLabel("IMPORTANT_SUBJECT_BLINK"), "Main face's eyes closed");
  assert.doesNotMatch(read("services", "image-selection", "image-selection.service.js"), /setCullingPersonRole/, "nothing on the web sets a role any more");
});

test("AI Culling shows no People section: the strip, its loader and the staff avatar loader are gone", () => {
  const dir = path.join(import.meta.dirname, "..", "src", "components", "image-selection", "culling");
  assert.equal(fs.existsSync(path.join(dir, "CullingPeopleStrip.js")), false);
  assert.doesNotMatch(read("components", "image-selection", "culling", "CullingWorkspace.js"), /CullingPeopleStrip|People in these photos/);
  assert.doesNotMatch(read("services", "image-selection", "image-selection.service.js"), /getCullingPeople/);
  assert.doesNotMatch(read("components", "image-selection", "client-gallery", "FaceAvatar.js"), /loadImage/, "the client gallery's avatar is back to its one loader");
  assert.equal(cullingStageLabel("SUBJECTS"), "Who is in each photo");
});

test("the compare dialog shows where each frame ranks in its group, best first", () => {
  const dialog = read("components", "image-selection", "culling", "CullingGroupCompareDialog.js");
  assert.match(dialog, /member\.rank/, "the rank the server sends is shown");
  assert.match(dialog, /cullingRankLabel\(member\.rank, group\.memberCount\)/);
  assert.doesNotMatch(dialog, /AI best/, "the star means the best frame, whoever chose it");
  // Culling V2: the basis is the balanced keeper merit, said on screen through the shared wording.
  assert.match(dialog, /description=\{CULLING_GROUP_RANKING\[group\?\.type\]/, "the basis of the rank is said on screen, not only on hover");
  assert.doesNotMatch(dialog, /text-\[10px\][^"]*"[^>]*title="Rank in this group/, "the chip is not below the readable floor");
  assert.equal(cullingRankLabel(1, 5), "#1 of 5");
  assert.equal(cullingRankLabel(null, 5), "");
});

test("the review speaks in scenes: a picker of the run's scenes, the scene on each card, and the two new reasons", () => {
  const scenes = [{ id: "CEREMONY", label: "Ceremony", count: 48 }, { id: "KIDS", label: "Kids and newborn", count: 40 }];
  assert.deepEqual(cullingSceneOptions(scenes), [{ value: CULLING_ALL_SCENES, label: "All scenes" }, { value: "CEREMONY", label: "Ceremony · 48" }, { value: "KIDS", label: "Kids and newborn · 40" }]);
  assert.deepEqual(cullingSceneOptions([]), []);
  assert.equal(cullingSceneLabel("KIDS", scenes), "Kids and newborn");
  assert.equal(cullingSceneLabel("KIDS", scenes, 0.82), "Kids and newborn");
  assert.equal(cullingSceneLabel("KIDS", scenes, 0.3), "", "an unsure guess is not shown");
  assert.equal(cullingSceneLabel("OLD_SCENE", scenes), "");
  assert.equal(cullingSceneLabel(null, scenes), "");
  assert.equal(cullingSceneHint(0.82), "The AI's guess · 82% sure");
  assert.equal(cullingReasonLabel("WELL_COMPOSED"), "Well composed");
  assert.equal(cullingReasonLabel("STRIKING_LOOK"), "Striking look");
  assert.equal(CULLING_FILTERS.find((entry) => entry.id === "accidental").label, "Likely accidental");
  for (const id of ["accidental", "cut_faces"]) assert.ok(CULLING_FILTERS.find((entry) => entry.id === id).hint, `${id} explains itself`);
  assert.equal(cullingReasonLabel("ACCIDENTAL_FRAME"), "Accidental frame");
  assert.equal(cullingReasonLabel("FACE_CUT_OFF"), "Face cut off");
  assert.ok(CULLING_FILTERS.some((entry) => entry.id === "accidental") && CULLING_FILTERS.some((entry) => entry.id === "cut_faces"));
  const gallery = read("components", "image-selection", "culling", "CullingReviewGallery.js");
  assert.match(gallery, /<Dropdown[\s\S]{0,80}ariaLabel="Scene \(AI's guess\)"/, "the scene picker is the shared Dropdown and says whose guess it is");
  assert.match(gallery, /cullingSceneLabel\(item\.sceneLabel, scenes, item\.sceneConfidence\)/);
  assert.match(gallery, /scene: activeScene === CULLING_ALL_SCENES \? undefined : activeScene/);
  assert.match(read("components", "image-selection", "culling", "CullingWorkspace.js"), /scenes=\{overview\.scenes \|\| \[\]\}/);
  assert.match(read("services", "image-selection", "image-selection.service.js"), /if \(scene\) query\.set\("scene", scene\)/);
});

test("the preview button sits on the photo, never over the card's decide buttons", () => {
  const gallery = read("components", "image-selection", "culling", "CullingReviewGallery.js");
  const photo = gallery.slice(gallery.indexOf('<div className="relative">'), gallery.indexOf("</div>", gallery.indexOf('<div className="relative">')));
  assert.match(photo, /GalleryLazyImage/);
  assert.match(photo, /ariaLabel=\{`Preview \$\{item\.upload\.fileName\}`\}/, "the button is inside the photo's own box");
});

test("the review gallery gives a way out of an empty result, explains its chips and uses the shared controls", () => {
  const gallery = read("components", "image-selection", "culling", "CullingReviewGallery.js");
  assert.match(gallery, /Show all scenes/, "an empty scene result offers the way back");
  assert.match(gallery, /title=\{entry\.hint/, "a chip's hint is its title");
  assert.match(gallery, /title=\{cullingSceneHint\(item\.sceneConfidence\)\}/);
  assert.doesNotMatch(gallery, /<select/, "the sort is the shared Dropdown too");
  assert.doesNotMatch(gallery, /className="w-44"/, "no fixed-width picker");
  assert.match(gallery, /const activeScene = /, "a scene that left the run falls back to all scenes");
});

test("the workspace says how much of the story the Keeps cover, and what is missing", () => {
  const coverage = { moments: { total: 10, kept: 9, missing: [{ id: "DECOR", label: "Decor" }] }, keyPeople: { total: 3, kept: 3 } };
  // "Scenes", the word the review's Scene picker uses.
  assert.equal(cullingCoverageLine(coverage), "Your Keeps cover 9 of 10 scenes · 3 of 3 key people");
  assert.deepEqual(cullingCoverageMissing(coverage), [{ id: "DECOR", label: "Decor" }]);
  assert.equal(cullingCoverageLine({ moments: null, keyPeople: { total: 2, kept: 1 } }), "Your Keeps cover 1 of 2 key people");
  assert.equal(cullingCoverageLine({ moments: { total: 1, kept: 1, missing: [] }, keyPeople: { total: 0, kept: 0 } }), "Your Keeps cover 1 of 1 scene");
  assert.deepEqual(cullingCoverageMissing({ moments: { total: 2, kept: 2, missing: [] }, keyPeople: { total: 0, kept: 0 } }), []);
  assert.equal(cullingCoverageLine(null), "");
  assert.equal(cullingReasonLabel("COVERS_PERSON"), "Keeps a key person");
  assert.equal(cullingReasonLabel("COVERS_SCENE"), "Covers a moment");
  assert.equal(cullingReasonLabel("UNIQUE_FRAME"), "Covers this hour");
  const workspace = read("components", "image-selection", "culling", "CullingWorkspace.js");
  assert.match(workspace, /cullingCoverageLine\(overview\.coverage\)/);
  assert.match(workspace, /No Keep yet in:/);
  assert.match(workspace, /onClick=\{\(\) => setReviewScene\(scene\.id\)\}/, "a missing scene opens the review on that scene");
  assert.match(workspace, /<CullingReviewGallery[\s\S]*?scene=\{reviewScene\}[\s\S]*?onSceneChange=\{setReviewScene\}/);
  assert.doesNotMatch(workspace, /role="status">\s*\{cullingCoverageLine/, "a line that refreshes silently is not a live region");
  assert.match(workspace, /useEffect\(\(\) => \(\) => window\.clearTimeout\(coverageRefresh\.current\), \[load\]\)/, "a queued refresh dies with the project it was for");
  assert.match(workspace, /coverageRefresh\.current = window\.setTimeout\(load, COVERAGE_REFRESH_MS\)/, "a decision refreshes the coverage shortly after");
});

test("a control that owns its keys (a dropdown trigger) never hands digits to the decide shortcuts; the scene stage has a label", () => {
  assert.equal(cullingKeyIgnored({ tagName: "BUTTON", getAttribute: (name) => (name === "aria-haspopup" ? "listbox" : null) }, { key: "1" }), true);
  assert.equal(cullingKeyIgnored({ tagName: "BUTTON", getAttribute: () => null }, { key: "1" }), false);
  assert.equal(cullingStageLabel("SCENE"), "Scenes and framing");
});

test("the photographer sees what culling has learned from them, can switch it off and make it forget", () => {
  const scenes = [{ id: "CANDID", label: "Candid guests", count: 3 }];
  assert.equal(cullingPreferenceFeatureLabel({ kind: "code", id: "SOFT_FOCUS", weight: 4 }, scenes), "Soft focus — you keep these clearly more often");
  assert.equal(cullingPreferenceFeatureLabel({ kind: "scene", id: "CANDID", weight: -1.2 }, scenes), "Candid guests — you reject these a little more often");
  assert.equal(cullingPreferenceFeatureLabel({ kind: "scene", id: "OLD", weight: 2 }, []), "OLD — you keep these a little more often");
  // Culling V2: a trait learned in one kind of scene only, and the burst-winner taste.
  assert.equal(cullingPreferenceFeatureLabel({ kind: "context", id: "SOFT_FOCUS", scene: "CANDID", weight: 4 }, scenes), "Soft focus in Candid guests — you keep these clearly more often");
  assert.equal(cullingGroupTasteLabel({ choices: 12, weights: { technical: 0.25, eyes: 0.3, expression: 0.3, face: 0.15 } }), "Choosing the best of a group, you favour expression over sharpness (learned from 12 picks)");
  assert.equal(cullingGroupTasteLabel({ choices: 6, weights: { technical: 0.35, eyes: 0.3, expression: 0.2, face: 0.15 } }), "");
  assert.match(cullingPreferenceSummary({ decisions: 7, minimum: 20, enabled: true }), /20 corrections' worth of Keep and Reject changes \(a bulk change counts less\) — 7 so far, 13 to go\.$/);
  assert.match(cullingPreferenceSummary({ decisions: 7, minimum: 20, enabled: true, groupTaste: { choices: 5, weights: {} } }), /Your burst picks already count\.$/);
  assert.equal(cullingPreferenceHasLearning({ decisions: 0, minimum: 20 }), false);
  assert.equal(cullingPreferenceHasLearning({ decisions: 0, minimum: 20, groupTaste: { choices: 5, weights: {} } }), true);
  assert.match(CULLING_PREFERENCE_BURST_POLICY, /after five picks/);
  const webPanel = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "image-selection", "culling", "CullingPreferencePanel.js"), "utf8");
  assert.match(webPanel, /\{cullingPreferenceHasLearning\(preferences\) && <ToggleSwitch/, "the switch shows from the first correction or pick");
  assert.match(webPanel, /\{cullingGroupTasteLabel\(preferences\.groupTaste\) && \(/, "the burst line shows whenever a taste exists");
  assert.equal(cullingGroupTasteLabel(null), "");
  assert.match(read("components", "image-selection", "culling", "CullingPreferencePanel.js"), /cullingGroupTasteLabel\(preferences\.groupTaste\)/);
  assert.match(cullingPreferenceSummary({ decisions: 7, minimum: 20, enabled: true }), /after 20 corrections' worth of Keep and Reject changes \(a bulk change counts less\) — 7 so far, 13 to go/);
  assert.match(cullingPreferenceSummary({ decisions: 134, minimum: 20, enabled: true }), /Learned from 134 corrections' worth of your Keep and Reject changes/);
  assert.match(cullingPreferenceSummary({ decisions: 134, minimum: 20, enabled: false }), /still learning.*do not use it/i);
  assert.match(CULLING_PREFERENCE_PRIVACY, /Private to you/);
  assert.match(CULLING_PREFERENCE_PRIVACY, /a few points at most/);
  assert.equal(cullingReasonLabel("TASTE_UP"), "You usually keep these");
  assert.equal(cullingReasonLabel("TASTE_DOWN"), "You usually reject these");
  // The three ways the desktop app can fail to open an original, as the badge says them.
  assert.equal(cullingReasonLabel("LOCAL_SOURCE_UNAVAILABLE"), "Original unavailable on workstation");
  assert.equal(cullingReasonLabel("LOCAL_SOURCE_CHANGED"), "Original changed since it was added");
  assert.equal(cullingReasonLabel("LOCAL_SOURCE_UNREADABLE"), "Original could not be decoded");
  const panel = read("components", "image-selection", "culling", "CullingPreferencePanel.js");
  assert.match(panel, /getCullingPreferences\(projectId\)/);
  assert.match(panel, /setCullingPreferencesEnabled\(projectId, /);
  assert.match(panel, /resetCullingPreferences\(projectId\)/);
  assert.match(panel, /<ToggleSwitch/);
  assert.match(panel, /<ConfirmDialog/);
  assert.match(panel, /if \(!canWrite/, "only someone who decides has preferences to see");
  assert.match(panel, /CULLING_PREFERENCE_PRIVACY/);
  assert.match(panel, /confirmLabel="Forget what it learned"/);
  assert.match(panel, /a run you already started keeps its numbers/i);
  assert.match(panel, /className="min-h-10"/, "a thumb-sized switch");
  assert.doesNotMatch(panel, /className="truncate"/, "a learned trait is never cut mid-sentence");
  const workspaceSource = read("components", "image-selection", "culling", "CullingWorkspace.js");
  assert.ok(workspaceSource.indexOf("<CullingPreferencePanel") > workspaceSource.indexOf("<CullingReviewGallery"), "the personal panel sits below the review, the main task");
  assert.match(read("components", "image-selection", "culling", "CullingWorkspace.js"), /<CullingPreferencePanel projectId=\{projectId\} canWrite=\{canWrite\}/);
  const service = read("services", "image-selection", "image-selection.service.js");
  assert.match(service, /cullingPath\(projectId\)\}\/preferences`\)/);
  assert.match(service, /\/preferences\/reset`, \{ method: "POST" \}/);
});

test("a shoot (root) folder's setup shows no AI culling mode cards; a card folder keeps them, and Start stays", () => {
  const workspace = read("components", "image-selection", "culling", "CullingWorkspace.js");
  assert.match(workspace, /shootFolder = false/);
  assert.match(workspace, /\{!shootFolder && <>\s*<p[^>]*>AI culling mode<\/p>\s*<ChoiceCards ariaLabel="Culling mode"/);
  assert.match(workspace, /\{!shootFolder && mode === "TARGET_COUNT" && \(/);
  assert.match(workspace, /onClick=\{start\}/, "the Start button is outside the hidden part");
  assert.match(read("components", "image-selection", "ImageSelectionProjectWorkspace.js"), /shootFolder=\{Boolean\(currentFolder && !currentFolder\.parentId\)\}/);
});
