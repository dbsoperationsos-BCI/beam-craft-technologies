const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { likeLiteral, everyChunk, matchesWordChunks, wordChunks } = require("../src/services/wordChunks");

/*
 * A search is matched as the characters typed. Prisma's `contains` and the raw-SQL searches become
 * MySQL `LIKE '%…%'`, which reads `%` as "anything", `_` as "any one character" and `\` as its escape -
 * so before `likeLiteral` a typed `%` found every row and `file_name` found `fileXname`. The rest of
 * the punctuation was always a bound value and is matched as itself.
 */

// MySQL's LIKE, default escape `\`, case-insensitive as the studio's collation is.
function mysqlLike(value, pattern) {
  let regex = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "\\" && index + 1 < pattern.length) { regex += pattern[index + 1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); index += 1; }
    else if (char === "%") regex += "[\\s\\S]*";
    else if (char === "_") regex += "[\\s\\S]";
    else regex += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${regex}$`, "i").test(value);
}
// A Word Chunk search the way a Prisma screen runs it: every chunk, each a `contains`.
const prismaSearch = (rows, query) => {
  const clauses = everyChunk(query, (chunk) => chunk);
  return rows.filter((row) => clauses.every((chunk) => mysqlLike(row, `%${chunk}%`)));
};

const ROWS = [
  "WED other studio", "John's Album", "A&B Studio", "Order #123", "100% done", "1000 photos", "file_name.jpg", "fileXname.jpg",
  "C++ workshop", "a/b split", "\"quoted text\" here", "<test> tag", "back\\slash", "Ravi Kumar", "ராஜா திருமணம்", "Café Noir",
];

test("likeLiteral escapes exactly the three LIKE characters and nothing else", () => {
  assert.equal(likeLiteral("100%"), "100\\%");
  assert.equal(likeLiteral("file_name"), "file\\_name");
  assert.equal(likeLiteral("back\\slash"), "back\\\\slash");
  for (const plain of ["C++", "John's", "A&B", "#123", "a/b", "<test>", "\"q\"", "(x)", "[y]", "{z}", "ராஜா", "' OR 1=1 --"]) assert.equal(likeLiteral(plain), plain);
  assert.equal(likeLiteral(null), "");
});

test("every special-character query is accepted and matches only rows that hold it", () => {
  const expect = (query, rows) => assert.deepEqual(prismaSearch(ROWS, query), rows, query);
  expect("WED other", ["WED other studio"]);
  expect("we ot", ["WED other studio"]);
  expect("John's Album", ["John's Album"]);
  expect("A&B Studio", ["A&B Studio"]);
  expect("#123", ["Order #123"]);
  expect("100%", ["100% done"]); // not "1000 photos"
  expect("file_name", ["file_name.jpg"]); // not "fileXname.jpg"
  expect("C++", ["C++ workshop"]);
  expect("a/b", ["a/b split"]);
  expect("\"quoted text\"", ["\"quoted text\" here"]);
  expect("<test>", ["<test> tag"]);
  expect("back\\slash", ["back\\slash"]);
  expect("ராஜா", ["ராஜா திருமணம்"]);
  expect("%", ["100% done"]);
  expect("_", ["file_name.jpg"]);
  expect("~!@#$%^&*()_+-={}[]:;\"'?,./\\|", []);
  expect("' OR 1=1 --", []);
});

test("a blank or spaces-only query is no filter; extra spaces change nothing", () => {
  assert.deepEqual(everyChunk("", (chunk) => chunk), []);
  assert.deepEqual(everyChunk("   ", (chunk) => chunk), []);
  assert.deepEqual(prismaSearch(ROWS, "  WED    other  "), ["WED other studio"]);
});

test("the in-memory matcher already matched characters literally, and still does", () => {
  assert.equal(matchesWordChunks("100% done", "100%"), true);
  assert.equal(matchesWordChunks("1000 photos", "100%"), false);
  assert.equal(matchesWordChunks("file_name", "file_name"), true);
  assert.equal(matchesWordChunks("fileXname", "file_name"), false);
  assert.deepEqual(wordChunks("C++  (x)"), ["C++", "(x)"], "chunks themselves are never escaped");
});

test("every raw-SQL LIKE search escapes what was typed", () => {
  const read = (file) => fs.readFileSync(path.join(__dirname, "../src", file), "utf8");
  assert.match(read("modules/sales/crm-leads/leadQueryService.js"), /params\.push\(`%\$\{likeLiteral\(chunk\)\}%`\)/);
  const calls = read("modules/sales/crm-leads/callBoardService.js");
  assert.match(calls, /params\.push\(`%\$\{likeLiteral\(chunk\)\}%`\)/);
  assert.match(calls, /values\.map\(\(entry\) => `%\$\{likeLiteral\(entry\)\}%`\)/);
  assert.match(read("modules/sales/crm-reports/filters.js"), /const like = `%\$\{likeLiteral\(chunk\)\}%`;/);
  assert.match(read("services/ai/tools/sales.js"), /const like = `%\$\{likeLiteral\(search\)\}%`;/);
  // Nothing anywhere builds a LIKE pattern from an unescaped search value.
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js") && /`%\$\{(?!likeLiteral\()/.test(fs.readFileSync(full, "utf8"))) offenders.push(path.relative(path.join(__dirname, "../src"), full));
    }
  };
  walk(path.join(__dirname, "../src"));
  assert.deepEqual(offenders, []);
});
