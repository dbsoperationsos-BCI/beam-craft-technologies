const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", "src", "modules", "image-selection", ...parts), "utf8");

// Photo Selection never needs a cull. The one thing that hides a photo is a finalized run's stamp
// (cullRejectedAt): a photo no run has finalized ("not run") is as visible as a Keep, and nothing in
// the galleries, picks or publish counts reads a culling session, a decision or a KEEP.
test("galleries, picks and publish counts hide only what a finalized run stamped", () => {
  const gallery = read("gallery", "repository.js");
  assert.match(gallery, /const cullEligible = \{ cullRejectedAt: null, cullingHoldAt: null, editingHoldAt: null \};/);
  for (const name of ["listReadyImages", "listPublishedImages", "setSelection"]) assert.match(gallery, new RegExp(`${name}[\\s\\S]{0,600}cullEligible`), name);
  const publication = read("publication", "repository.js");
  assert.match(publication, /cullRejectedAt: null/);
  for (const source of [gallery, publication, read("public-gallery", "controller.js")]) {
    assert.doesNotMatch(source, /cullingSession|effectiveDecision|aiDecision|"KEEP"/, "Photo Selection never asks about culling");
  }
});

test("only finalizing a run stamps photos, and a photo the client picked is never stamped", () => {
  const repository = read("ai-culling", "repository.js");
  const writes = [...repository.matchAll(/cullRejectedAt: (?!null)/g)].length;
  assert.ok(writes >= 1);
  const finalize = repository.slice(repository.indexOf("finalizeSession"), repository.indexOf("reopenSession"));
  assert.match(finalize, /photoSelections: \{ none: \{\} \}, selected: false/);
  assert.match(finalize, /effectiveDecision: \{ not: "KEEP" \}|NOT: \{ effectiveDecision: "KEEP" \}|effectiveDecision: \{ notIn|not: DECISIONS\.KEEP/);
});
