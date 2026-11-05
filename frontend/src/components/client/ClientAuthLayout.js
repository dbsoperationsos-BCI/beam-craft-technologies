"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AppLogo from "@/components/shared/AppLogo";
import { brandNameFor } from "@/components/shared/BrandFallbackLogo";
import useStudioBranding from "@/components/shared/useStudioBranding";
import ClientBackdrop from "./ClientBackdrop";
import { useClientCurtain } from "./ClientCurtain";
import FilmSplash from "./FilmSplash";
import FilmStrip from "./FilmStrip";

// Frames the strip shows before the studio has uploaded any pictures: warm exposures of the palette.
const BLANK_FRAMES = [
  "from-[var(--client-sand)] to-[var(--client-earth)]",
  "from-[var(--client-primary)] to-[var(--client-earth)]",
  "from-[color-mix(in_srgb,var(--client-sand)_70%,white)] to-[var(--client-sand)]",
  "from-[var(--client-earth)] to-[var(--client-film)]",
  "from-[var(--client-sand)] to-[var(--client-primary)]",
  "from-[color-mix(in_srgb,var(--client-earth)_60%,white)] to-[var(--client-earth)]",
];

/**
 * The client sign-in's own frame - not the studio's login, whose panel turns the staff's slides.
 *
 * Beside the form (below `lg`, above it) an earth panel carries the studio's line and a strip of
 * film drifting slowly past: the studio's own pictures where it has uploaded any (Settings → Project
 * Management → Client page images - not the staff sign-in's Login Slide), warm exposures of the
 * palette where it has not. The form sits on a glass card over the same dark ground - about half
 * white, the ground and its gold light blurred through it, lettered in the studio's ink - drawn in
 * from the screen's edges, which on a phone rises over the strip's foot.
 *
 * It opens on `FilmSplash`: the same film, rolled up, unrolling along the panel strip's own track
 * and tilt over a dark screen, which then lifts to show the page around it. The panel's strip waits,
 * hidden and still, until the opening hands over, and then drifts on from that very frame. All of
 * it stills for anybody whose device asks for less motion (globals.css, `film-drift`).
 */
export default function ClientAuthLayout({ children }) {
  const branding = useStudioBranding();
  const studioName = brandNameFor(branding);
  const pictures = Array.isArray(branding?.clientLoginSlides) ? branding.clientLoginSlides.filter(Boolean) : [];
  const frames = pictures.length ? pictures : BLANK_FRAMES;
  // Twice over, so the strip loops without a seam when it has drifted half its length.
  const reel = [...frames, ...frames, ...frames, ...frames].slice(0, Math.max(12, frames.length * 2));
  // The panel's strip, where the opening lands; and whether the opening is still showing.
  const stripRef = useRef(null);
  // Arrived behind the curtain (signed out from the project), the page is simply shown as the
  // curtain draws off it - the film has just passed; it does not unroll again.
  const { reveal, isDrawn } = useClientCurtain();
  const [opening, setOpening] = useState(() => !isDrawn());
  const opened = useCallback(() => setOpening(false), []);
  useEffect(() => { reveal(); }, [reveal]);
  const film = (develop) => <FilmStrip className="!rounded-none" listClassName="py-2">
    {reel.map((frame, index) => <li
      key={`${index}-${frame}`}
      style={develop ? { animationDelay: `${500 + index * 380}ms` } : undefined}
      className={`${develop ? "frame-develop " : ""}relative h-20 w-28 shrink-0 overflow-hidden rounded-sm sm:h-24 sm:w-36 lg:h-28 lg:w-44`}
    >
      {pictures.length
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={frame} alt="" className="h-full w-full object-cover" />
        : <span className={`block h-full w-full bg-gradient-to-br ${frame}`} />}
    </li>)}
  </FilmStrip>;

  /*
   * The dark ground runs under the whole page, so the form's card is glass over it: frosted, the
   * film and the gold light showing softly through. On a phone the card is drawn in from the
   * screen's edges and rises over the strip's foot, running down to the bottom; wider, it is a
   * card of its own beside the panel.
   */
  return <main className="relative grid min-h-[100dvh] grid-rows-[auto_1fr] bg-[var(--client-film)] lg:grid-cols-[1.05fr_1fr] lg:grid-rows-none">
    <ClientBackdrop />
    {/*
      The studio's mark, held at the screen's top left as the page scrolls - fixed rather than
      sticky, the application's body being a scroll box of its own. In its light lettering, on a
      band of the dark ground, translucent and blurred, so it stays legible over the glass card as
      that passes beneath; where the page does not scroll (wide screens) the band is clear.
    */}
    <header className="fixed inset-x-0 top-0 z-30 bg-[color-mix(in_srgb,var(--client-film)_55%,transparent)] px-6 pb-3 pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-md sm:px-10 lg:bg-transparent lg:px-14 lg:pt-10 lg:backdrop-blur-none">
      <AppLogo variant="navbar" surface="dark" priority />
    </header>
    {/* Starts below the fixed band on a phone - its top (1rem, or the notch), the mark's 2.5rem, its 0.75rem foot - and a gap. */}
    <section className="relative overflow-hidden pb-14 pt-[calc(max(1rem,env(safe-area-inset-top))+4.25rem)] sm:pt-[calc(max(1rem,env(safe-area-inset-top))+4.75rem)] lg:flex lg:flex-col lg:justify-center lg:pb-0 lg:pt-0">
      <div className="client-fade relative px-6 sm:px-10 lg:px-14">
        <p className="font-[family-name:var(--client-serif)] text-[2.4rem] font-semibold leading-[1.02] text-white sm:text-5xl lg:text-6xl">Your day,<br />frame by frame.</p>
        <p className="mt-4 max-w-md text-sm leading-relaxed text-white/85 sm:text-base">Sign in to follow your project with {studioName || "the studio"}, from the first plan to the finished album.</p>
      </div>
      <div ref={stripRef} aria-hidden="true" className={`relative mt-8 -rotate-2 overflow-hidden lg:mt-14 ${opening ? "motion-safe:invisible" : ""}`}>
        <div className={`${opening ? "" : "film-drift "}w-max`}>{film(false)}</div>
      </div>
    </section>
    <section className="relative z-10 -mt-7 flex justify-center px-3 sm:px-6 lg:mt-0 lg:items-center lg:px-12 lg:py-12">
      <div className="client-fade flex w-full max-w-[480px] justify-center rounded-t-[1.75rem] border border-b-0 border-white/60 bg-[linear-gradient(165deg,rgba(255,255,255,0.62)_0%,rgba(255,255,255,0.52)_100%)] px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-8 shadow-[inset_0_1px_0_rgba(255,255,255,0.75),0_-14px_40px_-22px_rgba(0,0,0,0.65)] backdrop-blur-2xl backdrop-saturate-150 [animation-delay:150ms] sm:px-10 lg:rounded-[1.75rem] lg:border-b lg:pb-10 lg:shadow-[inset_0_1px_0_rgba(255,255,255,0.75),0_30px_60px_-30px_rgba(0,0,0,0.7)]">
        <div className="w-full max-w-[420px]">{children}</div>
      </div>
    </section>
    {opening && <FilmSplash targetRef={stripRef} onDone={opened}>{film(true)}</FilmSplash>}
  </main>;
}
