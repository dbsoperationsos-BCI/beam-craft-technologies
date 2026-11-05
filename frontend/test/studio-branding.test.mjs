import assert from "node:assert/strict";
import test from "node:test";
import { BUNDLED_BRAND_NAME, brandNameInProse, brandingSavedNotice, hasBrandingChanges, haveSlidesChanged, normalizeBrandingDraft } from "../src/lib/studioBranding.mjs";

const LOGO = "https://example.r2.dev/image-selection/branding/logo.webp";

test("a sentence about the studio is given the Global Name, or the bundled brand", () => {
  assert.equal(brandNameInProse({ studioName: "Don't Blink Studio" }), "Don't Blink Studio");
  assert.equal(brandNameInProse({ studioName: "  Beam Craft  " }), "Beam Craft");
  // Left blank in Settings, and the moment before the branding endpoint has answered.
  assert.equal(brandNameInProse({ studioName: "" }), BUNDLED_BRAND_NAME);
  assert.equal(brandNameInProse({ studioName: "   " }), BUNDLED_BRAND_NAME);
  assert.equal(brandNameInProse({}), BUNDLED_BRAND_NAME);
  assert.equal(brandNameInProse(null), BUNDLED_BRAND_NAME);
  assert.equal(brandNameInProse(undefined), BUNDLED_BRAND_NAME);
  assert.equal(BUNDLED_BRAND_NAME, "Beam Craft");
});

test("nothing counts as a change until the settings have been read", () => {
  assert.equal(hasBrandingChanges(null, { studioName: "Beam Craft", galleryLogoUrl: LOGO }), false);
  assert.equal(hasBrandingChanges(undefined, { studioName: "", galleryLogoUrl: "" }), false);
});

test("a form that has only been opened is not a change", () => {
  assert.equal(hasBrandingChanges({ studioName: "", galleryLogoUrl: null }, { studioName: "", galleryLogoUrl: "" }), false);
  assert.equal(hasBrandingChanges({ studioName: "Beam Craft", galleryLogoUrl: LOGO }, { studioName: "Beam Craft", galleryLogoUrl: LOGO }), false);
});

test("whitespace around the name is not a change", () => {
  assert.equal(hasBrandingChanges({ studioName: "Beam Craft", galleryLogoUrl: LOGO }, { studioName: "  Beam Craft ", galleryLogoUrl: LOGO }), false);
});

test("a different name is a change", () => {
  assert.equal(hasBrandingChanges({ studioName: "", galleryLogoUrl: null }, { studioName: "Beam Craft", galleryLogoUrl: "" }), true);
  assert.equal(hasBrandingChanges({ studioName: "Beam Craft", galleryLogoUrl: null }, { studioName: "", galleryLogoUrl: "" }), true);
});

test("picking, replacing or removing the logo is a change", () => {
  assert.equal(hasBrandingChanges({ studioName: "", galleryLogoUrl: null }, { studioName: "", galleryLogoUrl: "data:image/webp;base64,AAAA" }), true);
  assert.equal(hasBrandingChanges({ studioName: "", galleryLogoUrl: LOGO }, { studioName: "", galleryLogoUrl: "data:image/webp;base64,AAAA" }), true);
  assert.equal(hasBrandingChanges({ studioName: "", galleryLogoUrl: LOGO }, { studioName: "", galleryLogoUrl: "" }), true);
});

test("the draft is normalised to the record's shape", () => {
  const blankIcons = { loginCredentialName: "", faviconUrl: null };
  assert.deepEqual(normalizeBrandingDraft({ studioName: "  Beam Craft ", galleryLogoUrl: "" }), { studioName: "Beam Craft", galleryLogoUrl: null, ...blankIcons });
  assert.deepEqual(normalizeBrandingDraft({ studioName: null, galleryLogoUrl: LOGO }), { studioName: "", galleryLogoUrl: LOGO, ...blankIcons });
  assert.deepEqual(normalizeBrandingDraft(undefined), { studioName: "", galleryLogoUrl: null, ...blankIcons });
  // The tab mark is cleared the way the logo is: "" from the form means null in the record.
  assert.deepEqual(
    normalizeBrandingDraft({ studioName: "", galleryLogoUrl: null, faviconUrl: "/brand/x.svg" }),
    { studioName: "", loginCredentialName: "", galleryLogoUrl: null, faviconUrl: "/brand/x.svg" },
  );
  assert.deepEqual(
    normalizeBrandingDraft({ studioName: "", galleryLogoUrl: null, faviconUrl: "" }),
    { studioName: "", loginCredentialName: "", galleryLogoUrl: null, faviconUrl: null },
  );
  // The credentials name is trimmed like the studio name, and blank means "use the shipped one".
  assert.equal(normalizeBrandingDraft({ loginCredentialName: "  Beam Craft Operations " }).loginCredentialName, "Beam Craft Operations");
  assert.equal(normalizeBrandingDraft({ loginCredentialName: "   " }).loginCredentialName, "");
});

