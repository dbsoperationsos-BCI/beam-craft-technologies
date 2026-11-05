const crypto = require("crypto");
const prisma = require("../../../config/db");

/**
 * The client's invoice link for money received - `<frontend>/i/<token>` - which opens the receipt's
 * PDF without signing in, the way a quotation's `/q/<token>` does.
 *
 * The token is made as a payment received is recorded (its receipt message carries the link), or the
 * first time Share invoice is used on an older one, and kept, so every message for it carries the
 * same link. It is never in a cash entry row (`toRow` drops it) - only handed out as the link. 96 random bits
 * from `crypto`, so a link cannot be guessed; the public route answers 404 to a miss and is rate
 * limited on misses. Deleting the entry takes the invoice down with it - the route reads live rows only.
 */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16}$/;
const newToken = () => crypto.randomBytes(12).toString("base64url");
const frontendBaseUrl = () => (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");
const invoiceUrl = (token) => `${frontendBaseUrl()}/i/${token}`;

/** The entry's invoice token, made now if it has none. Null for money spent or a missing entry. */
async function ensureInvoiceToken(entryId, client = prisma) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const entry = await client.cashEntry.findUnique({ where: { id: entryId }, select: { entryType: true, invoiceToken: true, deletedAt: true } });
    if (!entry || entry.deletedAt || entry.entryType !== "Received") return null;
    if (entry.invoiceToken) return entry.invoiceToken;
    try {
      // Only where it still has none, so two shares at once keep one link between them.
      await client.cashEntry.updateMany({ where: { id: entryId, invoiceToken: null }, data: { invoiceToken: newToken() } });
    } catch (error) {
      if (error.code !== "P2002") throw error; // the rare clash with another entry's token: try another
    }
  }
  throw new Error("Unable to make an invoice link for this payment.");
}

/** The live Received entry a public token names, with what its receipt is drawn from - or null. */
async function entryByInvoiceToken(token, include, client = prisma) {
  if (!TOKEN_PATTERN.test(String(token || ""))) return null;
  return client.cashEntry.findFirst({ where: { invoiceToken: String(token), entryType: "Received", deletedAt: null }, include });
}

module.exports = { ensureInvoiceToken, entryByInvoiceToken, invoiceUrl, TOKEN_PATTERN };
