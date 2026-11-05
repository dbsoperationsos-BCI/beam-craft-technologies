const test = require("node:test");
const assert = require("node:assert/strict");
const { createSettingsService, DEFAULTS } = require("../src/modules/image-selection/settings/service");
const { settingsSchema } = require("../src/modules/image-selection/settings/validation");

function fakeRepository(row = null) {
  const state = { row, upserts: [] };
  return {
    state,
    find: async () => state.row,
    upsert: async (data) => { state.upserts.push(data); state.row = { ...(state.row || {}), ...data }; return state.row; },
  };
}

// A studio that has never opened the settings form has no row, and everything downstream — the
// gallery expiry, the deliverable defaults, the name on the invite — has to keep working.
test("falls back to the shipped defaults when nothing has been saved", async () => {
  const settings = createSettingsService(fakeRepository(null));
  assert.deepEqual(await settings.read(), DEFAULTS);
  assert.equal(DEFAULTS.galleryValidityMonths, 6);
  assert.equal(DEFAULTS.defaultSelectionLimit, 50);
  assert.equal(DEFAULTS.studioName, "Don't Blink Studios");
  assert.equal(DEFAULTS.galleryLogoUrl, null);
});

test("reading never writes, so a read cannot create the settings row", async () => {
  const repo = fakeRepository(null);
  await createSettingsService(repo).read();
  assert.deepEqual(repo.state.upserts, []);
  assert.equal(repo.state.row, null);
});

test("a saved row wins over the defaults, field by field", async () => {
  const settings = createSettingsService(fakeRepository({ galleryValidityMonths: 12, studioName: "Beam Craft" }));
  const result = await settings.read();
  assert.equal(result.galleryValidityMonths, 12);
  assert.equal(result.studioName, "Beam Craft");
  // Untouched fields still answer with the default rather than undefined.
  assert.equal(result.defaultSelectionLimit, DEFAULTS.defaultSelectionLimit);
});

test("saving records who changed the studio-wide settings", async () => {
  const repo = fakeRepository(null);
  await createSettingsService(repo).save({ galleryValidityMonths: 3, defaultSelectionLimit: 80, studioName: "Beam Craft", galleryLogoUrl: null }, 42);
  assert.equal(repo.state.upserts[0].updatedByUserId, 42);
  assert.equal(repo.state.upserts[0].galleryValidityMonths, 3);
});

test("bounds the studio-wide numbers to the range a single project is allowed to hold", () => {
  const valid = { galleryValidityMonths: 6, defaultSelectionLimit: 50, studioName: "Beam Craft", galleryLogoUrl: null };
  assert.equal(settingsSchema.safeParse(valid).success, true);
  assert.equal(settingsSchema.safeParse({ ...valid, galleryValidityMonths: 0 }).success, false);
  assert.equal(settingsSchema.safeParse({ ...valid, galleryValidityMonths: 61 }).success, false);
  assert.equal(settingsSchema.safeParse({ ...valid, defaultSelectionLimit: 0 }).success, false);
  assert.equal(settingsSchema.safeParse({ ...valid, defaultSelectionLimit: 100001 }).success, false);
  assert.equal(settingsSchema.safeParse({ ...valid, defaultSelectionLimit: 20.5 }).success, false);
  // The name is optional, but it goes out on every invite, so a blank falls back to the default
  // rather than clearing it.
  // Emptying the name clears it: the field is optional, so a blank has to survive the save rather
  // than being written back over with the default.
  const blank = settingsSchema.safeParse({ ...valid, studioName: "   " });
  assert.equal(blank.success, true);
  assert.equal(blank.data.studioName, "");
  // Login slides: at most five, each a non-blank link or data URI, and absent means "leave as is".
  assert.equal(settingsSchema.safeParse({ ...valid, loginSlides: ["https://cdn/a.jpg", "data:image/png;base64,AAAA"] }).success, true);
  assert.equal(settingsSchema.safeParse({ ...valid, loginSlides: ["", "https://cdn/a.jpg"] }).success, false);
  assert.equal(settingsSchema.safeParse({ ...valid, loginSlides: Array(6).fill("https://cdn/a.jpg") }).success, false);
  assert.equal("loginSlides" in settingsSchema.safeParse(valid).data, false);
});

