const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * A shoot's optional cover picture on its pre-production plan: compressed and stored in R2 by the
 * save, kept per shoot, and never taken from a link the shoot does not already hold.
 */
const ROOT = path.join(__dirname, "..");
const CONTROLLER = fs.readFileSync(path.join(ROOT, "src/modules/project-management/pre-production/controller.js"), "utf8");
const SCHEMA = fs.readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8");
const { preProductionUpdateSchema } = require("../src/modules/project-management/pre-production/controller");

test("the cover is one optional column on the shoot's own pre-production row", () => {
  const model = SCHEMA.slice(SCHEMA.indexOf("model ProjectPreProduction {"), SCHEMA.indexOf("@@map(\"project_pre_production\")"));
  assert.match(model, /shootId\s+String\s+@unique/);
  assert.match(model, /coverImageUrl\s+String\?\s+@map\("cover_image_url"\) @db\.Text/);
  const migration = fs.readFileSync(path.join(ROOT, "prisma/migrations/20261023130000_pre_production_cover_image/migration.sql"), "utf8");
  assert.match(migration, /ALTER TABLE `project_pre_production` ADD COLUMN `cover_image_url` TEXT NULL;/);
});

test("a save may send a picture, the link it already has, null, or nothing", () => {
  assert.equal(preProductionUpdateSchema.safeParse({ coverImage: "data:image/png;base64,AAAA" }).success, true);
  assert.equal(preProductionUpdateSchema.safeParse({ coverImage: null }).success, true);
  assert.equal(preProductionUpdateSchema.safeParse({}).data.coverImage, undefined);
  assert.equal(preProductionUpdateSchema.safeParse({ coverImage: 5 }).success, false);
});

test("a picked picture is compressed into R2, and a replaced or orphaned one is deleted", () => {
  assert.match(CONTROLLER, /const COVER_COMPRESSION = \{ folder: COVER_FOLDER, maxBytes: 600 \* 1024, maxDimension: 2000 \};/);
  assert.match(CONTROLLER, /return storeImage\(coverImage, COVER_COMPRESSION\);/);
  // Nothing is compressed or uploaded for a shoot the save would refuse.
  assert.match(CONTROLLER, /if \(coverImage && !isHttpUrl\(coverImage\)\) \{\s*const target = await prisma\.projectShoot\.findFirst[\s\S]{0,400}?uploaded = await uploadCover\(coverImage\);/);
  // A link is accepted only when it is the one this shoot already holds.
  assert.match(CONTROLLER, /if \(isHttpUrl\(coverImage\) && coverImage\.trim\(\) !== current\) \{\s*throw Object\.assign\(new Error\("Pick the cover image from your device\."\), \{ status: 400 \}\);/);
  assert.match(CONTROLLER, /if \(replacedCover\) await deleteObject\(replacedCover\);/);
  assert.match(CONTROLLER, /if \(uploaded\?\.url && !committed\) await deleteObject\(uploaded\.url\);/);
  assert.match(CONTROLLER, /coverImageUrl: record\.coverImageUrl \|\| null,/);
});
