"use client";
import { useEffect } from "react";
import ChevronLeft from "@mui/icons-material/ChevronLeft";
import ChevronRight from "@mui/icons-material/ChevronRight";
import Close from "@mui/icons-material/Close";
import IconButton from "@/components/shared/IconButton";
import useEscapeKey from "@/components/shared/useEscapeKey";
import useFocusTrap from "@/components/shared/useFocusTrap";
import { layers } from "@/constants/layers";

/**
 * One picture, full screen, with previous and next - the staff media viewer's shell, shared by the
 * Events media grid and guest gallery and by a production shoot's photos.
 *
 * A layer over the gallery, not a page of its own: a translucent neutral scrim, blurred just
 * enough that the gallery stays recognisable behind the picture, and one glass language for
 * every control on it - a low-opacity dark glass with a hairline of light, light text, no shadow
 * - so the file name, Close, the arrows and Delete read as parts of one viewing surface rather
 * than cards laid on it. The scrim is dark in every theme and the glass sits on the scrim, so
 * the same classes read the same under the light and the dark themes; nothing here names a
 * theme. Hover only lifts a control's contrast, over 150 ms.
 *
 * The chrome is anchored to the viewport, never to the picture: the title top-left with a
 * 20 px inset, Close top-right at 40 px, the arrows centred in a lane either side (both always
 * drawn, disabled at the ends), the footer under the stage. The picture fits inside the lane at
 * its own ratio, never stretched, cropped or enlarged.
 *
 * Keys: Escape closes, the arrows move, Delete asks (`onDeleteKey` only ever opens the caller's
 * confirmation). `paused` silences the keys and the controls while a confirmation sits over the
 * viewer or a delete is in flight. The page under the layer is locked from scrolling while it is
 * open and restored on close; the gallery is neither reloaded nor moved.
 *
 * `children` sits under the picture for whatever the caller offers there (a Delete, an Open video);
 * `corner` sits at the bottom right, for a single icon such as a download. `layer` lifts it over a
 * form panel when it is opened from inside one (`dialogOverPanel`). On a phone the top bar keeps a
 * clear gap above it and clears the notch.
 */
export const GLASS = "border border-white/15 bg-slate-900/35 text-white/85 backdrop-blur-md transition-colors duration-150 hover:border-white/25 hover:bg-slate-900/55 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-slate-900/35 disabled:hover:text-white/85";
const ROUND = GLASS;

export default function Lightbox({ src, alt = "", title, subtitle, caption, onClose, onPrev, onNext, onDeleteKey, hasPrev = false, hasNext = false, paused = false, children, corner, layer = "dialog" }) {
  useEscapeKey(onClose, !paused);
  const trap = useFocusTrap(true);
  useEffect(() => {
    function onKey(event) {
      if (paused || event.defaultPrevented) return;
      // Alt+Left is the browser's Back and Ctrl/Cmd+arrows move the caret: a chord is never paging.
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
      if (event.key === "ArrowLeft" && hasPrev) onPrev?.();
      if (event.key === "ArrowRight" && hasNext) onNext?.();
      if (event.key === "Delete" && onDeleteKey) { event.preventDefault(); onDeleteKey(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasNext, hasPrev, onNext, onPrev, onDeleteKey, paused]);
  useEffect(() => {
    const previous = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);
  const heading = title || caption || alt;
  return <div ref={trap} role="dialog" aria-modal="true" aria-label={heading || "Photo"} aria-busy={paused || undefined} className={`fixed inset-0 ${layers[layer] || layers.dialog} flex flex-col overscroll-contain bg-slate-800/65 backdrop-blur-[6px]`}>
    <div className="flex items-start justify-between gap-4 px-5 pt-[max(2.5rem,calc(env(safe-area-inset-top)+1rem))] sm:pt-5">
      <div className="min-w-0 pt-1 text-white/90 [text-shadow:0_1px_2px_rgba(0,0,0,0.35)]">
        <p className="truncate text-sm font-medium">{heading}</p>
        {subtitle && <p className="truncate text-xs text-white/70">{subtitle}</p>}
      </div>
      <IconButton label="Close" size="md" shape="circle" variant="plain" onClick={onClose} disabled={paused} className={ROUND}><Close fontSize="small" /></IconButton>
    </div>
    <div className="relative flex min-h-0 flex-1 items-center justify-center px-16 py-4 sm:px-24">
      <IconButton label="Previous" size="md" shape="circle" variant="plain" onClick={onPrev} disabled={!hasPrev || paused} className={`absolute left-4 top-1/2 -translate-y-1/2 sm:left-7 ${ROUND}`}><ChevronLeft /></IconButton>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src && <img src={src} alt={alt} className="max-h-full max-w-full rounded-sm object-contain" />}
      <IconButton label="Next" size="md" shape="circle" variant="plain" onClick={onNext} disabled={!hasNext || paused} className={`absolute right-4 top-1/2 -translate-y-1/2 sm:right-7 ${ROUND}`}><ChevronRight /></IconButton>
    </div>
    {children && <div className="flex flex-wrap items-center justify-center gap-2 px-5 pb-6 pt-2">{children}</div>}
    {corner && <div className="flex justify-end px-4 pt-2 pb-[max(4rem,calc(env(safe-area-inset-bottom)+3rem))] sm:pb-6">{corner}</div>}
  </div>;
}
