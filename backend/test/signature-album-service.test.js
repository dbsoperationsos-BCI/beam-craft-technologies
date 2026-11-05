const test = require("node:test");
const assert = require("node:assert/strict");
const { createFakeRepository, seedProject } = require("./signature-album-fake-repository");
const { createSignatureAlbumService } = require("../src/modules/image-selection/signature-album/signatureAlbum.service");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createSignatureAlbumPdfService } = require("../src/modules/image-selection/signature-album/signatureAlbum.pdf.service");
const { createSignatureAlbumClientService } = require("../src/modules/image-selection/signature-album/signatureAlbum.client.service");
const { createSignatureAlbumSettingsService } = require("../src/modules/image-selection/signature-album/signatureAlbum.settings.service");
const { createSignatureAlbumPublishService } = require("../src/modules/image-selection/signature-album/signatureAlbum.publish.service");
const share = require("../src/modules/image-selection/signature-album/signatureAlbum.share.service");
const { LIMITS } = require("../src/modules/image-selection/signature-album/signatureAlbum.constants");

process.env.JWT_SECRET = process.env.JWT_SECRET || "signature-album-test-secret";
process.env.FRONTEND_URL = "http://localhost:3000";

const studioSettings = { read: async () => ({ studioName: "Dont Blink Studioz", galleryLogoUrl: "https://cdn/logo.png", galleryLogoDarkUrl: "https://cdn/logo-dark.png" }) };
function build({ clock } = {}) {
  const repo = createFakeRepository();
  const projectId = seedProject(repo);
  const now = () => clock || new Date("2026-09-24T10:00:00Z");
  const albumSettings = createSignatureAlbumSettingsService(repo);
  const shareService = share.createSignatureAlbumShareService(repo, { studioSettings, activity: { track: (_context, send) => send() }, sessions: { sendMessageToGroup: async () => ({ waMessageId: "wa-1" }) }, chatSwitches: { isChatEnabled: async () => true, isChatEnabledForUser: async () => true } });
  const publishing = createSignatureAlbumPublishService(repo, { albumSettings, studioSettings, share: shareService, now });
  const gallery = { media: async () => ({ redirectUrl: "https://r2/x" }), uploadRoot: "/uploads" };
  // The bucket and the purge, recorded rather than called: what an upload or a delete sends is the assertion.
  const bucket = { put: [], deleted: [], isConfigured: () => true, missingConfig: () => [], putObject: async (key, body, type) => { bucket.put.push({ key, type }); }, deleteObjects: async (keys) => { bucket.deleted.push(...keys); return { deleted: keys.length, failed: [] }; }, publicUrl: (key) => `https://r2.test/${key}` };
  const purged = [];
  const cleanup = { purgeDerivatives: async (rows) => { purged.push(...rows.flatMap((row) => [row.thumbnailKey, row.previewKey])); return { deleted: rows.length * 2, failed: [] }; } };
  // Download Album's PDF, printed by a stand-in: the headless browser is not what these tests are about.
  const printed = [];
  const pdfs = createSignatureAlbumPdfService({ dir: path.join(os.tmpdir(), `signature-album-pdf-test-${process.pid}`), render: async (album, file) => { printed.push(album.id); await fs.promises.writeFile(file, "%PDF-1.7 test"); }, log: { error: () => {} } });
  const client = createSignatureAlbumClientService(repo, { albumSettings, studioSettings, publishing, now, gallery, r2: bucket, pdfs });
  const service = createSignatureAlbumService(repo, { albumSettings, studioSettings, share: shareService, publishing, now, clientView: client, r2: bucket, cleanup });
  return { repo, projectId, service, client, albumSettings, publishing, gallery, bucket, purged, printed, cleanup };
}
async function albumWithContent(ctx) {
  const album = await ctx.service.create(ctx.projectId, 7);
  const chapter = await ctx.service.createChapter(album.id, { name: "Wedding" });
  await ctx.service.addItems(album.id, { chapterId: chapter.id, source: "FOLDER", folderId: "folder-wedding", includeSubfolders: true });
  await ctx.service.update(album.id, { coverImageId: "img-1" });
  return { album: await ctx.service.getForProject(ctx.projectId), chapter };
}

test("the logo variant is the album's own, saved from the Design panel, and the client and the preview draw the same mark", async () => {
  const ctx = build();
  const { album } = await albumWithContent(ctx);
  assert.equal(album.design.logoVariant, "AUTO");
  assert.deepEqual(album.branding.logo, { tone: "LIGHT", url: "https://cdn/logo.png", ownMark: true }, "Editorial is a light ground");
  const cinematic = await ctx.service.updateDesign(album.id, { theme: "CINEMATIC", applyThemeDefaults: true });
  assert.deepEqual(cinematic.branding.logo, { tone: "DARK", url: "https://cdn/logo-dark.png", ownMark: true }, "a dark ground wants the dark-mode mark");
  const pinned = await ctx.service.updateDesign(album.id, { logoVariant: "LIGHT" });
  assert.equal(pinned.design.logoVariant, "LIGHT");
  assert.equal(ctx.repo.state.albums[0].logoVariant, "LIGHT");
  assert.deepEqual(pinned.branding.logo, { tone: "LIGHT", url: "https://cdn/logo.png", ownMark: true });
  const auto = await ctx.service.updateDesign(album.id, { logoVariant: "AUTO" });
  const published = await ctx.service.publish(auto.id, 7);
  assert.equal(published.storedStatus, "PUBLISHED");
  assert.equal(ctx.repo.state.albums[0].brandingSnapshot.galleryLogoDarkUrl, "https://cdn/logo-dark.png");
  const client = await ctx.client.content(published.link.shortCode);
  const preview = await ctx.service.previewContent(album.id);
  assert.deepEqual(client.logo, { tone: "DARK", url: "https://cdn/logo-dark.png", ownMark: true });
  assert.deepEqual(preview.logo, client.logo);
  assert.deepEqual((await ctx.client.meta(published.link.shortCode)).logo, client.logo);
});

test("a theme is a preset, never a lock: applied on request, kept aside on request, reset on request", async () => {
  const ctx = build();
  const album = await ctx.service.create(ctx.projectId, 7);
  // A new album holds its theme's five values as its own.
  assert.equal(album.design.customized, false);
  assert.equal(ctx.repo.state.albums[0].headingFont, "Bodoni Moda");
  // Cinematic, defaults applied: the five change; one manual accent afterwards is a customisation.
  const cinematic = await ctx.service.updateDesign(album.id, { theme: "CINEMATIC", applyThemeDefaults: true });
  assert.deepEqual([cinematic.design.backgroundColor, cinematic.design.accentColor, cinematic.design.headingFont, cinematic.design.bodyFont, cinematic.design.customized], ["#111111", "#c6a86a", "Cormorant Garamond", "Manrope", false]);
  const burgundy = await ctx.service.updateDesign(album.id, { accentColor: "#800020" });
  assert.deepEqual([burgundy.design.accentColor, burgundy.design.customized], ["#800020", true]);
  assert.equal((await ctx.service.getForProject(ctx.projectId)).design.accentColor, "#800020", "a manual choice survives a reload");
  // Keep My Custom Styling: the theme changes, the five stay.
  const kept = await ctx.service.updateDesign(album.id, { theme: "LUXURY" });
  assert.deepEqual([kept.design.theme, kept.design.accentColor, kept.design.headingFont, kept.design.mutedTextColor], ["LUXURY", "#800020", "Cormorant Garamond", "#b7aa96"]);
  // Reset to Theme Defaults: the five become Luxury's; nothing else on the album moves.
  const reset = await ctx.service.updateDesign(album.id, { applyThemeDefaults: true });
  assert.deepEqual([reset.design.accentColor, reset.design.headingFont, reset.design.customized, reset.design.layoutStyle], ["#c9a35d", "Prata", false, album.design.layoutStyle]);
  assert.ok(album.themePresets.VINTAGE.overlay);
});

