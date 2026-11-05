"use client";
import { useEffect } from "react";
import IconButton from "@/components/shared/IconButton";
import useEscapeKey from "@/components/shared/useEscapeKey";
import { layers } from "@/constants/layers";

/**
 * One picture, full screen, with previous and next. Shared by the staff media grid and the guest
 * gallery. `children` sits under the picture for whatever the caller wants to offer there -
 * a Download, a "This is not me".
 */
export default function Lightbox({ src, alt = "", onClose, onPrev, onNext, hasPrev = false, hasNext = false, caption, children }) {
  useEscapeKey(onClose);
  useEffect(() => {
    function onKey(event) { if (event.key === "ArrowLeft" && hasPrev) onPrev?.(); if (event.key === "ArrowRight" && hasNext) onNext?.(); }
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = previous; };
  }, [hasNext, hasPrev, onNext, onPrev]);
  return <div role="dialog" aria-modal="true" aria-label={alt || "Photo"} className={`fixed inset-0 ${layers.dialog} flex flex-col bg-slate-950/95 text-white`}>
    <div className="flex items-center justify-between gap-2 px-3 py-2">
      <p className="min-w-0 truncate text-xs text-slate-300">{caption}</p>
      <IconButton label="Close" onClick={onClose} className="text-white hover:bg-white/10">✕</IconButton>
    </div>
    <div className="relative flex min-h-0 flex-1 items-center justify-center px-2">
      {hasPrev && <IconButton label="Previous" onClick={onPrev} className="absolute left-1 top-1/2 -translate-y-1/2 text-white hover:bg-white/10 sm:left-3">‹</IconButton>}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src && <img src={src} alt={alt} className="max-h-full max-w-full object-contain" />}
      {hasNext && <IconButton label="Next" onClick={onNext} className="absolute right-1 top-1/2 -translate-y-1/2 text-white hover:bg-white/10 sm:right-3">›</IconButton>}
    </div>
    {children && <div className="flex flex-wrap items-center justify-center gap-2 px-3 py-3">{children}</div>}
  </div>;
}
