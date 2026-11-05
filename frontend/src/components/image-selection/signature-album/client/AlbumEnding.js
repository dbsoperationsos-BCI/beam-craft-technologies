"use client";

import AlbumLogo from "./AlbumLogo";
import { linkLabel } from "@/lib/signatureAlbum.mjs";

/**
 * Thank you, the studio's mark, its name, its links, and the footer line.
 *
 * The mark is `AlbumLogo`: the Global Logo for the album's ground - the dark-mode upload on a dark
 * album, the light-mode one on a light album - and the bundled mark in that tone when none is
 * uploaded, so the logo switch being on always shows a mark that reads on the page. The name and
 * the links under it are the album's own text and muted tones, so mark and words are read
 * together on any ground. The name sits under the mark when the name switch is on; either can be
 * off on its own.
 */
export default function AlbumEnding({ ending, studioName, logo, design, footerText, showFooter }) {
  return <footer className="px-6 pb-16 pt-10 text-center sm:pt-14">
    <p className="sa-eyebrow">Thank you</p>
    <p className="sa-heading mx-auto mt-5 max-w-2xl text-2xl leading-snug sm:text-3xl">{ending?.message}</p>
    {ending?.showLogo && <div className="mt-12 flex justify-center"><AlbumLogo logo={logo} design={design} alt={studioName || ""} /></div>}
    {studioName && <p className={`sa-heading text-xl tracking-[0.2em] uppercase ${ending?.showLogo ? "mt-4 text-base" : "mt-12"}`}>{studioName}</p>}
    {/* Each link is named after where it goes - the site, the handle - not after what it is. */}
    {(ending?.websiteUrl || ending?.instagramUrl) && <p className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2 text-xs tracking-[0.18em]">
      {ending.websiteUrl && <a href={ending.websiteUrl} target="_blank" rel="noreferrer" className="sa-muted break-all" title={ending.websiteUrl}>{linkLabel(ending.websiteUrl, "website")}</a>}
      {ending.instagramUrl && <a href={ending.instagramUrl} target="_blank" rel="noreferrer" className="sa-muted break-all" title={ending.instagramUrl}>{linkLabel(ending.instagramUrl, "instagram")}</a>}
    </p>}
    {showFooter && footerText && <p className="sa-muted sa-line mt-16 border-t pt-6 text-[11px] tracking-[0.2em] uppercase">{footerText}</p>}
  </footer>;
}
