const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { createFakeDb, loadWith } = require("./helpers/photoSellingFakeDb");

// Photo Selling's guest name + WhatsApp number (no code), the selfie kept only with consent, later
// uploads matched to the guest, and one WhatsApp message per guest per settled batch - through the
// real guests, faces, search and notifications services over a fake database, face engine, storage
// and queue. The provider is a stand-in: no message leaves this test.
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret";
const src = path.join(__dirname, "../src");
const vectors = require("../src/modules/ai-feature/shared/vectors");
const relation = (table, resolve) => Object.assign(resolve, { table });

const me = vectors.normalize([1, 0, 0, 0]);
const me2 = vectors.normalize([0.95, 0.31, 0, 0]);
const other = vectors.normalize([0, 1, 0, 0]);
const ENV = { AI_FACE_ENGINE_ENABLED: "true", PHOTO_SELLING_WHATSAPP_ENABLED: "true", PHOTO_SELLING_WHATSAPP_TEMPLATE_NAME: "photos_ready", PHOTO_SELLING_WHATSAPP_TEMPLATE_LANGUAGE: "en", PHOTO_SELLING_PUBLIC_URL: "https://operations.dontblinkstudioz.com/s" };

async function withEnv(values, run) {
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  try { return await run(); } finally { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}

function world() {
  const photo = (id, galleryId, extra = {}) => ({ id, galleryId, available: true, removedAt: null, faceStatus: "DONE", previewKey: id, ...extra });
  const face = (id, photoId, galleryId, vector) => ({ id, photoId, galleryId, engine: "insightface", dimension: 4, vector: vectors.encode(vector), quality: 0.9 });
  const live = { status: "PUBLISHED", archivedAt: null, expiresAt: null, matchStrictness: "STANDARD", whatsappNotify: true, selfieSearchEnabled: true };
  const db = createFakeDb({
    photoSaleGallery: [{ id: "g1", title: "Kalai weds Priya", shortCode: "ABC123", ...live }, { id: "g2", title: "Other wedding", shortCode: "ZZZ999", ...live }],
    photoSalePhoto: [photo("solo", "g1"), photo("stranger", "g1"),
      photo("new-photo", "g1", { faceStatus: "QUEUED" }), photo("new-stranger", "g1", { faceStatus: "QUEUED" }), photo("new-removed", "g1", { faceStatus: "QUEUED", removedAt: new Date() }), photo("g2-photo", "g2", { faceStatus: "QUEUED" })],
    photoSaleFace: [face("x1", "solo", "g1", me2), face("x2", "stranger", "g1", other)],
    photoSaleSelfieSearch: [],
  }, {
    photoSaleFace: { photo: relation("photoSalePhoto", (row, t) => t.photoSalePhoto.find((p) => p.id === row.photoId)) },
    photoSalePhoto: { gallery: relation("photoSaleGallery", (row, t) => t.photoSaleGallery.find((g) => g.id === row.galleryId)) },
    photoSaleGuestMatch: {
      photo: relation("photoSalePhoto", (row, t) => t.photoSalePhoto.find((p) => p.id === row.photoId)),
      guest: relation("photoSaleGuest", (row, t) => t.photoSaleGuest.find((g) => g.id === row.guestId)),
      gallery: relation("photoSaleGallery", (row, t) => t.photoSaleGallery.find((g) => g.id === row.galleryId)),
    },
  });
  // What the fake engine sees: a photo's preview bytes are its id; anything else is the selfie.
  const seen = { "new-photo": [{ embedding: me, quality: 0.9 }], "new-stranger": [{ embedding: other, quality: 0.9 }], "new-removed": [{ embedding: me, quality: 0.9 }], "g2-photo": [{ embedding: me, quality: 0.9 }] };
  // What a selfie shows: `state.selfie`, which a test may change between searches.
  const state = { selfie: me };
  const engine = { health: () => ({ status: "ready", models: { complete: true } }), isReady: async () => true, describe: async (bytes) => ({ width: 1000, height: 1000, faces: (seen[bytes.toString()] || [{ embedding: state.selfie, quality: 0.9, box: [0, 0, 300, 300] }]).map((item) => ({ ...item, embedding: Array.from(item.embedding) })) }) };
  const storage = { getObject: async (key) => Buffer.from(key), putSelfieThumbnail: async (galleryId) => `photo-selling/gallery-${galleryId}/selfies/00000000-0000-0000-0000-000000000000.webp`, getSelfieThumbnail: async () => null };
  const queue = { notify: [], enqueueIndex: async () => {}, enqueueNotify: async (id) => { queue.notify.push(id); } };
  const stubs = { "config/db.js": db, "modules/ai-feature/face-engine/engine.js": engine, "modules/photo-selling/shared/storage.js": storage, "modules/photo-selling/search/queue.js": queue };
  for (const file of ["faces/service.js", "faces/insightface.js", "guests/service.js", "notifications/service.js", "galleries/service.js"]) delete require.cache[require.resolve(path.join(src, "modules/photo-selling", file))];
  const search = loadWith(path, src, stubs, "modules/photo-selling/search/service.js");
  const req = (file) => require(path.join(src, "modules/photo-selling", file));
  return { state, db, queue, search, guests: req("guests/service.js"), faces: req("faces/service.js"), notifications: req("notifications/service.js"), g1: db.tables.photoSaleGallery[0], g2: db.tables.photoSaleGallery[1] };
}

const session = (hash = "device-1") => ({ sessionHash: hash });
const selfie = () => ({ mimetype: "image/jpeg", buffer: require("sharp")({ create: { width: 400, height: 400, channels: 3, background: "#888" } }).jpeg() });
async function search(w, gallery, who) { const file = selfie(); file.buffer = await file.buffer.toBuffer(); return w.search.create(gallery, who, file, true); }
const fakeProvider = (answer = () => ({ providerMessageId: "wamid.1", status: "SENT" })) => { const sent = []; return { sent, factory: () => ({ name: "fake", async sendTemplateMessage(payload) { sent.push(payload); return answer(payload); } }) }; };
const newPhotos = async (w, ...ids) => { for (const id of ids) await w.faces.indexPhoto(id); };

test("every guest leaves a name and WhatsApp number - no code; the WhatsApp tick counts only where the gallery sends messages", () => withEnv(ENV, async () => {
  const w = world();
  const guest = await w.guests.register(w.g1, session(), { name: "Kavin", phone: "98765 43210", whatsappConsent: true });
  assert.deepEqual(guest, { name: "Kavin", phone: "+91 ••••••3210", whatsappOn: true, selfieCount: 0, selfieLimit: 10 });
  assert.equal(w.db.tables.photoSaleGuest[0].phone, "+919876543210", "a 10-digit mobile is read as India's");
  assert.equal((await w.guests.register(w.g1, session(), { name: "Kavin", phone: "9876543210", whatsappConsent: true })).name, "Kavin");
  assert.equal(w.db.tables.photoSaleGuest.length, 1, "a refresh or retry is the same guest, never a second");
  await assert.rejects(w.guests.register(w.g1, session("d2"), { name: "X", phone: "12345", whatsappConsent: true }), (error) => error.status === 400);
  await assert.rejects(w.guests.register(w.g1, session("d3"), { name: "X", phone: "+14155550100", whatsappConsent: true }), (error) => error.status === 400, "outside the dial codes served");
  w.g1.whatsappNotify = false;
  assert.deepEqual(await w.guests.register(w.g1, session("d4"), { name: "Asha", phone: "9876543211", whatsappConsent: true }), { name: "Asha", phone: "+91 ••••••3211", whatsappOn: false, selfieCount: 0, selfieLimit: 10 }, "registered all the same; the tick is not consent where no messages are sent");
  await withEnv({ PHOTO_SELLING_WHATSAPP_ENABLED: "false" }, async () => { w.g1.whatsappNotify = true; assert.equal(w.guests.offered(w.g1), false, "the server switch alone closes it"); });
  await withEnv({ PHOTO_SELLING_WHATSAPP_TEMPLATE_NAME: undefined }, async () => { assert.equal(w.guests.offered(w.g1), false, "no template named: not offered"); });
}));

test("where messages are offered, the selfie search waits for the name and number; each registered guest's selfie is kept as theirs", () => withEnv(ENV, async () => {
  const w = world();
  await assert.rejects(search(w, w.g1, session()), (error) => error.status === 409);
  await w.guests.register(w.g1, session(), { name: "Kavin", phone: "9876543210", whatsappConsent: true });
  const result = await search(w, w.g1, session());
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.notifyLater, true);
  const kept = w.db.tables.photoSaleGuestSelfie.filter((row) => row.guestId === w.db.tables.photoSaleGuest[0].id);
  assert.equal(kept.length, 1);
  assert.ok(kept[0].vector && kept[0].dimension === 4, "the selfie's face is kept for later uploads");
  assert.ok(kept[0].thumbnailKey, "with its private thumbnail");
  assert.deepEqual(w.db.tables.photoSaleGuestMatch.map((row) => [row.photoId, row.source]), [["solo", "SELFIE"]], "existing matches are theirs at once");
  assert.ok((await w.search.matchedPhotoIds(w.g1, session())).has("solo"));

  await w.guests.register(w.g1, session("no"), { name: "Ravi", phone: "9876500000", whatsappConsent: false });
  const plain = await search(w, w.g1, session("no"));
  assert.equal(plain.notifyLater, false, "no WhatsApp without the tick");
  assert.equal(w.db.tables.photoSaleGuestSelfie.length, 2, "the selfie is kept all the same - selfies stay until removed (owner's decision)");
}));

