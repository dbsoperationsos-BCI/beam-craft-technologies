import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as expiredLinkLib from "../src/lib/expiredLink.mjs";
const { expiredLinkFrom } = expiredLinkLib;

const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");

test("only a 410 is an expired link, and nothing the server sends about it is read", () => {
  // An empty marker: no type, no name, no date - even from a server that still sends them.
  assert.deepEqual(expiredLinkFrom({ status: 410, expiredLink: { type: "Photo Selection", name: "Ranju Raj", expiresAt: "2027-03-28T00:00:00.000Z" } }), {});
  assert.deepEqual(expiredLinkFrom({ status: 410, data: { expiredLink: { type: "Quotation", name: "harish" } } }), {});
  assert.deepEqual(expiredLinkFrom({ expired: true }), {});
  assert.equal(expiredLinkFrom({ status: 404, message: "not found" }), null, "an unknown link is not an expired one");
  assert.equal(expiredLinkFrom(null), null);
  // The formatters that named the type and the date are gone with the card they drew.
  assert.equal(expiredLinkLib.expiredLinkTypeLabel, undefined);
  assert.equal(expiredLinkLib.formatExpiryDate, undefined);
});

test("the one expired page says it has expired and whom to ask, and nothing about the link", () => {
  const page = read("components", "shared", "ExpiredClientLink.js");
  assert.match(page, />This link has expired</);
  assert.match(page, />This link is no longer active\.</);
  assert.match(page, /Please contact <span[^>]*>\{studio\}<\/span> to request a new link\./);
  // No details card, and no way for one to come back through the props: none are read.
  for (const gone of [/<dl/, /DetailRow/, /label="Type"/, /label="Client"/, /Expired on/, /expiresAt/, /\bname\b\s*=/, /typeLabel/, /formatExpiryDate/, /expiredLinkTypeLabel/]) {
    assert.doesNotMatch(page, gone, String(gone));
  }
  assert.match(page, /export default function ExpiredClientLink\(rest\) \{/);
  // Heading, line, then the contact sentence straight after it.
  assert.ok(page.indexOf("This link is no longer active.") < page.indexOf("Please contact"));
  // The illustration is decoration; the words carry the state. No contact button reaching no one.
  assert.match(page, /<svg viewBox="0 0 140 140" className=\{className\} aria-hidden="true"/);
  assert.doesNotMatch(page, /mailto:|tel:|wa\.me/);
  assert.ok(!/router\.push|redirect\(|window\.location/.test(page), "no redirect");
});

test("no page asks for a type when it reads an expired link", () => {
  for (const file of [["components", "sales", "PublicQuotationPage.js"], ["components", "sales", "PublicQuotationTermsPage.js"], ["components", "sales", "PublicQuotationPaymentPage.js"], ["components", "image-selection", "PublicGallery.js"], ["components", "image-selection", "signature-album", "client", "ClientSignatureAlbum.js"], ["components", "image-selection", "album-proofing", "client", "ClientProofExperience.js"], ["components", "ai-feature", "guest", "GuestStatusScreen.js"]]) {
    assert.doesNotMatch(read(...file), /expiredLinkFrom\([^)]*, "/, file.join("/"));
  }
});

test("every client link lapses to that page, before any PIN, and keeps its own not-found for anything else", () => {
  const cases = [
    [["components", "sales", "PublicQuotationPage.js"], /if \(expired\) return <ExpiredClientLink \{\.\.\.expired\} data-quotation-state="expired" \/>;/],
    [["components", "sales", "PublicQuotationTermsPage.js"], /if \(expired\) return <ExpiredClientLink/],
    [["components", "sales", "PublicQuotationPaymentPage.js"], /if \(expired\) return <ExpiredClientLink/],
    [["components", "image-selection", "PublicGallery.js"], /if \(expiredLink && !meta\) return <ExpiredClientLink \{\.\.\.expiredLink\} \/>;/],
    [["components", "image-selection", "signature-album", "client", "ClientSignatureAlbum.js"], /if \(expiredAlbum\) return <ExpiredClientLink \{\.\.\.expiredAlbum\} \/>;/],
    [["components", "image-selection", "album-proofing", "client", "ClientProofExperience.js"], /if \(screen === "error" && expiredLink\) return <ExpiredClientLink/],
    [["components", "ai-feature", "guest", "GuestStatusScreen.js"], /if \(expiredLink\) return <ExpiredClientLink \{\.\.\.expiredLink\} \/>;/],
  ];
  for (const [file, pattern] of cases) assert.match(read(...file), pattern, file.join("/"));
  // The PIN screens come after the expired check in each PIN-protected link.
  const gallery = read("components", "image-selection", "PublicGallery.js");
  assert.ok(gallery.indexOf("<ExpiredClientLink") < gallery.indexOf("<PinGate"));
  const album = read("components", "image-selection", "signature-album", "client", "ClientSignatureAlbum.js");
  assert.ok(album.indexOf("if (expiredAlbum) return") < album.indexOf("<AlbumPinGate"));
  const proof = read("components", "image-selection", "album-proofing", "client", "ClientProofExperience.js");
  assert.ok(proof.indexOf("<ExpiredClientLink") < proof.indexOf("<ClientPinGate"));
});