// The login slides live on the settings row but are edited by their own form, which sends only
// them; reading always answers a list, whatever the column holds.
test("reads login slides as a list and keeps them when a save leaves them out", async () => {
  const repo = fakeRepository({ loginSlides: null });
  assert.deepEqual((await createSettingsService(repo).read()).loginSlides, []);
  const withSlides = fakeRepository({ loginSlides: ["https://cdn/a.jpg", 7, ""] });
  assert.deepEqual((await createSettingsService(withSlides).read()).loginSlides, ["https://cdn/a.jpg"]);
});

// The two server-side roots bound everything this backend will open or write, so anything that
// could resolve outside one — a relative path, a `..` step — is refused before it can be stored.
// There is deliberately no browser download path here: that is a folder handle held by the browser
// itself, and a string on this row could never grant permission to write one.
test("accepts a real server storage path and refuses one that could escape it", () => {
  const base = { galleryValidityMonths: 6, defaultSelectionLimit: 50, studioName: "Beam Craft", galleryLogoUrl: null };
  const parse = (originalStoragePath) => settingsSchema.safeParse({ ...base, originalStoragePath });
  assert.equal(parse("D:\\DBS-Originals").success, true);
  assert.equal(parse("E:\\DontBlinkStudioz\\Originals").success, true);
  assert.equal(parse("\\\\studio-nas\\Originals").success, true);
  assert.equal(parse("/srv/dbs-originals").success, true);
  assert.equal(parse("DBS-Originals").success, false);
  assert.equal(parse("..\\DBS-Originals").success, false);
  assert.equal(parse("D:\\DBS-Originals\\..\\Windows").success, false);
  assert.equal(parse("D:\\DBS?Originals").success, false);
  assert.equal(parse(`D:\\${"x".repeat(500)}`).success, false);
  // The output path is held to exactly the same rule — it is written to, not just read.
  assert.equal(settingsSchema.safeParse({ ...base, selectedOutputPath: "\\\\studio-nas\\Selections" }).success, true);
  assert.equal(settingsSchema.safeParse({ ...base, selectedOutputPath: "../escape" }).success, false);
});

// Blank means "not configured", which switches the feature off rather than leaving it half on:
// originals cannot be registered and selections fall back to the browser's Target Download Path.
test("treats a blank storage path as no storage path rather than as an empty string", () => {
  const base = { galleryValidityMonths: 6, defaultSelectionLimit: 50, studioName: "Beam Craft", galleryLogoUrl: null };
  assert.equal(settingsSchema.parse({ ...base, originalStoragePath: "" }).originalStoragePath, null);
  assert.equal(settingsSchema.parse({ ...base, selectedOutputPath: null }).selectedOutputPath, null);
  assert.equal(settingsSchema.parse({ ...base }).originalStoragePath, null);
  assert.equal(DEFAULTS.originalStoragePath, null);
  assert.equal(DEFAULTS.selectedOutputPath, null);
});

test("treats a blank logo as no logo rather than as an empty string", () => {
  const base = { galleryValidityMonths: 6, defaultSelectionLimit: 50, studioName: "Beam Craft" };
  assert.equal(settingsSchema.parse({ ...base, galleryLogoUrl: "" }).galleryLogoUrl, null);
  assert.equal(settingsSchema.parse({ ...base, galleryLogoUrl: null }).galleryLogoUrl, null);
  assert.equal(settingsSchema.parse({ ...base }).galleryLogoUrl, null);
  assert.equal(settingsSchema.parse({ ...base, galleryLogoUrl: "https://cdn.example/logo.png" }).galleryLogoUrl, "https://cdn.example/logo.png");
});
