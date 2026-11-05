const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRateLimiter, hashedKey, clientIp } = require("../src/middleware/rateLimit");

/*
 * Signing in had no limit.
 *
 * The forgot-password and OTP routes were throttled and `/login` was not, so the one route that
 * checks a password could be hit with guesses as fast as bcrypt would answer them - and bcrypt is
 * slow on purpose, so every guess cost the server more than the caller. `/reset-password` and
 * `/refresh` take a token the same way. These pin that all three sit behind the limiter, and the two
 * properties the login limiter's shape depends on: a tight budget for the thing being attacked that
 * counts *failures* only, so ten junk requests at somebody's address cannot lock them out; and a
 * wide one for the address, which behind nginx is the whole studio - read from the end of
 * `X-Forwarded-For`, where nginx writes, not the start, where the caller does.
 */

const ROUTES = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "authRoutes.js"), "utf8");
const number = (name) => Number(new RegExp(`${name} \\|\\| (\\d+)`).exec(ROUTES)[1]);

/**
 * The smallest thing the middleware will accept as a request/response pair. `outcome` is the status
 * the handler would have answered with; the stub finishes the response with it so a forgiving bucket
 * can decide. A refused request never reaches the handler, so it never finishes.
 */
const call = (limiter, req = {}, outcome = 200) => new Promise((resolve) => {
  const headers = {};
  const listeners = [];
  const res = {
    set: (name, value) => { headers[name] = value; return res; },
    status: (code) => { res.code = code; return res; },
    json: (body) => { resolve({ code: res.code, body, headers }); return res; },
    on: (event, fn) => { if (event === "finish") listeners.push(fn); },
  };
  limiter(req, res, () => {
    res.statusCode = outcome;
    for (const fn of listeners) fn();
    resolve({ code: outcome, headers });
  });
});

/** The login limiter with the route's own key shape and numbers, read from the source. */
const loginLimiter = () => {
  const perAccount = number("LOGIN_MAX_PER_ACCOUNT_WINDOW");
  const perAccountAnywhere = number("LOGIN_MAX_PER_ACCOUNT_ANYWHERE_WINDOW");
  const perIp = number("LOGIN_MAX_PER_IP_WINDOW");
  const limiter = createRateLimiter({
    windowMs: 60_000,
    max: perAccount,
    keys: (req) => {
      const account = String(req.body?.email || req.body?.username || "").trim().toLowerCase();
      return [
        { key: `login:${account}@${req.ip}`, max: perAccount, forgiving: true },
        { key: `login:${account}`, max: perAccountAnywhere, forgiving: true },
        { key: `ip:${req.ip}`, max: perIp },
      ];
    },
    forgiveOn: (res) => res.statusCode < 300,
    message: () => "Too many sign-in attempts.",
  });
  return { limiter, perAccount, perAccountAnywhere, perIp };
};

const attempt = (limiter, email, ip, outcome) => call(limiter, { body: { email, password: "x" }, ip }, outcome);

test("every credential-taking auth route is behind a limiter", () => {
  assert.match(ROUTES, /router\.post\("\/login", loginLimiter, login\)/, "/login takes passwords unthrottled");
  assert.match(ROUTES, /router\.post\("\/reset-password", resetPasswordLimiter, resetPassword\)/, "/reset-password takes tokens unthrottled");
  assert.match(ROUTES, /router\.post\("\/refresh", refreshLimiter, refreshSession\)/, "/refresh takes tokens unthrottled");
  // The ones that were already there stay there.
  assert.match(ROUTES, /router\.post\("\/forgot-password", forgotPasswordLimiter, requestPasswordReset\)/);
  assert.match(ROUTES, /router\.post\("\/forgot-password\/otp", otpLimiter, requestPasswordResetOtp\)/);
});

