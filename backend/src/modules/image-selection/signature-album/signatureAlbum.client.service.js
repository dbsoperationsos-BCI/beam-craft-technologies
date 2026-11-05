const { repository } = require("./signatureAlbum.repository");
const { createSignatureAlbumSettingsService } = require("./signatureAlbum.settings.service");
const { createSignatureAlbumPublishService } = require("./signatureAlbum.publish.service");
const { sharedPdfService } = require("./signatureAlbum.pdf.service");
const { createSettingsService } = require("../settings/service");
const galleryService = require("../gallery/service");
const r2Storage = require("../storage/r2");
const share = require("./signatureAlbum.share.service");
const { httpError, resolveDesign, serializeImageRef, isExpired, brandingFor, transformOf, clientUrlFor, albumPdfFileName } = require("./signatureAlbum.helpers");
const { LIMITS } = require("./signatureAlbum.constants");
const { expiredLinkError } = require("../../../services/expiredLink");

/*
 * The client's album: what the public API answers, behind the short code and - when the album
 * asks for one - the PIN. No login, no ids in the URL, and a scoped session of its own once the
 * PIN checks out, so the raw PIN is sent once and never again.
 *
 * Every call re-resolves the album and re-checks it is published and not expired, so an album
 * taken down or expiring answers 404 / 410 from that moment, whatever session the browser holds.
 */
const publicMediaBase = (shortCode) => `/api/public/signature-albums/${shortCode}/images`;

