const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/**
 * That no async function is handed to an array method that cannot await it.
 *
 * This exists because of a real bug on the Payment Requests screen. `toRow` is async, and the list
 * endpoint answered `res.json({ data: data.map(toRow) })` — an array of *promises*. `JSON.stringify`
 * renders a promise as `{}`, so the API returned one empty object per request: the right number of
 * rows, every cell blank, and every status tab reading zero because no row carried a status. Every
 * other caller in that file already awaited `toRow`; the list was the one that did not.
 *
 * Nothing caught it. It is valid JavaScript, the module loads, no error is thrown and no promise
 * rejects — the data is simply gone by the time it is serialised. Lint has no rule for it here, and
 * a unit test would have had to assert on response *content* to notice.
 *
 * So the guard is on the shape of the source: an async callback either gets collected
 * (`Promise.all`) or it is not passed to `map` at all.
 */

const SRC = path.join(__dirname, "..", "src");

/** Comments are stripped first: this file's own prose quotes the bug it is guarding against. */
function code(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function jsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFiles(full));
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

const ARRAY_METHOD = /\.(map|flatMap|filter|forEach|some|every|sort)\(\s*([A-Za-z_$][\w$]*)\s*\)/g;
const ASYNC_FUNCTION = /async\s+function\s+([A-Za-z_$][\w$]*)/g;
const ASYNC_ARROW = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*async\b/g;

test("no async function is passed bare to an array method", () => {
  const offences = [];
  for (const file of jsFiles(SRC)) {
    const text = code(fs.readFileSync(file, "utf8"));
    const declared = new Set([
      ...[...text.matchAll(ASYNC_FUNCTION)].map((match) => match[1]),
      ...[...text.matchAll(ASYNC_ARROW)].map((match) => match[1]),
    ]);
    if (!declared.size) continue;
    text.split("\n").forEach((line, index) => {
      for (const [, method, callback] of line.matchAll(ARRAY_METHOD)) {
        // `Promise.all(rows.map(toRow))` is the correct form and stays allowed.
        if (declared.has(callback) && !line.includes("Promise.all") && !line.includes("Promise.allSettled")) {
          offences.push(`${path.relative(SRC, file)}:${index + 1} — .${method}(${callback}), and ${callback} is async`);
        }
      }
    });
  }
  assert.deepEqual(offences, [], `an async callback is being dropped, not awaited:\n${offences.join("\n")}`);
});

test("an inline `.map(async …)` has its promises collected", () => {
  const offences = [];
  for (const file of jsFiles(SRC)) {
    const lines = code(fs.readFileSync(file, "utf8")).split("\n");
    lines.forEach((line, index) => {
      if (!/\.(map|flatMap)\(\s*async\b/.test(line)) return;
      // The collecting call often sits a line or two above the map it wraps.
      const window = lines.slice(Math.max(0, index - 3), index + 2).join("\n");
      if (!/Promise\.(all|allSettled)|for await/.test(window)) {
        offences.push(`${path.relative(SRC, file)}:${index + 1} — ${line.trim().slice(0, 90)}`);
      }
    });
  }
  assert.deepEqual(offences, [], `promises from an inline async map are never collected:\n${offences.join("\n")}`);
});
