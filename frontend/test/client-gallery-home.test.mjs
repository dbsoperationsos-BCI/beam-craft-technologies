import assert from "node:assert/strict";
import test from "node:test";

import { canReviewItem, galleryHeading, selectionSentMessage, showsDeselectAll, showsSubmitAll, submittableItems, submitAllGroups } from "../src/lib/clientGalleryHome.mjs";

test("the heading names the client only, never the project", () => {
  assert.equal(galleryHeading({ clientName: "Ranju Raj", projectName: "test 2" }), "Ranju Raj");
  assert.equal(galleryHeading({ clientName: "  Ranju Raj ", projectName: "" }), "Ranju Raj");
  assert.equal(galleryHeading({ groomName: "Ravi", brideName: "Priya", clientName: "Ravi Kumar", projectName: "Engagement" }), "Ravi & Priya", "the couple names a wedding gallery");
});

test("a gallery that knows no client, or has not loaded yet, keeps Your gallery", () => {
  assert.equal(galleryHeading({ clientName: null, projectName: "Wedding Album" }), "Your gallery", "the project name is not a stand-in");
  assert.equal(galleryHeading({ clientName: "   ", projectName: null }), "Your gallery", "blank is not a name");
  assert.equal(galleryHeading(null), "Your gallery");
  assert.equal(galleryHeading(undefined), "Your gallery");
});

test("Deselect All is offered on the Selected tab only, once something is picked", () => {
  assert.equal(showsDeselectAll("selected", 5), true);
  assert.equal(showsDeselectAll("selected", 0), false, "nothing picked, nothing to deselect");
  assert.equal(showsDeselectAll("selected"), false);
  assert.equal(showsDeselectAll("all", 5), false);
  assert.equal(showsDeselectAll("people", 5), false);
  assert.equal(showsDeselectAll(undefined, 5), false);
});

const wedding = { id: "s-wed", shoot: "Wedding" };
const preWedding = { id: "s-pre", shoot: "Pre Wedding" };
const offered = (id, name, shoot, extra = {}) => ({ id, name, selectionLimit: 5, shootId: shoot?.id ?? null, shoot, submittedAt: null, ...extra });
const retouches = offered("ret", "Retouches", wedding);
const frames = offered("fra", "Frames", wedding);

test("Submit All shows only when two or more items hold saved picks", () => {
  assert.equal(showsSubmitAll([retouches, frames], { ret: 5 }), false, "only Retouches picked");
  assert.equal(showsSubmitAll([retouches, frames], { fra: 5 }), false, "only Frames picked");
  assert.equal(showsSubmitAll([retouches, frames], {}), false, "nothing picked");
  assert.equal(showsSubmitAll([retouches, frames], { ret: 5, fra: 5 }), true, "both picked");
  assert.equal(showsSubmitAll([retouches, { ...frames, submittedAt: "2026-10-01" }], { ret: 5, fra: 5 }), false, "a sent item cannot be sent again");
  assert.equal(showsSubmitAll([retouches, { ...frames, enabled: false }], { ret: 5, fra: 5 }), false, "a disabled item is not offered");
});

test("Submit All counts every eligible item, not just two", () => {
  const album = offered("alb", "Album", preWedding);
  assert.deepEqual(submittableItems([retouches, frames, album], { ret: 1, fra: 2, alb: 3 }).map((item) => item.id), ["ret", "fra", "alb"]);
});

test("the popup groups items under their own shoot, by id, without repeats", () => {
  const preRetouches = offered("pre-ret", "Retouches", preWedding);
  const groups = submitAllGroups([retouches, frames, preRetouches, retouches], { ret: 5, fra: 3, "pre-ret": 2 });
  assert.deepEqual(groups.map((group) => group.label), ["Wedding", "Pre Wedding"]);
  assert.deepEqual(groups[0].items.map((entry) => entry.item.id), ["ret", "fra"], "Retouches first, Frames below, listed once");
  assert.deepEqual(groups[1].items.map((entry) => entry.item.id), ["pre-ret"], "a Pre Wedding item never sits under Wedding");
});

test("the popup lists sent items for context and leaves out items with nothing to review", () => {
  const groups = submitAllGroups([retouches, { ...frames, submittedAt: "2026-10-01" }, offered("alb", "Album", wedding)], { ret: 5, fra: 5 });
  assert.deepEqual(groups[0].items.map((entry) => [entry.item.id, entry.ready]), [["ret", true], ["fra", false]]);
});

