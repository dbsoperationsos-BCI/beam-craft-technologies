const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PERMISSIONS } = require("../prisma/seeds/permission-catalogue");
const { ALBUM_PERMISSION, SETTINGS_PERMISSION } = require("../src/modules/image-selection/signature-album/signatureAlbum.permissions");

/*
 * The Signature Album's one permission exists in the catalogue and in the migration alike, with the
 * same three names the seed upserts on, and the migration grants it to SUPER_ADMIN - the two rules
 * IAM.md step 10 gives for a permission that ships with code.
 */
const MIGRATION = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20260924100000_signature_album", "migration.sql"), "utf8");
const ROUTES = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "image-selection", "signature-album", "signatureAlbum.routes.js"), "utf8");
const PUBLIC_ROUTES = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "image-selection", "signature-album", "signatureAlbum.public.routes.js"), "utf8");

test("the catalogue and the migration describe the same permission", () => {
  const row = PERMISSIONS.find((permission) => permission.module === ALBUM_PERMISSION.module && permission.feature === ALBUM_PERMISSION.feature);
  assert.ok(row, "the catalogue has no Signature Album row");
  assert.equal(row.level, "ISSIGNATURE_ALBUM");
  assert.match(MIGRATION, /'IMAGE_SELECTION', 'Signature Album', 'ISSIGNATURE_ALBUM'/);
  assert.match(MIGRATION, /WHERE NOT EXISTS/);
  assert.match(MIGRATION, /`role`\.`name` = 'SUPER_ADMIN' AND `role_permission`\.`id` IS NULL/);
  assert.match(MIGRATION, /`permission`\.`level` = 'ISSIGNATURE_ALBUM'/);
});

test("the roles that run Image Selection projects are handed the tab at the level they hold", () => {
  const follow = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20260924110000_signature_album_grants_follow_project_management", "migration.sql"), "utf8");
  assert.match(follow, /`old`\.`level` = 'ISPROJECT_MANAGE'/);
  assert.match(follow, /`new`\.`level` = 'ISSIGNATURE_ALBUM'/);
  // The level travels with the grant: READ stays READ.
  assert.match(follow, /`grant`\.`access_level`/);
  assert.match(follow, /WHERE NOT EXISTS/);
});

test("what left the rail left the database, and the download is the server's permission and not only the page's control", () => {
  const cleanup = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20260926130000_signature_album_download_cleanup", "migration.sql"), "utf8");
  assert.match(cleanup, /DROP TABLE `signature_album_favourite`/);
  for (const column of ["download_mode", "allow_favourite", "allow_selection", "album_first_opened_at", "album_last_opened_at", "allow_favourite_default", "allow_selection_default"]) assert.match(cleanup, new RegExp(`DROP COLUMN \`${column}\``));
  const schema = fs.readFileSync(path.join(__dirname, "..", "prisma", "schema.prisma"), "utf8");
  assert.ok(!/SignatureAlbumFavourite|download_mode|allow_favourite|allow_selection|album_last_opened_at/.test(schema), "the schema still names something the migration dropped");
  // The PDF prints the album's previews and nothing else; starting and fetching it sit behind the limiter.
  const client = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "image-selection", "signature-album", "signatureAlbum.client.service.js"), "utf8");
  assert.ok(!/\.original\(/.test(client), "the client service reaches for an original");
  assert.match(PUBLIC_ROUTES, /downloadLimiter, c\.startDownload/);
  assert.match(PUBLIC_ROUTES, /statusLimiter, c\.downloadStatus/);
  assert.match(PUBLIC_ROUTES, /downloadLimiter, c\.downloadAlbum/);
});

test("the settings answer to the Settings panel's own permission", () => {
  assert.deepEqual(SETTINGS_PERMISSION, { module: "SETTINGS", feature: "Organization" });
  assert.ok(PERMISSIONS.some((permission) => permission.module === "SETTINGS" && permission.feature === "Organization"));
});

test("the studio router is guarded and the public router is not a studio router", () => {
  assert.match(ROUTES, /router\.use\(protect\)/);
  assert.match(ROUTES, /requireAlbumAccess\(\)/);
  assert.match(ROUTES, /requireSettingsAccess\(\)/);
  assert.ok(!/req\.user\.role/.test(fs.readFileSync(path.join(__dirname, "..", "src", "modules", "image-selection", "signature-album", "signatureAlbum.controller.js"), "utf8")), "a role check below the guard");
  assert.ok(!/protect|requireModule/.test(PUBLIC_ROUTES), "the client's routes must authenticate by album session, not by login");
});

test("every album table cascades from the project and every reference cascades from its photo", () => {
  for (const table of ["signature_album", "signature_album_chapter", "signature_album_item", "signature_album_settings"]) assert.match(MIGRATION, new RegExp(`CREATE TABLE \`${table}\``));
  assert.match(MIGRATION, /`signature_album_project_id_fkey`[^;]*ON DELETE CASCADE/);
  assert.match(MIGRATION, /`signature_album_item_image_id_fkey`[^;]*ON DELETE CASCADE/);
  assert.match(MIGRATION, /`signature_album_cover_image_id_fkey`[^;]*ON DELETE SET NULL/);
  assert.match(MIGRATION, /`signature_album_chapter_cover_image_id_fkey`[^;]*ON DELETE SET NULL/);
  // The module never writes a photo row.
  const repository = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "image-selection", "signature-album", "signatureAlbum.repository.js"), "utf8");
  assert.ok(!/imageSelectionUpload\.(update|delete|create|upsert)/.test(repository), "the album repository writes to image_selection_upload");
  assert.ok(!/imageSelectionProject\.(update|delete|create|upsert)/.test(repository), "the album repository writes to image_selection_project");
  assert.ok(!/imageSelectionGalleryPublication\.(update|delete|create|upsert)/.test(repository), "the album repository writes to the gallery publication");
  assert.ok(!/imageSelectionPhotoSelection/.test(repository), "the album repository touches Photo Selection rows");
});

test("PIN attempts are counted per caller as every public budget reads one, not per proxy", () => {
  // Behind nginx `req.ip` is the proxy's for everyone: counting by it let a stranger lock every client out.
  const controller = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "image-selection", "signature-album", "signatureAlbum.public.controller.js"), "utf8");
  assert.match(controller, /service\.verifyPin\(params\.token, body\.pin, clientIp\(req\)\)/);
  assert.ok(!/req\.ip[,)\s;]/.test(controller.replace(/^\s*\/\/.*$/gm, "")), "no address is read straight off the request");
});