test("naming what the credentials email calls this system is an edit worth saving", () => {
  const saved = { studioName: "dhanush", loginCredentialName: "", galleryLogoUrl: LOGO, faviconUrl: null };
  assert.equal(hasBrandingChanges(saved, { ...saved }), false);
  assert.equal(hasBrandingChanges(saved, { ...saved, loginCredentialName: "Beam Craft Operations" }), true);
  // Whitespace is not a name, so typing spaces into an empty box is not an edit.
  assert.equal(hasBrandingChanges(saved, { ...saved, loginCredentialName: "   " }), false);
  assert.equal(brandingSavedNotice(saved, { ...saved, loginCredentialName: "Beam Craft Operations" }), "Login Credential Name saved.");
  assert.equal(
    brandingSavedNotice(saved, { ...saved, studioName: "Beam Craft", loginCredentialName: "Beam Craft Operations" }),
    "Global Name and Login Credential Name saved.",
  );
});

test("uploading or clearing a tab mark is an edit worth saving", () => {
  const saved = { studioName: "dhanush", galleryLogoUrl: LOGO, faviconUrl: null };
  const same = { studioName: "dhanush", galleryLogoUrl: LOGO };
  assert.equal(hasBrandingChanges(saved, same), false, "an untouched form has nothing to write");
  assert.equal(hasBrandingChanges(saved, { ...same, faviconUrl: "data:image/png;base64,AAAA" }), true);
  assert.equal(hasBrandingChanges(saved, { ...same, faviconUrl: "data:image/svg+xml;base64,AAAA" }), true);
  // And removing one that was set.
  assert.equal(hasBrandingChanges({ ...saved, faviconUrl: "/brand/x.svg" }, { ...same, faviconUrl: "" }), true);
});

test("the save notice names what was saved", () => {
  const saved = { studioName: "", galleryLogoUrl: null };
  assert.equal(brandingSavedNotice(saved, { studioName: "dhanush", galleryLogoUrl: "" }), "Global Name saved.");
  assert.equal(brandingSavedNotice(saved, { studioName: "", galleryLogoUrl: "data:image/webp;base64,AAAA" }), "Global Logo saved.");
  assert.equal(brandingSavedNotice(saved, { studioName: "dhanush", galleryLogoUrl: "data:image/webp;base64,AAAA" }), "Global Name and Global Logo saved.");
  assert.equal(brandingSavedNotice({ studioName: "dhanush", galleryLogoUrl: LOGO }, { studioName: "dhanush", galleryLogoUrl: "" }), "Global Logo saved.");
  // The tab mark is named too, alone or beside whatever else the save carried.
  assert.equal(brandingSavedNotice(saved, { studioName: "", galleryLogoUrl: "", faviconUrl: "data:image/png;base64,AAAA" }), "Favicon saved.");
  assert.equal(
    brandingSavedNotice(saved, { studioName: "dhanush", galleryLogoUrl: "", faviconUrl: "data:image/png;base64,AAAA" }),
    "Global Name and Favicon saved.",
  );
  assert.equal(
    brandingSavedNotice(saved, { studioName: "dhanush", galleryLogoUrl: "data:image/webp;base64,AAAA", faviconUrl: "data:image/png;base64,AAAA" }),
    "Global Name, Global Logo and Favicon saved.",
  );
});

test("login slides count as changed only when a picture or the order differs", () => {
  const slides = ["https://example.r2.dev/a.webp", "https://example.r2.dev/b.webp"];
  assert.equal(haveSlidesChanged(null, slides), false);
  assert.equal(haveSlidesChanged([], []), false);
  assert.equal(haveSlidesChanged(slides, [...slides]), false);
  assert.equal(haveSlidesChanged(slides, [slides[0]]), true);
  assert.equal(haveSlidesChanged(slides, [slides[1], slides[0]]), true);
  assert.equal(haveSlidesChanged(slides, [...slides, "data:image/webp;base64,AAAA"]), true);
  assert.equal(haveSlidesChanged(slides, ["data:image/webp;base64,AAAA", slides[1]]), true);
});
