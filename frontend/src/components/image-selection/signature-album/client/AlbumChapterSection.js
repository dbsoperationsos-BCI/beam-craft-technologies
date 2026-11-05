"use client";

import { useEffect, useRef } from "react";
import Button from "@/components/shared/Button";
import AlbumImage from "./AlbumImage";
import AlbumPhotoLayout from "./AlbumPhotoLayout";
import usePhotoDrag from "./usePhotoDrag";
import { chapterNumber } from "@/lib/signatureAlbum.mjs";

/**
 * One chapter: its heading, its subtitle in quotation marks, its cover as a wide band, and its
 * photos - the first batch the album opened with, then the rest as the reader nears the end of
 * what is shown. `onLoadMore` is asked for the next batch once, when the sentinel under the last
 * row comes within reach; `preload` widens that reach so the next batch is usually already there.
 * `editor` (the studio's Edit Album Preview only) lets the cover band and each photo be dragged.
 */
export default function AlbumChapterSection({ chapter, index, layoutStyle, loader, showNumbers, onLoadMore, loadingMore = false, preload = true, editor }) {
  const sentinelRef = useRef(null);
  const askedFor = useRef(-1);
  const hasMore = (chapter.items?.length || 0) < (chapter.photoCount || 0);
  const coverDrag = usePhotoDrag(chapter.cover, chapter.coverTransform, editor ? (transform) => editor.chapterCover(chapter, transform) : undefined, { hint: "hover" });

  useEffect(() => {
    const target = sentinelRef.current;
    if (!target || !hasMore || !onLoadMore || loadingMore) return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || askedFor.current === chapter.items.length) return;
      askedFor.current = chapter.items.length;
      onLoadMore(chapter);
    }, { rootMargin: preload ? "1400px 0px" : "500px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [chapter, hasMore, onLoadMore, loadingMore, preload]);

  return <section id={`chapter-${chapter.id}`} className="px-4 py-16 sm:px-8 sm:py-24 lg:px-16">
    <header className="mx-auto mb-8 max-w-3xl text-center sm:mb-12">
      <p className="sa-eyebrow">{chapterNumber(index)}{chapter.photoCount ? ` · ${chapter.photoCount} photos` : ""}</p>
      <h2 className="sa-heading mt-3 text-3xl sm:text-4xl lg:text-5xl">{chapter.name}</h2>
      {chapter.subtitle && <p className="sa-muted mt-4 text-base italic sm:text-lg">&ldquo;{chapter.subtitle}&rdquo;</p>}
    </header>
    {chapter.cover && <div className="mx-auto mb-8 max-w-6xl sm:mb-12"><AlbumImage item={chapter.cover} loader={loader} alt={chapter.name} transform={coverDrag.transform} className={coverDrag.frameClass} frameProps={coverDrag.frameProps} style={{ aspectRatio: "21 / 9" }} sizes="100vw">{coverDrag.hint}</AlbumImage></div>}
    <div className="mx-auto max-w-6xl">
      {chapter.items?.length
        ? <AlbumPhotoLayout items={chapter.items} layoutStyle={chapter.layoutStyle || layoutStyle} loader={loader} numberOffset={chapter.numberOffset || 0} showNumbers={showNumbers} editor={editor} />
        : <p className="sa-muted py-10 text-center text-sm">No photos in this chapter yet.</p>}
      {/* The next batch is asked for on its own as the reader nears it; the count is also a button,
          because a batch that failed is not asked for again and the chapter would otherwise stop. */}
      {hasMore && <div ref={sentinelRef} className="flex justify-center py-8">
        {loadingMore || !onLoadMore
          ? <span className="sa-muted text-xs tracking-[0.3em] uppercase" aria-live="polite">{loadingMore ? "Loading" : `${chapter.photoCount - chapter.items.length} more`}</span>
          : <Button type="button" variant="plain" size="md" className="sa-muted text-xs tracking-[0.3em] uppercase sm:text-xs" onClick={() => onLoadMore(chapter)}>{`${chapter.photoCount - chapter.items.length} more`}</Button>}
      </div>}
    </div>
  </section>;
}