test("a later upload that matches is recorded once, an unmatched, removed or other gallery's photo is not, and the run is scheduled", () => withEnv(ENV, async () => {
  const w = world();
  await w.guests.register(w.g1, session(), { name: "Kavin", phone: "9876543210", whatsappConsent: true });
  await search(w, w.g1, session());
  await newPhotos(w, "new-photo", "new-stranger", "new-removed", "g2-photo");
  const later = w.db.tables.photoSaleGuestMatch.filter((row) => row.source === "NEW_PHOTO");
  assert.deepEqual(later.map((row) => row.photoId), ["new-photo"]);
  assert.deepEqual(w.queue.notify, ["g1"]);
  // Indexing the same photo again (a retry, a reindex) records nothing new.
  w.db.tables.photoSalePhoto.find((row) => row.id === "new-photo").faceStatus = "QUEUED";
  await newPhotos(w, "new-photo");
  assert.equal(w.db.tables.photoSaleGuestMatch.filter((row) => row.source === "NEW_PHOTO").length, 1);
  assert.ok((await w.guests.matchedPhotoIds(w.g1, session())).includes("new-photo"), "the guest can see and buy it on their next visit");
}));

test("one message per guest with the approved template, to their number - never for their own search's matches, never twice", () => withEnv(ENV, async () => {
  const w = world();
  await w.guests.register(w.g1, session(), { name: "Kavin", phone: "9876543210", whatsappConsent: true });
  await search(w, w.g1, session());
  const fake = fakeProvider();
  await newPhotos(w, "new-stranger");
  assert.deepEqual((await w.notifications.notifyGallery("g1", { providerFor: fake.factory })).sent, [], "the selfie search, and an upload that matches nobody, send nothing");
  await newPhotos(w, "new-photo");
  const run = await w.notifications.notifyGallery("g1", { providerFor: fake.factory });
  assert.equal(run.sent.length, 1);
  const [payload] = fake.sent;
  assert.equal(payload.recipient, "+919876543210");
  assert.equal(payload.templateName, "photos_ready");
  assert.equal(payload.languageCode, "en");
  assert.deepEqual(payload.components, [
    { type: "body", parameters: [{ type: "text", text: "Kavin" }, { type: "text", text: "1" }, { type: "text", text: "Kalai weds Priya" }] },
    { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "s/ABC123" }] },
  ]);
  assert.equal(w.db.tables.photoSaleNotification[0].recipientMasked, "+91 ••••••3210", "only the masked number is kept");
  assert.deepEqual((await w.notifications.notifyGallery("g1", { providerFor: fake.factory })).sent, [], "a second run reports nothing already reported");
  assert.equal(fake.sent.length, 1);
}));

