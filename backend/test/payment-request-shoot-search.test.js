const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * An expense line's **Shoot ID** picker, searched on the server.
 *
 * What this pins is a bug that read as missing data. The picker was handed every live shoot up front,
 * capped at 200 and ordered by shoot date descending, and it filtered that list in the browser. So
 * the cap was not a page - it was the limit of what a line could ever name, and because the order put
 * the newest first, the shoots it dropped were the oldest: a studio's imported back catalogue was
 * precisely what an expense could not be filed against. Typing the id found nothing and the menu said
 * "No options available", which is the app saying the shoot does not exist.
 *
 * On the development database that was 200 of 986 shoots reachable.
 */

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const CONTROLLER = read("src/modules/hrm/payment-requests/controller.js");
const ROUTES = read("src/modules/hrm/payment-requests/routes.js");

test("the search runs over every shoot, not over a page of them", () => {
  const { searchShoots } = require("../src/modules/hrm/payment-requests/controller");
  assert.equal(typeof searchShoots, "function");
  // No project filter and no date floor: the only thing narrowing it is what was typed.
  const block = CONTROLLER.slice(CONTROLLER.indexOf("async function searchShoots"), CONTROLLER.indexOf("/** The vendors a request can be raised against"));
  assert.match(block, /where: \{ deletedAt: null, project: \{ deletedAt: null \} \},/);
  assert.doesNotMatch(block, /dateCreated: \{ gte/, "a shoot from last year is exactly what this has to find");
  assert.doesNotMatch(block, /projectId:\s*(search|req)/, "the project is derived from the shoot, never the other way about");
});

test("every word typed matches, in any order, against the id, the name and the project", () => {
  const block = CONTROLLER.slice(CONTROLLER.indexOf("async function searchShoots"), CONTROLLER.indexOf("/** The vendors a request can be raised against"));
  // Word Chunk Search, as the enquiry picker uses - now through the shared `searchPicker`, which
  // ANDs one clause per typed word beside whatever the caller already narrowed on.
  assert.match(block, /chunkIn: \(chunk\) => \[/);
  assert.match(read("src/services/pickerSearch.js"), /const chunks = everyChunk\(search, \(chunk\) => \(\{ OR: chunkIn\(chunk\) \}\)\);/);
  for (const field of ["shootId", "shoot", "eventId", "whatsappGroupName"]) {
    assert.match(block, new RegExp(`${field}: \\{ contains: chunk \\}`), `${field} is searched`);
  }
});

test("a page says it is a page, and the count is only paid for when the page is full", () => {
  const block = CONTROLLER.slice(CONTROLLER.indexOf("async function searchShoots"), CONTROLLER.indexOf("/** The vendors a request can be raised against"));
  // The page, the count and `capped` all come from the shared helper now, so they are the same
  // numbers and the same bargain in every picker rather than per module.
  const picker = read("src/services/pickerSearch.js");
  assert.match(picker, /const PICKER_PAGE = 50;/);
  assert.match(picker, /take = PICKER_PAGE/);
  assert.match(picker, /const total = rows\.length < take \? rows\.length : await model\.count\(\{ where: full \}\);/);
  assert.match(picker, /capped: total > rows\.length/);
  assert.match(CONTROLLER, /const SHOOT_PAGE = PICKER_PAGE;/);
  assert.match(block, /total,\n\s*capped,/);
});

test("the route sits above the id routes and behind the same permission as the rest", () => {
  assert.match(ROUTES, /router\.get\("\/shoots", controller\.searchShoots\);/);
  // Mounted after the router-wide guard, so a GET needs ACCOUNTS / Payment Request Read.
  const guardAt = ROUTES.indexOf('requireModule("ACCOUNTS", "Payment Request")');
  assert.ok(guardAt > 0 && ROUTES.indexOf('router.get("/shoots"') > guardAt, "guarded, not above the guard");
  // And above `/:id`, or "shoots" is read as an id.
  assert.ok(ROUTES.indexOf('router.get("/shoots"') < ROUTES.indexOf('router.get("/:id"'));
});

test("the options endpoint no longer pretends its list is everything", () => {
  const block = CONTROLLER.slice(CONTROLLER.indexOf("async function options"));
  const shoots = block.slice(block.indexOf("prisma.projectShoot.findMany"));
  assert.match(shoots.slice(0, 400), /take: SHOOT_PAGE/, "a page to open on, the same size as a page of search results");
  assert.doesNotMatch(shoots.slice(0, 400), /take: LOOKUP_LIMIT/, "200 of 986 was the whole bug");
});