test("a new album takes its defaults from the studio-wide settings and keeps them when the defaults change", async () => {
  const ctx = build();
  await ctx.albumSettings.save({ defaultTheme: "CINEMATIC", defaultCoverStyle: "SPLIT", allowDownloadDefault: false, defaultExpiryMonths: 3 }, 1);
  const album = await ctx.service.create(ctx.projectId, 7);
  assert.equal(album.design.theme, "CINEMATIC");
  assert.equal(album.design.coverStyle, "SPLIT");
  assert.deepEqual(album.permissions, { allowDownload: false, allowShare: true });
  assert.equal(new Date(album.expiresAt).toISOString(), "2026-12-24T10:00:00.000Z");
  assert.equal(album.status, "DRAFT");
  assert.equal(album.title, "Ajay");
  // The studio's album carries the branding the preview draws, the same the client will get.
  assert.equal(album.branding.studioName, "Dont Blink Studioz");
  assert.equal(album.branding.ending.message, "Thank you for letting us capture your story.");
  await ctx.albumSettings.save({ websiteUrl: "https://studio.example", instagramUrl: "https://instagram.com/studio", endingShowInstagram: false }, 1);
  const branded = await ctx.service.getForProject(ctx.projectId);
  assert.equal(branded.branding.ending.websiteUrl, "https://studio.example");
  assert.equal(branded.branding.ending.instagramUrl, null);
  await ctx.albumSettings.save({ defaultTheme: "MINIMAL" }, 1);
  assert.equal((await ctx.service.getForProject(ctx.projectId)).design.theme, "CINEMATIC");
  await assert.rejects(ctx.service.create(ctx.projectId, 7), /already has a Signature Album/);
});

test("photos are added as references: a folder with its subfolders, the client's picks, or a ticked list - never twice, never from another project", async () => {
  const ctx = build();
  const album = await ctx.service.create(ctx.projectId, 7);
  const wedding = await ctx.service.createChapter(album.id, { name: "Wedding" });
  const picks = await ctx.service.createChapter(album.id, { name: "Picks" });
  const fromFolder = await ctx.service.addItems(album.id, { chapterId: wedding.id, source: "FOLDER", folderId: "folder-wedding", includeSubfolders: true });
  assert.deepEqual([fromFolder.added, fromFolder.skipped], [3, 0]);
  const again = await ctx.service.addItems(album.id, { chapterId: wedding.id, source: "FOLDER", folderId: "folder-wedding", includeSubfolders: true });
  assert.deepEqual([again.added, again.skipped], [0, 3]);
  // img-2 is selected and already in the album; img-4 is selected and new.
  const selected = await ctx.service.addItems(album.id, { chapterId: picks.id, source: "SELECTED" });
  assert.deepEqual([selected.added, selected.skipped], [1, 1]);
  await assert.rejects(ctx.service.addItems(album.id, { chapterId: picks.id, source: "MANUAL", imageIds: ["img-5", "img-pending"] }), /not in this project/);
  await assert.rejects(ctx.service.addItems(album.id, { chapterId: picks.id, source: "MANUAL", imageIds: ["img-from-elsewhere"] }), /not in this project/);
  const manual = await ctx.service.addItems(album.id, { chapterId: picks.id, source: "MANUAL", imageIds: ["img-6", "img-5"] });
  assert.equal(manual.added, 2);
  const items = await ctx.service.listChapterItems(album.id, picks.id);
  assert.deepEqual(items.items.map((item) => item.imageId), ["img-4", "img-6", "img-5"]);
  assert.match(items.items[0].previewUrl, /^https?:\/\/|\/preview$/);
  // Nothing about the source photos changed.
  assert.equal(ctx.repo.state.images.length, 7);
  assert.equal(ctx.repo.state.images.find((image) => image.id === "img-2").selected, true);
  const summary = await ctx.service.getForProject(ctx.projectId);
  assert.equal(summary.counts.photoCount, 6);
  assert.deepEqual(summary.chapters.map((chapter) => chapter.photoCount), [3, 3]);
});

test("reordering, moving and highlighting change only the album's own rows, and the highlight cap holds", async () => {
  const ctx = build();
  const { album, chapter } = await albumWithContent(ctx);
  const items = (await ctx.service.listChapterItems(album.id, chapter.id)).items;
  await ctx.service.reorderItems(album.id, chapter.id, [items[2].id, items[0].id]);
  assert.deepEqual((await ctx.service.listChapterItems(album.id, chapter.id)).items.map((item) => item.imageId), ["img-3", "img-1", "img-2"]);
  await assert.rejects(ctx.service.reorderItems(album.id, chapter.id, ["item-nope"]), /not in this list/);
  const second = await ctx.service.createChapter(album.id, { name: "Portraits" });
  const moved = await ctx.service.updateItem(album.id, items[1].id, { chapterId: second.id });
  assert.equal(moved.chapterId, second.id);
  const starred = await ctx.service.updateItem(album.id, items[0].id, { isHighlight: true });
  assert.equal(starred.isHighlight, true);
  // Positioning is the item's own, saved as four values, and the photo row is never written.
  assert.deepEqual(starred.transform, { displayMode: "FILL", focalX: 50, focalY: 50, zoom: 1, adjusted: false });
  const placed = await ctx.service.updateItem(album.id, items[0].id, { displayMode: "FILL", focalX: 52, focalY: 38, zoom: 1.15 });
  assert.deepEqual(placed.transform, { displayMode: "FILL", focalX: 52, focalY: 38, zoom: 1.15, adjusted: true });
  assert.equal(ctx.repo.state.images.find((image) => image.id === placed.imageId).focalX, undefined);
  const reset = await ctx.service.updateItem(album.id, items[0].id, { displayMode: null, focalX: null, focalY: null, zoom: null });
  assert.equal(reset.transform.adjusted, false);
  // The cover has its own, and a new cover photo starts centred again.
  const coverPlaced = await ctx.service.update(album.id, { coverFocalX: 20, coverFocalY: 80, coverZoom: 1.3 });
  assert.deepEqual([coverPlaced.coverTransform.focalX, coverPlaced.coverTransform.focalY, coverPlaced.coverTransform.zoom], [20, 80, 1.3]);
  const recovered = await ctx.service.update(album.id, { coverImageId: "img-2" });
  assert.equal(recovered.coverTransform.adjusted, false);
  assert.equal((await ctx.service.listHighlights(album.id)).length, 1);
  // Chapters reorder the same way.
  await ctx.service.reorderChapters(album.id, [second.id, chapter.id]);
  assert.deepEqual((await ctx.service.getForProject(ctx.projectId)).chapters.map((row) => row.name), ["Portraits", "Wedding"]);
  // The cap.
  for (let index = 0; index < LIMITS.MAX_HIGHLIGHTS; index += 1) ctx.repo.state.items.push({ id: `hl-${index}`, albumId: album.id, chapterId: chapter.id, imageId: `extra-${index}`, sortOrder: 100 + index, isHighlight: true, highlightOrder: index, createdAt: new Date() });
  await assert.rejects(ctx.service.updateItem(album.id, items[2].id, { isHighlight: true }), /Up to 30 highlights/);
});

test("publishing is refused until the album is complete, then mints a link and a PIN once and keeps them", async () => {
  const ctx = build();
  const album = await ctx.service.create(ctx.projectId, 7);
  // A new album asks for no PIN; the studio turns it on under Permissions.
  assert.equal(album.link.requiresPin, false);
  await ctx.service.updateAccess(album.id, { requirePin: true });
  await assert.rejects(ctx.service.publish(album.id, 7), (error) => { assert.equal(error.status, 409); assert.match(error.message, /select a cover image/); assert.deepEqual(error.details.problems.map((problem) => problem.code), ["COVER", "PHOTOS"]); return true; });
  const chapter = await ctx.service.createChapter(album.id, { name: "Wedding" });
  await ctx.service.addItems(album.id, { chapterId: chapter.id, source: "FOLDER", folderId: "folder-wedding", includeSubfolders: true });
  await ctx.service.update(album.id, { coverImageId: "img-1" });
  const ready = await ctx.service.getForProject(ctx.projectId);
  assert.equal(ready.status, "READY");
  const published = await ctx.service.publish(ready.id, 7);
  assert.equal(published.status, "PUBLISHED");
  assert.match(published.link.shortCode, /^[A-Z2-9]{6}$/);
  assert.match(published.link.pin, /^\d{4}$/);
  assert.equal(published.link.clientUrl, `http://localhost:3000/a/${published.link.shortCode}`);
  assert.equal(published.publishedAt.toISOString(), "2026-09-24T10:00:00.000Z");
  // Unpublish keeps the link; republish reuses it.
  const down = await ctx.service.unpublish(ready.id);
  assert.equal(down.status, "READY");
  assert.equal(down.link.shortCode, published.link.shortCode);
  const up = await ctx.service.publish(ready.id, 7);
  assert.equal(up.link.shortCode, published.link.shortCode);
  assert.equal(up.link.pin, published.link.pin);
  // Regenerate changes the code; reset changes the PIN; each leaves the other alone.
  const relinked = await ctx.service.regenerateLink(ready.id);
  assert.notEqual(relinked.link.shortCode, published.link.shortCode);
  assert.equal(relinked.link.pin, published.link.pin);
  const repinned = await ctx.service.resetPin(ready.id);
  assert.equal(repinned.link.shortCode, relinked.link.shortCode);
  // The PIN hash is never handed out, and the stored row never holds the PIN in clear.
  const row = ctx.repo.state.albums[0];
  assert.match(row.pinHash, /^\$2/);
  assert.ok(!JSON.stringify(row).includes(repinned.link.pin) || row.pinCipher.includes(repinned.link.pin) === false);
  // A published album's project row is untouched: status, selection.
  assert.equal(ctx.repo.state.projects[0].allowPhotoSelection, true);
});

