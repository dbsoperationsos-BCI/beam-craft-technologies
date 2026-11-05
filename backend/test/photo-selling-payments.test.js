const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const crypto = require("crypto");
const { createFakeDb, loadWith } = require("./helpers/photoSellingFakeDb");

/*
 * The payment state machine against an in-memory database and a stand-in Cashfree: an order is paid
 * only on Cashfree's own answer, exactly once, for exactly its amount, however notices arrive.
 */
process.env.CASHFREE_CLIENT_ID = "test-client";
process.env.CASHFREE_CLIENT_SECRET = "test-secret";
process.env.CASHFREE_ENV = "sandbox";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret";

const src = path.join(__dirname, "../src");
const relation = (table, resolve) => Object.assign(resolve, { table });

function setup({ provider, orderStatus = "PENDING", payments = [{ attempt: 1, status: "CREATED" }], credentials = "VALID" } = {}) {
  const order = { id: "order-1", orderRef: "PS-TEST000001", galleryId: "g1", status: orderStatus, currency: "INR", totalPaise: 30000, buyerSessionHash: "a".repeat(64), buyerName: "Asha", buyerPhone: "9876543210", pricingSnapshot: {} };
  const db = createFakeDb({
    photoSaleOrder: [order],
    photoSalePayment: payments.map((p, i) => ({ id: `pay-${p.attempt}`, orderId: order.id, attempt: p.attempt, environment: p.environment || "SANDBOX", providerOrderId: `${order.orderRef}-${p.attempt}`, amountPaise: 30000, status: p.status, createdAt: p.createdAt || new Date(Date.now() - (10 - i) * 1000), expiresAt: new Date(Date.now() + 600000), paymentSessionId: "sess" })),
    photoSaleOrderItem: [
      { id: "item-o", orderId: order.id, photoId: "p1", kind: "ORIGINAL", fulfilment: "PENDING_PAYMENT", downloadCount: 0 },
      // An original that has gone missing since the order was made: paid for, but nothing to download.
      { id: "item-gone", orderId: order.id, photoId: "p2", kind: "ORIGINAL", fulfilment: "PENDING_PAYMENT", downloadCount: 0 },
    ],
    photoSalePhoto: [{ id: "p1", originalKey: "photo-selling/gallery-g1/originals/k1/a.jpg" }, { id: "p2", originalKey: null }],
  }, {
    photoSalePayment: { order: relation("photoSaleOrder", (row, t) => t.photoSaleOrder.find((o) => o.id === row.orderId)) },
    photoSaleOrderItem: { photo: relation("photoSalePhoto", (row, t) => t.photoSalePhoto.find((photo) => photo.id === row.photoId) || null) },
  });
  const calls = { createOrder: 0, getOrder: 0 };
  const fakeCashfree = {
    async createOrder() { calls.createOrder += 1; return { cfOrderId: "cf", paymentSessionId: `session-${calls.createOrder}`, orderStatus: "ACTIVE" }; },
    async getOrder(id) { calls.getOrder += 1; return provider(id).order; },
    async getPayments(id) { return provider(id).payments; },
    verifyWebhookSignature: require("../src/modules/photo-selling/payments/cashfree").verifyWebhookSignature,
    credentialState: () => credentials,
  };
  const service = loadWith(path, src, { "config/db.js": db, "modules/photo-selling/payments/cashfree.js": fakeCashfree }, "modules/photo-selling/payments/service.js");
  return { db, service, calls, order };
}

const paid = (amount = 300) => () => ({ order: { orderStatus: "PAID" }, payments: [{ cfPaymentId: "cfp-1", status: "SUCCESS", amount, currency: "INR", group: "upi", time: "2026-10-23T10:00:00Z" }] });

