import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SIDEBAR_MODULES, sidebarLabelForRoute } from "../src/constants/navigation.mjs";
import { permissionForRoute } from "../src/constants/modulePermissions.js";
import { cartKey, formatMoney, galleryStatus, isIndianMobile, normalizeCart, orderKeyFromHash, paiseToRupeesText, percentToBps, rupeesToPaise, toggleInCart } from "../src/lib/photoSelling.mjs";
import { DEFAULT_TEXT } from "../src/lib/qrPoster.mjs";
import { SALE_QR_DEFAULT_TEXT, qrWordsPayload, saleQrWords, salePosterText } from "../src/lib/photoSellingQr.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.join(here, "..", relative), "utf8");

test("Visual Curation lists seven entries side by side, Photo Selling beside the AI Feature", () => {
  const group = SIDEBAR_MODULES.find((entry) => entry.id === "visual-curation");
  assert.deepEqual(group.items.map((item) => item.label), ["AI Feature", "Photo Selling", "Photo Selection", "AI Culling", "AI Editing", "Signature Album", "Album Proofing"]);
  assert.deepEqual(group.items.map((item) => item.id), ["ai-feature", "photo-selling", "image-selection", "ai-culling", "ai-editing", "signature-album", "album-proofing"]);
  // Nothing nested: AI Feature is a link of its own, not a heading over options.
  assert.ok(group.items.every((item) => item.href && !item.children));
});

test("Photo Selling, under the AI Feature's prefix, lights only itself", () => {
  // The sidebar lights the entry with the longest claim on the page; Photo Selling's must be longer.
  const group = SIDEBAR_MODULES.find((entry) => entry.id === "visual-curation");
  const claim = (id) => group.items.find((item) => item.id === id);
  assert.ok(claim("photo-selling").href.startsWith(`${claim("ai-feature").activePath}/`));
  assert.ok(claim("photo-selling").href.length > claim("ai-feature").activePath.length);
  const sidebar = read("src/components/app-shell/AppSidebar.js");
  assert.match(sidebar, /claimLength\(item, pathname\) === longest/);
});

test("each option answers to its own permission; the AI Feature workflow keeps its own", () => {
  assert.deepEqual(permissionForRoute("/visual-curation/ai/photo-selling"), { module: "IMAGE_SELECTION", feature: "Photo Selling" });
  assert.deepEqual(permissionForRoute("/visual-curation/ai/photo-selling/galleries/abc"), { module: "IMAGE_SELECTION", feature: "Photo Selling" });
  assert.deepEqual(permissionForRoute("/visual-curation/ai/overview"), { module: "IMAGE_SELECTION", feature: "AI Feature" });
  assert.deepEqual(permissionForRoute("/visual-curation/ai/events/xyz"), { module: "IMAGE_SELECTION", feature: "AI Feature" });
  assert.equal(sidebarLabelForRoute("/visual-curation/ai/photo-selling"), "Photo Selling");
  assert.equal(sidebarLabelForRoute("/image-selection/dashboard"), "Photo Selection");
});

test("money is formatted and parsed in whole paise", () => {
  assert.equal(formatMoney(150000), "₹1,500");
  assert.equal(formatMoney(12345), "₹123.45");
  assert.equal(rupeesToPaise("1,500"), 150000);
  assert.equal(rupeesToPaise("99.5"), 9950);
  assert.equal(rupeesToPaise("₹ 10.05"), 1005);
  for (const bad of ["", "abc", "1.234", "-5", "1e3"]) assert.equal(rupeesToPaise(bad), null, bad);
  assert.equal(paiseToRupeesText(9950), "99.50");
  assert.equal(paiseToRupeesText(150000), "1500");
  assert.equal(percentToBps("18"), 1800);
  assert.equal(percentToBps("12.5"), 1250);
  assert.equal(percentToBps("x"), null);
});