test("an expired album is taken down when the studio switch says so, and never shown to a client either way", async () => {
  const clock = new Date("2026-09-24T10:00:00Z");
  const ctx = build({ clock });
  const { album } = await albumWithContent(ctx);
  await ctx.service.updateAccess(album.id, { expiresAt: "2026-10-01" });
  const published = await ctx.service.publish(album.id, 7);
  const code = published.link.shortCode;
  assert.equal((await ctx.client.meta(code)).title, "Ajay");
  clock.setMonth(clock.getMonth() + 2);
  await assert.rejects(ctx.client.meta(code), (error) => error.status === 410);
  assert.equal(ctx.repo.state.albums[0].status, "EXPIRED");
  assert.equal((await ctx.service.getForProject(ctx.projectId)).status, "EXPIRED");
  // Moving the date forward brings it back to READY, not to PUBLISHED.
  const revived = await ctx.service.updateAccess(album.id, { expiresAt: "2027-06-01" });
  assert.equal(revived.status, "READY");
  await assert.rejects(ctx.client.meta(code), (error) => error.status === 404);
  // With the switch off the row stays PUBLISHED but the client is still refused.
  const ctx2 = build({ clock: new Date("2026-09-24T10:00:00Z") });
  await ctx2.albumSettings.save({ autoUnpublishAfterExpiry: false }, 1);
  const { album: album2 } = await albumWithContent(ctx2);
  const published2 = await ctx2.service.publish(album2.id, 7);
  ctx2.repo.state.albums[0].expiresAt = new Date("2026-01-01");
  await assert.rejects(ctx2.client.meta(published2.link.shortCode), (error) => error.status === 410);
  assert.equal(ctx2.repo.state.albums[0].status, "PUBLISHED");
  assert.equal((await ctx2.service.getForProject(ctx2.projectId)).status, "EXPIRED");
});

test("the client API: nothing before publish, a session after the PIN, the first batch per chapter, then pages", async () => {
  const ctx = build();
  const { album, chapter } = await albumWithContent(ctx);
  const haldi = await ctx.service.createChapter(album.id, { name: "Haldi" });
  await ctx.service.addItems(album.id, { chapterId: haldi.id, source: "FOLDER", folderId: "folder-haldi" });
  // An empty chapter is the studio's to see; the client never gets an empty heading.
  await ctx.service.createChapter(album.id, { name: "Not yet filled" });
  await ctx.service.updateItem(album.id, (await ctx.service.listChapterItems(album.id, chapter.id)).items[0].id, { isHighlight: true });
  await ctx.albumSettings.save({ initialPhotosLoaded: 10, lazyLoadBatch: 10, footerText: "Made by {studioName}" }, 1);
  // Draft: unknown to the client.
  await assert.rejects(ctx.client.meta("ABCDEF"), (error) => error.status === 404);
  await ctx.service.updateAccess(album.id, { requirePin: true });
  const published = await ctx.service.publish(album.id, 7);
  const code = published.link.shortCode;
  const meta = await ctx.client.meta(code);
  assert.equal(meta.requiresPin, true);
  assert.equal(meta.pinLength, 4);
  assert.equal(meta.cover.imageId, "img-1");
  assert.equal(meta.studioName, "Dont Blink Studioz");
  assert.ok(!("chapters" in meta));
  await assert.rejects(ctx.client.verifyPin(code, "9999", "1.1.1.1"), (error) => error.status === 401);
  const { sessionToken } = await ctx.client.verifyPin(code, published.link.pin, "1.1.1.1");
  assert.ok(await ctx.client.requireSession(code, `Bearer ${sessionToken}`));
  await assert.rejects(ctx.client.requireSession("OTHER1", `Bearer ${sessionToken}`), /Invalid album session/);
  const content = await ctx.client.content(code);
  assert.equal(content.counts.photoCount, 6);
  assert.deepEqual(content.chapters.map((row) => [row.name, row.photoCount, row.items.length, row.numberOffset]), [["Wedding", 3, 3, 0], ["Haldi", 3, 3, 3]]);
  assert.equal(content.counts.chapterCount, 2);
  assert.equal(content.highlights.length, 1);
  assert.equal(content.footerText, "Made by Dont Blink Studioz");
  assert.equal(content.ending.message, "Thank you for letting us capture your story.");
  assert.equal(content.ending.showLogo, true);
  assert.equal(meta.showLogo, true);
  assert.deepEqual(content.permissions, { allowDownload: true, allowShare: true });
  assert.equal(content.chapters[1].items[0].number, 4);
  // Paging with a small batch.
  const page = await ctx.client.chapterItems(code, haldi.id, { offset: 2, limit: 2 });
  assert.deepEqual([page.offset, page.total, page.hasMore, page.items.length], [2, 3, false, 1]);
  assert.equal(page.items[0].number, 6);
  // Download Album is refused as a whole while the switch is off; on, the session starts one PDF,
  // asks until it is ready, and is then given a ticket that fetches that one file.
  await ctx.service.updateAccess(album.id, { allowDownload: false });
  assert.equal((await ctx.client.content(code)).permissions.allowDownload, false);
  await assert.rejects(ctx.client.startDownload(code), (error) => error.status === 403);
  await assert.rejects(ctx.client.downloadStatus(code), (error) => error.status === 403);
  await ctx.service.updateAccess(album.id, { allowDownload: true });
  assert.equal((await ctx.client.startDownload(code)).status, "preparing");
  assert.equal((await ctx.client.startDownload(code)).status, "preparing", "asked twice, it is printed once");
  let ready;
  for (let tries = 0; tries < 50 && ready?.status !== "ready"; tries += 1) { ready = await ctx.client.downloadStatus(code); if (ready.status !== "ready") await new Promise((resolve) => { setTimeout(resolve, 5); }); }
  assert.equal(ready.status, "ready");
  assert.equal(ctx.printed.length, 1);
  assert.match(ready.fileName, /-signature-album\.pdf$/);
  const download = await ctx.client.downloadAlbum(code, ready.ticket);
  assert.equal(download.fileName, ready.fileName);
  const bytes = await new Promise((resolve, reject) => { const parts = []; download.stream.on("data", (part) => parts.push(part)).on("end", () => resolve(Buffer.concat(parts).toString())).on("error", reject); });
  assert.equal(bytes, "%PDF-1.7 test");
  await assert.rejects(ctx.client.downloadAlbum(code, "a.b.c"), (error) => error.status === 401);
  assert.equal(ctx.repo.state.images.find((image) => image.id === "img-1").selected, false, "nothing the client does in the album becomes a Photo Selection pick");
  // Unpublished: gone.
  await ctx.service.unpublish(album.id);
  await assert.rejects(ctx.client.content(code), (error) => error.status === 404);
});

test("a chapter or photo write moves the album's updatedAt, which is what the workspace header shows", async () => {
  const ctx = build();
  const album = await ctx.service.create(ctx.projectId, 7);
  const row = ctx.repo.state.albums[0];
  row.updatedAt = new Date("2026-01-01T00:00:00Z");
  const chapter = await ctx.service.createChapter(album.id, { name: "Wedding" });
  assert.ok(row.updatedAt > new Date("2026-01-01T00:00:00Z"), "adding a chapter is an album write");
  row.updatedAt = new Date("2026-01-01T00:00:00Z");
  await ctx.service.addItems(album.id, { chapterId: chapter.id, source: "MANUAL", imageIds: ["img-1"] });
  assert.ok(row.updatedAt > new Date("2026-01-01T00:00:00Z"), "adding photos is an album write");
  row.updatedAt = new Date("2026-01-01T00:00:00Z");
  await ctx.service.addItems(album.id, { chapterId: chapter.id, source: "MANUAL", imageIds: ["img-1"] });
  assert.equal(row.updatedAt.getTime(), new Date("2026-01-01T00:00:00Z").getTime(), "adding a photo already there changes nothing");
  const items = (await ctx.service.listChapterItems(album.id, chapter.id)).items;
  await ctx.service.updateItem(album.id, items[0].id, { isHighlight: true });
  assert.ok(row.updatedAt > new Date("2026-01-01T00:00:00Z"), "starring a photo is an album write");
  assert.equal((await ctx.service.getForProject(ctx.projectId)).updatedAt, row.updatedAt, "the header reads the same timestamp");
});