test("a verified success marks the order paid once and unlocks what it bought", async () => {
  const { db, service } = setup({ provider: paid() });
  assert.equal((await service.reconcilePayment("pay-1")).outcome, "PAID");
  assert.equal(db.tables.photoSaleOrder[0].status, "PAID");
  assert.equal(db.tables.photoSalePayment[0].status, "SUCCESS");
  assert.equal(db.tables.photoSaleOrderItem.find((i) => i.id === "item-o").fulfilment, "READY", "the original is downloadable once the payment is verified");
  assert.equal(db.tables.photoSaleOrderItem.find((i) => i.id === "item-gone").fulfilment, "UNAVAILABLE");
  // Asked again - a repeated webhook, a second status poll - nothing changes and nothing is added.
  const events = db.tables.photoSalePaymentEvent.length;
  await service.reconcilePayment("pay-1");
  await service.reconcilePayment("pay-1");
  assert.equal(db.tables.photoSalePaymentEvent.filter((e) => e.eventType === "ORDER_PAID").length, 1);
  assert.equal(db.tables.photoSalePaymentEvent.length, events);
});

test("a paid amount that is not the order's never unlocks anything", async () => {
  const { db, service } = setup({ provider: paid(1) });
  assert.equal((await service.reconcilePayment("pay-1")).outcome, "MISMATCH");
  assert.equal(db.tables.photoSaleOrder[0].status, "PENDING");
  assert.equal(db.tables.photoSalePayment[0].status, "MISMATCH");
  assert.ok(db.tables.photoSaleOrderItem.every((i) => i.fulfilment === "PENDING_PAYMENT"));
});

test("a failure reported after success - out of order - does not undo the payment", async () => {
  let answer = paid();
  const { db, service } = setup({ provider: () => answer() });
  await service.reconcilePayment("pay-1");
  answer = () => ({ order: { orderStatus: "ACTIVE" }, payments: [{ cfPaymentId: "cfp-2", status: "FAILED", time: "2026-10-23T11:00:00Z" }] });
  await service.reconcilePayment("pay-1");
  assert.equal(db.tables.photoSaleOrder[0].status, "PAID");
  assert.equal(db.tables.photoSalePayment[0].status, "SUCCESS");
});

test("a failed or dropped attempt leaves the order retryable, never paid", async () => {
  const { db, service } = setup({ provider: () => ({ order: { orderStatus: "ACTIVE" }, payments: [{ status: "USER_DROPPED", time: "t" }] }) });
  assert.equal((await service.reconcilePayment("pay-1")).outcome, "CANCELLED");
  assert.equal(db.tables.photoSaleOrder[0].status, "FAILED");
  assert.ok(db.tables.photoSaleOrderItem.every((i) => i.fulfilment === "PENDING_PAYMENT"));
});

test("a pending bank confirmation stays pending and blocks a second checkout", async () => {
  const { db, service, calls, order } = setup({ provider: () => ({ order: { orderStatus: "ACTIVE" }, payments: [{ status: "PENDING", time: "t" }] }) });
  assert.equal((await service.reconcilePayment("pay-1")).outcome, "PENDING");
  assert.equal(db.tables.photoSalePayment[0].status, "PENDING");
  await assert.rejects(service.startCheckout(order, { shortCode: "ABC123", title: "T" }), (error) => error.status === 409);
  assert.equal(calls.createOrder, 0);
});

test("an open checkout is handed back rather than replaced; a failed one gets a new attempt", async () => {
  const open = setup({ provider: () => ({ order: { orderStatus: "ACTIVE" }, payments: [] }) });
  const again = await open.service.startCheckout(open.order, { shortCode: "ABC123", title: "T" });
  assert.equal(again.paymentSessionId, "sess");
  assert.equal(open.calls.createOrder, 0);

  const failed = setup({ provider: () => ({ order: { orderStatus: "ACTIVE" }, payments: [{ status: "FAILED", time: "t" }] }) });
  const retry = await failed.service.startCheckout(failed.order, { shortCode: "ABC123", title: "T" });
  assert.equal(retry.attempt, 2);
  assert.equal(failed.calls.createOrder, 1);
  assert.equal(failed.db.tables.photoSalePayment.find((p) => p.attempt === 2).providerOrderId, "PS-TEST000001-2");
});

