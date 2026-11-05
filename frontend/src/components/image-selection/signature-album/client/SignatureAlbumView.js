"use client";

import Download from "@mui/icons-material/Download";
import IosShare from "@mui/icons-material/IosShare";
import { downloadAlbumLabel, isDownloadAlbumBusy } from "@/lib/signatureAlbum.mjs";
import AlbumFrame from "./AlbumFrame";
import AlbumHero from "./AlbumHero";
import AlbumHighlights from "./AlbumHighlights";
import AlbumChapterSection from "./AlbumChapterSection";
import AlbumEnding from "./AlbumEnding";

/**
 * The album as a reader sees it, from `content` alone: cover, highlights, chapters, ending, the
 * few controls the studio allowed. The photos are the album's pages, not links: nothing opens when
 * one is clicked, and there is no photo viewer. This is the one rendering of the album -
 * the client page draws it with a live session, and the studio's preview draws it with the same
 * content from the studio's own guard - so what the studio sees is what the client gets.
 *
 * Everything that talks to a server comes in as a callback: Download Album, share, the next batch
 * of a chapter. A caller with nothing to say leaves them out and the control still draws, inert,
 * so the preview looks like the page and not like a cut-down version of it. `downloadState` is
 * the Download Album control's own: idle, preparing, downloading or error, worded by the helper
 * so the page and the preview cannot disagree about it. `editor` lets the studio's Edit Album
 * Preview drag the cover and every photo into place (see `usePhotoDrag`); the client's page never
 * passes it. `print` is the print view behind Download Album's PDF: the album alone, without the
 * controls or the Explore button, which mean nothing on paper.
 */
export default function SignatureAlbumView({ content, loader, onDownloadAlbum, downloadState = "idle", onShare, onLoadMore, loadingMore = EMPTY_MAP, editor, print = false, children }) {
  const permissions = content?.permissions || {};
  const scrollToFirst = () => { const first = document.getElementById(content?.highlights?.length ? "album-highlights" : `chapter-${content?.chapters?.[0]?.id}`); first?.scrollIntoView({ behavior: "smooth" }); };

  return <AlbumFrame design={content.design} className="min-h-[100svh]">
    {children}
    {/* The few controls, pinned top right and kept quiet: Download Album, share. */}
    {!print && <div className="pointer-events-none fixed right-3 top-3 z-[60] flex items-center gap-2 sm:right-5 sm:top-5">
      {/* Icon only; its name and title say what it does and, while the PDF is prepared, that it is busy. */}
      {permissions.allowDownload && <button type="button" onClick={onDownloadAlbum} disabled={isDownloadAlbumBusy(downloadState)} aria-busy={isDownloadAlbumBusy(downloadState)} aria-label={downloadAlbumLabel(downloadState)} title={downloadAlbumLabel(downloadState)} className="sa-chip pointer-events-auto grid h-9 w-9 place-items-center rounded-full disabled:opacity-60">{isDownloadAlbumBusy(downloadState) ? <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" /> : <Download style={{ fontSize: 16 }} aria-hidden="true" />}</button>}
      {permissions.allowShare && <button type="button" onClick={onShare} aria-label="Share album" className="sa-chip pointer-events-auto grid h-9 w-9 place-items-center rounded-full"><IosShare style={{ fontSize: 16 }} aria-hidden="true" /></button>}
    </div>}
    <AlbumHero album={content} design={content.design} loader={loader} onExplore={print ? undefined : scrollToFirst} editor={editor} />
    <div id="album-highlights">
      <AlbumHighlights items={content.highlights} layoutStyle={content.design.layoutStyle} loader={loader} showNumbers={content.showImageNumbers} editor={editor} />
    </div>
    {content.chapters.map((chapter, index) => <AlbumChapterSection key={chapter.id} chapter={chapter} index={index} layoutStyle={content.design.layoutStyle} loader={loader} showNumbers={content.showImageNumbers} onLoadMore={onLoadMore} loadingMore={Boolean(loadingMore[chapter.id])} preload={content.performance?.preloadNextImages !== false} editor={editor} />)}
    <AlbumEnding ending={content.ending} studioName={content.studioName} logo={content.logo} design={content.design} footerText={content.footerText} showFooter={content.showFooter} />
  </AlbumFrame>;
}
const EMPTY_MAP = {};
