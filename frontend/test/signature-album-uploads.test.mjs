import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");
const WORKSPACE = read("components", "image-selection", "ImageSelectionProjectWorkspace.js");
const ALBUM = read("components", "image-selection", "signature-album", "SignatureAlbumWorkspace.js");
const UPLOADER = read("components", "image-selection", "signature-album", "AlbumUploader.js");
const QUEUE = read("components", "image-selection", "signature-album", "useAlbumUploadQueue.js");
const GALLERY = read("components", "image-selection", "signature-album", "AlbumGallery.js");
const PHOTO_SELECTION = read("components", "image-selection", "UploadManager.js");
const SERVICE = read("services", "image-selection", "signature-album.service.js");
const COVER = read("components", "image-selection", "signature-album", "AlbumCover.js");

test("the folder tree steps aside on the Signature Album tab alone, and the folders are only hidden", () => {
  assert.match(WORKSPACE, /const folderless = activeTab === "album";/);
  assert.match(WORKSPACE, /\{!folderless && <aside/);
  assert.match(WORKSPACE, /\{!folderless && <FolderToolbar/);
  assert.match(WORKSPACE, /folderless \? "md:grid-cols-\[minmax\(0,1fr\)_300px\]" : "md:grid-cols-\[210px_minmax\(0,1fr\)_300px\]"/);
});

test("the Album tab is the upload, then the Gallery - the cover is a dialog, and nothing else is there", () => {
  const section = ALBUM.slice(ALBUM.indexOf('{section === "album"'), ALBUM.indexOf("{coverOpen &&"));
  const order = ["Upload Photos", "<AlbumUploader", "<AlbumGallery"].map((tag) => section.indexOf(tag));
  assert.ok(order.every((at) => at > 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "upload first");
  assert.ok(!section.includes("<AlbumCover"), "no cover card on the page");
  for (const gone of ["AlbumPreview", "ChapterManager", "ChapterPhotos", "HighlightManager", "PhotoPicker", "AlbumPhotos", "+ Add Photos"]) {
    assert.ok(!ALBUM.includes(gone), `${gone} is not on the Album tab`);
  }
  assert.match(ALBUM, /\{section === "design" && <DesignPanel album=\{album\} canWrite=\{canWrite\}/);
});

test("Add Cover or Edit Cover by the saved cover photo, opening the one cover editor as a dialog", () => {
  assert.match(ALBUM, /const hasCover = Boolean\(album\.coverPhotoId \|\| album\.coverImageId\);/, "either kind of cover - the rule publishing reads");
  assert.match(ALBUM, /\{!canWrite \? "View Cover" : hasCover \? "Edit Cover" : "Add Cover"\}/);
  assert.equal((ALBUM.match(/<AlbumCover /g) || []).length, 1, "one entry point");
  assert.match(ALBUM, /\{coverOpen && <AlbumCover /);
  // Everything is a draft until Save Cover: the photo and Adjust Cover included, written in one save.
  assert.match(COVER, /<Dialog\s/);
  assert.match(COVER, /onApply=\{\(next\) => \{ setTransform\(next\); setAdjusting\(false\); \}\}/, "Adjust Cover stages, it does not save");
  assert.doesNotMatch(COVER.slice(COVER.indexOf("function pickCover"), COVER.indexOf("function save")), /updateSignatureAlbum/, "picking a cover stages, it does not save");
  assert.equal((COVER.match(/updateSignatureAlbum\(/g) || []).length, 1, "one save");
  assert.match(COVER, /onClose\?\.\(\);\s*\n\s*\} catch/, "closes only after the save succeeds");
});

test("the upload is Photo Selection's own drop zone and progress panel, fed into the album's own queue", () => {
  for (const source of [UPLOADER, PHOTO_SELECTION]) assert.match(source, /<PhotoDropZone onFiles=/, "one drop zone, drawn by both");
  assert.match(UPLOADER, /<UploadBatchProgress/);
  assert.match(UPLOADER, /webkitdirectory=""/, "Choose Folder");
  assert.match(UPLOADER, /splitImageFiles\(/, "the same filter as the project upload");
  // Only the browser-built derivatives travel; the original never does.
  assert.match(QUEUE, /const prepared = await buildDerivatives\(file, options \|\| derivativeOptionsFor\("signatureAlbum"\)\);/, "the studio's Signature Album presets");
  assert.match(QUEUE, /uploadAlbumPhoto\(albumId, \{ \.\.\.prepared,/);
  assert.match(SERVICE, /form\.append\("thumbnail", thumbnail, "thumbnail\.webp"\);\s*\n\s*form\.append\("preview", preview, "preview\.jpg"\);/);
  assert.doesNotMatch(SERVICE.slice(SERVICE.indexOf("export function uploadAlbumPhoto")), /form\.append\("(original|file)"/);
  // Nothing fails quietly: a failed photo is counted and kept for Retry failed.
  assert.match(QUEUE, /failed\.current\.push\(file\);/);
  assert.match(QUEUE, /const retryFailed = useCallback/);
});

test("the Gallery lists the album's uploads with Photo Selection's toolbar and tiles", () => {
  assert.match(GALLERY, /<GalleryToolbar /);
  assert.match(GALLERY, /<GalleryGrid images=\{images\}/);
  assert.match(GALLERY, /processed image\{pagination\.total === 1 \? "" : "s"\}/);
  assert.match(GALLERY, /showTabs=\{false\}/, "no All photos / Selected: every upload is in the album");
  assert.doesNotMatch(GALLERY, /onSelected|selected=\{/, "no Selected filter left behind");
  // Photo Selection's Gallery keeps its tabs.
  assert.doesNotMatch(read("components", "image-selection", "Gallery.js"), /showTabs/);
});

test("the album header has no options menu, and nothing on the tab deletes the album", () => {
  const toolbar = read("components", "image-selection", "signature-album", "AlbumToolbar.js");
  assert.doesNotMatch(toolbar, /OptionsMenu|Delete Signature Album/);
  assert.doesNotMatch(ALBUM, /deleteSignatureAlbum|confirmDelete/);
});

const PICKER = read("components", "image-selection", "signature-album", "AlbumCoverPicker.js");
const HERO = read("components", "image-selection", "signature-album", "client", "AlbumHero.js");
const DRAG = read("components", "image-selection", "signature-album", "client", "usePhotoDrag.js");
const LAYOUT = read("components", "image-selection", "signature-album", "client", "AlbumPhotoLayout.js");
const CHAPTER = read("components", "image-selection", "signature-album", "client", "AlbumChapterSection.js");
const VIEW = read("components", "image-selection", "signature-album", "client", "SignatureAlbumView.js");
const PREVIEW = read("components", "image-selection", "signature-album", "AlbumPreview.js");
const ADMIN_PREVIEW = read("components", "image-selection", "signature-album", "AdminAlbumPreview.js");
const DESIGN = read("components", "image-selection", "signature-album", "DesignPanel.js");
const CLIENT_PAGE = read("components", "image-selection", "signature-album", "client", "ClientSignatureAlbum.js");

test("Choose Cover lists only the album's own uploads - no project folders - and saves the album photo", () => {
  assert.match(PICKER, /listAlbumPhotos\(albumId, \{ search: query, page, pageSize: PAGE_SIZE \}\)/);
  for (const gone of ["listAlbumSourceFolders", "listAlbumSourceImages", "FolderBranch", "projectId"]) assert.ok(!PICKER.includes(gone), `${gone} is not in the cover picker`);
  assert.match(PICKER, /No Signature Album photos uploaded yet\./);
  assert.match(PICKER, /Upload photos in the Album tab first\./);
  assert.match(COVER, /<AlbumCoverPicker albumId=\{album\.id\}/);
  assert.ok(!COVER.includes("PhotoPicker"), "the project-photo picker is not the cover's any more");
  assert.match(COVER, /coverChanged \? \{ coverAlbumPhotoId: coverPhotoId \}/);
  assert.ok(!COVER.includes("coverImageId:"), "a new cover is never a project photo");
});

test("the Design tab's preview is the Edit Album Preview; the rail's preview stays a preview", () => {
  assert.match(PREVIEW, /editable \? "Edit album preview" : "Live album preview"/);
  assert.match(PREVIEW, /\$\{editable \? "\?edit=1" : ""\}/);
  assert.match(PREVIEW, /event\.source !== frameRef\.current\?\.contentWindow/, "only its own page may report");
  assert.match(DESIGN, /<AlbumPreview album=\{album\} refreshKey=\{saves\} editable=\{canWrite\} onCoverSaved=\{onSaved\} onCoverError=\{onError\}/);
});

test("every photo in the Edit Album Preview drags on its own saved focal point and saves on release", () => {
  assert.match(DRAG, /dragTransform\(current\.start, dx, dy, current\.overflow\)/);
  assert.match(DRAG, /onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onLostPointerCapture: onPointerCancel \}/);
  assert.match(DRAG, /cursor-grabbing" : "cursor-grab"/);
  assert.match(DRAG, /await onCommit\(next\)/);
  assert.match(DRAG, /finally \{ setLocal\(null\); setSaving\(false\); \}/, "a failed save puts the photo back where it was saved");
  // Each kind of photo saves through the endpoint that already owns its placement.
  assert.match(ADMIN_PREVIEW, /updateSignatureAlbum\(albumId, \{ coverDisplayMode: transform\.displayMode, coverFocalX: transform\.focalX, coverFocalY: transform\.focalY, coverZoom: transform\.zoom \}\)/);
  assert.match(ADMIN_PREVIEW, /updateAlbumChapter\(albumId, chapter\.id, \{ coverDisplayMode/);
  assert.match(ADMIN_PREVIEW, /updateAlbumItem\(albumId, item\.id, transform\)/);
  assert.match(ADMIN_PREVIEW, /signature-album:position-error/);
  // Every cover style, the chapter band and every layout frame go through the one hook.
  assert.equal((HERO.match(/coverImage\("/g) || []).length, 7);
  assert.ok(!HERO.includes("transform={album.coverTransform}"));
  assert.match(HERO, /usePhotoDrag\(cover, album\.coverTransform, editor\?\.cover\)/);
  assert.match(CHAPTER, /editor\.chapterCover\(chapter, transform\)/);
  assert.match(LAYOUT, /editor\.photo\(item, transform\)/);
  assert.match(LAYOUT, /ownRatio: !aspect/);
  assert.match(VIEW, /showNumbers=\{content\.showImageNumbers\} editor=\{editor\} \/>/);
  assert.ok(!CLIENT_PAGE.includes("editor"), "the client's page cannot drag");
});

const VIEW_SOURCE = read("components", "image-selection", "signature-album", "client", "SignatureAlbumView.js");
const LAYOUT_SOURCE = read("components", "image-selection", "signature-album", "client", "AlbumPhotoLayout.js");
const IMAGE_SOURCE = read("components", "image-selection", "signature-album", "client", "AlbumImage.js");
const PRINT = read("components", "image-selection", "signature-album", "client", "SignatureAlbumPrint.js");
const CLIENT_ALBUM = read("components", "image-selection", "signature-album", "client", "ClientSignatureAlbum.js");
const CLIENT_GALLERY_VIEWER = read("components", "image-selection", "client-gallery", "ImageViewer.js");

test("a Signature Album photo opens nothing: no lightbox, no click handler, no zoom cursor", () => {
  assert.ok(!fs.existsSync(path.join(import.meta.dirname, "..", "src", "components", "image-selection", "signature-album", "client", "AlbumLightbox.js")));
  for (const source of [VIEW_SOURCE, LAYOUT_SOURCE, IMAGE_SOURCE, CHAPTER]) {
    assert.ok(!/Lightbox|onOpen|cursor-zoom-in/.test(source));
  }
  assert.ok(!/onClick/.test(IMAGE_SOURCE), "a photo frame is never a button");
  // The client gallery's own viewer is a different component and is untouched.
  assert.match(CLIENT_GALLERY_VIEWER, /export default function ImageViewer/);
});

test("Download Album prints the album as one PDF: started, asked after, then fetched once", () => {
  assert.match(CLIENT_ALBUM, /await startAlbumDownload\(code, sessionRef\.current\);\s*showNotice\([^\n]*\);\s*await check\(\);/, "started, the wait is explained, then asked after");
  assert.match(CLIENT_ALBUM, /showSuccess\("Your album is ready - downloading now\."\)/);
  assert.match(CLIENT_ALBUM, /getAlbumDownloadStatus\(code, sessionRef\.current\)/);
  assert.match(CLIENT_ALBUM, /window\.location\.assign\(albumDownloadUrl\(code, status\.ticket\)\)/);
  assert.ok(!/zip|ZIP|archive/.test(CLIENT_ALBUM));
  // The print view is the client's own view, whole, without controls, and says when it is ready.
  assert.match(PRINT, /<SignatureAlbumView content=\{content\} loader=\{loader\} print \/>/);
  assert.match(PRINT, /data-album-print-state=\{state \|\| undefined\}/);
  assert.match(PRINT, /while \(items\.length < chapter\.photoCount\)/, "every chapter whole");
  assert.match(VIEW_SOURCE, /\{!print && <div className="pointer-events-none fixed/);
  assert.match(VIEW_SOURCE, /onExplore=\{print \? undefined : scrollToFirst\}/);
});

test("Require PIN is the first of the Permissions, the Access PIN stays under Client Access, and Settings no longer offers a default", () => {
  const rail = read("components", "image-selection", "signature-album", "SignatureAlbumRightPanel.js");
  const permissions = read("components", "image-selection", "signature-album", "ClientPermissions.js");
  const settings = read("components", "image-selection", "SignatureAlbumSettingsField.js");
  const access = rail.slice(rail.indexOf('<Section title="Client Access">'), rail.indexOf('<Section title="Permissions"'));
  assert.ok(!access.includes('ariaLabel="Require PIN"'), "not under Client Access");
  assert.ok(access.includes('label="Access PIN"'), "the PIN itself stays where it was");
  assert.ok(permissions.indexOf('label="Require PIN"') < permissions.indexOf('label="Allow Download"'), "first of the permissions");
  assert.match(permissions, /set\(\{ requirePin: value \}\)/);
  assert.ok(!settings.includes('"requirePin"'));
});

test("the album gallery deletes by selection: Select all asks the server, the pick is ids, and a delete is confirmed first", () => {
  // Select all covers the whole search result, not the pages scrolled so far.
  assert.match(GALLERY, /listAlbumPhotoIds\(album\.id, \{ search: debouncedSearch \}\)/);
  assert.match(GALLERY, /const scopeIds = complete \? photos\.map/);
  assert.match(GALLERY, /useState\(\(\) => new Set\(\)\)/, "the pick is a set of ids, kept across searches");
  assert.match(GALLERY, /Select All \$\{plural\(pagination\.total, "Result"\)\}/, "a search says the scope");
  // Picked the client gallery's way: the whole photo toggles, drawn with its round tick - no checkbox.
  assert.match(GALLERY, /onToggleMark=\{canWrite \? \(image, event\) => toggle\(image\.id, !picked\.has\(image\.id\), event\.shiftKey\)/);
  assert.doesNotMatch(GALLERY, /<Checkbox/);
  assert.match(read("components", "image-selection", "client-gallery", "SelectionPhotoGrid.js"), /<SelectionTick selected=\{image\.selected\}/, "one tick for both galleries");
  // No tile deletes on its own any more; one confirmed request deletes the pick.
  assert.doesNotMatch(GALLERY, /DeleteOutlineRounded|deleteAlbumPhoto\(/);
  assert.match(GALLERY, /<ConfirmDialog/);
  assert.match(GALLERY, /deleteAlbumPhotos\(album\.id, ids\.slice\(start, start \+ DELETE_BATCH\)\)/);
  assert.match(SERVICE, /photos\/remove`, json\("POST", \{ photoIds \}\)/);
  // Photo Selection's tiles are untouched: it passes neither the tick nor the ring.
  assert.doesNotMatch(PHOTO_SELECTION + read("components", "image-selection", "Gallery.js"), /isMarked/);
});

test("after a delete the gallery says so, keeps keyboard focus, and recovers from a photo deleted elsewhere", () => {
  // Success is announced through the workspace's notice; a pick with photos still to do passes no
  // message, so its error stays. One that ended with every photo gone is told as done, not as an error.
  assert.match(GALLERY, /onChanged\?\.\(remaining \? null : parts\.join\(" "\)\)/);
  assert.match(GALLERY, /if \(failed && remaining\) \{/);
  assert.match(ALBUM, /onChanged=\{\(message\) => \{ void changed\(\); if \(message\) showSuccess\(message\); \}\}/);
  // Delete leaves the page with the pick, so focus lost to the body goes to the gallery's heading.
  assert.match(GALLERY, /<h2 ref=\{headingRef\} tabIndex=\{-1\}/);
  assert.match(GALLERY, /document\.activeElement === document\.body\) headingRef\.current\?\.focus\(\)/);
  // Only once the dialog has closed: a dialog still open keeps the focus, never the page behind it.
  assert.match(GALLERY, /if \(closing\) window\.requestAnimationFrame\(/);
  // A 404 asks which picks are gone and unpicks them, so Delete works again rather than failing the same way.
  assert.match(GALLERY, /if \(failure\.status === 404\) \{[^}]*stale = await missingIds\(/);
  assert.match(GALLERY, /const gone = new Set\(\[\.\.\.deleted, \.\.\.stale\]\)/);
  // The bulk controls are full-size touch targets.
  assert.doesNotMatch(GALLERY, /size="sm"/);
});
