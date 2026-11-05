const test = require("node:test");
const assert = require("node:assert/strict");
const QRCode = require("qrcode");
const { createPosterService, LOGO_MAX_BYTES } = require("../src/modules/ai-feature/share/poster");

const NOW = new Date("2026-10-13T10:00:00.000Z");
const URL_A = "https://studio.example/e/5G5TVW";

function build({ share = { status: "ACTIVE", expiresAt: null, shortCode: "5G5TVW" }, branding = {}, objects = {}, link = { url: URL_A, shortCode: "5G5TVW", pin: "3955" } } = {}) {
  const reads = [];
  const service = createPosterService({
    prisma: { aiEventShare: { findUnique: async () => share } },
    loadEvent: async (id) => { if (id === "gone") { const e = new Error("Event not found."); e.status = 404; throw e; } return { id, name: "Shivaharshan & Pavithra", eventType: "Wedding", startDate: NOW, endDate: null, location: "Chennai" }; },
    withLink: async () => link,
    settings: { read: async () => ({ studioName: "Don't Blink Studioz", galleryLogoUrl: null, galleryLogoDarkUrl: null, ...branding }) },
    objectStorage: {
      keyFromUrl: (url) => (url.startsWith("https://cdn.example/") ? url.slice("https://cdn.example/".length) : null),
      getPublicObjectBuffer: async (key) => { reads.push(key); if (objects[key] instanceof Error) throw objects[key]; return objects[key] ?? null; },
    },
    now: () => NOW,
  });
  return { service, reads };
}

test("an active link's kit carries the link, the event's own name and the QR grid of exactly that URL", async () => {
  const { service } = build();
  const kit = await service.poster("e1");
  assert.equal(kit.url, URL_A);
  assert.equal(kit.shortCode, "5G5TVW");
  assert.equal(kit.pin, "3955");
  assert.equal(kit.event.name, "Shivaharshan & Pavithra");
  assert.equal(kit.studioName, "Don't Blink Studioz");
  const expected = QRCode.create(URL_A, { errorCorrectionLevel: "H" });
  assert.equal(kit.qr.size, expected.modules.size);
  assert.equal(kit.qr.errorCorrection, "H");
  assert.equal(kit.qr.modules, Array.from(expected.modules.data, (bit) => (bit ? "1" : "0")).join(""));
  assert.match(kit.qr.modules, /^[01]+$/);
  assert.equal(kit.qr.modules.length, kit.qr.size ** 2);
});

test("a different event's link is a different grid", async () => {
  const a = await build().service.poster("e1");
  const b = await build({ link: { url: "https://studio.example/e/ZZ9QXK", shortCode: "ZZ9QXK", pin: null } }).service.poster("e2");
  assert.notEqual(a.qr.modules, b.qr.modules);
  assert.equal(b.pin, null);
});

test("no poster without a live link: never shared, revoked or expired is a 409; a gone event is a 404", async () => {
  await assert.rejects(() => build({ share: null }).service.poster("e1"), { status: 409 });
  await assert.rejects(() => build({ share: { status: "REVOKED", expiresAt: null } }).service.poster("e1"), { status: 409 });
  await assert.rejects(() => build({ share: { status: "ACTIVE", expiresAt: new Date("2026-10-01T00:00:00Z") } }).service.poster("e1"), { status: 409 });
  await assert.rejects(() => build().service.poster("gone"), { status: 404 });
});

test("the studio's Global Logo is read from our own bucket by its key and handed over as a data URL", async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const svg = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>");
  const { service, reads } = build({ branding: { galleryLogoUrl: "https://cdn.example/image-selection/branding/logo.png", galleryLogoDarkUrl: "https://cdn.example/image-selection/branding/dark.svg" }, objects: { "image-selection/branding/logo.png": png, "image-selection/branding/dark.svg": svg } });
  const kit = await service.poster("e1");
  assert.equal(kit.logos.light, `data:image/png;base64,${png.toString("base64")}`);
  assert.equal(kit.logos.dark, `data:image/svg+xml;base64,${svg.toString("base64")}`);
  assert.deepEqual(reads.sort(), ["image-selection/branding/dark.svg", "image-selection/branding/logo.png"]);
});

test("no logo, a URL that is not ours, a missing, failing or oversized object: left out, so the client uses the fallback mark", async () => {
  const none = await build().service.poster("e1");
  assert.deepEqual(none.logos, { light: null, dark: null });
  const foreign = build({ branding: { galleryLogoUrl: "https://evil.example/logo.png" } });
  assert.equal((await foreign.service.poster("e1")).logos.light, null);
  assert.deepEqual(foreign.reads, [], "a stored URL that is not our bucket is never fetched");
  const broken = build({ branding: { galleryLogoUrl: "https://cdn.example/image-selection/branding/a.png", galleryLogoDarkUrl: "https://cdn.example/image-selection/branding/b.png" }, objects: { "image-selection/branding/b.png": new Error("R2 down") } });
  assert.deepEqual((await broken.service.poster("e1")).logos, { light: null, dark: null });
  const huge = build({ branding: { galleryLogoUrl: "https://cdn.example/image-selection/branding/big.png" }, objects: { "image-selection/branding/big.png": Buffer.alloc(LOGO_MAX_BYTES + 1) } });
  assert.equal((await huge.service.poster("e1")).logos.light, null);
  const odd = build({ branding: { galleryLogoUrl: "https://cdn.example/image-selection/branding/logo.exe" } });
  assert.equal((await odd.service.poster("e1")).logos.light, null);
  // An object of ours outside the branding folder - a client's photo, say - is never read.
  const elsewhere = build({ branding: { galleryLogoUrl: "https://cdn.example/ai-feature/event-1/previews/x.jpg" }, objects: { "ai-feature/event-1/previews/x.jpg": Buffer.from([1]) } });
  assert.equal((await elsewhere.service.poster("e1")).logos.light, null);
  assert.deepEqual(elsewhere.reads, []);
});

test("a logo saved as a data URL (storage not configured) passes through untouched", async () => {
  const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
  const kit = await build({ branding: { galleryLogoUrl: dataUrl } }).service.poster("e1");
  assert.equal(kit.logos.light, dataUrl);
});

test("the poster route sits behind the router's protect and AI Feature guard", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "src", "modules", "ai-feature", "routes.js"), "utf8");
  const guard = source.indexOf("router.use(requireModule(MODULE, FEATURE));");
  const route = source.indexOf('router.get("/events/:eventId/share/poster", share.getSharePoster);');
  assert.ok(guard > -1 && route > guard);
});
