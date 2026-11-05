const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");

const { bulkIdsSchema, runBulkDelete, bulkDeleteHandler, mountBulkDelete } = require("../src/services/bulkDelete");

/**
 * Deleting a ticked set of rows, from any module's table.
 *
 * `services/bulkDelete.js` is deliberately pure - it holds no Prisma client and knows nothing about
 * any model - so every rule below is exercised without a database. What it is actually being held
 * to is the one thing a bulk delete must never get wrong: that it deletes through the module's own
 * delete, counts every refusal instead of swallowing it, and cannot be reached without
 * `ADMIN / Table Select All`.
 */

/** A fake response, recording what the handler answered rather than writing to a socket. */
function fakeRes() {
  const answer = { status: 200, body: null };
  return {
    answer,
    status(code) { answer.status = code; return this; },
    json(body) { answer.body = body; return this; },
  };
}

const call = async (handler, body) => {
  const res = fakeRes();
  await handler({ body, user: { id: 1 } }, res);
  return res.answer;
};

// ── what the ids may be ──────────────────────────────────────────────────────────────────────

test("ids may be uuids or numbers, because the application's tables are keyed both ways", () => {
  assert.deepEqual(bulkIdsSchema.parse(["a1b2", "c3d4"]), ["a1b2", "c3d4"]);
  assert.deepEqual(bulkIdsSchema.parse([11, 12]), [11, 12]);
});

test("an empty selection is refused rather than answered as nothing deleted", () => {
  assert.equal(bulkIdsSchema.safeParse([]).success, false);
});

test("a selection larger than the cap is refused, so one request cannot hold a connection open", () => {
  assert.equal(bulkIdsSchema.safeParse(Array.from({ length: 501 }, (unused, index) => index + 1)).success, false);
  assert.equal(bulkIdsSchema.safeParse(Array.from({ length: 500 }, (unused, index) => index + 1)).success, true);
});

/*
 * Not normalised to strings, and this is the assertion that says why.
 *
 * The ids are echoed back in `deletedIds`, and the selection bar clears its ticks by looking each
 * one up in the set it sent. An id that left as the number 12 and came back as the string "12"
 * matches nothing, so every row would stay ticked after a delete that had in fact worked.
 */
test("an id comes back as the type it was sent as", async () => {
  const answer = await call(bulkDeleteHandler({ deleteOne: async () => {}, noun: "asset" }), { ids: [12, 13] });
  assert.deepEqual(answer.body.data.deletedIds, [12, 13]);
  assert.equal(typeof answer.body.data.deletedIds[0], "number");
});

// ── what it does with the module's own delete ────────────────────────────────────────────────

test("every id goes through the module's delete, one at a time and with the request", async () => {
  const seen = [];
  const req = { body: { ids: ["a", "b", "c"] }, user: { id: 4 } };
  await runBulkDelete({ ids: req.body.ids, deleteOne: (id, request) => { seen.push([id, request]); }, req, noun: "row" });
  assert.deepEqual(seen.map(([id]) => id), ["a", "b", "c"]);
  // The request travels with the id, which is the whole of how a module scopes it: `scopedAsset`,
  // `activeRecord`, `mayDeleteProject` all read the caller off it.
  assert.equal(seen.every(([, request]) => request === req), true);
});

test("an id sent twice is deleted once", async () => {
  let calls = 0;
  const answer = await runBulkDelete({ ids: ["a", "a", "b"], deleteOne: () => { calls += 1; }, noun: "row" });
  assert.equal(calls, 2);
  assert.deepEqual(answer.deletedIds, ["a", "b"]);
});

/*
 * The one that matters most. A module's delete refuses for reasons the reader cannot see from the
 * table - a project they do not manage, an employee still holding a camera, the last Super Admin -
 * and a selection almost always contains some of those. Failing the whole request on the first one
 * would make a bulk delete useless on any real selection; ignoring them would report forty deleted
 * when thirty-seven went.
 */