test("a checkout for an order that turns out to be paid opens no new payment", async () => {
  const { service, calls, order } = setup({ provider: paid() });
  assert.deepEqual(await service.startCheckout(order, { shortCode: "ABC123", title: "T" }), { paid: true });
  assert.equal(calls.createOrder, 0);
});

test("a second attempt succeeding after the first paid is recorded as a refund due, not a second sale", async () => {
  const { db, service } = setup({ provider: paid(), payments: [{ attempt: 1, status: "CREATED" }, { attempt: 2, status: "CREATED" }] });
  await service.reconcilePayment("pay-1");
  assert.equal((await service.reconcilePayment("pay-2")).outcome, "DUPLICATE");
  assert.equal(db.tables.photoSalePaymentEvent.filter((e) => e.eventType === "DUPLICATE_PAYMENT").length, 1);
  assert.match(db.tables.photoSalePayment.find((p) => p.id === "pay-2").failureReason, /refund/i);
  assert.equal(db.tables.photoSaleOrder[0].status, "PAID");
});

const signed = (body, timestamp = "1700000000") => ({ rawBody: Buffer.from(body), headers: { "x-webhook-timestamp": timestamp, "x-webhook-signature": crypto.createHmac("sha256", "test-secret").update(`${timestamp}${body}`).digest("base64") } });
const webhookBody = (status = "SUCCESS") => JSON.stringify({ type: "PAYMENT_SUCCESS_WEBHOOK", data: { order: { order_id: "PS-TEST000001-1", order_amount: 300.0 }, payment: { cf_payment_id: 555, payment_status: status, payment_amount: 300.0 } } });

test("a webhook with a bad signature is refused and changes nothing", async () => {
  const { db, service, calls } = setup({ provider: paid() });
  const original = console.warn; console.warn = () => {};
  try {
    const result = await service.handleWebhook({ rawBody: Buffer.from(webhookBody()), headers: { "x-webhook-timestamp": "1", "x-webhook-signature": "forged" } });
    assert.equal(result.status, 401);
  } finally { console.warn = original; }
  assert.equal(calls.getOrder, 0);
  assert.equal(db.tables.photoSaleOrder[0].status, "PENDING");
  assert.equal(db.tables.photoSalePaymentEvent.length, 0);
});

test("a signed webhook is verified with Cashfree, and its duplicate is acknowledged without acting twice", async () => {
  const { db, service, calls } = setup({ provider: paid() });
  const first = await service.handleWebhook(signed(webhookBody()));
  assert.equal(first.status, 200);
  assert.equal(db.tables.photoSaleOrder[0].status, "PAID");
  const asked = calls.getOrder;
  const second = await service.handleWebhook(signed(webhookBody()));
  assert.equal(second.status, 200);
  assert.equal(second.body.duplicate, true);
  assert.equal(calls.getOrder, asked);
});

test("a webhook claiming success is not believed when Cashfree says otherwise", async () => {
  const { db, service } = setup({ provider: () => ({ order: { orderStatus: "ACTIVE" }, payments: [] }) });
  await service.handleWebhook(signed(webhookBody("SUCCESS")));
  assert.equal(db.tables.photoSaleOrder[0].status, "PENDING");
});

test("a webhook that cannot be applied is taken back so Cashfree retries it", async () => {
  const { db, service } = setup({ provider: () => { throw new Error("network down"); } });
  const original = console.error; console.error = () => {};
  try {
    const result = await service.handleWebhook(signed(webhookBody()));
    assert.equal(result.status, 500);
  } finally { console.error = original; }
  assert.equal(db.tables.photoSalePaymentEvent.filter((e) => e.source === "WEBHOOK").length, 0);
});

