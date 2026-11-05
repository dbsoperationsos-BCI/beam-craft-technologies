const jwt = require("jsonwebtoken");

/*
 * A one-time pass that lets the PDF renderer print one quotation whose public link has lapsed.
 *
 * The quotation PDF is printed from the client's own page (`/q/<token>`), and that page reads
 * `GET /api/public/quotations/:token`, which refuses a lapsed link. A signed-in client downloading
 * their own signed quotation from the client portal is not a stranger holding an old link, so the
 * portal mints this pass, the renderer sends it as a header on the page's requests, and
 * `publicQuotation` accepts it for that one token. The public link itself stays lapsed for everyone
 * else, and nothing is written: no link is renewed.
 *
 * Signed with the API's own secret, scoped to one quotation token, and valid for two minutes - long
 * enough for one render, useless afterwards.
 */
const HEADER = "x-quotation-print-pass";
const SCOPE = "quotation-print";
const TTL_SECONDS = 120;

// `ttlSeconds`: longer for the client's app showing the page itself (`getClientQuotationView`),
// which a client may keep open and refresh, than for one render.
function signPrintPass(publicToken, ttlSeconds = TTL_SECONDS) {
  return jwt.sign({ scope: SCOPE, token: publicToken }, process.env.JWT_SECRET, { expiresIn: ttlSeconds });
}

/** Whether the request carries a live pass for exactly this quotation token. */
function hasPrintPass(req, publicToken) {
  const pass = String(req?.headers?.[HEADER] || "");
  if (!pass || !publicToken) return false;
  try {
    const claims = jwt.verify(pass, process.env.JWT_SECRET);
    return claims?.scope === SCOPE && claims?.token === publicToken;
  } catch {
    return false;
  }
}

module.exports = { signPrintPass, hasPrintPass, PRINT_PASS_HEADER: HEADER };