test("a cart holds one line per photo - the photo's original - and never a price", () => {
  // A cart saved before originals were the one product (with a `kind`) still reads, one line per photo.
  const cart = normalizeCart([{ photoId: "a", pricePaise: 1 }, { photoId: "a", kind: "DIGITAL" }, { photoId: "b", kind: "ORIGINAL" }, { photoId: 5 }, { photoId: "" }, null]);
  assert.deepEqual(cart, [{ photoId: "a" }, { photoId: "b" }]);
  const added = toggleInCart(cart, { photoId: "c" });
  assert.equal(added.length, 3);
  assert.equal(toggleInCart(added, { photoId: "c" }).length, 2);
  assert.equal(cartKey({ photoId: "a", kind: "DIGITAL" }), "a");
});

test("the public service sends only which photos, never a price or a total", () => {
  const service = read("src/services/photo-selling/photo-store-public.service.js");
  assert.match(service, /const lines = \(items\) => items\.map\(\(item\) => \(\{ photoId: item\.photoId \}\)\)/);
  assert.match(service, /body: JSON\.stringify\(\{ items: lines\(items\), buyer \}\)/);
  // The store adds nothing up: every amount it shows is the server's quote.
  const cart = read("src/components/photo-selling/store/StoreCart.js");
  assert.doesNotMatch(cart, /\.reduce\(/);
});

test("an order key is read from the fragment only", () => {
  const key = "A".repeat(43);
  assert.equal(orderKeyFromHash(`#k=${key}`), key);
  assert.equal(orderKeyFromHash(`#x=1&k=${key}`), key);
  assert.equal(orderKeyFromHash("#k=short"), null);
  assert.equal(orderKeyFromHash(""), null);
});

test("Indian mobile numbers are checked the way the server checks them", () => {
  for (const ok of ["9876543210", "+91 98765 43210", "09876543210"]) assert.equal(isIndianMobile(ok), true, ok);
  for (const bad of ["12345", "5876543210", "98765432101"]) assert.equal(isIndianMobile(bad), false, bad);
});

test("a gallery's state reads in the studio's words", () => {
  assert.equal(galleryStatus({ status: "DRAFT" }).label, "Draft");
  assert.equal(galleryStatus({ status: "PUBLISHED", live: true }).label, "Live");
  assert.equal(galleryStatus({ status: "PUBLISHED", live: false, liveReason: "Expired" }).label, "Expired");
  assert.equal(galleryStatus({ status: "PUBLISHED", archivedAt: "x" }).label, "Archived");
});

test("the store never decides a payment: it opens Cashfree and asks the server afterwards", () => {
  const checkout = read("src/lib/cashfreeCheckout.js");
  assert.match(checkout, /https:\/\/sdk\.cashfree\.com\/js\/v3\/cashfree\.js/);
  assert.match(checkout, /environment === "PRODUCTION" \? "production" : "sandbox"/);
  const orderPage = read("src/components/photo-selling/store/StoreOrderPage.js");
  assert.match(orderPage, /getStoreOrder\(/);
  assert.doesNotMatch(orderPage, /searchParams|order_status|payment_status/);
});

test("staff write controls answer to canWrite, and every tab is handed it", () => {
  const workspace = read("src/components/photo-selling/gallery/GalleryWorkspacePage.js");
  assert.match(workspace, /canWrite: canWrite && !archived/);
  for (const file of ["GallerySettingsTab", "GalleryPhotosTab", "GalleryPricingTab", "GalleryShareDialog"]) {
    assert.match(read(`src/components/photo-selling/gallery/${file}.js`), /canWrite/, file);
  }
  assert.match(read("src/components/photo-selling/orders/OrderDetailDialog.js"), /const \{ canWrite \} = useRouteAccess\(\)/);
});

test("a gallery is created with only a name - nothing in the create flow asks for an AI Feature event", () => {
  const dialog = read("src/components/photo-selling/galleries/CreateGalleryDialog.js");
  assert.doesNotMatch(dialog, /eventId|listEligibleEvents|AI Feature event/);
  assert.match(dialog, /label="Gallery name" required/);
  for (const optional of ['label="Event date"', 'label="Venue"', 'label="Welcome note"']) assert.ok(dialog.includes(optional), optional);
  assert.doesNotMatch(read("src/services/photo-selling/photo-selling.service.js"), /events\/eligible/);
});

test("each photo is uploaded as its original, with a preview made on this computer for showing", () => {
  const store = read("src/components/photo-selling/upload/photoSaleUploadStore.js");
  assert.ok(store.includes("createWebUploadAdapter({ uploadItem: adapterUpload, noteBatch: null })"));
  assert.ok(store.includes("uploadSalePhoto("));
  assert.doesNotMatch(store, /uploadOptimizedAiMedia|ai-media-upload\.service/);
  // The shared engine lets go of item.file once compressed; the sale store keeps the original itself.
  assert.match(store, /compress: \(item\) => \{ if \(item\.file\) originals\.set\(item, item\.file\);/);
  assert.match(store, /const original = originals\.get\(item\);/);
  const service = read("src/services/photo-selling/photo-selling.service.js");
  assert.ok(service.includes('/photos/upload`, { method: "POST", body }'));
  assert.ok(service.includes('body.append("original", original, fileName);'), "the original file itself is sent");
  assert.ok(service.includes('if (optimized && payload) body.append("preview", payload'), "the web-size copy only alongside it");
  assert.doesNotMatch(service, /clientOptimized/);
  // The AI Feature's own upload is unchanged: its adapter still defaults to the AI Feature route.
  const adapter = read("src/components/ai-feature/media-upload/adapters/WebUploadAdapter.js");
  assert.ok(adapter.includes("uploadItem = aiUpload, noteBatch = noteAiMediaUploadBatch"));
});

test("the gallery is set up in three steps, and a new one opens on Photos", () => {
  const workspace = read("src/components/photo-selling/gallery/GalleryWorkspacePage.js");
  const ids = [...workspace.matchAll(/\{ id: "(\w+)", label: "[^"]+" \}/g)].map((match) => match[1]);
  assert.deepEqual(ids, ["details", "photos", "pricing", "orders"], "Publish, Share and its QR Template are header actions, not steps");
  assert.match(workspace, /const NEXT = \{ details: "photos", photos: "pricing" \};/, "Prices is the last step");
  assert.match(workspace, /\["share", "qr"\]\.includes\(params\.get\("step"\)\)/, "an older ?step=qr link opens Share with guests");
  assert.ok(read("src/components/photo-selling/galleries/GalleriesPage.js").includes("?step=photos"));
});


test("the store is selfie first: no call lists a gallery's photos, and nothing is shown before a match", () => {
  const service = read("src/services/photo-selling/photo-store-public.service.js");
  // The one photo list is the guest's own matches (`/guest/photos`); nothing asks for a gallery's photos.
  assert.doesNotMatch(service.replaceAll("/guest/photos", ""), /\/photos[`?]/, "no request for a gallery's photos");
  assert.doesNotMatch(service, /listStorePhotos/);
  const store = ["StoreExperience.js", "StoreLanding.js", "StoreSelfieSearch.js"].map((file) => read(`src/components/photo-selling/store/${file}`)).join("\n");
  assert.doesNotMatch(store, /allowBrowse|All photos|View the photos|Browse the gallery/);
  const experience = read("src/components/photo-selling/store/StoreExperience.js");
  // The grid only ever holds the guest's own search's photos.
  assert.match(experience, /const matched = search\?\.status === "COMPLETED"/);
  assert.match(experience, /const gridItems = \(matched \|\| \[\]\)/);
  assert.match(experience, /items=\{gridItems\}/);
  // Without a completed match, the page is the selfie search (the guest's own selfies above it) - never photos.
  assert.match(experience, /\n\s*<StoreSelfieSearch code=\{code\}/);
  // No match says so, with tips - it never falls back to other photos.
  const selfie = read("src/components/photo-selling/store/StoreSelfieSearch.js");
  assert.match(selfie, /No matching photos found/);
  assert.match(selfie, /disabled=\{!consent\}/, "nothing is sent before the guest agrees");
  // Every picture is a watermarked address; nothing in the store names an original.
  const all = ["StoreExperience.js", "StoreLanding.js", "StoreCart.js", "StoreOrderPage.js"].map((file) => read(`src/components/photo-selling/store/${file}`)).join("\n");
  assert.doesNotMatch(all, /originalKey|originals\//);
});

test("the buyer downloads only what the server says is downloadable, with fresh single-use links", () => {
  const orderPage = read("src/components/photo-selling/store/StoreOrderPage.js");
  assert.match(orderPage, /item\.canDownload && <StoreButton/);
  assert.match(orderPage, /getDownloadLink\(code, orderRef, item\.id, credentials\)/);
  assert.match(orderPage, /downloadsLeft/);
  assert.doesNotMatch(orderPage, /The studio will send your originals/);
  // Staff no longer deliver originals by hand.
  assert.doesNotMatch(read("src/services/photo-selling/photo-selling.service.js"), /deliver|fulfilment\/originals/);
  assert.doesNotMatch(read("src/components/photo-selling/orders/OrderDetailDialog.js"), /Mark delivered|deliverSaleOrderOriginal/);
});

test("publishing is a header action, not a step: the banner says what blocks it on every step, and Prices ends with Publish", () => {
  const workspace = read("src/components/photo-selling/gallery/GalleryWorkspacePage.js");
  assert.ok(!fs.existsSync(path.join(here, "..", "src/components/photo-selling/gallery/GalleryPreviewTab.js")), "no Publish tab");
  assert.doesNotMatch(read("src/services/photo-selling/photo-selling.service.js"), /previewSaleGallery/);
  assert.match(workspace, /\{canWrite && !archived && !published && ready && <Button type="button" variant="primary" size="sm" disabled=\{busy\} onClick=\{\(\) => setConfirm\("publish"\)\}>Publish<\/Button>\}/, "the header offers Publish once nothing blocks it");
  assert.match(workspace, /\{!archived && !published && blocking\.length > 0 && <div/, "the banner shows on every step");
  assert.match(workspace, /tab === "pricing" && <><GalleryPricingTab[\s\S]*?setConfirm\("publish"\)\}>Publish<\/Button>/, "Prices ends with Publish");
  assert.match(workspace, /"Published\. Share its link or QR code with your guests\.", \(\) => setSharing\(true\)/);
  const pricing = read("src/components/photo-selling/gallery/GalleryPricingTab.js");
  assert.match(pricing, /label="Price per photo" required/);
  assert.doesNotMatch(pricing, /digitalPricePaise|originalPricePaise|Sell full-resolution originals/);
});

test("a sales poster prints Photo Selling's own words - never the AI Feature's - and the gallery's name", () => {
  const kit = { url: "https://studio.test/s/ABC123", pin: "4321", event: { name: "Ravi & Meera" } };
  const text = salePosterText(kit, saleQrWords({}));
  assert.equal(text.heading, SALE_QR_DEFAULT_TEXT.heading);
  assert.equal(text.instruction, "SCAN TO VIEW & BUY");
  for (const aiWords of Object.values(DEFAULT_TEXT)) assert.ok(!Object.values(text).includes(aiWords), `"${aiWords}" is the AI Feature's`);
  assert.equal(text.footer, "Ravi & Meera");
  assert.equal(text.pin, "4321");
  assert.equal(text.link, "studio.test/s/ABC123");
  const edited = salePosterText(kit, saleQrWords({ heading: "SMILE", footer: "", showPin: false }));
  assert.equal(edited.heading, "SMILE");
  assert.equal(edited.footer, "", "an emptied line is left off");
  assert.equal(edited.pin, "", "the PIN is printed only when wanted");
  assert.deepEqual(qrWordsPayload({ heading: "A", junk: "x", showPin: false }), { heading: "A", showPin: false }, "only the poster's own fields are sent");
});

test("Photo Selling has its own Settings, on its own permission, reading only its own settings - opened over Galleries, not a page", () => {
  const dialog = read("src/components/photo-selling/settings/PhotoSellingSettingsDialog.js");
  assert.match(dialog, /getSaleSettings\(\)/);
  assert.match(dialog, /saveSaleSettings\(/);
  assert.doesNotMatch(dialog, /ai-feature\.service|default-settings|getAiDefault/i, "never the AI Feature's settings");
  assert.match(dialog, /<ReadOnlyFieldset canWrite=\{canWrite\}>/, "read-only for a role at Read");
  assert.match(dialog, /<Dialog\b/, "a dialog over the page");
  assert.doesNotMatch(dialog, /PhotoSellingNavigation/, "no page header of its own");
  // Closing with unsaved edits asks first; a refresh or closed tab is warned too.
  assert.match(dialog, /const close = \(\) => guard\(onClose\)/);
  assert.match(dialog, /onClose=\{close\}/);
  assert.match(dialog, /useUnloadWarning\(dirty, dirty\)/);
  assert.match(dialog, /<ConfirmDialog \{\.\.\.confirmProps\} layer="confirmOverDialog" \/>/);
  // Saving is offered only to Read / Write; Read gets Close.
  assert.match(dialog, /const footer = canWrite && form/);
  // Settings is no longer a section of the header switch...
  const nav = read("src/components/photo-selling/PhotoSellingNavigation.js");
  assert.doesNotMatch(nav, /label: "Settings"/);
  // Dashboard is the Overview page and Projects the Galleries page - labels only, the same routes.
  assert.match(nav, /label: "Dashboard", value: PHOTO_SELLING_ROOT \}[\s\S]*label: "Projects", value: `\$\{PHOTO_SELLING_ROOT\}\/galleries` \}[\s\S]*label: "Orders"/);
  // ...it is the ⋮ beside New Gallery, opening the dialog over the Galleries page.
  const galleries = read("src/components/photo-selling/galleries/GalleriesPage.js");
  assert.match(galleries, /<OptionsMenu ariaLabel="More Photo Selling actions"[^>]*items=\{\[\{ label: "Settings", onSelect: \(\) => setSettingsOpen\(true\) \}\]\}/);
  assert.match(galleries, /\{settingsOpen && <PhotoSellingSettingsDialog onClose=\{closeSettings\}/);
  // Its own parameter: `?settings=` is the app-wide Settings overlay's (lib/globalSettings.js).
  assert.match(galleries, /params\.get\("photoSettings"\) === "1"/);
  assert.doesNotMatch(galleries, /params\.get\("settings"\)/);
  // The old address still works: it lands on Galleries with Settings open, under the same permission.
  assert.match(read("src/app/(app)/visual-curation/ai/photo-selling/settings/page.js"), /redirect\("\/visual-curation\/ai\/photo-selling\/galleries\?photoSettings=1"\)/);
  assert.deepEqual(permissionForRoute("/visual-curation/ai/photo-selling/galleries"), { module: "IMAGE_SELECTION", feature: "Photo Selling" });
  const service = read("src/services/photo-selling/photo-selling.service.js");
  assert.match(service, /apiRequest\(`\$\{base\}\/settings`\)/);
  assert.match(service, /apiRequest\(`\$\{galleryPath\(id\)\}\/qr-kit`\)/);
});

test("QR Template keeps a downloaded design and words with the gallery, and the poster opens the gallery's own store", () => {
  const dialog = read("src/components/photo-selling/gallery/GalleryQrTemplateDialog.js");
  assert.match(dialog, /getSaleGalleryQrKit\(galleryId\)/, "the link comes from the server, for this gallery");
  // Saved only after a download that happened, only when changed, only at Read / Write.
  assert.match(dialog, /const downloaded = await drawn\.save\(format\);\s*if \(!downloaded \|\| !canWrite \|\| !changed\) return;/);
  assert.match(dialog, /updateSaleGallery\(galleryId, \{ qrTemplateId: poster\.templateId, qrText: qrWordsPayload\(poster\.words\) \}\)/);
  assert.doesNotMatch(dialog, /getAiSharePoster|ai-feature\.service/);
  assert.match(read("src/components/photo-selling/shared/SaleQrPosterEditor.js"), /salePosterText\(kit, words\)/);
});

test("no screen offers browsing: the Details step and Settings have no browse switch", () => {
  for (const file of ["src/components/photo-selling/gallery/GallerySettingsTab.js", "src/components/photo-selling/settings/PhotoSellingSettingsDialog.js"]) {
    const text = read(file);
    assert.doesNotMatch(text, /allowBrowse|Browse the whole gallery/, file);
  }
});

test("the selfie search status says what the face engine is doing now - starting, offline, model missing - as a status alone", () => {
  const banner = read("src/components/photo-selling/shared/ServerStatusBanner.js");
  for (const state of ["READY", "STARTING", "ENGINE_OFFLINE", "MODEL_MISSING", "NOT_CONFIGURED"]) assert.match(banner, new RegExp(`${state}: "`), state);
  // Originals storage and Selfie search are a status each, with no helper text; Payments keeps its.
  assert.doesNotMatch(banner, /faceMatching\.reason|originals\.reason|Photo Selling's own folder|private bucket|Guests find their photos only by selfie/);
  assert.match(banner, /Guests can find their photos, but cannot pay until it is\./);
});

test("the payments status says why checkout is off - missing keys, keys Cashfree refused - in the server's words", () => {
  const banner = read("src/components/photo-selling/shared/ServerStatusBanner.js");
  assert.match(banner, /payments\.reason/);
  assert.match(banner, /payments\.credentials === "INVALID" \? "Keys refused"/);
  assert.match(banner, /payments\.credentials === "UNREACHABLE"/);
});


test("Share with guests is the AI Feature's share dialog, with the gallery's own link, PIN, QR and words", () => {
  const share = read("src/components/photo-selling/gallery/GalleryShareDialog.js");
  const ai = read("src/components/ai-feature/event/ShareDialog.js");
  // The same building blocks and layout as the AI Feature's dialog.
  for (const piece of ['title="Share with guests"', 'size="md"', "<ActionField", 'label="Access PIN"', 'label="Require a PIN to open"', 'label="Ready-to-send message"', 'layer="confirmOverDialog"', 'className="h-40 w-40 shrink-0']) {
    assert.ok(ai.includes(piece), `AI dialog has ${piece}`);
    assert.ok(share.includes(piece), `Photo Selling dialog has ${piece}`);
  }
  // Photo Selling's own server call and data - never the AI Feature's.
  assert.match(share, /updateSaleGalleryLink\(galleryId, payload\)/);
  assert.doesNotMatch(share, /ai-feature\.service|createAiShare|getAiShare/);
  // No figures Photo Selling does not keep.
  assert.doesNotMatch(share, /accessCount|lastAccessAt|Opened/);
  // Changes only for Read / Write.
  assert.match(share, /\.\.\.\(canWrite \? \[\{ label: "New link code"/);
  assert.match(share, /labelAside=\{canWrite && <ToggleSwitch/);
  // QR Template takes the dialog's place and Back returns, as the AI Feature's does.
  assert.match(share, />QR Template<\/Button>/);
  assert.match(share, /if \(posters\) return <GalleryQrTemplateDialog [^>]*onBack=\{\(\) => setPosters\(false\)\}/);
  const workspace = read("src/components/photo-selling/gallery/GalleryWorkspacePage.js");
  assert.match(workspace, />Share<\/Button>/);
  assert.match(workspace, /"Published\. Share its link or QR code with your guests\.", \(\) => setSharing\(true\)/, "publishing opens it");
});

test("gallery cards, status pills and the overview use the AI Feature's patterns", () => {
  const chip = read("src/components/photo-selling/shared/SaleStatusChip.js");
  assert.match(chip, /rounded-full border px-2 py-0\.5 text-\[11px\] font-medium/);
  assert.match(read("src/components/ai-feature/shared/StatusChip.js"), /rounded-full border font-medium/);
  const galleries = read("src/components/photo-selling/galleries/GalleriesPage.js");
  assert.doesNotMatch(galleries, /absolute left-2 top-2/, "no status pill laid over the cover photo");
  assert.match(galleries, /grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3/);
  const overview = read("src/components/photo-selling/overview/PhotoSellingOverviewPage.js");
  assert.match(overview, /<DashboardRangeBar [^>]*options=\{RANGES\}/);
  assert.match(overview, /<EmptyDashboard /);
});

test("QR Template is the AI Feature's, drawn from the shared poster engine with the gallery's own kit", () => {
  const dialog = read("src/components/photo-selling/gallery/GalleryQrTemplateDialog.js");
  const ai = read("src/components/ai-feature/event/QrTemplateDialog.js");
  for (const piece of ['title="QR Template"', 'size="wide"', 'backAriaLabel="Back to Share with guests"', ">Back</Button>", '"Download PDF"', '"Download PNG"', '"Preparing PDF..."', '"Preparing PNG..."']) {
    assert.ok(ai.includes(piece), `AI has ${piece}`);
    assert.ok(dialog.includes(piece), `Photo Selling has ${piece}`);
  }
  // This gallery's own kit from Photo Selling's API - never the AI Feature's.
  assert.match(dialog, /getSaleGalleryQrKit\(galleryId\)/);
  assert.doesNotMatch(dialog, /getAiSharePoster|ai-feature\.service/);
  // One implementation: the dialog and the QR step share the editor and its poster hook, which draw
  // with the AI Feature's poster engine (the same ten designs and the same A1 export).
  assert.match(dialog, /useSalePoster\(\{ kit, templateId: poster\.templateId, words: poster\.words/);
  assert.match(dialog, /<SaleQrPosterEditor [^>]*poster=\{drawn\}/);
  const editor = read("src/components/photo-selling/shared/SaleQrPosterEditor.js");
  assert.match(editor, /from "@\/lib\/qrPoster\.mjs"/);
  assert.match(editor, /exportPoster\(template, text, assets/);
  assert.match(read("src/lib/photoSellingQr.mjs"), /export const SALE_QR_TEMPLATES = QR_TEMPLATES;/);
});

test("a gallery card has the AI Feature's ⋮ - Open, Edit, Duplicate, Archive / Restore, Delete - each asking first, writes only at Read / Write", () => {
  const page = read("src/components/photo-selling/galleries/GalleriesPage.js");
  const card = read("src/components/ai-feature/events/EventCard.js");
  assert.match(card, /<OptionsMenu ariaLabel=\{`Actions for \$\{event\.name\}`\} items=\{menuItems\} \/>/);
  assert.match(page, /<OptionsMenu ariaLabel=\{`Actions for \$\{gallery\.title\}`\} items=\{menuItems\} \/>/, "the same ⋮ in the same place");
  assert.match(page, /if \(!canWrite\) return \[open\];/, "Read sees Open only");
  for (const label of ['"Open Gallery"', '"Edit"', '"Duplicate"', '"Restore"', '"Archive"', '"Delete", tone: "danger"']) assert.ok(page.includes(`label: ${label}`), label);
  // Delete is on every gallery - live and sold ones too (owner's decision, 2026-10-31); the server keeps a sold one's orders.
  assert.doesNotMatch(page, /deletable/, "no gallery hides Delete");
  assert.match(page, /\{ separator: true \},\n\s*\{ label: "Delete", tone: "danger", onSelect: \(\) => setAction\(\{ mode: "delete", gallery \}\) \},/, "Delete always last, after a separator");
  const ask = read("src/components/photo-selling/galleries/GalleryActionDialog.js");
  assert.match(ask, /export function deleteMessage\(gallery\)/);
  assert.match(ask, /gallery\?\.status === "PUBLISHED" && "It stops selling at once/, "a live gallery is told it stops selling");
  assert.match(ask, /buyers can no longer download the photos they bought\. To keep their downloads, archive it instead\./, "a sold gallery is told what buyers lose, and the way to keep it");
  assert.match(read("src/components/photo-selling/gallery/GalleryWorkspacePage.js"), /message=\{deleteMessage\(gallery\)\}/, "the workspace's Delete asks the same");
  assert.match(page, /\$\{galleryHref\(gallery\.id\)\}\?step=details/, "Edit opens the Details step");
  assert.match(page, /duplicateSaleGallery\(gallery\.id, payload\)/);
  const dialog = read("src/components/photo-selling/galleries/GalleryActionDialog.js");
  assert.match(dialog, /title="Duplicate gallery"/);
  assert.match(dialog, /label="Name of the copy" required/);
  assert.match(read("src/services/photo-selling/photo-selling.service.js"), /export const duplicateSaleGallery = \(id, payload\) => apiRequest\(`\$\{galleryPath\(id\)\}\/duplicate`, json\("POST", payload\)\);/);
  // A link naming a step opens it over the remembered one (Edit, a new gallery's Photos).
  assert.match(read("src/components/photo-selling/gallery/GalleryWorkspacePage.js"), /const linkedStep = useRef\(stepIds\.includes\(params\.get\("step"\)\) \? params\.get\("step"\) : null\);/);
});

test("the Dashboard shows sales only: the server's setup status (payments, originals storage, selfie search) lives in Settings", () => {
  assert.doesNotMatch(read("src/components/photo-selling/overview/PhotoSellingOverviewPage.js"), /ServerStatusBanner/);
  assert.match(read("src/components/photo-selling/settings/PhotoSellingSettingsDialog.js"), /<ServerStatusBanner server=\{server\} \/>/);
});

test("Orders is on the application's own table: status tabs with their counts, the range, and the server's pages", () => {
  const table = read("src/components/photo-selling/orders/OrdersTable.js");
  assert.match(table, /import DataTable from "@\/components\/data-table\/DataTable";/);
  assert.doesNotMatch(table, /SimpleTable/);
  for (const header of ["Order", "Buyer", "Gallery", "Status", "Photos", "Total", "Placed"]) assert.match(table, new RegExp(`header: "${header}"`), header);
  assert.match(table, /features=\{\{ filtering: true, sorting: true \}\}/);
  assert.match(table, /listSaleOrders\(\{ galleryId, status: status \|\| undefined, page, \.\.\.\(range !== "all" \? \{ range \} : \{\}\) \}\)/, "the same server call, with the range when one is picked");
  // Each tab carries the server's count for the range picked; there is no search box.
  assert.match(table, /label: data\?\.counts \? `\$\{tab\.label\} \(\$\{data\.counts\[tab\.id \|\| "ALL"\] \?\? 0\}\)` : tab\.label/);
  assert.doesNotMatch(table, /SearchField/);
  // Status as tabs, no dropdown for it; the rolling range beside the search, Lifetime by default.
  assert.match(table, /<Tabs tabs=\{STATUSES\.map\(/);
  assert.doesNotMatch(table, /ariaLabel="Order status" options=/);
  for (const label of ["Lifetime", "This week", "This month", "3 months", "6 months"]) assert.match(table, new RegExp(`label: "${label}"`), label);
  assert.match(table, /useState\("all"\)/);
  assert.match(table, /onRowClick=\{\(row\) => setOpenId\(row\.id\)\}/, "a row still opens the order");
  assert.match(table, /Math\.ceil\(data\.total \/ data\.pageSize\)/, "page counts are the server's");
});