test("a run waits while photos are still being indexed", () => withEnv(ENV, async () => {
  const w = world();
  await w.guests.register(w.g1, session(), { name: "Kavin", phone: "9876543210", whatsappConsent: true });
  await search(w, w.g1, session());
  await newPhotos(w, "new-photo");
  // new-stranger is still QUEUED: the batch has not settled.
  assert.equal((await w.notifications.notifyGallery("g1", { providerFor: fakeProvider().factory })).wait, true);
}));

test("either switch off, consent withdrawn or the store closed sends nothing; stop clears the kept face", () => withEnv({ ...ENV }, async () => {
  const cases = [
    ["server switch off", (w) => { process.env.PHOTO_SELLING_WHATSAPP_ENABLED = "false"; }],
    ["gallery switch off", (w) => { w.g1.whatsappNotify = false; }],
    ["store closed", (w) => { w.g1.archivedAt = new Date(); }],
    ["no template", () => { delete process.env.PHOTO_SELLING_WHATSAPP_TEMPLATE_NAME; }],
    ["guest said stop", async (w) => { await w.guests.stop(w.g1, session()); assert.equal(w.db.tables.photoSaleGuest[0].faceVector, null); }],
  ];
  for (const [label, change] of cases) {
    await withEnv(ENV, async () => {
      const w = world();
      await w.guests.register(w.g1, session(), { name: "Kavin", phone: "9876543210", whatsappConsent: true });
      await search(w, w.g1, session());
      await newPhotos(w, "new-photo", "new-stranger");
      await change(w);
      const fake = fakeProvider();
      await w.notifications.notifyGallery("g1", { providerFor: fake.factory });
      assert.equal(fake.sent.length, 0, label);
    });
  }
}));

