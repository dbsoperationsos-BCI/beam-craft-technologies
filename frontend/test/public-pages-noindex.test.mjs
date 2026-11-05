import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Every page addressed by a token or a code is kept out of search engines.
 *
 * These pages have no login. The unguessable token in the URL is the whole of the secrecy, so a
 * link that reaches a crawler - forwarded, pasted into a chat that previews it, opened in a browser
 * that syncs history - would make the page findable by anybody. That is worst on the quotation
 * payment page, which prints the studio's account number, IFSC and UPI IDs and whose URL now
 * travels as a clickable link inside the PDF clients receive and forward.
 *
 * The convention existed but had drifted: eight of these pages carried the line and six did not,
 * including the payment page. This test is what stops the next page being added without it.
 */

const HERE = import.meta.dirname;
const APP = path.join(HERE, "..", "src", "app");

/** Every `page.js` whose route is addressed by a token, a code or an id rather than by a login. */
function tokenPages(dir = APP, routed = false) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "api") continue;
      found.push(...tokenPages(full, routed || /^\[(token|code|albumId)\]$/.test(entry.name)));
    } else if (routed && entry.name === "page.js") {
      found.push(full);
    }
  }
  return found;
}

test("every public token page refuses to be indexed", () => {
  const pages = tokenPages();
  assert.ok(pages.length >= 14, `expected the public token pages to be found, saw ${pages.length}`);
  const missing = [];
  for (const file of pages) {
    const source = fs.readFileSync(file, "utf8");
    // Either a static export or a generateMetadata that says it, but it has to be said.
    // `clientShareMetadata` (lib/shareMetadata.mjs) says it for the pages built on it - pinned in
    // test/share-metadata.test.mjs.
    const says = /robots:\s*\{\s*index:\s*false\s*,\s*follow:\s*false\s*\}/.test(source) || /return clientShareMetadata\(/.test(source);
    if (!says) missing.push(path.relative(APP, file));
  }
  assert.deepEqual(missing, [], "these public pages can be indexed by a search engine");
});
