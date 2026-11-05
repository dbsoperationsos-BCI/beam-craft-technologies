const test = require("node:test");
const assert = require("node:assert/strict");
const { olderVerdicts } = require("../src/modules/image-selection/ai-culling/stampOwnership");

/*
 * Reopening a finalized run gives each photo it settled back to the newest OTHER finalized run
 * that analyzed it: hidden again when that run did not keep it, visible when it did.
 */
const at = (minute) => new Date(Date.UTC(2026, 9, 6, 10, minute));

test("a photo goes back to the newest other finalized run's verdict", () => {
  const owners = olderVerdicts([
    { uploadId: "p1", sessionId: "whole", effectiveDecision: "REJECT", finalizedAt: at(1) },
    { uploadId: "p2", sessionId: "whole", effectiveDecision: "KEEP", finalizedAt: at(1) },
    { uploadId: "p3", sessionId: "whole", effectiveDecision: "MAYBE", finalizedAt: at(1) },
  ]);
  assert.deepEqual([...owners.entries()].sort(), [["p1", "whole"], ["p3", "whole"]]);
});

test("the newest finalized run wins, so a later KEEP leaves the photo visible", () => {
  const owners = olderVerdicts([
    { uploadId: "p1", sessionId: "old", effectiveDecision: "REJECT", finalizedAt: at(1) },
    { uploadId: "p1", sessionId: "newer", effectiveDecision: "KEEP", finalizedAt: at(5) },
    { uploadId: "p2", sessionId: "old", effectiveDecision: "KEEP", finalizedAt: at(1) },
    { uploadId: "p2", sessionId: "newer", effectiveDecision: "PENDING", finalizedAt: at(5) },
  ]);
  assert.equal(owners.has("p1"), false);
  assert.equal(owners.get("p2"), "newer");
});

test("no other finalized run means the photo simply comes back", () => {
  assert.equal(olderVerdicts([]).size, 0);
});
