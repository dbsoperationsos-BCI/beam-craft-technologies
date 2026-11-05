const test = require("node:test");
const assert = require("node:assert/strict");
const { KEY_ROOT, slugify, buildDerivativeKey } = require("../src/modules/image-selection/storage/keys");

test("builds a browsable key from project, folder chain and variant", () => {
  const key = buildDerivativeKey({
    projectName: "Priya & Arjun Wedding",
    projectId: "clx9a8b7c6d5e4f3g2h1abcdef",
    folders: [{ name: "Day 1" }, { name: "Ceremony" }],
    variant: "preview",
    fileName: "DSC_0142.JPG",
    storageName: "00d2c444-d6a9-45b8-8797-a6222869d76f",
  });
  assert.equal(key, `${KEY_ROOT}/priya-arjun-wedding-abcdef/day-1/ceremony/preview/dsc-0142-00d2c444.jpg`);
});

test("thumbnail variant uses the webp extension", () => {
  const key = buildDerivativeKey({
    projectName: "Test", projectId: "p123456", folders: [], variant: "thumbnail",
    fileName: "a.jpg", storageName: "abcdef12-0000-0000-0000-000000000000",
  });
  assert.match(key, /\/thumbnail\/a-abcdef12\.webp$/);
});

test("survives the punctuation real project titles contain", () => {
  // Titles in this system look like "WED ygygu HYD ... & rrrrrrr | SM | hnijhikj".
  const key = buildDerivativeKey({
    projectName: "WED ygygu HYD hnihijui ddddd & rrrrrrr | SM | hnijhikj |",
    projectId: "clabc123456", folders: [{ name: "Haldi / Mehendi" }], variant: "preview",
    fileName: "photo (1).jpg", storageName: "11112222-3333-4444-5555-666677778888",
  });
  assert.equal(key.includes(" "), false, "keys must not contain spaces");
  assert.equal(/[|&()/]/.test(key.replace(/\//g, "")), false, "keys must not contain unsafe punctuation");
  assert.equal(key.split("/").some((part) => part === ""), false, "no empty path segments");
  assert.match(key, /^image-selection\/photo-selection\//);
});

test("names that slugify to nothing still produce a valid path", () => {
  const key = buildDerivativeKey({
    projectName: "***", projectId: "zzzzzz", folders: [{ name: "!!!" }, { name: "" }],
    variant: "preview", fileName: "###.jpg", storageName: "deadbeef-0000-0000-0000-000000000000",
  });
  assert.equal(key, `${KEY_ROOT}/project-zzzzzz/folder-1/folder-2/preview/photo-deadbeef.jpg`);
});

test("identically named projects get distinct prefixes", () => {
  const base = { projectName: "Wedding", folders: [], variant: "preview", fileName: "a.jpg", storageName: "aaaaaaaa-0000-0000-0000-000000000000" };
  const first = buildDerivativeKey({ ...base, projectId: "clxaaa111111" });
  const second = buildDerivativeKey({ ...base, projectId: "clxbbb222222" });
  assert.notEqual(first, second);
});

test("two files with the same original name in one folder do not collide", () => {
  const base = { projectName: "P", projectId: "p00001", folders: [{ name: "F" }], variant: "preview", fileName: "DSC_0001.jpg" };
  const first = buildDerivativeKey({ ...base, storageName: "11111111-0000-0000-0000-000000000000" });
  const second = buildDerivativeKey({ ...base, storageName: "22222222-0000-0000-0000-000000000000" });
  assert.notEqual(first, second);
});

test("slugify strips accents and collapses separators", () => {
  assert.equal(slugify("Café  Déjà-Vu!!"), "cafe-deja-vu");
  assert.equal(slugify("   "), "");
});

test("rejects an unknown variant rather than writing a bad key", () => {
  assert.throws(() => buildDerivativeKey({ projectName: "P", projectId: "p1", folders: [], variant: "original", fileName: "a.jpg", storageName: "b" }), /Unknown derivative variant/);
});
