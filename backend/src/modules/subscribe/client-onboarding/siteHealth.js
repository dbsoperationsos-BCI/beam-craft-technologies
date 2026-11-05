const prisma = require("../../../config/db");

/**
 * Whether each live client's site is up: Beam Craft asks the site's own `/api/health` (what DBS-Operations-OS
 * already answers, and what each client app answers), records the answer, and the SUBSCRIBE pages read it.
 */

const DEFAULT_URL_TEMPLATE = "https://{subdomain}.beamcraft.tech/api/health";
const TIMEOUT_MS = 10_000;
const DAY_MS = 24 * 60 * 60 * 1000;
// Older checks are only history nobody reads; a week is kept, and the rest pruned on each round.
const KEEP_MS = 7 * DAY_MS;

/** The address a client's site answers health on. `SITE_HEALTH_URL_TEMPLATE` points it elsewhere locally. */
function healthUrl(subdomain, template = process.env.SITE_HEALTH_URL_TEMPLATE || DEFAULT_URL_TEMPLATE) {
  return template.replaceAll("{subdomain}", encodeURIComponent(subdomain));
}

// What the common network failures mean, for the people reading the SUBSCRIBE page.
const PLAIN_REASONS = {
  ENOTFOUND: "The address does not exist yet - this subdomain is not set up on the internet.",
  EAI_AGAIN: "The address could not be looked up right now.",
  ECONNREFUSED: "Nothing is answering at this address - the site is not running.",
  ECONNRESET: "The site dropped the connection.",
};

/** One check: up when the site answers 2xx in time, with how long it took and the version it reports. */
async function checkSite(subdomain, { fetchImpl = fetch, now = () => Date.now(), timeoutMs = TIMEOUT_MS } = {}) {
  const started = now();
  try {
    const answer = await fetchImpl(healthUrl(subdomain), { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: "application/json" } });
    const responseMs = Math.max(0, Math.round(now() - started));
    let body = null;
    try { body = await answer.json(); } catch { body = null; }
    const version = typeof body?.version === "string" ? body.version.slice(0, 40) : null;
    if (!answer.ok) return { ok: false, statusCode: answer.status, responseMs, version, error: `The site answered ${answer.status}.` };
    return { ok: true, statusCode: answer.status, responseMs, version, error: null };
  } catch (error) {
    const code = error?.cause?.code;
    const reason = error?.name === "TimeoutError" ? `No answer within ${Math.round(timeoutMs / 1000)} seconds.`
      : PLAIN_REASONS[code] || (/CERT|SSL|TLS/.test(String(code)) ? "The site's security certificate is not valid." : String(code || error?.message || "Unreachable"));
    return { ok: false, statusCode: null, responseMs: null, version: null, error: reason.slice(0, 300) };
  }
}

/** The latest check, and the share of the last day's checks that were up (a whole percent, or null). */
function summarizeHealth(checks, now = new Date()) {
  const sorted = [...(checks || [])].sort((a, b) => new Date(b.checkedAt) - new Date(a.checkedAt));
  const latest = sorted[0];
  const lastDay = sorted.filter((check) => now - new Date(check.checkedAt) <= DAY_MS);
  return {
    status: latest ? (latest.ok ? "Up" : "Down") : null,
    lastCheckedAt: latest ? latest.checkedAt : null,
    responseMs: latest?.responseMs ?? null,
    siteVersion: latest?.version ?? null,
    uptime24h: lastDay.length ? Math.round((lastDay.filter((check) => check.ok).length / lastDay.length) * 1000) / 10 : null,
    error: latest && !latest.ok ? latest.error ?? null : null,
  };
}

/** Checks one client's site now and records the answer. */
async function checkAndRecord(client) {
  const result = await checkSite(client.subdomain);
  await prisma.siteHealthCheck.create({ data: { clientId: client.id, ...result } });
  return result;
}

/** One round: every live client's site, then the history older than a week pruned. */
async function checkAllSites() {
  const clients = await prisma.subscriptionClient.findMany({ where: { activatedAt: { not: null }, subdomain: { not: null } }, select: { id: true, subdomain: true } });
  for (const client of clients) {
    try { await checkAndRecord(client); } catch (error) { console.error(`[site-health] ${client.subdomain}:`, error.message); }
  }
  await prisma.siteHealthCheck.deleteMany({ where: { checkedAt: { lt: new Date(Date.now() - KEEP_MS) } } });
}

/** Health summaries for these clients, by client id, from the last day of checks. */
async function healthFor(clientIds, now = new Date()) {
  if (!clientIds.length) return {};
  const checks = await prisma.siteHealthCheck.findMany({ where: { clientId: { in: clientIds }, checkedAt: { gte: new Date(now - DAY_MS) } }, orderBy: { checkedAt: "desc" } });
  const byClient = {};
  for (const check of checks) (byClient[check.clientId] ||= []).push(check);
  return Object.fromEntries(clientIds.map((id) => [id, summarizeHealth(byClient[id] || [], now)]));
}

/**
 * Every 5 minutes (`SITE_HEALTH_INTERVAL_MS`), from the API process. Off with `SITE_HEALTH_MONITOR=false`,
 * and never under `node --test`. A round still running when the next is due is skipped, not stacked.
 */
function startSiteHealthMonitor() {
  if (process.env.SITE_HEALTH_MONITOR === "false" || process.env.NODE_TEST_CONTEXT) return null;
  const interval = Number(process.env.SITE_HEALTH_INTERVAL_MS) || 5 * 60 * 1000;
  let running = false;
  const round = async () => {
    if (running) return;
    running = true;
    try { await checkAllSites(); } catch (error) { console.error("[site-health] round failed:", error.message); } finally { running = false; }
  };
  const timer = setInterval(round, interval);
  timer.unref?.();
  setTimeout(round, 15_000).unref?.();
  return timer;
}

module.exports = { healthUrl, checkSite, summarizeHealth, checkAndRecord, checkAllSites, healthFor, startSiteHealthMonitor };
