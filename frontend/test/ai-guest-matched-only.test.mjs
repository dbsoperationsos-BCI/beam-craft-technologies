import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { RETIRED_KEYS, SECTIONS } from "../src/lib/aiEventDefaults.mjs";

const aiFeature = path.join(process.cwd(), "src", "components", "ai-feature");
const read = (...parts) => fs.readFileSync(path.join(aiFeature, ...parts), "utf8");

// The AI Feature guest page shows a guest only the photos their own selfie matched.
test("Show All Photos and Show People to guests are gone from every AI Feature settings form", () => {
  for (const file of [["settings", "PrivacySettings.js"], ["shared", "SettingsGroupForm.js"]]) {
    const source = read(...file);
    assert.doesNotMatch(source, /Show All Photos|Show People|showAllPhotos|showPeople/, file.join("/"));
    assert.match(source, /Show My Photos/);
    assert.match(source, /Allow downloads/);
    assert.match(source, /Allow sharing/, "sharing a matched photo from the viewer stays a setting");
  }
  const drawn = SECTIONS.flatMap((section) => Object.entries(section.keys).flatMap(([group, keys]) => keys.map((key) => `${group}.${key}`)));
  for (const key of RETIRED_KEYS) assert.ok(!drawn.includes(key), key);
});

test("the guest page has no All Photos tab, whatever an older event stored", () => {
  const actions = read("guest", "guestActions.js");
  assert.doesNotMatch(actions, /id: "all"/);
  assert.match(actions, /if \(meta\?\.gallery\?\.showMyPhotos \|\| meta\?\.features\?\.selfieSearch\) tabs\.push\(\{ id: "mine", label: "My Photos" \}\);/);
  const gallery = read("guest", "GuestGallery.js");
  assert.doesNotMatch(gallery, /tab === "all"|listGuestGallery|fetchAll/);
  assert.doesNotMatch(fs.readFileSync(path.join(process.cwd(), "src", "services", "ai-feature", "ai-feature-public.service.js"), "utf8"), /\/gallery\$\{/);
  // Guest uploads moved to My Photos; the photo shows there only once the guest's selfie matches it.
  assert.match(gallery, /tab === "mine" && meta\?\.features\?\.guestUploads && <div className="mb-3 flex justify-end"><GuestUploadButton /);
});

test("zero matches say so and offer another selfie where selfie search is open", () => {
  const mine = read("guest", "MyPhotosTab.js");
  assert.match(mine, /No photos found yet/);
  assert.match(mine, /Only photos your selfie matches are shown here\./);
  assert.match(mine, /\{showFind && <div className="mt-5"><ReplaceSelfie primary/);
});
