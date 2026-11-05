const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { validateKey, validateValue, MAX_VALUE_BYTES } = require("../src/modules/user/preferences/service");

/*
 * A login's own arrangement of the application - column order, hidden columns, frozen columns,
 * column widths, density, remembered tabs - is written by a browser and lands in a JSON column.
 *
 * That makes it the one part of this module where "it is only a layout" is the wrong instinct.
 * Three things can go wrong and none of them announce themselves: a key nothing renders, which
 * turns the table into somewhere to park arbitrary JSON on an account; a value of a shape nothing
 * checks, which is handed straight back to the table's layout engine on the next sign-in; and a
 * payload with no ceiling, which is a way to fill the table.
 *
 * These read the validators directly rather than a database, the way the other pure-logic tests
 * here do, so they run anywhere with no MySQL.
 */

const ROUTES = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "user", "routes.js"), "utf8");

/* ------------------------------------------------------------------ only the keys we actually write */

test("the namespaces the application writes are accepted", () => {
  for (const key of ["table:employee-repository", "table:asset-management", "app:compactView", "tab:tasks", "tab:accounts.cash"]) {
    assert.equal(validateKey(key), key, `"${key}" is a key the application writes and must be storable`);
  }
});

test("a key outside those namespaces is refused", () => {
  for (const key of ["", "   ", "whatever", "table:", "app:", "tab:", "role:SUPER_ADMIN", "table:Employee Repository", "../etc/passwd", "table:" + "a".repeat(200)]) {
    assert.throws(() => validateKey(key), /not a preference key/i, `"${key}" must not be storable`);
  }
});

test("an unknown app preference is refused rather than stored as a curiosity", () => {
  // The `app:` namespace is a fixed, short list; anything else there is a client writing keys
  // nothing reads, which is exactly what the per-account cap exists to stop growing.
  assert.throws(() => validateValue("app:somethingElse", true), /not a preference this application keeps/i);
});

/* ------------------------------------------------------------------------------ shapes, not blobs */

test("a table layout keeps the four things a table remembers", () => {
  const layout = validateValue("table:employees", {
    columnOrder: ["name", "role"],
    columnVisibility: { name: true, salary: false },
    freezeCount: 2,
    columnSizing: { name: 240 },
  });
  assert.deepEqual(layout.columnOrder, ["name", "role"]);
  assert.deepEqual(layout.columnVisibility, { name: true, salary: false });
  assert.equal(layout.freezeCount, 2);
  assert.deepEqual(layout.columnSizing, { name: 240 });
});

test("a shown column is remembered as well as a hidden one", () => {
  // A table may ship with a column hidden by default. Dropping the `true` as "the default anyway"
  // would silently refuse to remember half the choices in the Manage Columns dialog.
  const layout = validateValue("table:employees", { columnVisibility: { hiddenByDefault: true } });
  assert.deepEqual(layout.columnVisibility, { hiddenByDefault: true });
});

test("a duplicated column id is folded rather than drawn twice", () => {
  const layout = validateValue("table:employees", { columnOrder: ["name", "name", "role"] });
  assert.deepEqual(layout.columnOrder, ["name", "role"]);
});

test("a width that is not a usable number is dropped", () => {
  // Handed on, these reach the table's own layout as a column of no width at all, and the row
  // cannot be read at the point nobody is looking at this code.
  const layout = validateValue("table:employees", { columnSizing: { a: 0, b: -10, c: "wide", d: null, e: 180 } });
  assert.deepEqual(layout.columnSizing, { e: 180 });
});

test("a width is capped rather than trusted", () => {
  const layout = validateValue("table:employees", { columnSizing: { a: 99999 } });
  assert.ok(layout.columnSizing.a <= 2000, "a column wider than any screen is not a width anybody chose");
});

test("a layout of the wrong shape is refused", () => {
  assert.throws(() => validateValue("table:employees", "everything"), /must be an object/i);
  assert.throws(() => validateValue("table:employees", { columnOrder: "name" }), /list of column ids/i);
  assert.throws(() => validateValue("table:employees", { columnOrder: [1, 2] }), /column ids/i);
  assert.throws(() => validateValue("table:employees", { columnVisibility: [] }), /must be an object/i);
  assert.throws(() => validateValue("table:employees", { freezeCount: 999 }), /small whole number/i);
  assert.throws(() => validateValue("table:employees", { freezeCount: -1 }), /small whole number/i);
  assert.throws(() => validateValue("table:employees", { freezeCount: 1.5 }), /small whole number/i);
});

test("a column order longer than any table could have is refused", () => {
  assert.throws(() => validateValue("table:employees", { columnOrder: Array.from({ length: 500 }, (_, index) => `c${index}`) }), /list of column ids/i);
});

test("the density is a boolean and the remembered tab is a short string", () => {
  assert.equal(validateValue("app:compactView", true), true);
  assert.throws(() => validateValue("app:compactView", "yes"), /true or false/i);
  assert.equal(validateValue("tab:tasks", "Pending"), "Pending");
  assert.throws(() => validateValue("tab:tasks", { name: "Pending" }), /short string/i);
  assert.throws(() => validateValue("tab:tasks", "x".repeat(200)), /short string/i);
});

test("there is a ceiling on what one preference may hold", () => {
  assert.ok(MAX_VALUE_BYTES > 0 && MAX_VALUE_BYTES <= 64 * 1024, "a layout is small; the cap is what stops the column being used as storage");
});

/* -------------------------------------------------------- the caller may only touch their own row */

test("the routes take the account from the token and never from the payload", () => {
  const block = ROUTES.slice(ROUTES.indexOf('router.get("/preferences"'), ROUTES.indexOf("// Get current user's permissions"));
  assert.ok(block.includes('router.get("/preferences"'), "the three preference routes are expected in this file");
  assert.ok(block.includes('router.put("/preferences/:key"'));
  assert.ok(block.includes('router.delete("/preferences/:key"'));

  const calls = block.match(/preferencesService\.\w+\(([^,)]+)/g) || [];
  assert.equal(calls.length, 3, "every preference route goes through the service");
  for (const call of calls) {
    assert.ok(
      call.includes("req.user.id"),
      `"${call}" must name the signed-in account: a user id read from the body or the URL would let one login rewrite another's screens`
    );
  }
  assert.ok(!/req\.(body|params|query)\??\.\w*[uU]ser[iI]d/.test(block), "nothing here may take a user id from the request");
});

test("the whole user module is behind the JWT", () => {
  // These routes carry no module permission on purpose - a table layout belongs to whoever
  // arranged it, and there is no IAM feature it could sensibly be gated behind. `protect` on the
  // router is therefore the only thing standing in front of them, so it has to be there.
  assert.ok(/router\.use\(protect\)/.test(ROUTES), "the user router mounts protect for every route under it");
});