test("a manually named project's items sit in one group with no shoot heading", () => {
  const groups = submitAllGroups([offered("a", "Retouches", null), offered("b", "Frames", null)], { a: 1, b: 1 });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, null);
});

// The labels and the compact popup, read from the components themselves: there is no DOM renderer
// in this suite, and these are exactly the strings a client sees.
import fs from "node:fs";
const source = (file) => fs.readFileSync(new URL(`../src/components/image-selection/client-gallery/${file}`, import.meta.url), "utf8");

test("Submit All's popup lists counts and statuses, not photo thumbnails", () => {
  const dialog = source("SubmitAllDialog.js");
  assert.doesNotMatch(dialog, /PublicGalleryLazyImage|<img/, "no thumbnail renders in the popup");
  assert.match(dialog, /photos selected/);
  assert.match(dialog, /Review &amp; Submit/);
  assert.match(dialog, />Submit All<\/Button>/, "the combined action reads Submit All");
  assert.doesNotMatch(dialog, /Submit All Selections/);
  assert.match(dialog, /footerInline/, "Submit All and Close share one row, phones too");
});

test("the review action reads Review & Submit, without the item's name", () => {
  const button = source("ReviewSubmitButton.js");
  assert.match(button, /\n\s*Review &amp; Submit\r?\n/);
  assert.doesNotMatch(button, /Review &amp; Submit\{/);
});

test("Review & Submit sits in the same footer on the card list and inside every open card", () => {
  // One footer in both places - never the header - so the button, its rule and its place cannot drift.
  const footer = source("SelectionFooter.js");
  assert.match(footer, /<footer/);
  assert.match(footer, /<ReviewSubmitButton item=\{active\}[^>]*onClick=\{onReviewAndSend\}/);
  assert.match(source("FolderCards.js"), /<SelectionFooter[\s\S]*?onReviewAndSend=\{onReviewAndSend\}/);
  const grid = source("FolderGrid.js");
  assert.match(grid, /<SelectionFooter[^>]*active=\{activeDeliverable\}[^>]*onReviewAndSend=\{onReviewAndSend\}/);
  assert.doesNotMatch(grid, /<ReviewSubmitButton/, "an open card's header carries no Review & Submit of its own");
  // The open card is handed the card list's own review and Submit All, not a second submission path.
  const gallery = fs.readFileSync(new URL("../src/components/image-selection/PublicGallery.js", import.meta.url), "utf8");
  assert.equal((gallery.match(/onReviewAndSend=\{\(\) => openReview\(true\)\}/g) || []).length, 2);
  assert.equal((gallery.match(/onSubmitAll=\{\(\) => openSubmitAll\(\)\}/g) || []).length, 2);
});

test("the review page's final action reads Submit", () => {
  const review = source("ReviewSelected.js");
  assert.match(review, /"Submitting…" : "Submit"/);
  assert.doesNotMatch(review, /`Send \$\{itemName\}`/);
});

test("Review & Submit opens for an unsent item holding a pick, the same rule inside a card and on the card list", () => {
  const album = { id: "a", name: "album", selectionLimit: 2 };
  assert.equal(canReviewItem(album, 1), true, "one pick is enough - the limit is a ceiling");
  assert.equal(canReviewItem(album, 2), true);
  assert.equal(canReviewItem(album, 0), false, "nothing picked yet");
  assert.equal(canReviewItem({ ...album, submittedAt: "2026-10-22T10:00:00Z" }, 2), false, "already sent");
  assert.equal(canReviewItem(null, 3), false, "no item in view");
});

test("the sent snackbar names the studio's Global Name", () => {
  assert.equal(selectionSentMessage("album", "BEAMCRAFT"), "Album sent to BEAMCRAFT");
  assert.equal(selectionSentMessage("Engagement Album", "  Beam   Craft  "), "Engagement Album sent to Beam Craft");
  assert.equal(selectionSentMessage(null, "BEAMCRAFT"), "Sent to BEAMCRAFT");
});

test("with no Global Name the sent snackbar keeps saying your photographer", () => {
  for (const missing of [undefined, null, "", "   ", "\t\n"]) {
    assert.equal(selectionSentMessage("album", missing), "Album sent to your photographer", JSON.stringify(missing));
  }
  assert.equal(selectionSentMessage("", ""), "Sent to your photographer");
});