test("the studio's preview is the client's content: same chapters, numbers, cover placement and ending, before and after publish", async () => {
  const ctx = build();
  const { album, chapter } = await albumWithContent(ctx);
  await ctx.service.createChapter(album.id, { name: "Empty" });
  await ctx.service.update(album.id, { coverFocalX: 30, coverFocalY: 70, coverZoom: 1.2 });
  const items = (await ctx.service.listChapterItems(album.id, chapter.id)).items;
  await ctx.service.updateItem(album.id, items[1].id, { focalY: 10, zoom: 1.1 });
  // A draft previews - the client would be refused, the studio is not.
  const draft = await ctx.service.previewContent(album.id);
  assert.deepEqual(draft.chapters.map((row) => [row.name, row.photoCount, row.numberOffset]), [["Wedding", 3, 0]]);
  assert.deepEqual([draft.coverTransform.focalX, draft.coverTransform.focalY, draft.coverTransform.zoom], [30, 70, 1.2]);
  assert.equal(draft.chapters[0].items[1].transform.focalY, 10);
  const published = await ctx.service.publish(album.id, 7);
  const client = await ctx.client.content(published.link.shortCode);
  const preview = await ctx.service.previewContent(album.id);
  // The same content, differing only in where the photo URLs point.
  const strip = (content) => JSON.parse(JSON.stringify(content, (key, value) => (/Url$/.test(key) && typeof value === "string" ? "<url>" : value)));
  assert.deepEqual(strip(preview), strip(client));
  assert.match(preview.chapters[0].items[0].previewUrl, /^https?:\/\/|\/api\/image-selection\/signature-albums\/media\//);
  const page = await ctx.service.previewChapterItems(album.id, chapter.id, { offset: 2, limit: 2 });
  const clientPage = await ctx.client.chapterItems(published.link.shortCode, chapter.id, { offset: 2, limit: 2 });
  assert.deepEqual(strip(page), strip(clientPage));
});

test("a source photo deleted through Image Selection leaves the album cleanly; deleting the album touches no photo", async () => {
  const ctx = build();
  const { album, chapter } = await albumWithContent(ctx);
  await ctx.service.updateChapter(album.id, chapter.id, { coverImageId: "img-2" });
  ctx.repo.deletePhoto("img-1");
  const after = await ctx.service.getForProject(ctx.projectId);
  assert.equal(after.coverImageId, null);
  assert.equal(after.counts.photoCount, 2);
  assert.equal(after.status, "DRAFT");
  assert.deepEqual(after.problems.map((problem) => problem.code), ["COVER"]);
  ctx.repo.deletePhoto("img-2");
  assert.equal((await ctx.service.getForProject(ctx.projectId)).chapters[0].coverImageId, null);
  const photosBefore = ctx.repo.state.images.length;
  await ctx.service.remove(album.id);
  assert.equal(ctx.repo.state.images.length, photosBefore);
  assert.equal(ctx.repo.state.albums.length, 0);
  assert.equal(ctx.repo.state.items.length, 0);
  assert.equal(ctx.repo.state.chapters.length, 0);
  assert.equal(await ctx.service.getForProject(ctx.projectId), null);
});

test("the picker reads the project's folders with READY counts and marks what the album already holds", async () => {
  const ctx = build();
  const { album } = await albumWithContent(ctx);
  const folders = await ctx.service.sourceFolders(ctx.projectId);
  assert.deepEqual(folders.folders.map((folder) => [folder.name, folder.photoCount, folder.totalPhotoCount]), [["Wedding", 0, 3], ["Haldi", 3, 3]]);
  assert.equal(folders.selectedCount, 2);
  const page = await ctx.service.sourceImages(ctx.projectId, album.id, { folderId: "folder-wedding-cam1", selectedOnly: false, search: "", page: 1, pageSize: 2 });
  assert.deepEqual(page.items.map((image) => [image.imageId, image.inAlbum]), [["img-1", true], ["img-2", true]]);
  assert.equal(page.pagination.totalPages, 2);
  const picks = await ctx.service.sourceImages(ctx.projectId, album.id, { selectedOnly: true, search: "", page: 1, pageSize: 60 });
  assert.deepEqual(picks.items.map((image) => image.imageId), ["img-2", "img-4"]);
});

test("Review & Share carries the link, the PIN, the message and a QR of the link alone; the group send needs a linked group", async () => {
  const ctx = build();
  const { album } = await albumWithContent(ctx);
  const published = await ctx.service.publish(album.id, 7);
  const details = await ctx.service.shareDetails(album.id);
  assert.equal(details.clientUrl, published.link.clientUrl);
  assert.equal(details.pin, published.link.pin);
  assert.match(details.qrDataUrl, /^data:image\/png;base64,/);
  assert.match(details.message, new RegExp(published.link.shortCode));
  assert.equal(details.whatsappShareUrl, "https://wa.me/919876543210");
  await assert.rejects(ctx.service.sendToGroup(album.id, 7), /not linked to a WhatsApp group/);
  ctx.repo.state.projects[0].whatsappGroupJid = "123@g.us";
  ctx.repo.state.projects[0].whatsappGroupSubject = "Ajay & Priya";
  assert.deepEqual(await ctx.service.sendToGroup(album.id, 7), { sent: true, providerMessageId: "wa-1", groupSubject: "Ajay & Priya" });
});

test("PIN attempts are rate limited per link and per address", async () => {
  share._resetPinAttempts();
  for (let index = 0; index < share.PIN_MAX_PER_LINK; index += 1) share.registerPinAttempt("ABCDEF", "9.9.9.9");
  assert.throws(() => share.registerPinAttempt("ABCDEF", "9.9.9.9"), /Too many attempts/);
  share.registerPinAttempt("ABCDEF", "8.8.8.8");
  share._resetPinAttempts();
});

test("a chapter's cover is positioned like the album's: saved with the chapter, defaulted for an old chapter, cleared when the cover changes, apart from the layout", async () => {
  const ctx = build();
  const album = await ctx.service.create(ctx.projectId, 7);
  // An existing chapter, made before positioning existed: the default placement, never adjusted.
  const old = await ctx.service.createChapter(album.id, { name: "Haldi", coverImageId: "img-1" });
  assert.deepEqual(old.coverTransform, { displayMode: "FILL", focalX: 50, focalY: 50, zoom: 1, adjusted: false });
  // Adjusted and saved with the chapter, in one request with its other fields.
  const adjusted = await ctx.service.updateChapter(album.id, old.id, { name: "Haldi", subtitle: "Turmeric", layoutStyle: "GRID", coverDisplayMode: "FILL", coverFocalX: 30, coverFocalY: 10, coverZoom: 1.4 });
  assert.deepEqual(adjusted.coverTransform, { displayMode: "FILL", focalX: 30, focalY: 10, zoom: 1.4, adjusted: true });
  assert.equal(adjusted.layoutStyle, "GRID");
  // Reread: it is stored, not remembered.
  const reread = (await ctx.service.getForProject(ctx.projectId)).chapters.find((row) => row.id === old.id);
  assert.deepEqual(reread.coverTransform, adjusted.coverTransform);
  // The layout changing on its own leaves the placement alone.
  const relaid = await ctx.service.updateChapter(album.id, old.id, { layoutStyle: "MASONRY" });
  assert.deepEqual(relaid.coverTransform, adjusted.coverTransform, "the layout and the cover's placement are separate things");
  // A new cover photo starts from the default; the old crop is not applied to it.
  const replaced = await ctx.service.updateChapter(album.id, old.id, { coverImageId: "img-2" });
  assert.deepEqual(replaced.coverTransform, { displayMode: "FILL", focalX: 50, focalY: 50, zoom: 1, adjusted: false });
  // Picked and adjusted in one save: the new cover with its own placement.
  const both = await ctx.service.updateChapter(album.id, old.id, { coverImageId: "img-3", coverDisplayMode: "FIT", coverFocalX: 60, coverFocalY: 40, coverZoom: 1 });
  assert.deepEqual(both.coverTransform, { displayMode: "FIT", focalX: 60, focalY: 40, zoom: 1, adjusted: true });
  // A chapter created with a cover and a placement carries both from the start.
  const fresh = await ctx.service.createChapter(album.id, { name: "Sangeet", coverImageId: "img-1", coverFocalX: 80, coverFocalY: 20 });
  assert.deepEqual(fresh.coverTransform, { displayMode: "FILL", focalX: 80, focalY: 20, zoom: 1, adjusted: true });
  // Removing the cover removes the placement with it.
  const bare = await ctx.service.updateChapter(album.id, old.id, { coverImageId: null });
  assert.equal(bare.cover, null);
  assert.equal(bare.coverTransform.adjusted, false);
});

test("the client page and the studio's preview draw the chapter cover under the same placement the editor saved", async () => {
  const ctx = build();
  const { album, chapter } = await albumWithContent(ctx);
  await ctx.service.updateChapter(album.id, chapter.id, { coverImageId: "img-2", coverFocalX: 15, coverFocalY: 85, coverZoom: 1.25 });
  const preview = await ctx.service.previewContent(album.id);
  assert.deepEqual(preview.chapters[0].coverTransform, { displayMode: "FILL", focalX: 15, focalY: 85, zoom: 1.25, adjusted: true });
});

/*
 * Photos uploaded to the album itself: the album's own library, never a project photo. Only the two
 * derivatives the browser built are stored, under the album's R2 prefix; the studio places them into
 * chapters by hand; deleting one takes its files and its placements; nothing reaches the project.
 */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);
