const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * Assets, Vendors and Client Storage are now read page by page until every record is drawn
 * (frontend `readEveryPage`). Paging over `createdAt` alone is unstable: a bulk entry or an import
 * writes many rows in the same instant, and MySQL may order ties differently on each page's read, so
 * a record could be skipped on one page and repeated on the next. Each list breaks the tie on `id`.
 * The page cap (100) is unchanged, and so is every filter beside the order.
 */

const read = (file) => fs.readFileSync(path.join(__dirname, "..", "src", "modules", "assets", file), "utf8");
const stableOrder = /orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\], skip: \(input\.page - 1\) \* input\.limit, take: input\.limit/;

for (const [file, model] of [["assets.controller.js", "asset"], ["vendors.controller.js", "vendor"], ["client-storage.controller.js", "clientStorage"]]) {
  test(`${file}: the ${model} list pages in a stable order and keeps its 100 cap`, () => {
    const source = read(file);
    const list = source.slice(source.indexOf(`prisma.${model}.findMany({ where`));
    assert.match(list.slice(0, 300), stableOrder);
    assert.match(source, /limit: z\.coerce\.number\(\)\.int\(\)\.min\(1\)\.max\(100\)\.default\(50\)/);
  });
}

test("Asset Requests pages in the same stable order", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "src", "modules", "assets", "asset-requests.controller.js"), "utf8");
  assert.match(source, /orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\], skip: \(input\.page - 1\) \* input\.limit/);
});
