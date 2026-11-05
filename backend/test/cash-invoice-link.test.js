const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ensureInvoiceToken, entryByInvoiceToken, invoiceUrl, TOKEN_PATTERN } = require("../src/modules/accounts/cash-entries/invoiceLink");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

/** A stand-in for `prisma.cashEntry`, enough for the token rules. */
function fakeClient(row) {
  return {
    cashEntry: {
      findUnique: async () => (row ? { ...row } : null),
      updateMany: async ({ where, data }) => { if (row && row.invoiceToken === where.invoiceToken) { row.invoiceToken = data.invoiceToken; return { count: 1 }; } return { count: 0 }; },
      findFirst: async ({ where }) => (row && row.invoiceToken === where.invoiceToken && !row.deletedAt && row.entryType === where.entryType ? row : null),
    },
  };
}

test("a payment received gets one unguessable token, kept for every later share", async () => {
  const row = { entryType: "Received", invoiceToken: null, deletedAt: null };
  const client = fakeClient(row);
  const first = await ensureInvoiceToken("e1", client);
  assert.match(first, TOKEN_PATTERN, "16 base64url characters - 96 random bits");
  assert.equal(await ensureInvoiceToken("e1", client), first, "the same link every time");
  assert.equal(invoiceUrl(first).endsWith(`/i/${first}`), true);
});

test("money spent, or a deleted entry, has no invoice link and no public invoice", async () => {
  assert.equal(await ensureInvoiceToken("e1", fakeClient({ entryType: "Spent", invoiceToken: null })), null);
  assert.equal(await ensureInvoiceToken("e1", fakeClient({ entryType: "Received", invoiceToken: null, deletedAt: new Date() })), null);
  const deleted = { entryType: "Received", invoiceToken: "AAAAAAAAAAAAAAAA", deletedAt: new Date() };
  assert.equal(await entryByInvoiceToken("AAAAAAAAAAAAAAAA", {}, fakeClient(deleted)), null);
  assert.equal(await entryByInvoiceToken("not-a-token", {}, fakeClient(deleted)), null, "anything not shaped like a token is a miss before the database");
});

test("the public routes are rate limited on misses, and the share and send sit under Cash Management", () => {
  const publicRoutes = read("src/modules/accounts/cash-entries/publicRoutes.js");
  assert.match(publicRoutes, /createPublicLinkLimiter\("invoice"\)/);
  assert.match(publicRoutes, /router\.get\("\/:token\/pdf", linkLimiter, pdfLimiter, publicInvoicePdf\);/);
  assert.match(read("src/server.js"), /app\.use\("\/api\/public\/invoices", cashInvoicePublicRoutes\);/);
  const routes = read("src/modules/accounts/cash-entries/routes.js");
  assert.match(routes, /router\.use\(requireModule\("ACCOUNTS", "Cash Management"\)\);[\s\S]*router\.post\("\/:id\/share", controller\.shareInvoice\);/, "a POST, so Read \/ Write");
  assert.match(routes, /router\.post\("\/:id\/whatsapp-group", requireTemplateOn\("CASH_RECEIVED"\), whatsappLimits\.send, controller\.sendInvoiceToGroup\);/);
  const controller = read("src/modules/accounts/cash-entries/controller.js");
  assert.match(controller, /res\.locals\.linkMiss = true; return res\.status\(404\)/, "a miss counts against the limiter");
  assert.match(controller, /trigger: "CASH_RECEIPT_INVOICE"/);
});

test("the receipt always carries the invoice link, in the wording or after it", () => {
  const source = read("src/modules/accounts/cash-entries/receiptMessage.js");
  assert.match(source, /"invoice link": invoiceLink \|\| undefined,/);
  assert.match(source, /if \(message && invoiceLink && !message\.body\.includes\(invoiceLink\)\) message\.body = `\$\{message\.body\.trimEnd\(\)\}\\n\\nInvoice: \$\{invoiceLink\}`;/);
  // Made as the payment is recorded, so the message after recording carries it.
  assert.match(read("src/modules/accounts/cash-entries/controller.js"), /const token = await ensureInvoiceToken\(entryId\);/);
  assert.match(read("src/modules/accounts/cash-entries/controller.js"), /const \{ receiptMessage, invoiceLink \} = await receiptWithLink\(created\.id\);/);
});

test("the token never rides in a cash entry row, and a public failure never says why", () => {
  const controller = read("src/modules/accounts/cash-entries/controller.js");
  assert.match(controller, /const \{ invoiceToken: _invoiceToken, \.\.\.fields \} = entry;\n  return \{\n    \.\.\.fields,/);
  assert.doesNotMatch(controller.slice(controller.indexOf("async function publicInvoice("), controller.indexOf("module.exports = {")), /handleCashEntryError/);
  assert.match(controller, /if \(!token \|\| !parsed\.data\.message\.includes\(invoiceUrl\(token\)\)\)/, "a group send carries this payment's own link");
});