const upload = (ctx, albumId, fileName = "DSC_0001.JPG", files = {}) => ctx.service.uploadPhoto(albumId, { fileName, mimeType: "image/jpeg", sizeBytes: 5242880, width: 6000, height: 4000, ...(files.sourceUploadId ? { sourceUploadId: files.sourceUploadId } : {}) }, files.thumbnail || { buffer: WEBP, size: WEBP.length }, files.preview || { buffer: JPEG, size: JPEG.length });

test("an upload is the album's own - two derivatives under the album prefix, never a project photo - and is in the album at once", async () => {
  const ctx = build();
  const album = await ctx.service.create(ctx.projectId, 7);
  const photosBefore = ctx.repo.state.images.length;
  const photo = await upload(ctx, album.id);
  assert.deepEqual(ctx.bucket.put.map((put) => put.type), ["image/webp", "image/jpeg"]);
  assert.ok(ctx.bucket.put.every((put) => put.key.startsWith("image-selection/signature-album/")), "never under the photo-selection prefix");
  // Served from its own two objects - asked of the row, not of the URL: the URL is the R2 address
  // only where R2_PUBLIC_BASE_URL is set, and the album's API route everywhere else (CI).
  const stored = ctx.repo.state.albumPhotos.find((row) => row.id === photo.photoId);
  assert.deepEqual([stored.thumbnailKey, stored.previewKey], ctx.bucket.put.map((put) => put.key), "served from its own R2 objects");
  assert.equal(ctx.repo.state.images.length, photosBefore, "no project photo was created");
  // No chapter step: the album's first upload makes the chapter the client page draws it in.
  assert.deepEqual(ctx.repo.state.chapters.map((chapter) => chapter.name), ["Album"]);
  assert.equal(photo.inAlbum, true);
  const items = (await ctx.service.listChapterItems(album.id, ctx.repo.state.chapters[0].id, { page: 1, pageSize: 200 })).items;
  assert.deepEqual(items.map((item) => [item.fileName, item.uploaded]), [["DSC_0001.JPG", true]]);
});

test("uploads arriving together make one chapter, and an album with chapters of its own keeps them", async () => {
  const ctx = build();
  const album = await ctx.service.create(ctx.projectId, 7);
  await Promise.all(["a.jpg", "b.jpg", "c.jpg"].map((name) => upload(ctx, album.id, name)));
  assert.equal(ctx.repo.state.chapters.length, 1, "one Gallery, not three");
  const older = build();
  const { album: built, chapter } = await albumWithContent(older);
  await upload(older, built.id, "late.jpg");
  assert.deepEqual(older.repo.state.chapters.map((row) => row.id), [chapter.id], "no chapter added to an album that has one");
  const items = (await older.service.listChapterItems(built.id, chapter.id, { page: 1, pageSize: 200 })).items;
  assert.equal(items.at(-1).fileName, "late.jpg", "after what was already there");
});

test("the Gallery lists uploads newest first and searches them", async () => {
  const ctx = build();
  const album = await ctx.service.create(ctx.projectId, 7);
  for (const name of ["one.jpg", "two.jpg", "three.jpg"]) await upload(ctx, album.id, name);
  const all = await ctx.service.listPhotos(album.id, { page: 1, pageSize: 60, search: "", order: "desc" });
  assert.deepEqual(all.items.map((photo) => photo.fileName), ["three.jpg", "two.jpg", "one.jpg"]);
  assert.deepEqual((await ctx.service.listPhotos(album.id, { page: 1, pageSize: 60, search: "tw", order: "desc" })).items.map((photo) => photo.fileName), ["two.jpg"]);
});

test("an upload whose bytes are not what the browser said is refused before anything is stored", async () => {
  const ctx = build();
  const album = await ctx.service.create(ctx.projectId, 7);
  await assert.rejects(upload(ctx, album.id, "x.jpg", { preview: { buffer: Buffer.from("<html>"), size: 6 } }), /could not be read as a photo/);
  assert.equal(ctx.bucket.put.length, 0);
  assert.equal(ctx.repo.state.albumPhotos.length, 0);
});

test("a row that cannot be written takes its two files back with it", async () => {
  const ctx = build();
  const album = await ctx.service.create(ctx.projectId, 7);
  ctx.repo.createAlbumPhoto = async () => { throw new Error("db down"); };
  await assert.rejects(upload(ctx, album.id), /db down/);
  assert.deepEqual(ctx.bucket.deleted, ctx.bucket.put.map((put) => put.key));
});

test("a preview that cannot be stored takes the thumbnail already stored back with it", async () => {
  const ctx = build();
  const album = await ctx.service.create(ctx.projectId, 7);
  const put = ctx.bucket.putObject;
  ctx.bucket.putObject = async (key, body, type) => { if (type === "image/jpeg") throw new Error("R2 503"); return put(key, body, type); };
  await assert.rejects(upload(ctx, album.id), /R2 503/);
  assert.deepEqual(ctx.bucket.deleted, [ctx.bucket.put[0].key], "only what was written");
  assert.equal(ctx.repo.state.albumPhotos.length, 0);
});

test("deleting an upload removes its files first and takes it out of the album; deleting the album removes all of them", async () => {
  const ctx = build();
  const album = await ctx.service.create(ctx.projectId, 7);
  const kept = await upload(ctx, album.id, "kept.jpg");
  const gone = await upload(ctx, album.id, "gone.jpg");
  await ctx.service.update(album.id, { coverImageId: "img-1" });
  const goneRow = ctx.repo.state.albumPhotos.find((photo) => photo.id === gone.photoId);
  await ctx.service.deletePhoto(album.id, gone.photoId);
  assert.deepEqual(ctx.purged, [goneRow.thumbnailKey, goneRow.previewKey]);
  assert.equal(ctx.repo.state.items.filter((item) => item.albumPhotoId === gone.photoId).length, 0, "out of the album");
  assert.equal(ctx.repo.state.items.filter((item) => item.albumPhotoId === kept.photoId).length, 1);
  assert.equal(ctx.repo.state.albums[0].coverImageId, "img-1", "the cover is a project photo and is untouched");
  await assert.rejects(ctx.service.deletePhoto(album.id, gone.photoId), /not in this album/);
  const imagesBefore = ctx.repo.state.images.length;
  await ctx.service.remove(album.id);
  const keptRow = { thumbnailKey: ctx.bucket.put[0].key, previewKey: ctx.bucket.put[1].key };
  assert.ok(ctx.purged.includes(keptRow.thumbnailKey) && ctx.purged.includes(keptRow.previewKey), "the album's remaining uploads went with it");
  assert.equal(ctx.repo.state.albumPhotos.length, 0);
  assert.equal(ctx.repo.state.images.length, imagesBefore, "the project's own photos are not the album's to delete");
});

