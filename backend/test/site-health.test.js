const test = require("node:test");
const assert = require("node:assert/strict");
const { healthUrl, checkSite, summarizeHealth } = require("../src/modules/subscribe/client-onboarding/siteHealth");

const NOW = new Date("2026-11-04T14:00:00Z");
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test("each client's health address is its subdomain's /api/health", () => {
  assert.equal(healthUrl("velava"), "https://velava.beamcraft.tech/api/health");
  assert.equal(healthUrl("velava", "http://localhost:5001/api/health?site={subdomain}"), "http://localhost:5001/api/health?site=velava");
});

test("a site answering 200 is up, with its response time and the version it reports", async () => {
  let clock = 1000;
  const result = await checkSite("velava", { fetchImpl: async () => { clock += 230; return response(200, { ok: true, version: "1.4.2" }); }, now: () => clock });
  assert.deepEqual(result, { ok: true, statusCode: 200, responseMs: 230, version: "1.4.2", error: null });
});

test("an error status, or no answer at all, is down with the reason", async () => {
  const failing = await checkSite("velava", { fetchImpl: async () => response(502, {}), now: () => 0 });
  assert.equal(failing.ok, false);
  assert.equal(failing.statusCode, 502);
  assert.match(failing.error, /502/);
  const unreachable = await checkSite("velava", { fetchImpl: async () => { throw new Error("getaddrinfo ENOTFOUND velava.beamcraft.tech"); }, now: () => 0 });
  assert.equal(unreachable.ok, false);
  assert.equal(unreachable.statusCode, null);
  assert.match(unreachable.error, /ENOTFOUND/);
});

test("the summary is the latest check, plus uptime over the last 24 hours", () => {
  const at = (minutesAgo) => new Date(NOW.getTime() - minutesAgo * 60_000);
  const checks = [
    { checkedAt: at(5), ok: true, responseMs: 210, version: "1.4.2" },
    { checkedAt: at(10), ok: false, responseMs: null, version: null },
    { checkedAt: at(15), ok: true, responseMs: 250, version: "1.4.1" },
    { checkedAt: at(20), ok: true, responseMs: 240, version: "1.4.1" },
    { checkedAt: at(60 * 25), ok: false, responseMs: null, version: null },
  ];
  assert.deepEqual(summarizeHealth(checks, NOW), { status: "Up", lastCheckedAt: at(5), responseMs: 210, siteVersion: "1.4.2", uptime24h: 75, error: null });
  assert.deepEqual(summarizeHealth([], NOW), { status: null, lastCheckedAt: null, responseMs: null, siteVersion: null, uptime24h: null, error: null });
});

test("network failures read in plain words", async () => {
  const failWith = (code) => checkSite("velava", { fetchImpl: async () => { throw Object.assign(new Error("fetch failed"), { cause: { code } }); }, now: () => 0 });
  assert.equal((await failWith("ENOTFOUND")).error, "The address does not exist yet - this subdomain is not set up on the internet.");
  assert.equal((await failWith("ECONNREFUSED")).error, "Nothing is answering at this address - the site is not running.");
  assert.equal((await failWith("CERT_HAS_EXPIRED")).error, "The site's security certificate is not valid.");
});
