import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { LAST_PAGE_KEYS, PAGE_FAMILIES, familyOf, lastPageKey, rememberedPage } from "../src/lib/lastPage.mjs";
import { SIDEBAR_MODULES as NAVIGATION } from "../src/constants/navigation.mjs";

test("a screen of a dropdown family is recognised, and nothing else is", () => {
  assert.equal(familyOf("/hrm/employee-referrals"), "employee-repository");
  assert.equal(familyOf("/employees/"), "employee-repository");
  assert.equal(familyOf("/project-management/pre-production/corp"), "pre-production");
  assert.equal(familyOf("/project-management/pre-production"), "pre-production");
  assert.equal(familyOf("/project-management/production/schedule"), "production");
  assert.equal(familyOf("/visual-curation/ai/events"), "ai-feature");
  assert.equal(familyOf("/image-selection/projects"), "image-selection");
  assert.equal(familyOf("/image-selection/album-proofing"), "album-proofing");
  // A record opened under a screen is not a screen of the family.
  assert.equal(familyOf("/visual-curation/ai/events/42"), null);
  assert.equal(familyOf("/sales/crm"), null);
});

test("the remembered page is used only when it is one of the family's screens the reader may open", () => {
  assert.equal(rememberedPage("employee-repository", "/hrm/employee-referrals"), "/hrm/employee-referrals");
  assert.equal(rememberedPage("pre-production", "/project-management/pre-production/corp"), "/project-management/pre-production/corp");
  // A stored value is a hint, never a way in.
  assert.equal(rememberedPage("employee-repository", "/sales/crm"), null);
  assert.equal(rememberedPage("employee-repository", "/admin/roles", () => false), null);
  assert.equal(rememberedPage("pre-production", 42), null);
  assert.equal(rememberedPage("pre-production", null), null);
});

test("kept under the remembered-tab namespace the server already accepts, for both families", () => {
  assert.equal(lastPageKey("pre-production"), "tab:page.pre-production");
  assert.match(lastPageKey("employee-repository"), /^tab:[a-zA-Z0-9._-]{1,100}$/);
  assert.deepEqual(Object.keys(PAGE_FAMILIES), ["employee-repository", "pre-production", "production", "ai-feature", "image-selection", "album-proofing", "ai-culling", "ai-editing", "signature-album"]);
  assert.deepEqual(LAST_PAGE_KEYS, Object.keys(PAGE_FAMILIES).map(lastPageKey));
  for (const key of LAST_PAGE_KEYS) assert.match(key, /^tab:[a-zA-Z0-9._-]{1,100}$/);
});

test("the shell records the page and the sidebar opens it", () => {
  const read = (p) => fs.readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
  assert.match(read("components/app-shell/AppShell.js"), /useRememberLastPage\(\);/);
  const sidebar = read("components/preferences/useSidebarLayout.js");
  assert.match(sidebar, /const entry = remembered\(FAMILY_SIDEBAR_ITEM_ID\) \|\| familyEntryFor\(hasPermission\);/);
  assert.match(sidebar, /const href = PAGE_FAMILIES\[item\.id\] \? remembered\(item\.id\) : null;/);
});

test("every family is a real sidebar row, and every screen of it a page that exists", () => {
  const rows = new Map(NAVIGATION.flatMap((group) => group.items || []).map((item) => [item.id, item]));
  for (const [id, screens] of Object.entries(PAGE_FAMILIES)) {
    assert.ok(rows.has(id), `${id} is not a sidebar row`);
    for (const href of screens) {
      assert.ok(fs.existsSync(new URL(`../src/app/(app)${href}/page.js`, import.meta.url)), `${href} has no page`);
    }
  }
});
