import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EVERY_PAGE_LIMIT, readEveryPage } from "../src/lib/everyPage.mjs";

/*
 * Assets, Vendors and Client Storage draw their whole list in the table and the board, but each
 * endpoint answers one page (default 50, capped at 100). They used to be asked once, so only the
 * first 50 records were ever drawn while the Assets footer counted the server's total. They now read
 * every page, and the footer counts the rows actually drawn.
 */

const root = path.join(import.meta.dirname, "..", "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

/** A stub endpoint over `count` rows numbered 1..count, answering the backend's pagination shape. */
function endpoint(count, extra = {}) {
  const calls = [];
  const rows = Array.from({ length: count }, (_, index) => ({ id: index + 1 }));
  const fetchPage = async (page, limit) => {
    calls.push({ page, limit });
    return { data: rows.slice((page - 1) * limit, page * limit), pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) }, ...extra };
  };
  return { calls, fetchPage };
}

test("every page is read, at the most the endpoints allow", async () => {
  const { calls, fetchPage } = endpoint(250);
  const result = await readEveryPage(fetchPage);
  assert.equal(EVERY_PAGE_LIMIT, 100);
  assert.deepEqual(calls, [{ page: 1, limit: 100 }, { page: 2, limit: 100 }, { page: 3, limit: 100 }]);
  assert.equal(result.data.length, 250);
  assert.deepEqual(result.data.map((row) => row.id), Array.from({ length: 250 }, (_, index) => index + 1));
});

test("the total is the rows returned, so the footer counts what is drawn", async () => {
  const result = await readEveryPage(endpoint(120).fetchPage);
  assert.equal(result.pagination.total, 120);
  assert.equal(result.pagination.total, result.data.length);
});

test("the first page's extras (counts, branches, canImport) are kept", async () => {
  const result = await readEveryPage(endpoint(5, { counts: { all: 5 }, canImport: true, branches: [{ id: 1 }] }).fetchPage);
  assert.deepEqual(result.counts, { all: 5 });
  assert.equal(result.canImport, true);
  assert.deepEqual(result.branches, [{ id: 1 }]);
});

test("a single page is one request, and an empty list is one request", async () => {
  const small = endpoint(40);
  assert.equal((await readEveryPage(small.fetchPage)).data.length, 40);
  assert.equal(small.calls.length, 1);
  const empty = endpoint(0);
  const result = await readEveryPage(empty.fetchPage);
  assert.deepEqual(result.data, []);
  assert.equal(result.pagination.total, 0);
  assert.equal(empty.calls.length, 1);
});

test("a row that shifts between two reads is drawn once, and a list that shrank stops early", async () => {
  const pages = { 1: [{ id: 1 }, { id: 2 }], 2: [{ id: 2 }, { id: 3 }], 3: [] };
  const calls = [];
  const result = await readEveryPage(async (page) => { calls.push(page); return { data: pages[page], pagination: { total: 8, totalPages: 4 } }; }, 2);
  assert.deepEqual(result.data.map((row) => row.id), [1, 2, 3]);
  assert.deepEqual(calls, [1, 2, 3]);
});

test("a failed page fails the read rather than drawing half a list", async () => {
  await assert.rejects(readEveryPage(async (page) => {
    if (page === 2) throw new Error("boom");
    return { data: [{ id: 1 }], pagination: { total: 2, totalPages: 2 } };
  }, 1), /boom/);
});

test("the three registers read every page for their table and board", () => {
  const service = read("frontend", "src", "services", "assets", "assets.service.js");
  assert.match(service, /export const getAllAssets = \(params\) => readEveryPage\(\(page, limit\) => getAssets\(\{ \.\.\.params, page, limit \}\)\)/);
  assert.match(service, /export const getAllVendors = \(params\) => readEveryPage\(\(page, limit\) => getVendors\(\{ \.\.\.params, page, limit \}\)\)/);
  assert.match(service, /export const getAllClientStorageRecords = \(params\) => readEveryPage\(\(page, limit\) => getClientStorageRecords\(\{ \.\.\.params, page, limit \}\)\)/);

  const assets = read("frontend", "src", "components", "assets", "AssetManagementPage.js");
  assert.equal((assets.match(/getAllAssets\(\{/g) || []).length, 3, "the load, the reload after a save and the reload after an inspection");
  // The status counts still ask for one row each: they read only `pagination.total`.
  assert.match(assets, /const base = \{ branchIds: branchQuery, limit: 1 \}/);

  const vendors = read("frontend", "src", "components", "assets", "VendorManagementView.js");
  assert.match(vendors, /await getAllVendors\(\{ status:/);
  assert.doesNotMatch(vendors, /await getVendors\(/);

  const storage = read("frontend", "src", "components", "assets", "ClientStorageManagementView.js");
  assert.match(storage, /await getAllClientStorageRecords\(/);
  assert.doesNotMatch(storage, /await getClientStorageRecords\(/);
});

test("Asset Requests reads every page too; its pending count still asks for one row", () => {
  const service = fs.readFileSync(new URL("../src/services/assets/assets.service.js", import.meta.url), "utf8");
  assert.match(service, /export const getAllAssetRequests = \(params\) => readEveryPage\(\(page, limit\) => getAssetRequests\(\{ \.\.\.params, page, limit \}\)\);/);
  const page = fs.readFileSync(new URL("../src/components/assets/AssetManagementPage.js", import.meta.url), "utf8");
  assert.doesNotMatch(page, /getAssetRequests\(\{ limit: 100 \}\)/);
  assert.equal((page.match(/getAllAssetRequests\(\)/g) || []).length, 2);
  assert.match(page, /getAssetRequests\(\{ status: "PENDING", limit: 1 \}\)/);
});