test("Select All lists every photo the search matches, loaded or not, and bulk delete takes only those - files first, cover and placements with them", async () => {
  const ctx = build();
  const album = await ctx.service.create(ctx.projectId, 7);
  const photos = [];
  for (const name of ["haldi-1.jpg", "haldi-2.jpg", "wedding-1.jpg", "wedding-2.jpg", "wedding-3.jpg"]) photos.push(await upload(ctx, album.id, name));
  // Every match, not one page of them.
  assert.equal((await ctx.service.listPhotoIds(album.id)).total, 5);
  const weddings = await ctx.service.listPhotoIds(album.id, { search: "wedding" });
  assert.deepEqual(new Set(weddings.photoIds), new Set(photos.slice(2).map((photo) => photo.photoId)));
  // The cover is one of them: deleting it leaves the album needing a cover, as deleting it alone does.
  await ctx.service.update(album.id, { coverAlbumPhotoId: photos[2].photoId });
  const keys = ctx.repo.state.albumPhotos.filter((row) => weddings.photoIds.includes(row.id)).flatMap((row) => [row.thumbnailKey, row.previewKey]);
  const result = await ctx.service.deletePhotos(album.id, [...weddings.photoIds, weddings.photoIds[0]]);
  assert.equal(result.deleted, 3, "a repeated id counts once");
  assert.deepEqual(new Set(ctx.purged), new Set(keys), "every file of every photo, and nothing else");
  assert.deepEqual(ctx.repo.state.albumPhotos.map((row) => row.fileName).sort(), ["haldi-1.jpg", "haldi-2.jpg"]);
  assert.equal(ctx.repo.state.items.filter((item) => weddings.photoIds.includes(item.albumPhotoId)).length, 0, "out of the album");
  assert.equal(ctx.repo.state.items.filter((item) => item.albumPhotoId).length, 2, "the rest stay placed");
  assert.equal((await ctx.service.getForProject(ctx.projectId)).coverPhotoId, null);
});

test("bulk delete is all or nothing: another album's photo, or a cloud failure, deletes no row", async () => {
  const ctx = build();
  const album = await ctx.service.create(ctx.projectId, 7);
  const mine = await upload(ctx, album.id, "mine.jpg");
  const other = seedProject(ctx.repo, { projectId: "project-2" });
  const otherAlbum = await ctx.service.create(other, 7);
  const theirs = await upload(ctx, otherAlbum.id, "theirs.jpg");
  await assert.rejects(ctx.service.deletePhotos(album.id, [mine.photoId, theirs.photoId]), /1 of those photos is not in this album\. Nothing was deleted/);
  assert.equal(ctx.repo.state.albumPhotos.length, 2, "neither was touched");
  assert.deepEqual(ctx.purged, [], "no file was touched either");
  ctx.cleanup.purgeDerivatives = async () => { throw Object.assign(new Error("Cloud cleanup failed for 1 file(s). Nothing was deleted — please try again."), { status: 502 }); };
  await assert.rejects(ctx.service.deletePhotos(album.id, [mine.photoId]), /Cloud cleanup failed/);
  assert.equal(ctx.repo.state.albumPhotos.length, 2, "the row stays when its files could not go");
});

test("the client's media route serves an upload in the album from R2, and nothing it has not been shown", async () => {
  const ctx = build();
  const { album } = await albumWithContent(ctx);
  const shown = await upload(ctx, album.id, "shown.jpg");
  const hidden = await upload(ctx, album.id, "hidden.jpg");
  // An upload from before uploads were placed automatically: in the library, not in the album.
  ctx.repo.state.items = ctx.repo.state.items.filter((item) => item.albumPhotoId !== hidden.photoId);
  const code = (await ctx.service.publish(album.id, 7)).link.shortCode;
  const session = `Bearer ${(await ctx.client.verifyPin(code, "", "1.1.1.1")).sessionToken}`;
  const found = await ctx.client.media(code, shown.photoId, "preview", session);
  assert.match(found.redirectUrl, /^https:\/\/r2\.test\/image-selection\/signature-album\/.+\.jpg$/);
  await assert.rejects(ctx.client.media(code, hidden.photoId, "preview", session), /not in this album/, "not the client's to see");
  // The studio's route, which takes a project id: an upload of this project's album, from R2.
  assert.match((await ctx.service.photoMedia(ctx.projectId, hidden.photoId, "thumbnail")).redirectUrl, /\.webp$/);
  await assert.rejects(ctx.service.photoMedia("another-project", hidden.photoId, "thumbnail"), /Image not found/);
});

/*
 * The cover is chosen from the album's own uploads. A cover chosen before from the project's photos
 * keeps drawing until another is chosen; the new one replaces it, starts centred, and is what the
 * client page, the PIN screen and the publish check read.
 */