test("Meta failures: an unknown outcome is never sent again, a passing refusal is retried, a bad number is not", () => withEnv(ENV, async () => {
  const run = async (code) => {
    const w = world();
    await w.guests.register(w.g1, session(), { name: "Kavin", phone: "9876543210", whatsappConsent: true });
    await search(w, w.g1, session());
    await newPhotos(w, "new-photo", "new-stranger");
    await w.notifications.notifyGallery("g1", { providerFor: fakeProvider(() => { throw Object.assign(new Error("refused"), { code }); }).factory });
    const retry = fakeProvider();
    await w.notifications.notifyGallery("g1", { providerFor: retry.factory });
    return { w, retried: retry.sent.length };
  };
  const uncertain = await run("META_NETWORK_ERROR");
  assert.equal(uncertain.w.db.tables.photoSaleNotification[0].status, "UNCERTAIN");
  assert.equal(uncertain.retried, 0, "Meta may have it: never a second copy");
  assert.equal((await run("META_80007")).retried, 1, "Meta refused for a passing reason: the next run sends it");
  const bad = await run("META_131026");
  assert.equal(bad.retried, 0, "a number that cannot receive would only fail again");
  assert.equal(bad.w.db.tables.photoSaleNotification[0].status, "FAILED");
}));

test("guests are kept to their own gallery and device", () => withEnv(ENV, async () => {
  const w = world();
  await w.guests.register(w.g1, session(), { name: "Kavin", phone: "9876543210", whatsappConsent: true });
  await search(w, w.g1, session());
  await newPhotos(w, "new-photo", "new-stranger", "g2-photo");
  assert.deepEqual(await w.guests.matchedPhotoIds(w.g1, session("someone-else")), [], "another device sees none of this guest's matches");
  assert.deepEqual(await w.guests.matchedPhotoIds(w.g2, session()), [], "the same device in another gallery is nobody there");
  assert.equal(w.db.tables.photoSaleGuestMatch.some((row) => row.photoId === "g2-photo"), false, "another gallery's upload is never matched to this guest");
}));

