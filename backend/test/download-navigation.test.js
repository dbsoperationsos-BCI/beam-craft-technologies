const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const { wantsPage, backToPage } = require("../src/services/downloadNavigation");

const requestWith = (accept) => { const req = Object.create(express.request); req.headers = accept === undefined ? {} : { accept }; return req; };
const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", "src", ...parts), "utf8");

test("a page load is told apart from a fetch by what it asks for", () => {
  // What Chrome, Safari and Firefox send when the browser itself is pointed at a URL.
  assert.equal(wantsPage(requestWith("text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8")), true);
  // What `fetch` sends by default, and what `apiRequest` sends.
  assert.equal(wantsPage(requestWith("*/*")), false);
  assert.equal(wantsPage(requestWith("application/json")), false);
  assert.equal(wantsPage(requestWith(undefined)), false, "no Accept at all keeps the JSON answer");
});

test("a refused page load goes back to the client's page, marked so the page can say so", () => {
  const calls = [];
  const res = { redirect: (status, url) => { calls.push([status, url]); return "sent"; } };
  assert.equal(backToPage(res, "https://studio.example/a/ABCD1234"), "sent");
  assert.equal(backToPage(res, "https://studio.example/q/abcdEFGH?print=1"), "sent");
  assert.deepEqual(calls, [[303, "https://studio.example/a/ABCD1234?download=failed"], [303, "https://studio.example/q/abcdEFGH?print=1&download=failed"]]);
});

test("both client downloads send a refused page load back to the client's own page", () => {
  const album = read("modules", "image-selection", "signature-album", "signatureAlbum.public.controller.js");
  assert.match(album, /if \(!query\.success\) return page \? backToPage\(res, clientUrlFor\(params\.token\)\)/);
  assert.match(album, /if \(page && !isClientAbort\(error\) && !res\.headersSent\) return backToPage\(res, clientUrlFor\(params\.token\)\);/);
  const quotation = read("modules", "sales", "projects", "controller.js");
  assert.match(quotation, /page \? backToPage\(res, `\$\{frontendOrigin\(\)\}\/q\/\$\{token\}`\) : send\(\)/);
  assert.match(quotation, /return refuse\(410, null, \(\) => sendQuotationExpired\(res\)\);/, "a fetch still gets the 410");
});
