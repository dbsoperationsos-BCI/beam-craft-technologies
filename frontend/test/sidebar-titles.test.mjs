import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SIDEBAR_MODULES, sidebarLabelForRoute } from "../src/constants/navigation.mjs";

/*
 * One screen, one name.
 *
 * The sidebar said **Quotations** and the page heading said Quotation, because the name was written
 * in two places and only one of them was ever corrected. Nothing breaks when those disagree, which
 * is why it survived: somebody clicks an entry and lands on a page that calls itself something
 * else, and there is nowhere to report it to.
 *
 * So `ModulePageHeader` reads the heading of a listed screen out of the registry, and these hold
 * the two halves of that: the lookup answers for every entry the menu has, and it answers for
 * exactly those - a page the menu does not list keeps the title it sets for itself.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const HEADER = fs.readFileSync(path.join(here, "..", "src", "components", "layout", "ModulePageHeader.js"), "utf8");

test("every screen the sidebar lists can be named from its route", () => {
  for (const group of SIDEBAR_MODULES) {
    for (const item of group.items || []) {
      assert.equal(sidebarLabelForRoute(item.href), item.label, `${item.href} is not named after its menu entry`);
    }
  }
});

test("the name survives the shapes a route actually arrives in", () => {
  // `usePathname` gives no query, but a caller passing one - or a link written with a trailing
  // slash - must not silently fall through to the page's own title.
  assert.equal(sidebarLabelForRoute("/sales/quotation"), "Quotations");
  assert.equal(sidebarLabelForRoute("/sales/quotation/"), "Quotations");
  assert.equal(sidebarLabelForRoute("/sales/quotation?view=all"), "Quotations");
});

test("a page the menu does not list is left alone", () => {
  /*
   * Matched exactly rather than by prefix, which is the whole reason this is safe to apply to every
   * page at once: a record opened under a listed route is a different screen with a name of its
   * own, and a prefix match would rename all of them after the menu entry above them.
   */
  assert.equal(sidebarLabelForRoute("/image-selection/projects/12"), "");
  assert.equal(sidebarLabelForRoute("/project-management/pre-production/dum-dum"), "");
  assert.equal(sidebarLabelForRoute("/profile"), "");
  assert.equal(sidebarLabelForRoute("/admin/roles"), "");
  for (const missing of [undefined, null, "", "/"]) assert.equal(sidebarLabelForRoute(missing), "");
});

test("the header reads the registry rather than only the title it is passed", () => {
  // Read out of the source, because the alternative is rendering a Next.js client component here -
  // and this is the line that makes every other assertion in this file mean anything on screen.
  assert.match(HEADER, /sidebarLabelForRoute\(pathname\) \|\| title/);
});