test("the cover is one of the album's uploads, replacing a project-photo cover, and only this album's", async () => {
  const ctx = build();
  const { album } = await albumWithContent(ctx); // a legacy project-photo cover, img-1
  assert.equal((await ctx.service.getForProject(ctx.projectId)).coverImageId, "img-1", "the legacy cover is kept");
  await ctx.service.update(album.id, { coverFocalX: 20, coverFocalY: 80 });
  const photo = await upload(ctx, album.id, "cover.jpg");
  const saved = await ctx.service.update(album.id, { coverAlbumPhotoId: photo.photoId });
  assert.equal(saved.coverPhotoId, photo.photoId);
  assert.equal(saved.coverImageId, null, "one cover at a time");
  assert.equal(saved.cover.fileName, "cover.jpg");
  assert.equal(saved.coverTransform.adjusted, false, "a new cover starts centred");
  // Positioned like any cover, through the same four values.
  const placed = await ctx.service.update(album.id, { coverFocalX: 30, coverFocalY: 10 });
  assert.deepEqual([placed.coverTransform.focalX, placed.coverTransform.focalY], [30, 10]);
  await assert.rejects(ctx.service.update(album.id, { coverAlbumPhotoId: "someone-elses" }), /not in this album/);
  // Published with it, the client's own content and media route serve that cover.
  const code = (await ctx.service.publish(album.id, 7)).link.shortCode;
  assert.match((await ctx.client.media(code, photo.photoId, "preview")).redirectUrl, /\/image-selection\/signature-album\//);
  // Deleting the photo takes the cover with it; the album is back to needing one.
  await ctx.service.deletePhoto(album.id, photo.photoId);
  const after = await ctx.service.getForProject(ctx.projectId);
  assert.equal(after.coverPhotoId, null);
  assert.equal(after.cover, null);
});

test("an album with no cover of either kind cannot be published", async () => {
  const { publishProblems } = require("../src/modules/image-selection/signature-album/signatureAlbum.helpers");
  const base = { title: "A", expiresAt: null };
  assert.ok(publishProblems({ ...base, coverImageId: null, coverAlbumPhotoId: null }, { chapterCount: 1, photoCount: 1 }).some((problem) => problem.code === "COVER"));
  assert.ok(!publishProblems({ ...base, coverImageId: null, coverAlbumPhotoId: "p1" }, { chapterCount: 1, photoCount: 1 }).some((problem) => problem.code === "COVER"));
});

test("a new album asks for no PIN, whatever the old studio-wide setting says, and publishing then mints none", async () => {
  const ctx = build();
  await ctx.albumSettings.save({ requirePin: true }, 1);
  const { album } = await albumWithContent(ctx);
  assert.equal(album.link.requiresPin, false);
  const published = await ctx.service.publish(album.id, 7);
  assert.equal(published.link.requiresPin, false);
  assert.equal(published.link.pin, null);
  // Turned on later, it is honoured - the album's own switch, saved on the album.
  const locked = await ctx.service.updateAccess(album.id, { requirePin: true });
  assert.equal(locked.link.requiresPin, true);
  assert.match(locked.link.pin, /^\d{4}$/);
});

// The tab opens the workspace at once and creates the album behind the scenes, so two clients can
// race to create it: the unique projectId lets one insert through, and the loser must get the
// same 409 the pre-check gives - the client re-reads - never a 500 and never a second album.
test("a create that loses the race to the unique projectId answers 409, not 500", async () => {
  const ctx = build();
  const original = ctx.repo.createAlbum;
  let calls = 0;
  ctx.repo.createAlbum = async (data) => {
    calls += 1;
    // The other client's insert landed between this client's read and its insert.
    await original(data);
    throw Object.assign(new Error("Unique constraint failed on the fields: (`project_id`)"), { code: "P2002" });
  };
  await assert.rejects(ctx.service.create(ctx.projectId, 7), (error) => error.status === 409 && /already has a Signature Album/.test(error.message));
  assert.equal(calls, 1);
  ctx.repo.createAlbum = original;
  const album = await ctx.service.getForProject(ctx.projectId);
  assert.ok(album?.id, "the album the winner made is the one everyone reads");
  await assert.rejects(ctx.service.create(ctx.projectId, 7), /already has a Signature Album/);
});

/*
 * A session remembers which PIN it was opened under. Reset PIN, or switching the PIN on or off,
 * ends every session opened before it - the client is asked again - while a session signed before
 * the marker existed is still honoured until it expires.
 */
test("a session ends when the PIN is reset or switched on or off, and an unmarked older session still opens", async () => {
  const ctx = build();
  const { album } = await albumWithContent(ctx);
  const code = (await ctx.service.publish(album.id, 7)).link.shortCode;
  const open = async (pin = "") => `Bearer ${(await ctx.client.verifyPin(code, pin, "1.1.1.1")).sessionToken}`;
  const noPin = await open();
  assert.ok(await ctx.client.requireSession(code, noPin));
  const locked = await ctx.service.updateAccess(album.id, { requirePin: true });
  await assert.rejects(ctx.client.requireSession(code, noPin), (error) => error.status === 401 && /PIN for this album has changed/.test(error.message), "opened before the PIN was switched on");
  const withPin = await open(locked.link.pin);
  assert.ok(await ctx.client.requireSession(code, withPin));
  await ctx.service.resetPin(album.id);
  await assert.rejects(ctx.client.requireSession(code, withPin), (error) => error.status === 401, "opened under the old PIN");
  const legacy = `Bearer ${share.signSession(code, album.id)}`;
  assert.ok(await ctx.client.requireSession(code, legacy), "issued before the marker: still accepted");
  await ctx.service.updateAccess(album.id, { requirePin: false });
  const reopened = await open();
  assert.ok(await ctx.client.requireSession(code, reopened));
});

test("the album cover needs no session, a chapter's own cover is served, and nothing else without one", async () => {
  const ctx = build();
  const { album } = await albumWithContent(ctx); // cover img-1, the Wedding chapter holds img-1..3
  await ctx.service.createChapter(album.id, { name: "Reception", coverImageId: "img-5" });
  await ctx.service.updateAccess(album.id, { requirePin: true });
  const published = await ctx.service.publish(album.id, 7);
  const code = published.link.shortCode;
  assert.ok(await ctx.client.media(code, "img-1", "thumbnail"), "the PIN screen draws the cover before there is a session");
  await assert.rejects(ctx.client.media(code, "img-2", "thumbnail"), (error) => error.status === 401, "an album photo needs the session");
  await assert.rejects(ctx.client.media(code, "img-5", "thumbnail"), (error) => error.status === 401, "so does a chapter cover");
  const session = `Bearer ${(await ctx.client.verifyPin(code, published.link.pin, "1.1.1.1")).sessionToken}`;
  assert.ok(await ctx.client.media(code, "img-5", "preview", session), "a chapter cover outside the album's photos");
  await assert.rejects(ctx.client.media(code, "img-6", "preview", session), /not in this album/);
});


/*
 * AI Culling -> Send Photos -> Signature Album. Only a finalized run's photos go; the desktop asks
 * which still need the album's own copy (importPlan), compresses each original with the album's
 * preset on the workstation and uploads the two derivatives tagged with the photo they were made
 * from - one copy per photo per album, so a retry or a second send stores nothing twice.
 */
function withRuns(ctx, runs) {
  // Two runs over the seeded photos: "done" is finalized, "open" is still in review.
  const decisions = { "img-1": "KEEP", "img-2": "KEEP", "img-3": "KEEP", "img-5": "MAYBE" };
  ctx.service = createSignatureAlbumService(ctx.repo, { albumSettings: ctx.albumSettings, studioSettings, share: share.createSignatureAlbumShareService(ctx.repo, { studioSettings, sessions: {}, chatSwitches: {} }), publishing: ctx.publishing, now: () => new Date("2026-09-24T10:00:00Z"), clientView: ctx.client, r2: ctx.bucket, cleanup: ctx.cleanup,
    cullingRepository: {
      findSession: async (projectId, sessionId) => (runs[sessionId] && projectId === ctx.projectId ? { id: sessionId, status: runs[sessionId] } : null),
      listSessionUploadIds: async (projectId, sessionId, decision, { limit } = {}) => {
        if (!runs[sessionId]) return null;
        const ids = Object.keys(decisions).filter((id) => decision == null || decisions[id] === decision);
        return limit ? ids.slice(0, limit) : ids;
      },
    } });
  return ctx;
}

test("a culling run's photos reach the album only once the run is finalized - its Keeps, ticked photos, the desktop's plan alike", async () => {
  const ctx = withRuns(build(), { done: "FINALIZED", open: "REVIEW_READY", gone: "CANCELLED" });
  for (const [status, run] of [["REVIEW_READY", "open"], ["CANCELLED", "gone"]]) {
    for (const call of [
      () => ctx.service.importUploads(ctx.projectId, { cullingSessionId: run, decision: "KEEP" }, 7),
      () => ctx.service.importUploads(ctx.projectId, { cullingSessionId: run, imageIds: ["img-1"] }, 7),
      () => ctx.service.importPlan(ctx.projectId, { cullingSessionId: run, decision: "KEEP" }, 7),
    ]) await assert.rejects(call(), (error) => error.status === 409 && error.details.notFinalized === true && error.details.status === status);
  }
  assert.equal(ctx.repo.state.albums.length, 0, "a refused send does not even make the album");
  await assert.rejects(ctx.service.importPlan(ctx.projectId, { cullingSessionId: "elsewhere" }, 7), (error) => error.status === 404);
  const added = await ctx.service.importUploads(ctx.projectId, { cullingSessionId: "done", decision: "KEEP", limit: 2 }, 7);
  assert.equal(added.added, 2, "the first two Keeps, in the run's order");
  const ticked = await ctx.service.importUploads(ctx.projectId, { cullingSessionId: "done", imageIds: ["img-5", "img-6"] }, 7);
  assert.equal(ticked.added, 1, "img-6 was not analysed by this run, so it is not sent from its review");
});

test("the desktop's plan lists only what still needs the album's own copy, with where each original is - never its bytes", async () => {
  const ctx = withRuns(build(), { done: "FINALIZED" });
  Object.assign(ctx.repo.state.images.find((image) => image.id === "img-2"), { originalPath: "Wedding/IMG_2.CR3", storageRootId: "root-1", sizeBytes: 26214400n, sourceChecksum: "abc" });
  const plan = await ctx.service.importPlan(ctx.projectId, { cullingSessionId: "done", decision: "KEEP" }, 7);
  assert.equal(plan.total, 3);
  assert.equal(plan.alreadyInAlbum, 0);
  assert.deepEqual(plan.photos.map((photo) => photo.uploadId), ["img-1", "img-2", "img-3"]);
  assert.deepEqual(plan.photos[1], { uploadId: "img-2", fileName: "IMG_2.jpg", originalPath: "Wedding/IMG_2.CR3", storageRootId: "root-1", sizeBytes: 26214400, sourceChecksum: "abc" });
  assert.ok(plan.albumId, "the album is made when the project had none");
  // img-1 placed by reference (the web's send), img-2 copied by the desktop: neither is listed again.
  await ctx.service.importUploads(ctx.projectId, { imageIds: ["img-1"] }, 7);
  await upload(ctx, plan.albumId, "IMG_2.jpg", { sourceUploadId: "img-2" });
  const again = await ctx.service.importPlan(ctx.projectId, { cullingSessionId: "done", decision: "KEEP" }, 7);
  assert.deepEqual(again.photos.map((photo) => photo.uploadId), ["img-3"]);
  assert.equal(again.alreadyInAlbum, 2);
  // And the web's by-reference add skips a photo the album already holds its own copy of.
  const web = await ctx.service.importUploads(ctx.projectId, { imageIds: ["img-2", "img-3"] }, 7);
  assert.deepEqual([web.added, web.skipped], [1, 1]);
});

test("a copy of a project photo is stored once per album: a retry answers with it before anything reaches the bucket, and a race loses cleanly", async () => {
  const ctx = build();
  const album = await ctx.service.create(ctx.projectId, 7);
  const first = await upload(ctx, album.id, "IMG_1.jpg", { sourceUploadId: "img-1" });
  assert.equal(first.alreadyInAlbum, undefined);
  assert.equal(ctx.repo.state.albumPhotos[0].sourceUploadId, "img-1");
  const puts = ctx.bucket.put.length;
  const retry = await upload(ctx, album.id, "IMG_1.jpg", { sourceUploadId: "img-1" });
  assert.equal(retry.alreadyInAlbum, true);
  assert.equal(retry.photoId, first.photoId);
  assert.equal(ctx.bucket.put.length, puts, "nothing was written for the retry");
  assert.equal(ctx.repo.state.albumPhotos.length, 1);
  // Not this project's photo: refused before anything is stored.
  await assert.rejects(upload(ctx, album.id, "x.jpg", { sourceUploadId: "img-pending" }), (error) => error.status === 404);
  await assert.rejects(upload(ctx, album.id, "x.jpg", { sourceUploadId: "someone-elses" }), (error) => error.status === 404);
  assert.equal(ctx.bucket.put.length, puts);
  // Two sends at once: both pass the first look, one wins the unique index, the other's files go back.
  const [a, b] = await Promise.all([upload(ctx, album.id, "IMG_3.jpg", { sourceUploadId: "img-3" }), upload(ctx, album.id, "IMG_3.jpg", { sourceUploadId: "img-3" })]);
  assert.equal(a.photoId, b.photoId);
  assert.equal(ctx.repo.state.albumPhotos.filter((row) => row.sourceUploadId === "img-3").length, 1);
  assert.equal(ctx.bucket.deleted.length, 2, "the loser's two objects were taken back");
  // A photo with no source (uploaded to the album directly) is never deduplicated.
  await upload(ctx, album.id, "free.jpg"); await upload(ctx, album.id, "free.jpg");
  assert.equal(ctx.repo.state.albumPhotos.filter((row) => row.fileName === "free.jpg").length, 2);
});

test("the upload answers 200 for a copy already there and 201 for one stored now - what the desktop's transfer queue reads", () => {
  const controller = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "image-selection", "signature-album", "signatureAlbum.controller.js"), "utf8");
  assert.match(controller, /res\.status\(photo\.alreadyInAlbum \? 200 : 201\)/);
  const routes = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "image-selection", "signature-album", "signatureAlbum.routes.js"), "utf8");
  assert.ok(routes.indexOf("albums.use(requireAlbumAccess())") < routes.indexOf('albums.post("/projects/:projectId/import/plan"'), "the plan is behind the album's own guard");
  const v = require("../src/modules/image-selection/signature-album/signatureAlbum.validation");
  assert.deepEqual(v.importPlanSchema.parse({ cullingSessionId: "s1", limit: "3" }), { cullingSessionId: "s1", decision: "KEEP", limit: 3 });
  assert.throws(() => v.importPlanSchema.parse({ cullingSessionId: "s1", limit: 0 }));
  assert.throws(() => v.importPlanSchema.parse({ limit: 3 }), "a plan always names its run");
  assert.equal(v.photoUploadSchema.parse({ fileName: "a.jpg", mimeType: "image/jpeg", sizeBytes: "5", width: "1", height: "1", sourceUploadId: "img-1" }).sourceUploadId, "img-1");
});

