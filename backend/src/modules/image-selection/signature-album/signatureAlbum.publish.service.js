const { repository } = require("./signatureAlbum.repository");
const { createSignatureAlbumSettingsService } = require("./signatureAlbum.settings.service");
const { createSettingsService } = require("../settings/service");
const share = require("./signatureAlbum.share.service");
const { httpError, addMonths, publishProblems, isExpired } = require("./signatureAlbum.helpers");

/*
 * Publishing, unpublishing and expiry: the album's own lifecycle, independent of the project's
 * status and of the Photo Selection gallery's publication. Nothing here reads or writes either.
 */
function createSignatureAlbumPublishService(repo = repository, dependencies = {}) {
  const albumSettings = dependencies.albumSettings || createSignatureAlbumSettingsService(repo);
  const studioSettings = dependencies.studioSettings || createSettingsService();
  const shareService = dependencies.share || share.createSignatureAlbumShareService(repo);
  const now = dependencies.now || (() => new Date());

  async function counts(albumId) {
    const [chapterCount, photoCount] = await Promise.all([repo.countChapters(albumId), repo.countItems(albumId)]);
    return { chapterCount, photoCount };
  }
  async function problems(album) { return publishProblems(album, { ...(await counts(album.id)), now: now() }); }

  /*
   * An expired album is taken down the next time anyone looks at it - the studio side or the
   * client link - when the studio-wide switch says so. With the switch off the row stays
   * PUBLISHED, the derived status still reads EXPIRED, and the public API still refuses it: the
   * switch decides what the row says, never whether an expired album is shown.
   */
  async function settleExpiry(album) {
    if (album.status !== "PUBLISHED" || !isExpired(album, now())) return album;
    const { autoUnpublishAfterExpiry } = await albumSettings.read();
    return autoUnpublishAfterExpiry ? repo.updateAlbum(album.id, { status: "EXPIRED" }) : album;
  }

  async function publish(album, userId) {
    const blocking = await problems(album);
    if (blocking.length) throw httpError(409, `Album cannot be published. ${blocking[0].message}`, { problems: blocking });
    const settings = await albumSettings.read();
    let current = album;
    // The link is minted once and kept: republishing after an unpublish keeps the URL the client
    // already has. Regenerate Link is the only thing that changes it.
    if (!current.shortCode || !current.tokenHash) current = await shareService.mintLink(current.id);
    if (current.requirePin && !current.pinHash) current = await shareService.mintPin(current.id, settings.pinLength);
    const { studioName, galleryLogoUrl, galleryLogoDarkUrl } = await studioSettings.read();
    const publishedAt = now();
    return repo.updateAlbum(current.id, {
      status: "PUBLISHED",
      publishedAt,
      publishedByUserId: userId ?? null,
      // The date the studio chose wins; otherwise the studio-wide window, stored on the row so a
      // later change to the default cannot move this album's expiry.
      expiresAt: current.expiresAt || addMonths(publishedAt, settings.defaultExpiryMonths),
      // Both Global Logos travel: the album's pages pick between them by the album's background,
      // and a theme changed after publishing must still find the mark for the new ground.
      brandingSnapshot: { studioName, galleryLogoUrl: settings.useGlobalLogo ? galleryLogoUrl : null, galleryLogoDarkUrl: settings.useGlobalLogo ? galleryLogoDarkUrl || null : null, capturedAt: publishedAt.toISOString() },
    });
  }

  async function unpublish(album) {
    if (album.status === "DRAFT") return album;
    return repo.updateAlbum(album.id, { status: "DRAFT" });
  }

  // A new link: the old URL stops answering as soon as the new code is written. The PIN is kept.
  async function regenerateLink(album) {
    return shareService.mintLink(album.id);
  }
  async function resetPin(album) {
    const settings = await albumSettings.read();
    return shareService.mintPin(album.id, settings.pinLength);
  }

  return { counts, problems, settleExpiry, publish, unpublish, regenerateLink, resetPin };
}

module.exports = { createSignatureAlbumPublishService };