test("Indian mobile numbers are normalised; anything else is refused", () => {
  const { service } = setup({ provider: paid() });
  assert.equal(service.normalizeIndianPhone("+91 98765 43210"), "9876543210");
  assert.equal(service.normalizeIndianPhone("09876543210"), "9876543210");
  assert.equal(service.normalizeIndianPhone("12345"), null);
  assert.equal(service.normalizeIndianPhone("5876543210"), null);
});

test("keys Cashfree refused turn checkout off - the buyer is told only that payment is unavailable, staff why", async () => {
  const { service, calls, order } = setup({ credentials: "INVALID", payments: [], provider: () => ({ order: { orderStatus: "ACTIVE" }, payments: [] }) });
  await assert.rejects(service.startCheckout(order, { shortCode: "abc", title: "Wedding" }), (error) => error.status === 503 && /isn't available right now/.test(error.message) && !/CASHFREE|keys|refused/i.test(error.message));
  assert.equal(calls.createOrder, 0);
  const config = require("../src/modules/photo-selling/shared/config");
  assert.match(config.status().payments.reason, /refused this server's payment keys/, "staff see the reason");
});

test("while new checkouts are off (keys refused), payments already made are still settled", async () => {
  const { db, service } = setup({ credentials: "INVALID", provider: paid(), payments: [{ attempt: 1, status: "PENDING", createdAt: new Date(Date.now() - 10 * 60 * 1000) }] });
  assert.equal(await service.reconcileStale(), 1);
  assert.equal(db.tables.photoSaleOrder[0].status, "PAID");
});

test("the sweep settles a payment the buyer never came back for - only open attempts of this environment, past a couple of minutes", async () => {
  const old = new Date(Date.now() - 10 * 60 * 1000);
  const { db, service, calls } = setup({
    provider: paid(),
    payments: [
      { attempt: 1, status: "CREATED", createdAt: old },
      { attempt: 2, status: "PENDING", createdAt: old, environment: "PRODUCTION" },
      { attempt: 3, status: "CREATED", createdAt: new Date() },
    ],
  });
  assert.equal(await service.reconcileStale(), 1, "only the old sandbox attempt is asked about");
  assert.equal(calls.getOrder, 1);
  assert.equal(db.tables.photoSaleOrder[0].status, "PAID");
  assert.equal(db.tables.photoSaleOrderItem.find((item) => item.id === "item-o").fulfilment, "READY");
  // Settled: a second sweep finds nothing open to ask about but the fresh attempt, still too new.
  assert.equal(await service.reconcileStale(), 0);
});

test("a success in another currency is a mismatch, never a sale", async () => {
  const { db, service } = setup({ provider: () => ({ order: { orderStatus: "PAID" }, payments: [{ cfPaymentId: "cfp-1", status: "SUCCESS", amount: 300, currency: "USD", time: "2026-10-23T10:00:00Z" }] }) });
  assert.equal((await service.reconcilePayment("pay-1")).outcome, "MISMATCH");
  assert.equal(db.tables.photoSaleOrder[0].status, "PENDING");
  assert.ok(db.tables.photoSaleOrderItem.every((item) => item.fulfilment === "PENDING_PAYMENT"));
});

// Cashfree's webhook version 2025-01-01: { type, event_time, data: { order, payment, customer_details } }.
const notice = (type, status, { orderId = "PS-TEST000001-1", amount = 300.0 } = {}) => JSON.stringify({ type, event_time: "2026-10-26T13:12:51+05:30", data: { order: { order_id: orderId, order_amount: amount, order_currency: "INR" }, payment: { cf_payment_id: 777, payment_status: status, payment_amount: amount, payment_currency: "INR", payment_group: "upi" }, customer_details: { customer_phone: "9876543210" } } });

test("a signed PAYMENT_FAILED_WEBHOOK marks the attempt failed - checked with Cashfree - and unlocks nothing", async () => {
  const { db, service } = setup({ provider: () => ({ order: { orderStatus: "ACTIVE" }, payments: [{ cfPaymentId: "777", status: "FAILED", amount: 300, currency: "INR", message: "Insufficient funds", time: "2026-10-26T13:12:51Z" }] }) });
  assert.equal((await service.handleWebhook(signed(notice("PAYMENT_FAILED_WEBHOOK", "FAILED")))).status, 200);
  assert.equal(db.tables.photoSalePayment[0].status, "FAILED");
  assert.equal(db.tables.photoSaleOrder[0].status, "FAILED", "retryable, never paid");
  assert.ok(db.tables.photoSaleOrderItem.every((item) => item.fulfilment === "PENDING_PAYMENT"));
});

test("a signed PAYMENT_USER_DROPPED_WEBHOOK cancels the attempt and unlocks nothing", async () => {
  const { db, service } = setup({ provider: () => ({ order: { orderStatus: "ACTIVE" }, payments: [{ cfPaymentId: "777", status: "USER_DROPPED", amount: 300, currency: "INR", time: "2026-10-26T13:12:51Z" }] }) });
  assert.equal((await service.handleWebhook(signed(notice("PAYMENT_USER_DROPPED_WEBHOOK", "USER_DROPPED")))).status, 200);
  assert.equal(db.tables.photoSalePayment[0].status, "CANCELLED");
  assert.notEqual(db.tables.photoSaleOrder[0].status, "PAID");
  assert.ok(db.tables.photoSaleOrderItem.every((item) => item.fulfilment === "PENDING_PAYMENT"));
});

test("a signed success whose amount Cashfree reports differently from the order is a mismatch - nothing unlocked", async () => {
  const { db, service } = setup({ provider: paid(1) });
  assert.equal((await service.handleWebhook(signed(notice("PAYMENT_SUCCESS_WEBHOOK", "SUCCESS", { amount: 1 })))).status, 200);
  assert.equal(db.tables.photoSalePayment[0].status, "MISMATCH");
  assert.equal(db.tables.photoSaleOrder[0].status, "PENDING");
  assert.ok(db.tables.photoSaleOrderItem.every((item) => item.fulfilment === "PENDING_PAYMENT"));
});

test("a body changed after signing - or re-serialised - fails the signature and changes nothing", async () => {
  const { db, service, calls } = setup({ provider: paid() });
  const original = console.warn; console.warn = () => {};
  try {
    // As Cashfree sends it: amounts with their decimals ("300.00"), which JSON.parse + stringify drops.
    const good = signed(notice("PAYMENT_SUCCESS_WEBHOOK", "SUCCESS").replace(/:300([,}])/g, ":300.00$1"));
    const edited = { ...good, rawBody: Buffer.from(String(good.rawBody).replace("300", "3")) };
    assert.equal((await service.handleWebhook(edited)).status, 401);
    const reserialised = { ...good, rawBody: Buffer.from(JSON.stringify(JSON.parse(String(good.rawBody)))) };
    assert.equal((await service.handleWebhook(reserialised)).status, 401, "300.0 becomes 300: the raw bytes are what is signed");
    assert.equal((await service.handleWebhook({ ...good, headers: { ...good.headers, "x-webhook-timestamp": "1700000001" } })).status, 401, "another timestamp");
    assert.equal((await service.handleWebhook({ rawBody: good.rawBody, headers: {} })).status, 401, "no signature headers");
  } finally { console.warn = original; }
  assert.equal(calls.getOrder, 0);
  assert.equal(db.tables.photoSaleOrder[0].status, "PENDING");
  assert.equal(db.tables.photoSalePaymentEvent.length, 0);
});

test("a signed notice for an order this store never made is acknowledged and touches nothing", async () => {
  const { db, service, calls } = setup({ provider: paid() });
  const result = await service.handleWebhook(signed(notice("PAYMENT_SUCCESS_WEBHOOK", "SUCCESS", { orderId: "SOMEONE-ELSES-1" })));
  assert.equal(result.status, 200);
  assert.equal(calls.getOrder, 0);
  assert.equal(db.tables.photoSaleOrder[0].status, "PENDING");
  assert.equal(db.tables.photoSalePaymentEvent.length, 0);
});