function createSignatureAlbumClientService(repo = repository, dependencies = {}) {
  const albumSettings = dependencies.albumSettings || createSignatureAlbumSettingsService(repo);
  const studioSettings = dependencies.studioSettings || createSettingsService();
  const publishing = dependencies.publishing || createSignatureAlbumPublishService(repo, { albumSettings });
  const gallery = dependencies.gallery || galleryService;
  const pdfs = dependencies.pdfs || sharedPdfService();
  const now = dependencies.now || (() => new Date());
  const r2 = dependencies.r2 || r2Storage;

  /*
   * The album a code names, if it may be shown at all. Draft and unpublished answer the same 404
   * an unknown code gets - a probe learns nothing - and an expired album answers 410 with a
   * message, because a client holding a link the studio sent deserves to be told why.
   */
  async function authorize(code) {
    const album = await repo.findAlbumByShortCode(String(code).toUpperCase());
    if (!album) throw httpError(404, "This album is not available.");
    const settled = await publishing.settleExpiry(album);
    // Checked before anything else about the album - the PIN included - so an expired link is told
    // so at once.
    if (settled.status === "EXPIRED" || (settled.status === "PUBLISHED" && isExpired(settled, now()))) throw expiredLinkError();
    if (settled.status !== "PUBLISHED") throw httpError(404, "This album is not available.");
    return { ...settled, project: album.project };
  }

  async function branding(album) {
    const [settings, studio] = await Promise.all([albumSettings.read(), studioSettings.read()]);
    return brandingFor(album, settings, studio);
  }

  // The PIN screen's answer: enough to draw it in the album's own design, and nothing that is
  // behind the PIN - no photo but the cover, no chapter, no count of anything private.
  async function meta(code) {
    const album = await authorize(code);
    const brand = await branding(album);
    const base = publicMediaBase(album.shortCode);
    return {
      title: album.title, subtitle: album.subtitle || "", eventDate: album.eventDate,
      cover: serializeImageRef(album.coverImage, base), coverAlignment: album.coverAlignment, coverTransform: transformOf(album, "cover"),
      design: resolveDesign(album),
      requiresPin: album.requirePin,
      showLogo: brand.showLogo,
      // How many boxes the PIN screen draws: the length of the PIN this album was actually given,
      // which is not always the studio-wide setting of today.
      pinLength: album.requirePin ? (share.safeDecrypt(album.pinCipher)?.length || 4) : 0,
      studioName: brand.studioName, logoUrl: brand.logoUrl, logo: brand.logo,
      expiresAt: album.expiresAt,
    };
  }

  async function verifyPin(code, pin, address) {
    const album = await authorize(code);
    if (album.requirePin) {
      if (!album.pinHash) throw httpError(409, "This album has not been given a PIN yet. Please contact your photographer.");
      share.registerPinAttempt(album.shortCode, address || "unknown");
      if (!(await share.comparePin(pin, album.pinHash))) throw httpError(401, "Incorrect PIN. Please check the message from your photographer.");
      share.clearPinAttempts(album.shortCode, address || "unknown");
    }
    return { sessionToken: share.signSession(album.shortCode, album.id, { pinMark: share.pinMarkOf(album) }), title: album.title };
  }
  // The session, checked against the PIN the album has now: one opened before Reset PIN, or before
  // the PIN was switched on or off, is refused. The album is looked up only for a marked session.
  async function requireSession(code, authHeader, album = null) {
    const payload = share.verifySession(String(code).toUpperCase(), authHeader);
    if (payload.pin === undefined) return payload;
    return share.verifySession(String(code).toUpperCase(), authHeader, album || await authorize(code));
  }

  function serializeItem(item, base, index) {
    return { id: item.id, imageId: item.imageId, isHighlight: item.isHighlight, number: index, transform: transformOf(item), ...serializeImageRef(item.image, base) };
  }

  /*
   * The whole album's shape, with only the first batch of each chapter's photos: cover, the
   * highlights (at most thirty, so they travel whole), every chapter with its count and its first
   * `initialPhotosLoaded` photos, the ending and the client's permissions. The rest of a chapter
   * is paged through `chapterItems` as the reader scrolls, so a five-thousand-photo album opens
   * as fast as a hundred-photo one.
   */
  async function content(code) {
    const album = await authorize(code);
    return contentFor(album, publicMediaBase(album.shortCode));
  }

  /*
   * The album's content for any reader, from the album row and the media base its photo URLs
   * are built on. The client page and the studio's preview both come through here - one
   * builder, so the two cannot disagree about chapters, numbering, the ending or the cover.
   */
  async function contentFor(album, base) {
    const [brand, chapters, highlights] = await Promise.all([branding(album), repo.listChapters(album.id), repo.listHighlights(album.id)]);
    const first = brand.performance.initialPhotosLoaded;
    const chapterContent = [];
    let running = 0;
    for (const chapter of chapters) {
      const { items, total } = await repo.pageChapterItems(chapter.id, { page: 1, pageSize: first });
      // A chapter with nothing in it yet is the studio's to see, not the client's: it is left out
      // of the album rather than shown as an empty heading, and the running numbers skip it.
      if (!total) continue;
      chapterContent.push({
        id: chapter.id, name: chapter.name, subtitle: chapter.subtitle || "", cover: serializeImageRef(chapter.coverImage, base), coverTransform: transformOf(chapter, "cover"),
        layoutStyle: chapter.layoutStyle || album.layoutStyle, photoCount: total, numberOffset: running,
        items: items.map((item, index) => serializeItem(item, base, running + index + 1)),
      });
      running += total;
    }
    return {
      title: album.title, subtitle: album.subtitle || "", eventDate: album.eventDate,
      cover: serializeImageRef(album.coverImage, base), coverAlignment: album.coverAlignment, coverTransform: transformOf(album, "cover"),
      design: resolveDesign(album),
      studioName: brand.studioName, logoUrl: brand.logoUrl, logo: brand.logo, footerText: brand.footerText, showFooter: brand.showFooter,
      ending: brand.ending,
      performance: brand.performance,
      showImageNumbers: brand.showImageNumbers,
      // What the client may do: download the whole album as one PDF, and share the link.
      permissions: { allowDownload: album.allowDownload, allowShare: album.allowShare },
      counts: { photoCount: running, chapterCount: chapterContent.length, highlightCount: highlights.length },
      highlights: highlights.map((item, index) => serializeItem(item, base, index + 1)),
      chapters: chapterContent,
      clientUrl: clientUrlFor(album.shortCode),
      expiresAt: album.expiresAt,
    };
  }

  async function chapterItems(code, chapterId, options = {}) {
    const album = await authorize(code);
    return chapterItemsFor(album, chapterId, publicMediaBase(album.shortCode), options);
  }

  /** The next batch of a chapter, for the client page and the studio's preview alike. */
  async function chapterItemsFor(album, chapterId, base, { offset = 0, limit } = {}) {
    const chapter = await repo.findChapter(album.id, chapterId);
    if (!chapter) throw httpError(404, "Chapter not found.");
    const { lazyLoadBatch } = (await albumSettings.read());
    const pageSize = Math.min(LIMITS.MAX_BATCH, Math.max(1, Number(limit) || lazyLoadBatch));
    const page = Math.floor(offset / pageSize) + 1;
    // Offsets that are not a multiple of the batch are rounded down to one: the reader asks for
    // "the next batch after N", and N is always what it was already given.
    const { items, total } = await repo.pageChapterItems(chapter.id, { page, pageSize });
    const start = (page - 1) * pageSize;
    // The running number continues across the chapters the client sees, which needs every
    // earlier non-empty chapter's count.
    const earlier = (await repo.listChapters(album.id)).filter((other) => other.sortOrder < chapter.sortOrder || (other.sortOrder === chapter.sortOrder && other.createdAt < chapter.createdAt));
    const numberOffset = earlier.reduce((sum, other) => sum + (other._count?.items || 0), 0);
    return { chapterId: chapter.id, items: items.map((item, index) => serializeItem(item, base, numberOffset + start + index + 1)), offset: start, total, hasMore: start + items.length < total };
  }

  /*
   * Download Album: the whole designed album as one PDF (`signatureAlbum.pdf.service.js`). Built on
   * the server in the background, because a large album takes longer than a request may stay open:
   * the session starts it (`startDownload`), asks how it is going (`downloadStatus`) and, once it is
   * ready, is handed a ticket - a download cannot carry the session header - that fetches the file
   * as a plain URL (`downloadAlbum`). Every step checks the album and Allow Download again, so the
   * switch turned off in between is honoured, and a ticket is only good for the album it names.
   */
  async function requireDownloadable(code) {
    const album = await authorize(code);
    if (!album.allowDownload) throw httpError(403, "Downloads are not enabled for this album.");
    return album;
  }
  async function startDownload(code) {
    return pdfs.start(await requireDownloadable(code));
  }
  async function downloadStatus(code) {
    const album = await requireDownloadable(code);
    const state = pdfs.status(album);
    if (state.status !== "ready") return state;
    return { ...state, ticket: share.signDownloadTicket(album.shortCode, album.id), fileName: albumPdfFileName(album) };
  }
  async function downloadAlbum(code, ticket) {
    const album = await requireDownloadable(code);
    const payload = share.verifyDownloadTicket(album.shortCode, ticket);
    if (payload.albumId !== album.id) throw httpError(401, "Invalid download link.");
    return { fileName: albumPdfFileName(album), stream: pdfs.open(album) };
  }

  // The local-derivative fallback for a photo processed before R2, behind the album session. A
  // photo uploaded to the album itself has only its R2 object, so it is only ever a redirect.
  // The album's cover alone is served without a session: the PIN screen draws it before there is one.
  // A chapter cover may be any project photo, so the chapters' covers are served as well.
  async function media(code, imageId, type, authHeader) {
    const album = await authorize(code);
    const isAlbumCover = imageId === (album.coverImageId || album.coverAlbumPhotoId);
    if (!isAlbumCover) await requireSession(code, authHeader, album);
    const shown = album.coverImageId === imageId || (await repo.listItemImageIds(album.id, [imageId])).length || (await repo.listChapters(album.id)).some((chapter) => chapter.coverImageId === imageId);
    if (shown) return gallery.media(album.projectId, imageId, type);
    if (album.coverAlbumPhotoId === imageId || (await repo.listItemPhotoIds(album.id, [imageId])).length) {
      const photo = await repo.findProjectAlbumPhoto(album.projectId, imageId);
      const redirectUrl = photo ? r2.publicUrl(type === "thumbnail" ? photo.thumbnailKey : photo.previewKey) : null;
      if (redirectUrl) return { redirectUrl };
    }
    throw httpError(404, "That photo is not in this album.");
  }

  return { authorize, meta, verifyPin, requireSession, content, contentFor, chapterItems, chapterItemsFor, startDownload, downloadStatus, downloadAlbum, media };
}

module.exports = { createSignatureAlbumClientService, publicMediaBase };
