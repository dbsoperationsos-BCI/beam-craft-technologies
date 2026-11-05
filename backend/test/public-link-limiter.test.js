const test = require("node:test");
const assert = require("node:assert/strict");
const { createPublicLinkLimiter, networkOf } = require("../src/middleware/rateLimit");

/*
 * The pages opened by a link alone - the onboarding and interview forms, the CRD form, a quotation.
 *
 * The onboarding and interview forms counted every request, sixty a quarter-hour per address, and
 * behind nginx the address can be the whole studio. One form is several requests, so HR opening a
 * day's onboarding links one after another was refused "Too many requests" by the fifteenth or so -
 * while the CRD form and the quotation sheet had no limit at all. A real link never misses, so only
 * a *miss* is counted: anybody opening real links is never refused, and somebody walking the code
 * space spends thirty misses and is stopped. A wide ceiling on every request still bounds a flood.
 */

// `statusCode` is set only once the stub handler answers, as Express sets it when a response is sent.
const call = (limiter, outcome = 200, ip = "203.0.113.7", { miss = false } = {}) => new Promise((resolve) => {
  const listeners = [];
  const res = {
    locals: {},
    set: () => res,
    status: (code) => { res.code = code; return res; },
    json: () => { resolve(res.code); return res; },
    on: (event, fn) => { if (event === "finish") listeners.push(fn); },
  };
  limiter({ ip, headers: {}, params: {} }, res, () => {
    res.statusCode = outcome;
    if (miss) res.locals.linkMiss = true;
    for (const fn of listeners) fn();
    resolve(outcome);
  });
});

test("opening a hundred real links in a row is never refused", async () => {
  const limiter = createPublicLinkLimiter("test-real");
  for (let index = 0; index < 100; index += 1) assert.equal(await call(limiter, 200), 200);
});

test("thirty links that do not exist stop the address, real links included", async () => {
  const limiter = createPublicLinkLimiter("test-guess");
  for (let index = 0; index < 30; index += 1) assert.equal(await call(limiter, 404), 404);
  assert.equal(await call(limiter, 200), 429);
  // Another address is untouched by somebody else's guessing.
  assert.equal(await call(limiter, 200, "198.51.100.9"), 200);
});

test("an expired or refused link counts as a miss too", async () => {
  const limiter = createPublicLinkLimiter("test-gone");
  for (let index = 0; index < 15; index += 1) await call(limiter, 410);
  for (let index = 0; index < 15; index += 1) await call(limiter, 400);
  assert.equal(await call(limiter, 200), 429);
});

test("every request is still bounded, so a flood of real links is stopped", async () => {
  const limiter = createPublicLinkLimiter("test-flood", { maxRequests: 50 });
  for (let index = 0; index < 50; index += 1) await call(limiter, 200);
  assert.equal(await call(limiter, 200), 429);
});

const ROUTERS = {
  onboarding: "../src/modules/hrm/onboarding-invites/publicRoutes",
  interview: "../src/modules/hrm/interview/publicRoutes",
  crd: "../src/modules/sales/crd-documents/publicRoutes",
};

// Read from the router itself rather than its source, so a limiter mounted after a handler fails.
for (const [name, file] of Object.entries(ROUTERS)) {
  test(`the ${name} link pages are limited before anything answers them`, () => {
    const router = require(file);
    assert.equal(router.stack[0].handle.name, "rateLimit");
  });
}

test("the quotation sheet, its PDF and its payment details spend one budget of misses", () => {
  const router = require("../src/modules/sales/quotations-public/routes");
  const first = (path) => router.stack.find((layer) => layer.route?.path === path).route.stack[0].handle;
  assert.equal(first("/:token").name, "rateLimit");
  assert.equal(first("/:token/pdf"), first("/:token"));
  assert.equal(first("/:token/payment"), first("/:token"));
});

test("a refusal answered with a redirect is still a miss", async () => {
  const limiter = createPublicLinkLimiter("test-redirect");
  for (let index = 0; index < 30; index += 1) await call(limiter, 303, undefined, { miss: true });
  assert.equal(await call(limiter, 200), 429);
});

test("the quotation PDF marks a refusal it redirects as a miss", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "src", "modules", "sales", "projects", "controller.js"), "utf8");
  assert.match(source, /res\.locals\.linkMiss = true;\s*return page \? backToPage\(res, `\$\{frontendOrigin\(\)\}\/q\/\$\{token\}`\)/);
});

test("a burst of guesses sent at once lets no more than the budget through", async () => {
  const limiter = createPublicLinkLimiter("test-burst");
  const answers = await Promise.all(Array.from({ length: 100 }, () => call(limiter, 404)));
  assert.equal(answers.filter((code) => code === 404).length, 30);
});

test("an IPv6 connection is counted once, however many of its addresses it uses", async () => {
  assert.equal(networkOf("2001:db8:1:2:aaaa::1"), "2001:db8:1:2::/64");
  assert.equal(networkOf("2001:db8:1:2:ffff:ffff:ffff:ffff"), "2001:db8:1:2::/64");
  assert.equal(networkOf("2001:db8::7"), "2001:db8:0:0::/64");
  assert.equal(networkOf("::ffff:203.0.113.7"), "203.0.113.7");
  assert.equal(networkOf("203.0.113.7"), "203.0.113.7");
  const limiter = createPublicLinkLimiter("test-ipv6");
  for (let index = 0; index < 30; index += 1) await call(limiter, 404, `2001:db8:1:2::${index.toString(16)}`);
  assert.equal(await call(limiter, 200, "2001:db8:1:2::ffff"), 429);
});

test("one page's misses are not another's", async () => {
  const guessed = createPublicLinkLimiter("test-one");
  const other = createPublicLinkLimiter("test-two");
  for (let index = 0; index < 30; index += 1) await call(guessed, 404);
  assert.equal(await call(other, 200), 200);
});
