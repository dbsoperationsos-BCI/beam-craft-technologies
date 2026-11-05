"use client";

import AlbumImage from "./AlbumImage";
import usePhotoDrag from "./usePhotoDrag";
import { coverAlignmentClasses, formatEventDate } from "@/lib/signatureAlbum.mjs";

/**
 * The cover, in the styles the Design panel offers - one component, switched on `coverStyle`.
 *
 * Full Screen: the cover photo fills the first screen with the words over it. Split: the photo on
 * one side and the words on the other, stacking on a phone. Minimal: the words alone on the
 * album's background, the photo underneath as a wide band. Added beside those three: Centered
 * Hero (a large photo with the words centred beneath it), Editorial Overlay (a magazine title
 * block over the photo's lower corner), Framed (the photo inside a wide margin and a thin rule,
 * words beneath) and Story (an opening page: eyebrow, title, subtitle, date, then the photo).
 * Every one of them reads the same three lines - title, subtitle, date - and the same `Explore`
 * that scrolls to the first section.
 *
 * `editor` is the studio's Edit Album Preview: with it the cover photo can be dragged to a new place
 * in its frame (`usePhotoDrag`), in every style. The client's page passes none.
 */
function CoverWords({ album, tone = "light", align }) {
  const classes = coverAlignmentClasses(align);
  const name = album.title || "Signature Album";
  return <div className={`flex w-full flex-col ${classes.align} ${classes.text} ${tone === "light" ? "text-white" : ""}`}>
    {album.subtitle && <p className={`sa-eyebrow sa-fade-in ${tone === "light" ? "!text-white/80" : ""}`}>{album.subtitle}</p>}
    <h1 className="sa-heading sa-fade-in mt-4 text-5xl leading-[1.05] sm:text-6xl lg:text-7xl" style={{ animationDelay: "120ms" }}>{name}</h1>
    {album.eventDate && <p className={`sa-fade-in mt-5 text-xs tracking-[0.3em] uppercase ${tone === "light" ? "text-white/80" : "sa-muted"}`} style={{ animationDelay: "240ms" }}>{formatEventDate(album.eventDate)}</p>}
  </div>;
}

function ExploreButton({ onExplore, tone }) {
  if (!onExplore) return null;
  return <button type="button" onClick={onExplore} className={`sa-btn sa-fade-in mt-10 ${tone === "light" ? "!border-white/50 !text-white hover:!bg-white hover:!text-black" : ""}`} style={{ animationDelay: "360ms" }}>Explore</button>;
}

