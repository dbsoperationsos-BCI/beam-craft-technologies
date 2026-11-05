const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const read = (relative) => fs.readFileSync(path.join(__dirname, "..", relative), "utf8");
const routes = read("src/modules/photo-selling/routes.js");
const publicRoutes = read("src/modules/photo-selling/public/routes.js");
const server = read("src/server.js");

test("every staff route sits behind protect and IMAGE_SELECTION / Photo Selling", () => {
  const guardAt = routes.indexOf("router.use(requireModule(MODULE, FEATURE));");
  assert.ok(routes.indexOf("router.use(protect);") >= 0 && guardAt > routes.indexOf("router.use(protect);"));
  const firstRoute = routes.search(/router\.(get|post|patch|put|delete)\(/);
  assert.ok(firstRoute > guardAt, "no route is declared before the guard");
  const { MODULE, FEATURE } = require("../src/modules/photo-selling/shared/permissions");
  assert.equal(MODULE, "IMAGE_SELECTION");
  assert.equal(FEATURE, "Photo Selling");
});

test("no controller decides access by role", () => {
  const dir = path.join(__dirname, "../src/modules/photo-selling");
  const files = [];
  const walk = (folder) => { for (const entry of fs.readdirSync(folder, { withFileTypes: true })) { const full = path.join(folder, entry.name); if (entry.isDirectory()) walk(full); else if (entry.name.endsWith(".js")) files.push(full); } };
  walk(dir);
  for (const file of files) assert.doesNotMatch(fs.readFileSync(file, "utf8"), /req\.user\.role/, path.relative(dir, file));
});

test("Photo Selling stands alone: it never reads or writes an AI Feature event, photo or face", () => {
  const dir = path.join(__dirname, "../src/modules/photo-selling");
  const files = [];
  const walk = (folder) => { for (const entry of fs.readdirSync(folder, { withFileTypes: true })) { const full = path.join(folder, entry.name); if (entry.isDirectory()) walk(full); else if (entry.name.endsWith(".js")) files.push(full); } };
  walk(dir);
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    const name = path.relative(dir, file);
    assert.doesNotMatch(text, /prisma\.aiEvent(Media|Face|FaceEmbedding|Guest|Share|Setting)?\./, name);
    assert.doesNotMatch(text, /require\("\.\.\/(\.\.\/)?ai-feature\/(events|media\/service|processing|matches|people|guests|share\/service|public)/, name);
  }
  // Its objects live under its own namespace only.
  assert.match(read("src/modules/photo-selling/shared/storage.js"), /const ROOT = "photo-selling";/);
});

test("the permission exists in the catalogue and in a migration that grants it to SUPER_ADMIN only", () => {
  const { PERMISSIONS } = require("../prisma/seeds/permission-catalogue");
  const row = PERMISSIONS.find((permission) => permission.module === "IMAGE_SELECTION" && permission.feature === "Photo Selling");
  assert.ok(row);
  assert.equal(row.level, "ISPHOTO_SELLING");
  const migration = read("prisma/migrations/20261023130000_photo_selling/migration.sql");
  assert.match(migration, /'IMAGE_SELECTION', 'Photo Selling', 'ISPHOTO_SELLING'/);
  assert.match(migration, /WHERE `role`\.`name` = 'SUPER_ADMIN'/);
  assert.doesNotMatch(migration, /BRANCH_ADMIN|'ADMIN'/);
  // New tables only: nothing existing is altered or dropped.
  assert.doesNotMatch(migration, /ALTER TABLE `(?!photo_sale_)/);
  assert.doesNotMatch(migration, /DROP /);
});

test("both routers are mounted, and the webhook path keeps its raw body", () => {
  assert.match(server, /app\.use\("\/api\/photo-selling", photoSellingRoutes\)/);
  assert.match(server, /app\.use\("\/api\/public\/photo-selling", photoSellingPublicRoutes\)/);
  assert.match(server, /\\\/photo-selling\\\/webhooks\\\/cashfree/);
  const fallback = server.indexOf('res.status(404).json({ message: "Not found" })');
  assert.ok(fallback > 0, "the 404 fallback is where it was");
  assert.ok(server.indexOf('app.use("/api/photo-selling"') < fallback && server.indexOf('app.use("/api/public/photo-selling"') < fallback, "mounted ahead of the 404 fallback");
});

test("the guest store is rate limited throughout, with tight buckets for PIN, checkout and selfie", () => {
  assert.match(publicRoutes, /router\.use\(limiter\("store"/);
  assert.match(publicRoutes, /"\/:code\/session", limiter\("session", 15, 40/);
  assert.match(publicRoutes, /"\/:code\/checkout", limiter\("checkout"/);
  assert.match(publicRoutes, /"\/:code\/selfie-search", limiter\("selfie", 60, 20/);
  assert.match(publicRoutes, /"\/webhooks\/cashfree", limiter\("webhook"/);
});

test("the store never hands out a clean preview, a storage key, a path or face data", () => {
  const service = read("src/modules/photo-selling/public/service.js");
  const storePhoto = service.slice(service.indexOf("function storePhoto"), service.indexOf("async function photosByIds"));
  assert.doesNotMatch(storePhoto, /previewKey|thumbnailKey|originalPath|relativePath|embedding|vector|fileName/);
  assert.match(storePhoto, /watermarks\.addressesFor/);
});

test("an original is reached only through a paid order's ticket, streamed - never a link, a presigned URL or a key", () => {
  const orders = read("src/modules/photo-selling/orders/service.js");
  const open = orders.slice(orders.indexOf("async function openDownload("), orders.indexOf("/* ------------------------------------------------------------------ staff */"));
  assert.match(open, /security\.readTicket\(ticket/);
  assert.match(open, /item\.order\.status !== "PAID"/);
  assert.match(open, /ticketHash: security\.hash\(payload\.jti\)/, "the ticket is claimed before a byte is read");
  assert.ok(open.indexOf("ticketHash") < open.indexOf("storage.getOriginal"), "claimed first, read second");
  // No module file presigns or links an original.
  const dir = path.join(__dirname, "../src/modules/photo-selling");
  const files = [];
  const walk = (folder) => { for (const entry of fs.readdirSync(folder, { withFileTypes: true })) { const full = path.join(folder, entry.name); if (entry.isDirectory()) walk(full); else if (entry.name.endsWith(".js")) files.push(full); } };
  walk(dir);
  for (const file of files) assert.doesNotMatch(fs.readFileSync(file, "utf8"), /getSignedUrl|s3-request-presigner/, path.relative(dir, file));
  const storage = read("src/modules/photo-selling/shared/storage.js");
  const putOriginal = storage.slice(storage.indexOf("async function putOriginal("), storage.indexOf("async function getOriginal("));
  assert.match(putOriginal, /Bucket: target/);
  assert.doesNotMatch(putOriginal, /Bucket: bucket\b/, "never the public bucket");
  // No response names the original's key: staff see hasOriginal, guests see watermarked addresses.
  const photos = read("src/modules/photo-selling/photos/service.js");
  const serialize = photos.slice(photos.indexOf("function serializePhoto("), photos.indexOf("async function loadEditable("));
  assert.doesNotMatch(serialize, /originalKey:/);
  assert.match(serialize, /hasOriginal: Boolean\(row\.originalKey\)/);
});

test("originals use the studio's existing bucket in their own folder; a separate bucket, when named, instead", () => {
  const config = require("../src/modules/photo-selling/shared/config");
  const saved = { ...process.env };
  try {
    Object.assign(process.env, { R2_ACCOUNT_ID: "a", R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s", R2_BUCKET_NAME: "public-bucket" });
    delete process.env.PHOTO_SELLING_ORIGINALS_BUCKET; delete process.env.R2_PRIVATE_BUCKET_NAME;
    assert.deepEqual(config.originalsStore(), { bucket: "public-bucket", ready: true, reason: null, shared: true }, "no second bucket is needed");
    process.env.R2_PRIVATE_BUCKET_NAME = "private-bucket";
    assert.deepEqual(config.originalsStore(), { bucket: "private-bucket", ready: true, reason: null, shared: false });
    process.env.PHOTO_SELLING_ORIGINALS_BUCKET = "studio-originals";
    assert.equal(config.originalsStore().bucket, "studio-originals");
    delete process.env.R2_ACCOUNT_ID;
    assert.equal(config.originalsStore().ready, false, "only an unconfigured R2 refuses uploads");
  } finally { process.env = saved; }
  // The original's key, in any bucket, is made on the server and never answered to anybody.
  const storage = read("src/modules/photo-selling/shared/storage.js");
  assert.match(storage, /const key = `\$\{galleryRoot\(galleryId\)\}\/originals\/\$\{randomUUID\(\)\}\/\$\{safeFileName\(fileName\)\}`;/);
  const controller = read("src/modules/photo-selling/controller.js");
  const upload = controller.slice(controller.indexOf("const uploadPhoto = "), controller.indexOf("const savePackages = "));
  assert.ok(upload.indexOf("config.originalsStore()") < upload.indexOf("photoUpload()(req"), "refused before a byte is read");
  assert.match(upload, /removeTemp\(req\)/, "temporary files are always removed");
});

test("the store has no route that lists a gallery's photos; cart and checkout take only the device's own matches", () => {
  assert.doesNotMatch(publicRoutes, /["'`]\/:code\/photos["'`]/, "there is no photo listing for a guest");
  assert.match(publicRoutes, /"\/:code\/selfie-search\/latest"[\s\S]*"\/:code\/selfie-search\/:searchId"/, "latest is declared before the id route");
  const service = read("src/modules/photo-selling/public/service.js");
  assert.doesNotMatch(service, /async function listPhotos\(/);
  for (const name of ["quote", "checkout"]) {
    const body = service.slice(service.indexOf(`async function ${name}(`), service.indexOf("}\n", service.indexOf(`async function ${name}(`)));
    assert.match(body, /await onlyMatched\(gallery, session, body\.items\)/, `${name} checks the device's matches, always`);
  }
  const only = service.slice(service.indexOf("async function onlyMatched("), service.indexOf("/** What a cart costs."));
  assert.doesNotMatch(only, /allowBrowse|return;/, "no gallery is exempt");
  assert.match(read("src/modules/photo-selling/orders/service.js"), /const FOR_SALE = \(gallery\) => \(\{ galleryId: gallery\.id, available: true, removedAt: null, originalKey: \{ not: null \} \}\);/);
});

test("the originals migration alters only Photo Selling's own tables and keeps the price it replaces", () => {
  const migration = read("prisma/migrations/20261026120000_photo_selling_originals/migration.sql");
  for (const [, table] of migration.matchAll(/(?:ALTER TABLE|UPDATE|ON) `([a-z_]+)`/g)) assert.match(table, /^photo_sale_/, table);
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM|TRUNCATE/);
  assert.ok(migration.indexOf("SET `digital_price_paise` = `original_price_paise`") < migration.indexOf("DROP COLUMN `original_price_paise`"), "the original price is carried over before its column goes");
  assert.match(migration, /CREATE UNIQUE INDEX `photo_sale_download_ticket_hash_key`/);
});

test("match strictness takes only its three levels, and a reindex only well-formed photo ids", () => {
  const v = require("../src/modules/photo-selling/shared/validation");
  assert.equal(v.updateGallery.safeParse({ matchStrictness: "BROADER" }).success, true);
  assert.equal(v.updateGallery.safeParse({ matchStrictness: "LOOSE" }).success, false);
  assert.equal(v.updateGallery.safeParse({ matchThreshold: 0.1 }).success, false, "the old free threshold is gone");
  assert.equal(v.reindexPhotos.safeParse({}).success, true);
  assert.equal(v.reindexPhotos.safeParse({ photoIds: ["cmphoto1"] }).success, true);
  assert.equal(v.reindexPhotos.safeParse({ photoIds: [] }).success, false);
  assert.equal(v.reindexPhotos.safeParse({ everything: true }).success, false);
});
