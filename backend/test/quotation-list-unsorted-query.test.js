const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * The quotation register reads every live quotation with its whole JSON payload. Sorted by MySQL,
 * those payloads went through the server's sort buffer, and once the register outgrew it the query
 * failed with "Out of sort memory" (MySQL 1038) and the register read as empty in production. The
 * rows are read unsorted and ordered in the code instead.
 */
const CONTROLLER = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "projects", "controller.js"), "utf8");

test("the register's query asks MySQL for no sort, and the code orders the rows instead", () => {
  const body = CONTROLLER.slice(CONTROLLER.indexOf("async function listQuotations("), CONTROLLER.indexOf("const narrowed = enquiryId ?"));
  assert.match(body, /prisma\.salesQuotation\.findMany\(\{[\s\S]*?\}\)\)\.sort\(byChainThenNewestVersion\);/);
  assert.doesNotMatch(body, /orderBy:/);
});

test("the order is the one the query used to ask for: chain ascending, newest version first", () => {
  const source = CONTROLLER.slice(CONTROLLER.indexOf("function byChainThenNewestVersion("), CONTROLLER.indexOf("async function listQuotations("));
  const byChainThenNewestVersion = new Function(`${source}; return byChainThenNewestVersion;`)();
  const rows = [
    { id: 1, quotationNumber: "QUT002", version: 1 },
    { id: 2, quotationNumber: "QUT001", version: 1 },
    { id: 3, quotationNumber: "QUT002", version: 3 },
    { id: 4, quotationNumber: "QUT001", version: 2 },
  ];
  assert.deepEqual(rows.sort(byChainThenNewestVersion).map((row) => row.id), [4, 2, 3, 1]);
});
