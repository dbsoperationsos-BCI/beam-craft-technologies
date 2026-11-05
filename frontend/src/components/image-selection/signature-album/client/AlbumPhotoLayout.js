"use client";

import AlbumImage from "./AlbumImage";
import usePhotoDrag from "./usePhotoDrag";
import { editorialRows, storyRows, mixedRows, rowAspect, curatedRows, frameWeight, rowWeight, orientationOf, CURATED_MIN_ROW_WEIGHT, ORIENTATION_FRAME_CSS } from "@/lib/signatureAlbum.mjs";

/**
 * A run of photos in one of the layouts. The same component draws a chapter, the highlights and
 * the studio's live preview, so the arrangement a photographer sees while building is the one
 * the client scrolls. Editorial, Masonry and Grid came first; Story (one wide frame, then a pair,
 * the wide ones drifting left and right), Showcase (one hero, then a supporting grid), Filmstrip
 * (wide 16:9 frames in twos) and Mixed (full width, two columns, three, two) were added beside
 * them, each a pattern over the same `Frame` rather than a renderer of its own. Curated (each photo
 * in the frame of its own orientation, `curatedRows`) is the newest, and what a new album starts on.
 *
 * A photo is part of the page, not a link: nothing opens when it is clicked. `numberOffset` is where the running number
 * starts for this run. `editor` is the studio's Edit Album Preview: each photo can then be dragged
 * inside its frame (`usePhotoDrag`); the client's page passes none.
 */
function Frame({ item, aspect, loader, showNumbers, number, sizes, editor, wrapperStyle }) {
  // A frame with no `aspect` is the photo's own shape: nothing to drag until it is zoomed.
  const drag = usePhotoDrag(item, item.transform, editor ? (transform) => editor.photo(item, transform) : undefined, { ownRatio: !aspect, hint: "hover" });
  return <div className="relative" style={wrapperStyle}>
    <AlbumImage item={item} loader={loader} alt={item.fileName || `Photo ${number}`} style={aspect ? { aspectRatio: aspect } : undefined} sizes={sizes} transform={drag.transform} className={drag.frameClass} frameProps={drag.frameProps}>{drag.hint}</AlbumImage>
    {showNumbers && <span className="sa-chip pointer-events-none absolute bottom-2 left-2 rounded-full px-2 py-0.5 text-[10px] tracking-widest">{String(number).padStart(3, "0")}</span>}
  </div>;
}

