const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { MAX_INFRASTRUCTURE_PHOTOS, mergePdfAssets } = require("../src/modules/sales/quotation-brands/defaults");
const { refuseOverfullCollages } = require("../src/modules/sales/quotation-brands/controller");

/*
 * How many photographs one branch's collage may hold, and what happens to a ninth.
 *
 * The client's copy lays a collage out from how many photographs the branch has, and it has a
 * composition for one through eight and none for a ninth. So eight is not a number chosen for
 * tidiness - it is what the page can actually print - and a ninth has to be refused here rather
 * than stored and then quietly dropped where nobody sees it happen.
 */

/** A response that records what it was told to send, so the refusal can be read back. */
function recordingResponse() {
  const sent = { status: null, body: null };
  return {
    sent,
    status(code) { sent.status = code; return this; },
    json(body) { sent.body = body; return this; },
  };
}

const photos = (count) => Array.from({ length: count }, (_, index) => `https://cdn.example/photo-${index + 1}.webp`);

test("a branch may save up to eight photographs", () => {
  for (let count = 0; count <= MAX_INFRASTRUCTURE_PHOTOS; count += 1) {
    const res = recordingResponse();
    const body = { pdfAssets: { infrastructure: [{ title: "Erode", subtitle: "Tamil Nadu", photos: photos(count) }] } };
    assert.equal(refuseOverfullCollages(body, res), false, `${count} photographs must be allowed through`);
    assert.equal(res.sent.status, null);
  }
});

test("a ninth photograph is refused, and the refusal says which branch and what to do", () => {
  const res = recordingResponse();
  const body = { pdfAssets: { infrastructure: [{ title: "Erode", photos: photos(8) }, { title: "Coimbatore", photos: photos(9) }] } };
  assert.equal(refuseOverfullCollages(body, res), true);
  assert.equal(res.sent.status, 400);
  // Named, counted and answerable: an administrator who has just added one picture too many is told
  // which collage is over and by how much, not that their input was "invalid".
  assert.match(res.sent.body.message, /Coimbatore/);
  assert.match(res.sent.body.message, /9 photographs/);
  assert.match(res.sent.body.message, new RegExp(`at most ${MAX_INFRASTRUCTURE_PHOTOS}`));
  assert.match(res.sent.body.message, /remove 1/);
});

test("a branch with no name still gets a refusal that reads as a sentence", () => {
  const res = recordingResponse();
  assert.equal(refuseOverfullCollages({ pdfAssets: { infrastructure: [{ title: "  ", photos: photos(11) }] } }, res), true);
  assert.match(res.sent.body.message, /^A branch has 11 photographs\./);
  assert.match(res.sent.body.message, /remove 3/);
});

test("a request that says nothing about the collages is left alone", () => {
  // A partial edit - the wording, or the section switches - must not be judged on collages it never
  // sent, or saving a heading would depend on pictures that are not in the request at all.
  for (const body of [null, undefined, {}, { pdfContent: { infrastructureTitle: "Our Infrastructure" } }, { pdfAssets: {} }, { pdfAssets: { infrastructure: "nonsense" } }]) {
    const res = recordingResponse();
    assert.equal(refuseOverfullCollages(body, res), false);
    assert.equal(res.sent.status, null);
  }
});

test("the stored order is the printed order - nothing re-sorts a collage on its way out", () => {
  // The layout reads the list straight through, so which photograph lands in the tall frame on the
  // right is its position and nothing else. `mergePdfAssets` is what every read passes through.
  const stored = { infrastructure: [{ title: "Erode", subtitle: "Tamil Nadu", photos: photos(8) }] };
  const merged = mergePdfAssets(stored);
  assert.deepEqual(merged.infrastructure[0].photos, photos(8));
});

test("the API's ceiling is the one the client's copy can lay out", () => {
  // Two files, one number. The screen hides the upload field at eight and this refuses a ninth, but
  // both are only right because the page has exactly eight compositions to print.
  const layout = fs.readFileSync(path.join(__dirname, "../../frontend/src/lib/infrastructureCollage.mjs"), "utf8");
  const match = layout.match(/export const MAX_INFRA_PHOTOS = (\d+);/);
  assert.ok(match, "the client's copy must declare how many photographs it can lay out");
  assert.equal(Number(match[1]), MAX_INFRASTRUCTURE_PHOTOS);
  // And a composition for every count up to it, or a branch could save what cannot be drawn.
  for (let count = 1; count <= MAX_INFRASTRUCTURE_PHOTOS; count += 1) {
    assert.match(layout, new RegExp(`\\n  ${count}: \\[`), `the layout table has no entry for ${count} photographs`);
  }
});
