const crypto = require("crypto");
const prisma = require("../../../config/db");
const { SUBDOMAIN_PATTERN, dateOnly } = require("./subscription");

/**
 * The client site's side of BeamCraft: its server reads the subscription set up for it with
 * `Authorization: Bearer <site key>` and `X-Site: <subdomain>` (docs: Velava's BEAMCRAFT-SITE-API.md).
 */

// One answer for an unknown subdomain, one with no key, and a wrong key, so subdomains cannot be probed.
const NOT_RECOGNISED = "This site is not recognised.";
// Compared against when there is no stored hash, so a miss costs the same as a wrong key.
const NO_HASH = "0".repeat(64);
const HASH_PATTERN = /^[a-f0-9]{64}$/;

const hashSiteKey = (key) => crypto.createHash("sha256").update(String(key)).digest("hex");

/** A new site key (32 random bytes, hex) and the hash that is all the server keeps of it. */
function makeSiteKey() {
  const key = crypto.randomBytes(32).toString("hex");
  return { key, hash: hashSiteKey(key) };
}

/** Whether `presented` is the key behind `storedHash`, compared in constant time. */
function siteKeyMatches(presented, storedHash) {
  const stored = HASH_PATTERN.test(String(storedHash || "")) ? storedHash : NO_HASH;
  const same = crypto.timingSafeEqual(Buffer.from(hashSiteKey(presented || ""), "hex"), Buffer.from(stored, "hex"));
  return same && Boolean(presented) && stored !== NO_HASH;
}

const bearerToken = (req) => /^Bearer\s+(\S+)$/i.exec(String(req.get("authorization") || ""))?.[1] || "";

/** What the client's site is given: the live columns only - never a change still waiting for Update site. */
function siteSubscription(client) {
  return {
    product: client.product,
    subdomain: client.subdomain,
    companyName: client.companyName,
    logoUrl: client.logoUrl,
    faviconUrl: client.faviconUrl,
    usersAllowed: client.usersAllowed,
    adminUsername: client.adminUsername,
    adminPasswordHash: client.adminPasswordHash,
    passwordSetAt: client.adminPasswordSetAt ? new Date(client.adminPasswordSetAt).toISOString() : null,
    validFrom: client.validFrom ? dateOnly(client.validFrom) : null,
    validUntil: client.validUntil ? dateOnly(client.validUntil) : null,
    modules: Array.isArray(client.modules) ? client.modules : [],
    version: client.liveVersion,
  };
}

/** GET /api/client-site/subscription */
async function getSiteSubscription(req, res, db = prisma) {
  const subdomain = String(req.get("x-site") || "").trim().toLowerCase();
  try {
    const client = SUBDOMAIN_PATTERN.test(subdomain) ? await db.subscriptionClient.findUnique({ where: { subdomain } }) : null;
    if (!siteKeyMatches(bearerToken(req), client?.siteKeyHash)) return res.status(401).json({ message: NOT_RECOGNISED });
    if (!client.activatedAt) return res.status(404).json({ message: "This site's account is not set up yet." });
    return res.json({ data: siteSubscription(client) });
  } catch (error) {
    console.error("[client-site] subscription:", error?.message);
    return res.status(500).json({ message: "Unable to read the subscription" });
  }
}

module.exports = { NOT_RECOGNISED, hashSiteKey, makeSiteKey, siteKeyMatches, siteSubscription, getSiteSubscription };
