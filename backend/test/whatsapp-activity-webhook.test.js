const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { isConfigured, signatureMatches, statusesIn, applyStatuses } = require("../src/modules/settings/whatsapp-activity/metaWebhook");

const SECRET = "app-secret";
const sign = (raw) => `sha256=${crypto.createHmac("sha256", SECRET).update(raw).digest("hex")}`;
const metaBody = (statuses) => ({ object: "whatsapp_business_account", entry: [{ id: "1", changes: [{ field: "messages", value: { messaging_product: "whatsapp", statuses } }] }] });

test("the webhook exists only when both the verify token and the app secret are set", () => {
  assert.equal(isConfigured({}), false);
  assert.equal(isConfigured({ META_WHATSAPP_WEBHOOK_VERIFY_TOKEN: "v" }), false);
  assert.equal(isConfigured({ META_WHATSAPP_WEBHOOK_VERIFY_TOKEN: "v", META_WHATSAPP_APP_SECRET: "s" }), true);
});

test("a POST is accepted only with Meta's signature over the raw bytes", () => {
  const raw = Buffer.from(JSON.stringify(metaBody([])));
  assert.equal(signatureMatches(raw, sign(raw), SECRET), true);
  assert.equal(signatureMatches(raw, sign(Buffer.from("{}")), SECRET), false);
  assert.equal(signatureMatches(raw, "sha256=short", SECRET), false);
  assert.equal(signatureMatches(raw, undefined, SECRET), false);
  assert.equal(signatureMatches(undefined, sign(raw), SECRET), false, "no raw body captured means nothing to verify");
});

test("statuses are read out of Meta's shape with the provider's error and time, and junk is skipped", () => {
  const statuses = statusesIn(metaBody([
    { id: "wamid.1", status: "delivered", timestamp: "1760680800", recipient_id: "919876543210" },
    { id: "wamid.2", status: "failed", timestamp: "1760680900", errors: [{ code: 131026, title: "Message undeliverable" }] },
    { status: "read" },
    null,
  ]));
  assert.deepEqual(statuses, [
    { id: "wamid.1", status: "delivered", errorCode: null, errorMessage: null, at: new Date(1760680800 * 1000) },
    { id: "wamid.2", status: "failed", errorCode: "131026", errorMessage: "Message undeliverable", at: new Date(1760680900 * 1000) },
  ]);
  assert.deepEqual(statusesIn({}), []);
  assert.deepEqual(statusesIn(null), []);
});

test("every status is handed to the activity log; one that throws does not stop the rest", async () => {
  const seen = [];
  const applied = await applyStatuses(metaBody([{ id: "a", status: "sent" }, { id: "b", status: "read" }, { id: "c", status: "delivered" }]), {
    onDeliveryStatus: async (id, status) => { seen.push([id, status]); if (id === "b") throw new Error("db down"); return 1; },
  });
  assert.deepEqual(seen, [["a", "sent"], ["b", "read"], ["c", "delivered"]]);
  assert.equal(applied, 2);
});
