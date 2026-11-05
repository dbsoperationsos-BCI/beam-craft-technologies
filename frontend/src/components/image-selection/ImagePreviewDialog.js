"use client";

// The zoomable full-screen preview, kept for AI Photo Culling alone: choosing between near-identical
// frames needs the photo large. The workspace gallery dropped it by request on 2026-09-03 and does
// not import it; nothing else should either.
import Add from "@mui/icons-material/Add";
import Close from "@mui/icons-material/Close";
import Remove from "@mui/icons-material/Remove";
import { useEffect, useState } from "react";
import Image from "next/image";
import { fetchProtectedImage } from "@/services/image-selection/image-selection.service";
import isRemoteImage from "@/lib/isRemoteImage";
import useEscapeKey from "@/components/shared/useEscapeKey";
import useFocusTrap from "@/components/shared/useFocusTrap";

// `aside`: an optional panel beside the photo (below it on a phone) - Photo Culling's "why".
// `galleryKeys`: the opener's keyboard shortcuts keep working inside (Photo Culling's 1/2/3, ←/→).
export default function ImagePreviewDialog({ image, onClose, aside = null, galleryKeys = false }) {
  const [source, setSource] = useState(""); const [zoom, setZoom] = useState(100);
  const remote = isRemoteImage(image.previewUrl);
  useEffect(() => { if (remote) { setSource(image.previewUrl); return undefined; } const controller = new AbortController(); let url = ""; fetchProtectedImage(image.previewUrl, controller.signal).then((blob) => { url = URL.createObjectURL(blob); setSource(url); }).catch(() => setSource("")); return () => { controller.abort(); if (url) URL.revokeObjectURL(url); }; }, [image.previewUrl, remote]);
  // Escape goes through the shared stack so only the topmost overlay closes; the zoom keys stay here.
  useEscapeKey(onClose);
  // Focus stays inside while it is open (the culling panel adds controls) and returns on close.
  const trapRef = useFocusTrap(true);
  useEffect(() => { function keydown(event) { if (event.key === "+" || event.key === "=") setZoom((value) => Math.min(400, value + 25)); if (event.key === "-") setZoom((value) => Math.max(25, value - 25)); } window.addEventListener("keydown", keydown); return () => window.removeEventListener("keydown", keydown); }, []);
  return <div ref={trapRef} data-culling-keys={galleryKeys ? "" : undefined} className="fixed inset-0 z-50 flex flex-col bg-slate-950/95" role="dialog" aria-modal="true" aria-label={image.fileName ? `Preview of ${image.fileName}` : "Image preview"}><header className="flex h-14 shrink-0 items-center justify-end gap-2 border-b border-white/10 px-4 text-white"><button type="button" onClick={() => setZoom((value) => Math.max(25, value - 25))} aria-label="Zoom out" className="grid h-8 w-8 place-items-center rounded bg-white/10"><Remove style={{ fontSize: 18 }} /></button><input type="range" min="25" max="400" step="25" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} aria-label="Zoom" className="w-28" /><span className="w-12 text-center text-xs">{zoom}%</span><button type="button" onClick={() => setZoom((value) => Math.min(400, value + 25))} aria-label="Zoom in" className="grid h-8 w-8 place-items-center rounded bg-white/10"><Add style={{ fontSize: 18 }} /></button><button type="button" onClick={() => setZoom(100)} className="h-8 rounded bg-white/10 px-3 text-xs">Reset</button><button type="button" onClick={onClose} aria-label="Close preview" className="ml-2 grid h-8 w-8 place-items-center rounded bg-white/10"><Close style={{ fontSize: 20 }} /></button></header><div className="flex min-h-0 flex-1 flex-col md:flex-row"><div className="min-h-0 flex-1 overflow-auto p-6 text-center" onWheel={(event) => { if (event.ctrlKey) setZoom((value) => Math.max(25, Math.min(400, value + (event.deltaY < 0 ? 25 : -25)))); }}>{source
  ? remote
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={source} alt={image.fileName || "Gallery image"} decoding="async" style={{ width: `${zoom}%`, height: "auto" }} className="mx-auto object-contain" />
    : <Image src={source} alt={image.fileName || "Gallery image"} width={image.width || 1600} height={image.height || 1200} unoptimized style={{ width: `${zoom}%`, height: "auto" }} className="mx-auto object-contain" />
  : <div className="mx-auto h-full max-w-4xl animate-pulse rounded-xl bg-white/5" />}</div>{aside && <aside aria-label="About this photo" className="max-h-[45vh] shrink-0 border-t border-white/10 bg-white md:max-h-none md:w-80 md:border-l md:border-t-0">{aside}</aside>}</div></div>;
}