test("a refusal is counted, not thrown, and the rest of the selection still goes", async () => {
  const answer = await runBulkDelete({
    ids: ["ok-1", "refused", "ok-2"],
    deleteOne: (id) => { if (id === "refused") throw new Error("Not yours to delete."); },
    noun: "project",
  });
  assert.deepEqual(answer.deletedIds, ["ok-1", "ok-2"]);
  assert.deepEqual(answer.missedIds, ["refused"]);
  assert.match(answer.message, /^2 projects deleted\. 1 could not be deleted and was left alone\.$/);
});

test("a selection that went whole says so and nothing else", async () => {
  const answer = await runBulkDelete({ ids: ["a", "b"], deleteOne: () => {}, noun: "asset" });
  assert.equal(answer.message, "2 assets deleted.");
  assert.deepEqual(answer.missedIds, []);
});

test("the sentence reads for one row as well as forty", async () => {
  const answer = await runBulkDelete({ ids: ["a"], deleteOne: () => {}, noun: "vendor" });
  assert.equal(answer.message, "1 vendor deleted.");
});

test("a noun that does not pluralise with an s says so itself", async () => {
  const answer = await runBulkDelete({ ids: ["a", "b"], deleteOne: () => {}, noun: "entry", plural: "entries" });
  assert.equal(answer.message, "2 entries deleted.");
});

// ── what the route answers ───────────────────────────────────────────────────────────────────

test("a body that is not a list of ids is a 400, not a 500", async () => {
  const handler = bulkDeleteHandler({ deleteOne: () => {}, noun: "row" });
  assert.equal((await call(handler, {})).status, 400);
  assert.equal((await call(handler, { ids: "everything" })).status, 400);
});

/*
 * Nothing deleted is its own answer, and it is not the partial success above it. A reader who ticks
 * forty rows they may not touch has to be told the selection went nowhere - a 200 saying "0 rows
 * deleted" reads as the table having quietly emptied.
 */
test("a selection of which nothing could be deleted is a 404", async () => {
  const answer = await call(bulkDeleteHandler({
    deleteOne: () => { throw new Error("Not yours."); },
    noun: "entry",
    plural: "entries",
  }), { ids: ["a", "b"] });
  assert.equal(answer.status, 404);
  assert.equal(answer.body.message, "None of the selected entries could be deleted.");
  // Both lists still come back, so the bar leaves every row ticked rather than clearing a selection
  // that is still entirely there.
  assert.deepEqual(answer.body.data.missedIds, ["a", "b"]);
});

test("a partial delete is a 200 carrying both lists", async () => {
  const answer = await call(bulkDeleteHandler({
    deleteOne: (id) => { if (id === "no") throw new Error("Not yours."); },
    noun: "task",
  }), { ids: ["yes", "no"] });
  assert.equal(answer.status, 200);
  assert.deepEqual(answer.body.data.deletedIds, ["yes"]);
  assert.deepEqual(answer.body.data.missedIds, ["no"]);
});

// ── the guard ────────────────────────────────────────────────────────────────────────────────

/**
 * The layers a request passes through on the route `mountBulkDelete` registered.
 *
 * Read off the router rather than asserted about the source, because "is the guard mounted" is a
 * question about the stack express actually built - and a guard named in a comment and left off the
 * call is exactly the mistake this is here to catch.
 */
function bulkRouteLayers(router) {
  const layer = router.stack.find((entry) => entry.route?.path === "/bulk" && entry.route.methods.delete);
  return layer ? layer.route.stack.map((entry) => entry.handle) : null;
}

test("the route mounts ADMIN / Table Select All ahead of anything the module adds", () => {
  const router = express.Router();
  const moduleGuard = (req, res, next) => next();
  mountBulkDelete(router, { guard: moduleGuard, deleteOne: () => {}, noun: "asset" });

  const layers = bulkRouteLayers(router);
  assert.ok(layers, "DELETE /bulk was not registered");
  // Three: the select-all guard, the module's own, and the handler. In that order - the permission
  // to act on a selection at all is asked before the module is asked anything.
  assert.equal(layers.length, 3);
  assert.equal(layers[1], moduleGuard);
});