test("the store's first screen: name and number always, the PIN where set, no code - and no selfie before them", () => withEnv(ENV, async () => {
  const w = world();
  const security = require("../src/modules/photo-selling/shared/security");
  const stubs = { "config/db.js": w.db, "modules/photo-selling/galleries/service.js": { ...require(path.join(src, "modules/photo-selling/galleries/service.js")), resolveCode: async (code) => w.db.tables.photoSaleGallery.find((row) => row.shortCode === code) || null } };
  const store = loadWith(path, src, stubs, "modules/photo-selling/public/service.js");
  w.g1.visitCount = 0;
  await assert.rejects(store.openSession("ABC123", { name: "Kavin", phone: "123" }, "1.1.1.1"), (error) => error.status === 400, "a number Meta could not take is refused");
  assert.equal(w.db.tables.photoSaleGuest.length, 0);
  const opened = await store.openSession("ABC123", { name: "Kavin", phone: "9876543210", whatsappConsent: true }, "1.1.1.1");
  assert.ok(opened.session);
  assert.deepEqual(opened.guest, { name: "Kavin", phone: "+91 ••••••3210", whatsappOn: true, selfieCount: 0, selfieLimit: 10 });
  const session = security.readSession(`Bearer ${opened.session}`, "g1");
  assert.equal(w.db.tables.photoSaleGuest[0].sessionHash, session.sessionHash, "the guest is this session's, never an id from the request");
  assert.equal(w.g1.visitCount, 1);
  // A session from before the first screen asked for these has no guest: the selfie waits for them.
  const old = security.signSession("g1").token;
  await assert.rejects(store.selfiePreflight("ABC123", `Bearer ${old}`), (error) => error.status === 409);
  await store.selfiePreflight("ABC123", `Bearer ${opened.session}`);
}));

test("the orders list's rolling ranges: last 7 and 30 days, 3 and 6 months up to now, or everything", () => {
  const { rangeStart } = require("../src/modules/photo-selling/orders/service");
  const now = new Date("2026-10-29T12:00:00Z");
  assert.equal(rangeStart("7d", now).toISOString(), "2026-10-22T12:00:00.000Z");
  assert.equal(rangeStart("30d", now).toISOString(), "2026-09-29T12:00:00.000Z");
  assert.equal(rangeStart("3m", now).getUTCMonth(), 6, "July");
  assert.equal(rangeStart("6m", now).getUTCMonth(), 3, "April");
  assert.equal(rangeStart("all", now), null);
  assert.equal(rangeStart(undefined, now), null);
  const v = require("../src/modules/photo-selling/shared/validation");
  assert.equal(v.listOrders.safeParse({ range: "1y" }).success, false, "only the offered ranges");
  assert.equal(v.listOrders.safeParse({ range: "3m" }).success, true);
});

test("the orders list counts each status for the tabs - in the range picked, whatever tab is open", () => {
  const now = Date.now();
  const order = (id, status, daysAgo, galleryId = "g1") => ({ id, galleryId, status, orderRef: `PS-${id}`, buyerName: "B", buyerPhone: "9876543210", createdAt: new Date(now - daysAgo * 86400000), subtotalPaise: 100, discountPaise: 0, taxPaise: 0, totalPaise: 100, currency: "INR" });
  const db = createFakeDb({ photoSaleOrder: [order("a", "PAID", 1), order("b", "FAILED", 2), order("c", "PAID", 40), order("d", "PENDING", 200), order("e", "PAID", 1, "g2")] });
  const orders = loadWith(path, src, { "config/db.js": db }, "modules/photo-selling/orders/service.js");
  return (async () => {
    const all = await orders.list({ galleryId: "g1", status: "PAID" });
    assert.deepEqual(all.counts, { PAID: 2, FAILED: 1, PENDING: 1, ALL: 4 }, "the counts ignore the open tab, and keep to the gallery");
    assert.equal(all.total, 2, "the list itself is the open tab's");
    const month = await orders.list({ galleryId: "g1", range: "30d" });
    assert.deepEqual(month.counts, { PAID: 1, FAILED: 1, ALL: 2 }, "and follow the range");
  })();
});

test("a guest keeps up to ten selfies: the eleventh is refused by the server, and removing one frees a slot", () => withEnv(ENV, async () => {
  const w = world();
  await w.guests.register(w.g1, session(), { name: "Kavin", phone: "9876543210", whatsappConsent: false });
  for (let i = 0; i < 10; i += 1) await search(w, w.g1, session());
  assert.equal((await w.guests.listSelfies(w.g1, session())).count, 10);
  await assert.rejects(search(w, w.g1, session()), (error) => error.status === 429 && /Remove one to add another/.test(error.message));
  assert.equal(w.db.tables.photoSaleGuestSelfie.length, 10, "nothing kept for the refused one");
  assert.equal(w.db.tables.photoSaleGuest[0].selfieCount, 10);
  const [first] = (await w.guests.listSelfies(w.g1, session())).items;
  await w.guests.removeSelfie(w.g1, session(), first.id);
  assert.equal(w.db.tables.photoSaleGuest[0].selfieCount, 9);
  await search(w, w.g1, session());
  assert.equal((await w.guests.listSelfies(w.g1, session())).count, 10, "a replacement fits");
}));

