const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");
const service = require("../src/modules/sales/client-offers/service");
const { studioDateKey } = require("../src/services/studioTime");

/*
 * Sales -> Client Offers: an offer reaches the clients' app only while it is on, not removed, and
 * today is within its dates. Real rows, removed at the end.
 */
const STAMP = String(Date.now()).slice(-6);
const made = [];
const shift = (days) => { const d = new Date(`${studioDateKey(new Date())}T00:00:00.000Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
// A poster that is already a web address: kept as it is, so nothing is ever uploaded to storage.
const PIXEL = "https://example.com/offer-poster.png";
const add = async (overrides) => {
  const input = service.offerSchema.parse({ title: `TCO-${STAMP} ${overrides.name}`, image: PIXEL, ...overrides });
  const offer = await service.createOffer(input, null);
  made.push(offer.id);
  return offer;
};

after(async () => {
  await prisma.clientOffer.deleteMany({ where: { id: { in: made } } });
  await prisma.$disconnect();
});

test("only offers that are on, not removed and within their dates reach the clients", async () => {
  const open = await add({ name: "open" });
  const current = await add({ name: "current", validFrom: shift(-1), validUntil: shift(1) });
  const ended = await add({ name: "ended", validUntil: shift(-1) });
  const later = await add({ name: "later", validFrom: shift(2) });
  const off = await add({ name: "off", isActive: false });
  const removed = await add({ name: "removed" });
  assert.equal(await service.removeOffer(removed.id, null), true);

  const live = (await service.liveOffers()).map((offer) => offer.id);
  assert.ok(live.includes(open.id) && live.includes(current.id), "open-ended and current are shown");
  for (const offer of [ended, later, off, removed]) assert.ok(!live.includes(offer.id), `${offer.title} is not shown`);

  const team = (await service.listOffers()).map((offer) => offer.id);
  assert.ok(team.includes(off.id) && team.includes(ended.id), "the team still sees switched-off and ended offers");
  assert.ok(!team.includes(removed.id), "a removed offer is gone from the list");
});

test("an offer is its poster, and cannot end before it starts", async () => {
  await assert.rejects(service.createOffer(service.offerSchema.parse({}), null), /poster/);
  assert.equal(service.offerSchema.safeParse({ image: PIXEL }).success, true, "no title is needed");
  assert.equal(service.offerSchema.safeParse({ title: "Festive offer", validFrom: "2026-11-10", validUntil: "2026-11-01" }).success, false);
  assert.equal(service.offerSchema.safeParse({ title: "Festive offer", tone: "light", validFrom: "2026-11-01", validUntil: "2026-11-10" }).success, true);
});

test("a poster is square, portrait or story - by shape, with a pixel or two of room - and nothing else", () => {
  const size = (width, height) => service.posterSizeOf(width, height)?.key ?? null;
  assert.equal(size(1080, 1080), "square");
  assert.equal(size(1080, 1350), "portrait");
  assert.equal(size(1080, 1920), "story");
  // The same shapes at another resolution, as compressed for storage or exported larger.
  assert.equal(size(2160, 2700), "portrait");
  assert.equal(size(900, 1600), "story");
  assert.equal(size(1080, 1352), "portrait", "an export a pixel or two off still counts");
  // The earlier wide poster, and shapes near but not one of the three.
  assert.equal(size(1200, 675), null);
  assert.equal(size(1080, 1200), null);
  assert.equal(size(1080, 1600), null);
  assert.equal(size(0, 0), null);
  assert.deepEqual(service.POSTER_SIZES.map((s) => `${s.width}x${s.height}`), ["1080x1080", "1080x1350", "1080x1920"]);
});

test("an offer's poster size reaches the app with it, and an offer saved before sizes were kept sends none", async () => {
  const offer = await add({ name: "sized" });
  await prisma.clientOffer.update({ where: { id: offer.id }, data: { imageWidth: 1080, imageHeight: 1350 } });
  const live = (await service.liveOffers()).find((o) => o.id === offer.id);
  assert.equal(live.imageWidth, 1080);
  assert.equal(live.imageHeight, 1350);
  const unsized = await add({ name: "unsized" });
  const old = (await service.liveOffers()).find((o) => o.id === unsized.id);
  assert.equal(old.imageWidth, null);
  assert.equal(old.imageHeight, null);
});

test("a referral offer shows on the Referrals page only, a Home offer on Home only", async () => {
  const home = await add({ name: "home" });
  const referral = await add({ name: "referral", placement: "referral" });
  assert.equal(referral.placement, "referral");
  const onHome = (await service.liveOffers()).map((offer) => offer.id);
  const onReferrals = (await service.liveOffers("referral")).map((offer) => offer.id);
  assert.ok(onHome.includes(home.id) && !onHome.includes(referral.id));
  assert.ok(onReferrals.includes(referral.id) && !onReferrals.includes(home.id));
  assert.equal(service.offerSchema.safeParse({ image: PIXEL, placement: "elsewhere" }).success, false);
});