export default function AlbumPhotoLayout({ items, layoutStyle = "EDITORIAL", loader, showNumbers = false, numberOffset = 0, editor }) {
  const common = (item, index) => ({ item, loader, showNumbers, editor, number: item.number || numberOffset + index + 1 });
  if (!items?.length) return null;

  if (layoutStyle === "GRID") {
    return <div className="sa-gap grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((item, index) => <Frame key={item.id} {...common(item, index)} aspect="1 / 1" sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw" />)}
    </div>;
  }

  if (layoutStyle === "MASONRY") {
    return <div className="sa-masonry">
      {items.map((item, index) => <Frame key={item.id} {...common(item, index)} sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw" />)}
    </div>;
  }

  if (layoutStyle === "SHOWCASE") {
    // The hero at its own ratio; the supporting photos in one frame shaped by what they mostly are.
    const [hero, ...rest] = items;
    const supporting = rowAspect(rest);
    return <div className="sa-gap flex flex-col">
      <Frame {...common(hero, 0)} sizes="100vw" />
      {rest.length > 0 && <div className="sa-gap grid grid-cols-2 sm:grid-cols-3">
        {rest.map((item, index) => <Frame key={item.id} {...common(item, index + 1)} aspect={supporting} sizes="(max-width: 640px) 50vw, 33vw" />)}
      </div>}
    </div>;
  }

  if (layoutStyle === "FILMSTRIP") {
    return <div className="sa-gap grid grid-cols-1 sm:grid-cols-2">
      {items.map((item, index) => <Frame key={item.id} {...common(item, index)} aspect="16 / 9" sizes="(max-width: 640px) 100vw, 50vw" />)}
    </div>;
  }

  if (layoutStyle === "CURATED") {
    // Every photo in the frame of its own orientation (3:2, 2:3, 1:1). A row's frames share one
    // height by taking widths in proportion to their ratios, so a portrait beside a landscape keeps
    // a portrait frame and the row's edges still align - at every screen width, since the
    // proportions are the frames' own. The crop is cover-from-centre, then the saved focal point.
    const rows = curatedRows(items).reduce((list, row) => { const start = list.length ? list[list.length - 1].start + list[list.length - 1].row.length : 0; list.push({ row, start }); return list; }, []);
    return <div className="sa-gap flex flex-col">
      {rows.map(({ row, start }) => {
        const weight = rowWeight(row);
        // A row lighter than a full-width landscape (only ever the last one - a lone portrait, say)
        // is drawn narrower and centred, so no row stands taller than the hero.
        const width = weight < CURATED_MIN_ROW_WEIGHT ? `${((weight / CURATED_MIN_ROW_WEIGHT) * 100).toFixed(3)}%` : undefined;
        return <div key={row[0].id} className="sa-gap mx-auto flex w-full" style={width ? { width } : undefined}>
          {row.map((item, offset) => <Frame key={item.id} {...common(item, start + offset)} aspect={ORIENTATION_FRAME_CSS[orientationOf(item)]} wrapperStyle={{ flex: `${frameWeight(item)} 1 0%`, minWidth: 0 }} sizes={`${Math.ceil((frameWeight(item) / weight) * 100)}vw`} />)}
        </div>;
      })}
    </div>;
  }

  if (layoutStyle === "STORY" || layoutStyle === "MIXED") {
    const grouped = (layoutStyle === "STORY" ? storyRows(items) : mixedRows(items)).reduce((list, row) => { const start = list.length ? list[list.length - 1].start + list[list.length - 1].row.length : 0; list.push({ row, start }); return list; }, []);
    let wide = 0;
    return <div className="sa-gap flex flex-col">
      {grouped.map(({ row, start }) => {
        if (row.length === 1) {
          // Story drifts its wide frames left and right in turn; Mixed keeps them full width.
          const drift = layoutStyle === "STORY" ? (wide++ % 2 === 0 ? "sm:mr-auto sm:w-[88%]" : "sm:ml-auto sm:w-[88%]") : "";
          return <div key={row[0].id} className={`w-full ${drift}`}><Frame {...common(row[0], start)} sizes="100vw" /></div>;
        }
        // Wide rows keep the photo's own ratio; pairs and trios share a frame shaped by their contents.
        const aspect = rowAspect(row);
        return <div key={row[0].id} className={`sa-gap grid ${row.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
          {row.map((item, offset) => <Frame key={item.id} {...common(item, start + offset)} aspect={aspect} sizes={row.length === 2 ? "50vw" : "33vw"} />)}
        </div>;
      })}
    </div>;
  }

  // Editorial: rows of one, two and three, each row sharing one aspect so its frames align. Each
  // row knows where it starts, so a photo's index into `items` survives the grouping.
  const rows = editorialRows(items).reduce((list, row) => { const start = list.length ? list[list.length - 1].start + list[list.length - 1].row.length : 0; list.push({ row, start }); return list; }, []);
  return <div className="sa-gap flex flex-col">
    {rows.map(({ row, start }) => {
      // A row of one is the photo at its own ratio, uncropped; a pair or trio shares a frame shaped
      // by what is in it - portraits get a portrait frame, landscapes a landscape one, a mix a
      // frame between - so the crop, which the studio can move, is the smallest it can be.
      const aspect = row.length === 1 ? undefined : rowAspect(row);
      return <div key={row[0].id} className={`sa-gap grid ${row.length === 1 ? "grid-cols-1" : row.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
        {row.map((item, offset) => <Frame key={item.id} {...common(item, start + offset)} aspect={aspect} sizes={row.length === 1 ? "100vw" : row.length === 2 ? "50vw" : "33vw"} />)}
      </div>;
    })}
  </div>;
}
