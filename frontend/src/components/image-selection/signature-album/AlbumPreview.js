"use client";

import { useEffect, useRef, useState } from "react";
import PhoneIphone from "@mui/icons-material/PhoneIphone";
import DesktopWindows from "@mui/icons-material/DesktopWindows";

/**
 * The live album preview: the client's page itself, in an iframe the size of the device being
 * previewed, scaled to fit the space it is given.
 *
 * An iframe rather than the components in place, because a page's layout answers to its own
 * viewport: the responsive breakpoints, the cover's 100svh and therefore its crop are all decided
 * by the window's width and height. Drawn inside the admin page they answered to the admin's
 * window - a "phone" preview laid out with desktop rules, a cover cropped to a 420px band - and
 * differed from what the client got. In an iframe of 390×844 the page *is* the phone page.
 *
 * `refreshKey` changing tells the page to refetch, so a save in the panels shows here at once.
 *
 * `editable` makes it the Design tab's Edit Album Preview: the page is opened with `?edit=1`, so the
 * cover and every photo can be dragged into place, and the page's answer comes back here - `onCoverSaved` with
 * the album update's response, `onCoverError` with the reason. Elsewhere it is only a preview.
 */
const DEVICES = {
  desktop: { width: 1440, height: 900, label: "Desktop preview" },
  phone: { width: 390, height: 844, label: "Phone preview" },
};

export default function AlbumPreview({ album, refreshKey = 0, className = "", editable = false, onCoverSaved, onCoverError }) {
  const [device, setDevice] = useState("desktop");
  const boxRef = useRef(null);
  const frameRef = useRef(null);
  const [box, setBox] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = boxRef.current; if (!el) return undefined;
    const measure = () => { const rect = el.getBoundingClientRect(); setBox({ width: rect.width, height: rect.height }); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!refreshKey) return;
    frameRef.current?.contentWindow?.postMessage({ type: "signature-album:refresh" }, window.location.origin);
  }, [refreshKey]);
  // Only this preview's own page may report a cover save.
  const handlers = useRef({ onCoverSaved, onCoverError });
  useEffect(() => { handlers.current = { onCoverSaved, onCoverError }; });
  useEffect(() => {
    if (!editable) return undefined;
    const onMessage = (event) => {
      if (event.origin !== window.location.origin || event.source !== frameRef.current?.contentWindow) return;
      if (event.data?.type === "signature-album:cover-saved") handlers.current.onCoverSaved?.(event.data.response);
      else if (event.data?.type === "signature-album:position-error") handlers.current.onCoverError?.(event.data.message);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [editable]);

  if (!album) return null;
  // Desktop fills the box: the page is 1440 wide, scaled to the box's width, and as tall as the box
  // is at that scale - a real, if tall, desktop viewport - so no strip of the box is left empty
  // under it. The phone keeps its true 390×844 shape, scaled to fit and centred.
  const preset = DEVICES[device];
  const fitWidth = box.width ? Math.min(box.width / preset.width, 1) : 0;
  const scale = device === "phone" ? (box.width && box.height ? Math.min(fitWidth, box.height / preset.height) : 0) : fitWidth;
  // Exactly the box's height in device pixels - a short box is a short window, not a cropped tall
  // one, or the bottom of the page could never be reached.
  const size = device === "phone" ? preset : { ...preset, height: scale ? Math.max(320, Math.round(box.height / scale)) : preset.height };
  return <div className={`flex min-h-0 flex-col ${className}`}>
    <div className="mb-2 flex items-center justify-between">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{editable ? "Edit album preview" : "Live album preview"} <span className="font-normal normal-case tracking-normal text-slate-400">· {device === "phone" ? `${preset.width}×${preset.height}` : `${preset.width} wide`}{editable ? " · drag any photo to reposition; it saves at once" : ""}</span></p>
      <div className="flex gap-1">
        <button type="button" onClick={() => setDevice("desktop")} aria-pressed={device === "desktop"} aria-label="Desktop preview" className={`rounded p-1 ${device === "desktop" ? "bg-slate-200 text-slate-800" : "text-slate-400 hover:text-slate-700"}`}><DesktopWindows style={{ fontSize: 16 }} aria-hidden="true" /></button>
        <button type="button" onClick={() => setDevice("phone")} aria-pressed={device === "phone"} aria-label="Phone preview" className={`rounded p-1 ${device === "phone" ? "bg-slate-200 text-slate-800" : "text-slate-400 hover:text-slate-700"}`}><PhoneIphone style={{ fontSize: 16 }} aria-hidden="true" /></button>
      </div>
    </div>
    <div ref={boxRef} className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-slate-200 bg-slate-100 shadow-sm">
      {scale > 0 && <iframe
        ref={frameRef}
        key={device}
        title={size.label}
        src={`/signature-album-preview/${encodeURIComponent(album.id)}${editable ? "?edit=1" : ""}`}
        width={size.width}
        height={size.height}
        style={{ width: size.width, height: size.height, transform: `scale(${scale})`, transformOrigin: "top left", position: "absolute", left: Math.max(0, (box.width - size.width * scale) / 2), top: 0, border: 0, background: "white" }}
      />}
    </div>
  </div>;
}
