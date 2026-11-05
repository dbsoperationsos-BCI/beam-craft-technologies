import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { brandedTitle, clientShareMetadata, shareImageUrl, shareOrigin } from "../src/lib/shareMetadata.mjs";

const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", ...parts), "utf8");
const ORIGIN = "https://operations.example.com";
const branding = { studioName: "Some Studio", galleryLogoUrl: "https://cdn.example.com/branding/logo.png" };

test("a shared quotation link previews as the studio in Settings → Branding, with its logo and nothing private", () => {
  const meta = clientShareMetadata({ page: "Quotation", branding, origin: ORIGIN, path: "/q/abc123" });
  assert.equal(meta.title, "Quotation | Some Studio");
  assert.equal(meta.description, "View your quotation securely.");
  assert.equal(meta.openGraph.title, "Quotation | Some Studio");
  assert.equal(meta.openGraph.siteName, "Some Studio");
  assert.equal(meta.openGraph.url, `${ORIGIN}/q/abc123`);
  assert.equal(meta.openGraph.type, "website");
  assert.deepEqual(meta.openGraph.images, [{ url: "https://cdn.example.com/branding/logo.png", alt: "Some Studio" }]);
  assert.equal(meta.twitter.title, "Quotation | Some Studio");
  assert.deepEqual(meta.twitter.images, ["https://cdn.example.com/branding/logo.png"]);
  assert.deepEqual(meta.robots, { index: false, follow: false });
  assert.ok(!JSON.stringify(meta).includes("HRM Foundation"));
});

test("with no branding set there is no borrowed name and no borrowed picture", () => {
  for (const empty of [null, {}, { studioName: "  ", galleryLogoUrl: "" }]) {
    const meta = clientShareMetadata({ page: "Quotation", branding: empty, origin: ORIGIN, path: "/q/abc123" });
    assert.equal(meta.title, "Quotation");
    assert.equal(meta.openGraph.siteName, undefined);
    assert.equal(meta.openGraph.images, undefined);
    assert.equal(meta.twitter.images, undefined);
    assert.ok(!/beam ?craft/i.test(JSON.stringify(meta)));
  }
  assert.equal(brandedTitle("Terms & Conditions", { studioName: "Some Studio" }), "Terms & Conditions | Some Studio");
});

test("the picture is always a public absolute address a crawler can reach", () => {
  assert.equal(shareImageUrl({ galleryLogoUrl: "/uploads/logo.png" }, ORIGIN), `${ORIGIN}/uploads/logo.png`, "a path on this site is made absolute");
  assert.equal(shareImageUrl({ galleryLogoUrl: "/uploads/logo.png" }, null), null, "and with no origin, left out");
  assert.equal(shareImageUrl({ galleryLogoUrl: "http://localhost:5001/logo.png" }, ORIGIN), null, "never a local address");
  assert.equal(shareImageUrl({ galleryLogoUrl: "http://cdn.example.com/logo.png" }, ORIGIN), null, "never an http picture on an https page");
  assert.equal(shareImageUrl({ galleryLogoUrl: "data:image/png;base64,AAAA" }, ORIGIN), null);
  assert.equal(shareImageUrl({ galleryLogoUrl: "//evil.example/logo.png" }, ORIGIN), null);
});

test("the origin is the configured one, else the host the request came to - never a malformed one", () => {
  assert.equal(shareOrigin({ configured: "https://operations.example.com/", host: "10.0.0.5:3000" }), "https://operations.example.com");
  assert.equal(shareOrigin({ host: "operations.example.com", proto: "https" }), "https://operations.example.com");
  assert.equal(shareOrigin({ host: "operations.example.com" }), "https://operations.example.com", "https unless told otherwise");
  assert.equal(shareOrigin({ host: "localhost:3000" }), "http://localhost:3000");
  assert.equal(shareOrigin({ host: "a.example, b.example", proto: "https, http" }), "https://a.example");
  assert.equal(shareOrigin({ host: "evil.com/<script>" }), null);
  assert.equal(shareOrigin({}), null);
  // With no origin there is no half-built URL.
  assert.equal(clientShareMetadata({ page: "Quotation", branding: { studioName: "Some Studio" }, origin: null }).openGraph.url, undefined);
});

test("all three quotation pages read the studio's branding on the server, and name no studio themselves", () => {
  for (const [file, page] of [["page.js", "Quotation"], ["payment/page.js", "Payment Details"], ["terms/page.js", "Terms & Conditions"]]) {
    const source = read("src", "app", "q", "[token]", ...file.split("/"));
    assert.match(source, /export async function generateMetadata\(\{ params \}\)/);
    assert.ok(source.includes(`page: "${page}", branding: await serverStudioBranding()`), file);
    assert.ok(!/beam ?craft|don.t blink/i.test(source.replace(/\/\/.*$/gm, "")), file);
  }
  assert.ok(!/beam ?craft/i.test(read("src", "lib", "shareMetadata.mjs")));
});