test("a photo still processing or still held for culling is counted, never sent and never fails the others", async () => {
  const ctx = build();
  Object.assign(ctx.repo.state.images.find((image) => image.id === "img-3"), { cullingHoldAt: new Date() });
  const result = await ctx.service.importUploads(ctx.projectId, { imageIds: ["img-1", "img-pending", "img-3"] }, 7);
  assert.deepEqual([result.added, result.notSendable], [1, 2], "img-1 placed; the processing one and the held one counted");
  const album = await ctx.service.getForProject(ctx.projectId);
  await assert.rejects(upload(ctx, album.id, "IMG_3.jpg", { sourceUploadId: "img-3" }), (error) => error.status === 404, "a held photo's copy is refused before anything is stored");
  ctx.repo.state.images.push({ id: "img-elsewhere", projectId: "project-2", folderId: "f", fileName: "E.jpg", status: "READY", createdAt: new Date() });
  await assert.rejects(upload(ctx, album.id, "x.jpg", { sourceUploadId: "img-elsewhere" }), (error) => error.status === 404, "another project's photo as the source");
});

test("the album's culling sends need AI Culling's permission besides the album's, and a plan or a ticked send never mixes its shapes", () => {
  const routes = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "image-selection", "signature-album", "signatureAlbum.routes.js"), "utf8");
  assert.match(routes, /const readsCulling = checkPermission\("IMAGE_SELECTION", "AI Culling", "READ"\);/);
  // ...and only into an album the project is linked to (projects/modules.js).
  assert.match(routes, /albums\.post\("\/projects\/:projectId\/import", readsCulling, requireProjectLink\(\[\["culling", "album"\]\]\), c\.importUploads\);/);
  assert.match(routes, /albums\.post\("\/projects\/:projectId\/import\/plan", readsCulling, requireProjectLink\(\[\["culling", "album"\]\]\), c\.importPlan\);/);
  const v = require("../src/modules/image-selection/signature-album/signatureAlbum.validation");
  assert.throws(() => v.importPlanSchema.parse({ cullingSessionId: "s1", uploadIds: ["a"], decision: "KEEP" }), "ticked photos and a decision are two different sends");
  assert.throws(() => v.importUploadsSchema.parse({ imageIds: ["a"], cullingSessionId: "s1", limit: 2 }));
  assert.deepEqual(v.importPlanSchema.parse({ cullingSessionId: "s1", uploadIds: ["a"] }), { cullingSessionId: "s1", uploadIds: ["a"] });
});

/*
 * AI Editing → Signature Album, automatically: a saved edit is written into the photo's ONE album
 * copy - the by-reference item swapped in place, the copy updated in place on every later version.
 */
const edited = (ctx, uploadId, tag = "v1") => ctx.service.syncEditedCopy(ctx.projectId, uploadId, { fileName: `${uploadId} (edited).jpg`, mimeType: "image/jpeg", sizeBytes: 9, width: 6000, height: 4000, thumbnail: { buffer: WEBP, size: WEBP.length }, preview: { buffer: Buffer.concat([JPEG, Buffer.from(tag)]), size: JPEG.length + tag.length } }, 7);

test("a synced edit takes over the photo's by-reference place - same item, chapter, order and favourite - and a re-edit updates that one copy", async () => {
  const ctx = build();
  await ctx.service.importUploads(ctx.projectId, { imageIds: ["img-1", "img-2"] }, 7);
  const item = ctx.repo.state.items.find((row) => row.imageId === "img-1");
  Object.assign(item, { isHighlight: true, highlightOrder: 1, focalX: 30 });
  const before = { id: item.id, chapterId: item.chapterId, sortOrder: item.sortOrder, items: ctx.repo.state.items.length };
  const first = await edited(ctx, "img-1");
  assert.equal(first.created, true);
  const swapped = ctx.repo.state.items.find((row) => row.id === before.id);
  assert.deepEqual([swapped.imageId, swapped.albumPhotoId, swapped.chapterId, swapped.sortOrder, swapped.isHighlight, swapped.focalX], [null, first.photoId, before.chapterId, before.sortOrder, true, 30], "the same item now shows the edit");
  assert.equal(ctx.repo.state.items.length, before.items, "no second entry");
  const copy = ctx.repo.state.albumPhotos.find((row) => row.id === first.photoId);
  assert.equal(copy.sourceUploadId, "img-1");
  const oldKeys = [copy.thumbnailKey, copy.previewKey];
  const again = await edited(ctx, "img-1", "v2");
  assert.equal(again.photoId, first.photoId, "the re-edit updates the same copy");
  assert.equal(again.created, false);
  assert.equal(ctx.repo.state.albumPhotos.filter((row) => row.sourceUploadId === "img-1").length, 1);
  assert.notDeepEqual([copy.thumbnailKey, copy.previewKey], oldKeys, "pointed at the new derivatives");
  assert.ok(oldKeys.every((key) => ctx.bucket.deleted.includes(key)), "and the old ones are taken back");
  assert.equal(ctx.repo.state.items.length, before.items);
  assert.ok(ctx.repo.state.items.some((row) => row.imageId === "img-2"), "an unedited photo keeps its own album asset");
});

test("a synced edit updates the desktop's copy from the original in place, and a photo not in the album is placed once", async () => {
  const ctx = build();
  const album = await ctx.service.create(ctx.projectId, 7);
  const desktop = await upload(ctx, album.id, "IMG_3.jpg", { sourceUploadId: "img-3" });
  const synced = await edited(ctx, "img-3");
  assert.equal(synced.photoId, desktop.photoId);
  assert.equal(ctx.repo.state.albumPhotos.length, 1);
  const placed = await edited(ctx, "img-4");
  assert.equal(placed.created, true);
  assert.equal(ctx.repo.state.items.filter((row) => row.albumPhotoId === placed.photoId).length, 1);
  await assert.rejects(ctx.service.syncEditedCopy(ctx.projectId, "img-5", { fileName: "x", mimeType: "image/jpeg", sizeBytes: 1, width: 1, height: 1, thumbnail: { buffer: Buffer.from("x"), size: 1 }, preview: { buffer: JPEG, size: 6 } }, 7), /could not be read as a photo/);
  assert.equal(ctx.repo.state.albumPhotos.length, 2, "bad bytes store nothing");
});

