const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const express = require("express");
const { createMetaWebhookRouter, WEBHOOK_PATH } = require("../src/modules/settings/whatsapp-activity/metaWebhook");

/*
 * The webhook over HTTP, as Meta would call it: the handshake, an unsigned POST, a signed one. The
 * body parser here keeps the raw bytes the way server.js does, since the signature is over those.
 */
const ENV = { META_WHATSAPP_WEBHOOK_VERIFY_TOKEN: "verify-me", META_WHATSAPP_APP_SECRET: "app-secret" };
const sign = (raw) => `sha256=${crypto.createHmac("sha256", ENV.META_WHATSAPP_APP_SECRET).update(raw).digest("hex")}`;

async function serve(onDeliveryStatus) {
  const app = express();
  app.use(express.json({ verify: (req, _res, buffer) => { if (buffer?.length) req.rawBody = buffer; } }));
  app.use(WEBHOOK_PATH, createMetaWebhookRouter({ env: ENV, onDeliveryStatus }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}${WEBHOOK_PATH}`;
  return { base, close: () => new Promise((resolve) => server.close(resolve)) };
}

test("the handshake answers the challenge only for the right token", async () => {
  const { base, close } = await serve(async () => 1);
  try {
    const ok = await fetch(`${base}?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345`);
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), "12345");
    assert.match(ok.headers.get("content-type") || "", /text\/plain/);
    const wrong = await fetch(`${base}?hub.mode=subscribe&hub.verify_token=guess&hub.challenge=12345`);
    assert.equal(wrong.status, 403);
    const noMode = await fetch(`${base}?hub.verify_token=verify-me&hub.challenge=1`);
    assert.equal(noMode.status, 403);
  } finally {
    await close();
  }
});

test("a POST without Meta's signature is refused and reaches the log not at all; a signed one is applied", async () => {
  const seen = [];
  const { base, close } = await serve(async (id, status) => { seen.push([id, status]); return 1; });
  try {
    const body = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: "wamid.9", status: "delivered", timestamp: "1760680800" }] } }] }] });
    const unsigned = await fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body });
    assert.equal(unsigned.status, 401);
    const forged = await fetch(base, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": sign(Buffer.from("{}")) }, body });
    assert.equal(forged.status, 401);
    assert.deepEqual(seen, []);
    const signed = await fetch(base, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": sign(Buffer.from(body)) }, body });
    assert.equal(signed.status, 200);
    assert.deepEqual(seen, [["wamid.9", "delivered"]]);
    // The same delivery again is 200 too - Meta is never told to retry a repeat.
    const again = await fetch(base, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": sign(Buffer.from(body)) }, body });
    assert.equal(again.status, 200);
  } finally {
    await close();
  }
});