test("the route's login limiter counts failures on the account buckets and everything on the address", () => {
  assert.match(ROUTES, /key: `login:\$\{account\}@\$\{ip\}`, max: loginMaxPerAccount, forgiving: true/);
  assert.match(ROUTES, /key: `login:\$\{account\}`, max: loginMaxPerAccountAnywhere, forgiving: true/);
  assert.match(ROUTES, /key: `ip:\$\{ip\}`, max: loginMaxPerIp \}/, "the address bucket must not be forgiving");
  assert.match(ROUTES, /forgiveOn: \(res\) => res\.statusCode < 300/);
  const { perAccount, perAccountAnywhere, perIp } = loginLimiter();
  assert.ok(perAccount >= 5 && perAccount <= 20, `${perAccount} per account: a person who mistypes twice must not be locked out, a script must be`);
  assert.ok(perAccountAnywhere > perAccount, "the account-wide ceiling must be the looser one");
  assert.ok(perIp > perAccountAnywhere, "one office connection is held to one account's allowance");
});

test("a guessing script is stopped at the account, whatever it sends as the password", async () => {
  const { limiter, perAccount } = loginLimiter();
  for (let i = 0; i < perAccount; i += 1) {
    assert.equal((await attempt(limiter, "target@example.com", "10.0.0.1", 401)).code, 401, `attempt ${i + 1} refused before the budget was spent`);
  }
  assert.equal((await attempt(limiter, "target@example.com", "10.0.0.1", 401)).code, 429);
  // Case does not buy a fresh budget.
  assert.equal((await attempt(limiter, "Target@Example.com", "10.0.0.1", 401)).code, 429);
  // And a colleague on the same connection still signs in.
  assert.equal((await attempt(limiter, "someone@example.com", "10.0.0.1", 200)).code, 200);
});

test("signing in correctly spends nothing, however often it is done", async () => {
  const { limiter, perAccount } = loginLimiter();
  for (let i = 0; i < perAccount * 3; i += 1) {
    assert.equal((await attempt(limiter, "owner@example.com", "10.0.0.5", 200)).code, 200, `sign-in ${i + 1} refused`);
  }
  // A failure after all that is still only the first failure.
  assert.equal((await attempt(limiter, "owner@example.com", "10.0.0.5", 401)).code, 401);
});

test("junk requests at somebody's address from elsewhere do not lock them out", async () => {
  /*
   * The lock-out that the first shape allowed: an address is guessable, and ten requests at it
   * from anywhere filled the owner's budget whether or not they were the owner. Now the tight
   * bucket is per account *and* address, so the attacker fills their own.
   */
  const { limiter, perAccount } = loginLimiter();
  for (let i = 0; i < perAccount + 5; i += 1) {
    await attempt(limiter, "victim@example.com", "203.0.113.9", 401);
  }
  assert.equal((await attempt(limiter, "victim@example.com", "203.0.113.9", 401)).code, 429, "the attacker's own bucket should be full");
  assert.equal((await attempt(limiter, "victim@example.com", "10.0.0.6", 200)).code, 200, "the owner was locked out by somebody else's junk");
});

test("failures from many addresses meet the account-wide ceiling", async () => {
  const { limiter, perAccountAnywhere } = loginLimiter();
  for (let i = 0; i < perAccountAnywhere; i += 1) {
    const answer = await attempt(limiter, "victim@example.com", `198.51.100.${i}`, 401);
    assert.equal(answer.code, 401, `failure ${i + 1} refused before the ceiling`);
  }
  assert.equal((await attempt(limiter, "victim@example.com", "198.51.100.250", 401)).code, 429);
});

test("a username sign-in is budgeted the same way as an email one", async () => {
  const { limiter, perAccount } = loginLimiter();
  for (let i = 0; i < perAccount; i += 1) {
    await call(limiter, { body: { username: "anu", password: "x" }, ip: "10.0.0.2" }, 401);
  }
  assert.equal((await call(limiter, { body: { username: "ANU", password: "x" }, ip: "10.0.0.2" }, 401)).code, 429);
});

test("a list worked through from one address is stopped at the address, sign-ins included", async () => {
  const { limiter, perIp } = loginLimiter();
  for (let i = 0; i < perIp; i += 1) {
    await attempt(limiter, `user${i}@example.com`, "10.0.0.3", i % 2 ? 200 : 401);
  }
  const refused = await attempt(limiter, "fresh@example.com", "10.0.0.3", 200);
  assert.equal(refused.code, 429);
  // The refusal says when to come back, and says it as JSON the frontend can show.
  assert.ok(Number(refused.headers["Retry-After"]) >= 1, "no Retry-After on a 429");
  assert.equal(typeof refused.body.message, "string");
});