test("selfies sent at once cannot pass the limit together", () => withEnv(ENV, async () => {
  const w = world();
  await w.guests.register(w.g1, session(), { name: "Kavin", phone: "9876543210", whatsappConsent: false });
  for (let i = 0; i < 8; i += 1) await search(w, w.g1, session());
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => search(w, w.g1, session())));
  assert.equal(w.db.tables.photoSaleGuestSelfie.length, 10);
  assert.equal(results.filter((result) => result.status === "rejected").length >= 3, true);
}));

test("several selfies: their matches combine, each photo once; removing one keeps what another still matches", () => withEnv(ENV, async () => {
  const w = world();
  await w.guests.register(w.g1, session(), { name: "Kavin", phone: "9876543210", whatsappConsent: false });
  w.state.selfie = me;
  await search(w, w.g1, session());
  await search(w, w.g1, session());
  w.state.selfie = other;
  await search(w, w.g1, session());
  const ids = await w.guests.matchedPhotoIds(w.g1, session());
  assert.deepEqual([...ids].sort(), ["solo", "stranger"], "both selfies' photos, each once");
  const selfies = w.db.tables.photoSaleGuestSelfie;
  const otherSelfie = selfies.find((row) => vectors.decode(row.vector)[1] > 0.9);
  const meSelfie = selfies.find((row) => row.id !== otherSelfie.id);
  await w.guests.removeSelfie(w.g1, session(), meSelfie.id);
  assert.deepEqual([...(await w.guests.matchedPhotoIds(w.g1, session()))].sort(), ["solo", "stranger"], "the other copy of the same face still matches solo");
  assert.equal(w.db.tables.photoSaleSelfieSearch.some((row) => row.id === meSelfie.searchId), false, "the search it was taken in goes with it");
  await w.guests.removeSelfie(w.g1, session(), otherSelfie.id);
  assert.deepEqual(await w.guests.matchedPhotoIds(w.g1, session()), ["solo"], "only what a remaining selfie supports is left");
  assert.ok(w.db.tables.photoSaleStorageCleanup.length >= 1, "thumbnails go through the durable clean-up");
}));

test("a selfie the engine cannot read keeps nothing and leaves earlier matches alone", () => withEnv(ENV, async () => {
  const w = world();
  await w.guests.register(w.g1, session(), { name: "Kavin", phone: "9876543210", whatsappConsent: false });
  await search(w, w.g1, session());
  w.state.selfie = null;
  await assert.rejects(search(w, w.g1, session()));
  assert.equal(w.db.tables.photoSaleGuestSelfie.length, 1);
  assert.equal(w.db.tables.photoSaleGuest[0].selfieCount, 1, "the failed one gave its slot back");
  assert.ok((await w.guests.matchedPhotoIds(w.g1, session())).includes("solo"));
}));

test("a guest cannot see, read or remove another guest's selfies", () => withEnv(ENV, async () => {
  const w = world();
  await w.guests.register(w.g1, session("a"), { name: "Kavin", phone: "9876543210", whatsappConsent: false });
  await w.guests.register(w.g1, session("b"), { name: "Ravi", phone: "9876500000", whatsappConsent: false });
  await search(w, w.g1, session("a"));
  const [mine] = (await w.guests.listSelfies(w.g1, session("a"))).items;
  assert.equal((await w.guests.listSelfies(w.g1, session("b"))).count, 0);
  await assert.rejects(w.guests.selfieThumbnail(w.g1, session("b"), mine.id), (error) => error.status === 404);
  await w.guests.removeSelfie(w.g1, session("b"), mine.id);
  assert.equal(w.db.tables.photoSaleGuestSelfie.length, 1, "still there");
  assert.equal((await w.guests.listSelfies(w.g2, session("a"))).count, 0, "nor in another gallery");
}));
