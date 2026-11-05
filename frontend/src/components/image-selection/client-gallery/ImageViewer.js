"use client";
import ArrowBack from "@mui/icons-material/ArrowBack";
import ArrowForward from "@mui/icons-material/ArrowForward";
import Check from "@mui/icons-material/Check";
import { useEffect, useState } from "react";
import Image from "next/image";
import { fetchGalleryImage } from "@/services/image-selection/public-gallery.service";
import isRemoteImage from "@/lib/isRemoteImage";
import useEscapeKey from "@/components/shared/useEscapeKey";

export default function ImageViewer({ image, index, total, selectedCount, sessionToken, onClose, onPrev, onNext, onToggleSelect, hasPrev, hasNext, deliverables = [] }) {
  const [source, setSource] = useState("");
  const remote = isRemoteImage(image.previewUrl);
  // What this photo is picked for — the selection items (Retouches, Frame, …) it belongs to,
  // shown when hovering or focusing the select button so the tick can say what it means.
  const selectedFor = deliverables
    .filter((item) => (image.photoSelections || []).some((selection) => selection.imageSelectionDeliverableConfigId === item.id))
    .map((item) => item.name);

  useEffect(() => {
    if (remote) { setSource(image.previewUrl); return undefined; }
    const controller = new AbortController(); let url = "";
    setSource("");
    fetchGalleryImage(image.previewUrl, sessionToken, controller.signal).then((blob) => { url = URL.createObjectURL(blob); setSource(url); }).catch(() => setSource(""));
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [image.previewUrl, remote, sessionToken]);

  // Escape leaves the photo. The arrows and space stay on the viewer's own listener below - they
  // are about moving through the gallery rather than about dismissing what is open.
  useEscapeKey(onClose);

  useEffect(() => {
    function keydown(event) {
      if (event.key === "ArrowLeft" && hasPrev) onPrev();
      if (event.key === "ArrowRight" && hasNext) onNext();
      if (event.key === " ") { event.preventDefault(); onToggleSelect(image); }
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [onClose, onPrev, onNext, onToggleSelect, image, hasPrev, hasNext]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white" role="dialog" aria-modal="true" aria-label={`Viewing ${image.fileName}`}>
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-3 sm:h-14 sm:px-4">
        <button type="button" onClick={onClose} aria-label="Back to gallery" className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-slate-600 hover:bg-slate-100"><ArrowBack style={{ fontSize: 20 }} /></button>
        <p className="min-w-0 truncate text-[11px] text-slate-500 sm:text-xs">{index + 1} of {total} photos ({selectedCount} selected)</p>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700">{selectedCount}</span>
      </header>

      <div className="relative min-h-0 flex-1 bg-slate-50">
        {hasPrev && <button type="button" onClick={onPrev} aria-label="Previous photo" className="absolute left-2 top-1/2 z-10 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/70 shadow backdrop-blur-md sm:left-3"><ArrowBack style={{ fontSize: 20 }} /></button>}
        {hasNext && <button type="button" onClick={onNext} aria-label="Next photo" className="absolute right-2 top-1/2 z-10 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/70 shadow backdrop-blur-md sm:right-3"><ArrowForward style={{ fontSize: 20 }} /></button>}
        <div className="flex h-full items-center justify-center p-2 sm:p-4">
          {source
            ? remote
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={source} alt={image.fileName} decoding="async" style={{ maxHeight: "100%", width: "auto", height: "auto" }} className="mx-auto max-h-full w-auto object-contain" />
              : <Image src={source} alt={image.fileName} width={image.width || 1600} height={image.height || 1200} unoptimized style={{ maxHeight: "100%", width: "auto", height: "auto" }} className="mx-auto max-h-full w-auto object-contain" />
            : <div className="h-full w-full max-w-3xl animate-pulse rounded-xl bg-slate-100" />}
        </div>
      </div>

      <footer className="flex h-16 shrink-0 items-center justify-center gap-6 border-t border-slate-100 pb-[env(safe-area-inset-bottom)] sm:h-20 sm:gap-8">
        <button type="button" onClick={onPrev} disabled={!hasPrev} aria-label="Previous" className="grid h-10 w-10 place-items-center rounded-full border border-slate-200 text-slate-500 disabled:opacity-30"><ArrowBack style={{ fontSize: 20 }} /></button>
        <span className="group relative">
          <button
            type="button"
            onClick={() => onToggleSelect(image)}
            aria-pressed={image.selected}
            aria-label={image.selected ? "Remove from selection" : "Select this photo"}
            className={`grid h-12 w-12 place-items-center rounded-full transition sm:h-14 sm:w-14 ${image.selected ? "bg-emerald-500 text-white" : "border-2 border-slate-300 text-slate-300"}`}
          >
            <Check style={{ fontSize: 28 }} />
          </button>
          {selectedFor.length > 0 && (
            <div role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-max max-w-[70vw] -translate-x-1/2 rounded-md bg-slate-900/90 px-3 py-2 text-center opacity-0 shadow-lg transition group-focus-within:opacity-100 group-hover:opacity-100">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-300">Selected for</p>
              {selectedFor.map((name) => <p key={name} className="mt-0.5 truncate text-xs text-white">{name}</p>)}
            </div>
          )}
        </span>
        <button type="button" onClick={onNext} disabled={!hasNext} aria-label="Next" className="grid h-10 w-10 place-items-center rounded-full border border-slate-200 text-slate-500 disabled:opacity-30"><ArrowForward style={{ fontSize: 20 }} /></button>
      </footer>
    </div>
  );
}
