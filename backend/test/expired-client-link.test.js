const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { EXPIRED_LINK_MESSAGE, expiredLink, expiredLinkError, expiredLinkBody } = require("../src/services/expiredLink");

/*
 * One expired-link answer for every client link: the 410 each already gave, and an `expiredLink`
 * that says nothing - not what the link was for, whose it was, or when it lapsed.
 */
test("an expired link answers 410 and carries no detail of what was behind it", () => {
  assert.deepEqual(expiredLink(), {});
  // Whatever a caller once passed is not read.
  assert.deepEqual(expiredLink({ type: "Quotation", name: "Harish", expiresAt: new Date() }), {});
  const error = expiredLinkError();
  assert.equal(error.status, 410);
  // One message for every kind of link, naming none of them.
  assert.equal(error.message, EXPIRED_LINK_MESSAGE);
  assert.doesNotMatch(EXPIRED_LINK_MESSAGE, /quotation|gallery|proof|album|event|selection/i);
  assert.deepEqual(expiredLinkBody(error), { expiredLink: {} });
  assert.deepEqual(expiredLinkBody(new Error("x")), {}, "any other error adds nothing");
});

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", "src", "modules", ...parts), "utf8");

test("no client link that expires names itself, and every controller still passes the answer on", () => {
  const sources = [
    read("image-selection", "publication", "service.js"),
    read("image-selection", "signature-album", "signatureAlbum.client.service.js"),
    read("image-selection", "album-proofs", "client.service.js"),
    read("ai-feature", "share", "service.js"),
  ];
  for (const source of sources) {
    assert.match(source, /expiredLinkError\(\)/);
    assert.doesNotMatch(source, /expiredLinkError\([^)]/, "no message, type, name or date of its own");
  }
  for (const file of [["image-selection", "public-gallery", "controller.js"], ["image-selection", "signature-album", "signatureAlbum.public.controller.js"], ["image-selection", "album-proofs", "public.controller.js"], ["ai-feature", "shared", "http.js"]]) {
    assert.match(read(...file), /\.\.\.expiredLinkBody\(error\)/, file.join("/"));
  }
  const quotation = read("sales", "projects", "controller.js");
  assert.match(quotation, /function sendQuotationExpired\(res\) \{\n  return res\.status\(410\)\.json\(\{ message: EXPIRED_LINK_MESSAGE, expiredLink: expiredLink\(\) \}\);/);
  // The record and the PDF; the PDF hands it over through `refuse`, which a page load turns into a
  // return to the quotation and a fetch answers exactly as before.
  assert.equal((quotation.match(/(?:return |=> )sendQuotationExpired\(res\)/g) || []).length, 2);
  assert.match(read("sales", "quotations-public", "controller.js"), /return sendQuotationExpired\(res\);/);
});

test("a gallery link keeps answering expired after its first expired visit revoked it, and a link taken down early is still not found", () => {
  const service = read("image-selection", "publication", "service.js");
  assert.match(service, /lapsed\.status === "REVOKED" && lapsed\.revokedAt && expiryOf\(lapsed\) <= lapsed\.revokedAt\) throw galleryExpired\(\);/);
  assert.match(service, /throw httpError\(404, "Published gallery not found\."\);\n  \}\n  if \(expiryOf\(publication\) <= new Date\(\)\)/);
});

test("the public token lookups stay rate limited per address", () => {
  assert.match(read("image-selection", "public-gallery", "routes.js"), /router\.get\("\/:token", lookupLimiter, getMeta\);/);
  assert.match(read("image-selection", "album-proofs", "public.routes.js"), /router\.get\("\/:token", lookupLimiter, controller\.meta\);/);
});
