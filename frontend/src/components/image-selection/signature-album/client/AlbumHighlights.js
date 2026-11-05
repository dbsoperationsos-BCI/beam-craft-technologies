"use client";

import AlbumPhotoLayout from "./AlbumPhotoLayout";

/**
 * "Our Favourite Moments": the highlights, laid out editorially whatever the album's layout - except
 * on a Curated album, where they too are framed by their own orientation. Every album made before
 * Curated existed keeps the Editorial highlights it always had.
 */
export default function AlbumHighlights({ items, loader, showNumbers, editor, layoutStyle }) {
  if (!items?.length) return null;
  return <section className="px-4 py-16 sm:px-8 sm:py-24 lg:px-16">
    <header className="mx-auto mb-10 max-w-3xl text-center sm:mb-14">
      <p className="sa-eyebrow">Highlights</p>
      <h2 className="sa-heading mt-3 text-3xl sm:text-4xl lg:text-5xl">Our Favourite Moments</h2>
    </header>
    <div className="mx-auto max-w-6xl">
      <AlbumPhotoLayout items={items} layoutStyle={layoutStyle === "CURATED" ? "CURATED" : "EDITORIAL"} loader={loader} showNumbers={showNumbers} editor={editor} />
    </div>
  </section>;
}