/*
 * A module that adds nothing still gets the select-all guard. This is the assertion that would have
 * caught an unguarded bulk delete, which is the one mistake in this change that would matter: every
 * router mounting one goes through this function, and none of them can end up with the handler
 * alone.
 */
test("a module that names no extra guard is still not left open", () => {
  const router = express.Router();
  mountBulkDelete(router, { deleteOne: () => {}, noun: "row" });
  assert.equal(bulkRouteLayers(router).length, 2);
});

test("a module may name several guards, and all of them are mounted", () => {
  const router = express.Router();
  const first = (req, res, next) => next();
  const second = (req, res, next) => next();
  mountBulkDelete(router, { guard: [first, second], deleteOne: () => {}, noun: "row" });

  const layers = bulkRouteLayers(router);
  assert.equal(layers.length, 4);
  assert.equal(layers[1], first);
  assert.equal(layers[2], second);
});

// ── how the modules wire it ──────────────────────────────────────────────────────────────────

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", "src", ...parts), "utf8");

/*
 * `/bulk` is a fixed segment. A router that matches `/:id` first reads it as a record named "bulk"
 * and answers 404 - a route in the wrong order wearing the costume of a missing record, which is
 * the hardest kind of bug to see in a router this long.
 */
test("every bulk delete is mounted above the id route it would otherwise be swallowed by", () => {
  const routers = [
    [["modules", "assets", "assets.routes.js"], 'router.delete(\n  "/:assetId"'],
    [["modules", "assets", "vendors.routes.js"], 'router.delete("/:vendorId"'],
    [["modules", "assets", "client-storage.routes.js"], 'router.delete("/:storageId"'],
    [["modules", "hrm", "tasks", "routes.js"], 'router.delete("/:id"'],
    [["modules", "accounts", "cash-entries", "routes.js"], 'router.delete("/:id"'],
    [["modules", "hrm", "master-data", "routes.js"], 'router.delete("/employees/:id"'],
    [["modules", "admin", "routes.js"], 'router.delete("/users/:userId"'],
  ];

  for (const [parts, idRoute] of routers) {
    const source = read(...parts);
    const mounted = source.indexOf("mountBulkDelete(router");
    assert.notEqual(mounted, -1, `${parts.join("/")} mounts no bulk delete`);
    assert.ok(mounted < source.indexOf(idRoute), `${parts.join("/")} mounts /bulk below its id route`);
  }
});

/*
 * And each one deletes through the module's own delete rather than its own query.
 *
 * This is the security argument in `bulkDelete.js` held to, module by module: nothing in the shared
 * service checks the ids, because only the module knows what makes a row reachable. A router that
 * handed over a bare `prisma.thing.delete` would pass every other test in this file and open a hole
 * that `ADMIN / Table Select All` does not close - that permission says the reader may act on a
 * selection, not that every id they can type belongs to them.
 */
test("no bulk route deletes with a query of its own", () => {
  for (const parts of [
    ["modules", "assets", "assets.routes.js"],
    ["modules", "assets", "vendors.routes.js"],
    ["modules", "assets", "client-storage.routes.js"],
    ["modules", "hrm", "tasks", "routes.js"],
    ["modules", "accounts", "cash-entries", "routes.js"],
    ["modules", "hrm", "master-data", "routes.js"],
    ["modules", "sales", "projects", "routes.js"],
    ["modules", "admin", "routes.js"],
  ]) {
    const source = read(...parts);
    for (const mount of source.matchAll(/mountBulkDelete\(router, \{[\s\S]*?\n\}\);|mountBulkDelete\(router, \{[^\n]*\}\);/g)) {
      assert.doesNotMatch(mount[0], /prisma\./, `${parts.join("/")} deletes through prisma rather than the module's own delete`);
      assert.match(mount[0], /deleteOne:/, `${parts.join("/")} mounts a bulk delete with no deleteOne`);
    }
  }
});