export default function AlbumHero({ album, design, loader, onExplore, editor }) {
  const style = design?.coverStyle || "FULL_SCREEN";
  const align = album.coverAlignment || design?.coverAlignment || "CENTER";
  const classes = coverAlignmentClasses(align);
  const cover = album.cover;
  const drag = usePhotoDrag(cover, album.coverTransform, editor?.cover);
  // The cover photo in whichever frame the style draws, placed by the saved transform or the drag.
  const coverImage = (className, style) => <AlbumImage item={cover} eager loader={loader} alt={album.title} transform={drag.transform} className={`${className} ${drag.frameClass}`} style={style} frameProps={drag.frameProps}>{drag.hint}</AlbumImage>;
  const minHeight = "min-h-[100svh]";

  if (style === "SPLIT") {
    return <section className="grid min-h-[100svh] grid-cols-1 md:grid-cols-2">
      <div className="relative order-1 min-h-[52vw] md:order-none md:min-h-0">
        {cover ? coverImage("!absolute inset-0 h-full", { aspectRatio: "auto" }) : <div className="sa-frame absolute inset-0" />}
      </div>
      <div className={`flex flex-col justify-center px-6 py-14 sm:px-12 lg:px-20 ${classes.align}`}>
        <CoverWords album={album} tone="dark" align={align} />
        <ExploreButton onExplore={onExplore} tone="dark" />
      </div>
    </section>;
  }

  if (style === "MINIMAL") {
    return <section className="flex min-h-[100svh] flex-col">
      <div className={`flex flex-1 flex-col justify-center px-6 pb-12 pt-24 sm:px-12 lg:px-24 ${classes.align}`}>
        <CoverWords album={album} tone="dark" align={align} />
        <ExploreButton onExplore={onExplore} tone="dark" />
      </div>
      {cover && <div className="px-4 pb-4 sm:px-8 sm:pb-8">{coverImage("max-h-[70svh] w-full", { aspectRatio: "16 / 9" })}</div>}
    </section>;
  }

  if (style === "CENTERED_HERO") {
    return <section className="flex min-h-[100svh] flex-col">
      <div className="px-3 pt-3 sm:px-6 sm:pt-6">
        {cover ? coverImage("max-h-[72svh] w-full", { aspectRatio: "16 / 9" }) : <div className="sa-frame aspect-[16/9] w-full" />}
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center sm:py-16">
        <CoverWords album={album} tone="dark" align="CENTER" />
        <ExploreButton onExplore={onExplore} tone="dark" />
      </div>
    </section>;
  }

  if (style === "EDITORIAL_OVERLAY") {
    const left = align !== "RIGHT";
    return <section className={`relative flex ${minHeight} items-end overflow-hidden`}>
      {cover ? coverImage("!absolute inset-0 h-full", { aspectRatio: "auto" }) : <div className="sa-frame absolute inset-0" />}
      <div className={`relative m-4 w-full max-w-xl sm:m-10 ${left ? "mr-auto" : "ml-auto"}`}>
        <div className="sa-line border-l-2 px-5 py-6 sm:px-8 sm:py-8" style={{ background: "color-mix(in srgb, var(--album-bg) 88%, transparent)", borderColor: "var(--album-accent)" }}>
          <CoverWords album={album} tone="dark" align="LEFT" />
          <ExploreButton onExplore={onExplore} tone="dark" />
        </div>
      </div>
    </section>;
  }

  if (style === "FRAMED") {
    return <section className="flex min-h-[100svh] flex-col items-center justify-center px-6 py-10 sm:px-16 sm:py-16 lg:px-28">
      <div className="sa-line w-full max-w-4xl border p-3 sm:p-5">
        {cover ? coverImage("max-h-[62svh] w-full", { aspectRatio: "4 / 3" }) : <div className="sa-frame aspect-[4/3] w-full" />}
      </div>
      <div className="mt-10 flex flex-col items-center text-center">
        <CoverWords album={album} tone="dark" align="CENTER" />
        <ExploreButton onExplore={onExplore} tone="dark" />
      </div>
    </section>;
  }

  if (style === "STORY") {
    return <section className="flex min-h-[100svh] flex-col">
      <div className={`flex flex-col px-6 pb-8 pt-20 sm:px-12 sm:pt-28 lg:px-24 ${classes.align}`}>
        <p className="sa-eyebrow sa-fade-in">The story of</p>
        <h1 className={`sa-heading sa-fade-in mt-4 text-5xl leading-[1.05] sm:text-6xl lg:text-7xl ${classes.text}`} style={{ animationDelay: "120ms" }}>{album.title || "Signature Album"}</h1>
        {album.subtitle && <p className={`sa-muted sa-fade-in mt-4 text-lg italic sm:text-xl ${classes.text}`} style={{ animationDelay: "200ms" }}>{album.subtitle}</p>}
        {album.eventDate && <p className={`sa-fade-in mt-5 text-xs tracking-[0.3em] uppercase ${classes.text}`} style={{ animationDelay: "280ms" }}>{formatEventDate(album.eventDate)}</p>}
        <span aria-hidden="true" className="sa-fade-in mt-8 block h-px w-16" style={{ background: "var(--album-accent)", animationDelay: "360ms" }} />
      </div>
      <div className="mx-auto w-full max-w-3xl px-6 pb-10 sm:px-12">
        {cover ? coverImage("w-full", { aspectRatio: "4 / 5", maxHeight: "70svh" }) : <div className="sa-frame aspect-[4/5] w-full" />}
        <div className="mt-6 flex justify-center"><ExploreButton onExplore={onExplore} tone="dark" /></div>
      </div>
    </section>;
  }

  return <section className={`relative flex ${minHeight} items-end overflow-hidden`}>
    {cover ? coverImage("!absolute inset-0 h-full", { aspectRatio: "auto" }) : <div className="sa-frame absolute inset-0" />}
    <div className="pointer-events-none absolute inset-0" style={{ background: "var(--album-overlay)" }} aria-hidden="true" />
    <div className={`relative flex w-full flex-col px-6 pb-16 pt-32 sm:px-12 lg:px-20 ${classes.align}`}>
      <CoverWords album={album} tone="light" align={align} />
      <ExploreButton onExplore={onExplore} tone="light" />
    </div>
  </section>;
}
