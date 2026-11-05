const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { SIDEBAR_STRUCTURE, validateSidebarLayout } = require("../src/modules/user/preferences/sidebarStructure");
const { validateValue } = require("../src/modules/user/preferences/service");

/*
 * What the server will and will not store as somebody's sidebar arrangement.
 *
 * The browser refuses to drag a screen out of its module; this is the same rule enforced where a
 * rewritten browser cannot reach it.
 */

const layout = (moduleOrder, submoduleOrder = {}) => ({ moduleOrder, submoduleOrder });

test("a well-formed arrangement is stored as sent", () => {
  const value = layout(
    ["accounts", "hrm", "sales-crm"],
    { "sales-crm": ["quotations", "contacts"], hrm: ["tasks"] }
  );
  assert.deepEqual(validateSidebarLayout(value), value);
});

test("the preference service accepts the sidebar key and refuses invented app keys", () => {
  assert.deepEqual(
    validateValue("app:sidebarLayout", layout(["hrm"], { hrm: ["tasks"] })),
    layout(["hrm"], { hrm: ["tasks"] })
  );
  assert.throws(() => validateValue("app:whateverElse", true), /not a preference this application keeps/);
});

test("a screen may not be filed under a module that does not own it", () => {
  // Quotations into Project Management: the case the whole rule exists for.
  assert.throws(
    () => validateSidebarLayout(layout([], { "project-management": ["quotations"] })),
    /"quotations" belongs to "sales-crm"/
  );
  // And the same for a module's own screen sent one module over.
  assert.throws(
    () => validateSidebarLayout(layout([], { hrm: ["assets"] })),
    /"assets" belongs to "resource-management"/
  );
});

test("a list naming the same entry twice is refused", () => {
  assert.throws(() => validateSidebarLayout(layout(["hrm", "hrm"])), /names "hrm" more than once/);
  assert.throws(
    () => validateSidebarLayout(layout([], { hrm: ["tasks", "tasks"] })),
    /names "tasks" more than once/
  );
});

test("an id this server has never heard of is dropped, not refused", () => {
  // A browser running ahead of this server must not have every save rejected; the browser puts
  // anything genuinely new back the next time it works the layout out.
  assert.deepEqual(
    validateSidebarLayout(layout(["hrm", "some-future-module"], { hrm: ["tasks", "some-future-screen"], "some-future-module": ["x"] })),
    layout(["hrm"], { hrm: ["tasks"] })
  );
});

test("anything that is not a layout is refused with a 400", () => {
  for (const value of [null, "hrm", 42, ["hrm"], { moduleOrder: "hrm" }, { submoduleOrder: [] }]) {
    const error = (() => { try { validateSidebarLayout(value); return null; } catch (thrown) { return thrown; } })();
    assert.ok(error, `${JSON.stringify(value)} should not be storable`);
    assert.equal(error.status, 400);
  }
});

test("an id that is not a sidebar id at all is refused", () => {
  assert.throws(() => validateSidebarLayout(layout(["Sales & CRM"])), /must contain sidebar ids/);
  assert.throws(() => validateSidebarLayout(layout(["a".repeat(80)])), /must contain sidebar ids/);
});

test("a list far longer than the sidebar is refused rather than stored", () => {
  assert.throws(() => validateSidebarLayout(layout(Array.from({ length: 60 }, (_, i) => `m-${i}`))), /more entries than the sidebar has/);
});

/*
 * The one that keeps this file honest.
 *
 * `sidebarStructure.js` is a mirror of the canonical registry in the frontend package, which is
 * what lets the server check a relationship without the sidebar's labels, routes and icons being
 * written twice. A mirror is only safe while something proves it is still a mirror.
 */
test("the server's copy of the sidebar structure matches the canonical registry exactly", async () => {
  const registryPath = path.resolve(__dirname, "../../frontend/src/constants/navigation.mjs");
  if (!fs.existsSync(registryPath)) {
    // The backend is deployed without the frontend package beside it; there is nothing to compare.
    return;
  }
  const { SIDEBAR_MODULES } = await import(pathToFileURL(registryPath).href);
  const canonical = Object.fromEntries(SIDEBAR_MODULES.map((group) => [group.id, group.items.map((item) => item.id)]));

  assert.deepEqual(
    Object.keys(SIDEBAR_STRUCTURE),
    Object.keys(canonical),
    "the modules, or their default order, differ from the registry"
  );
  assert.deepEqual(SIDEBAR_STRUCTURE, canonical, "a module's screens, or their default order, differ from the registry");
});