test("the reset and refresh limiters key on a hash of the token, never on the token itself", () => {
  // A token is a credential; the limiter holds its keys in memory for the window.
  assert.match(ROUTES, /key: `reset:\$\{hashedKey\(req\.body\?\.token\)\}`/, "the reset token is used raw as a bucket key");
  assert.match(ROUTES, /key: `refresh:\$\{hashedKey\(req\.body\?\.refreshToken\)\}`/, "the refresh token is used raw as a bucket key");
  assert.doesNotMatch(ROUTES, /createHash\(/, "the hash helper is copied into the routes instead of taken from rateLimit.js");
  const token = "a-secret-token";
  assert.notEqual(hashedKey(token), token);
  assert.equal(hashedKey(token).length, 16);
  assert.equal(hashedKey(token), hashedKey(token), "the same token must land in the same bucket");
  assert.notEqual(hashedKey(token), hashedKey("another"), "two tokens share a bucket");
});

test("one token is refused after its budget, and a fresh token is not", async () => {
  // The reset and refresh limiters, with the route's own key shape: per token tight, per address wide.
  const perToken = 10;
  const limiter = createRateLimiter({
    windowMs: 60_000,
    max: perToken,
    keys: (req) => [
      { key: `reset:${hashedKey(req.body?.token)}`, max: perToken },
      { key: `ip:${req.ip}`, max: 30 },
    ],
    message: () => "Too many attempts.",
  });
  for (let i = 0; i < perToken; i += 1) {
    assert.equal((await call(limiter, { body: { token: "victim-token", password: "x" }, ip: "10.0.0.4" })).code, 200);
  }
  assert.equal((await call(limiter, { body: { token: "victim-token", password: "x" }, ip: "10.0.0.4" })).code, 429);
  assert.equal((await call(limiter, { body: { token: "another-token", password: "x" }, ip: "10.0.0.4" })).code, 200);
});

test("the refresh address budget is wider than the login one, because every desktop refreshes", () => {
  assert.ok(number("AUTH_REFRESH_MAX_PER_IP_WINDOW") > number("LOGIN_MAX_PER_IP_WINDOW"), "a studio's desktops behind one address would be refused refreshes before sign-ins");
});

test("behind nginx the caller's address is the one nginx appended, not the one the caller wrote", () => {
  /*
   * `proxy_add_x_forwarded_for` appends the address nginx saw after whatever the client sent, so the
   * first entry is the caller's to invent. Reading it let a caller mint a fresh address per request
   * and walk through every per-address budget.
   */
  const previous = { header: process.env.TRUST_PROXY_HEADER, hops: process.env.TRUST_PROXY_HOPS };
  try {
    const req = { headers: { "x-forwarded-for": "1.1.1.1, 203.0.113.7" }, ip: "127.0.0.1" };
    process.env.TRUST_PROXY_HEADER = "";
    assert.equal(clientIp(req), "127.0.0.1", "the header must be ignored where no proxy is trusted");
    process.env.TRUST_PROXY_HEADER = "true";
    delete process.env.TRUST_PROXY_HOPS;
    assert.equal(clientIp(req), "203.0.113.7", "the caller's own entry was trusted");
    process.env.TRUST_PROXY_HOPS = "2";
    assert.equal(clientIp(req), "1.1.1.1", "two proxies of ours: the entry before the last is the caller");
    assert.equal(clientIp({ headers: {}, ip: "10.0.0.8" }), "10.0.0.8", "no header falls back to the socket");
  } finally {
    if (previous.header === undefined) delete process.env.TRUST_PROXY_HEADER; else process.env.TRUST_PROXY_HEADER = previous.header;
    if (previous.hops === undefined) delete process.env.TRUST_PROXY_HOPS; else process.env.TRUST_PROXY_HOPS = previous.hops;
  }
});
