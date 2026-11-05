"use client";

import { useContext, useEffect, useRef, useState } from "react";
import AlbumPrintContext from "./AlbumPrintContext";
import isRemoteImage from "@/lib/isRemoteImage";
import { aspectRatio } from "@/lib/signatureAlbum.mjs";
import { imageStyle } from "@/lib/signatureAlbumTransform.mjs";

/**
 * One photograph in the album, loaded only as it comes into view.
 *
 * The frame reserves the photo's own aspect ratio before a byte arrives, so the page never jumps
 * as photos load, and it is painted in two steps: the small thumbnail first, blurred and scaled to
 * fill, then the web preview over it once it has decoded. An R2 object is a plain <img>; a photo
 * processed before object storage is an API route behind the album session, fetched through
 * `loader` and shown as an object URL. The original is never asked for.
 *
 * `transform` is how the photo sits in this frame - FILL or FIT, the focal point, the zoom - as
 * `imageStyle` turns it into CSS. Absent, the photo covers the frame from its centre, which is
 * what every frame drew before positioning existed. Never a stretch: object-fit keeps the
 * photo's own ratio whatever the frame's is.
 */
// `frameProps` are handlers for the frame itself and `children` draws over the photo - the studio's
// Edit Album Preview drags photos with them; the client's page passes neither. A photo is never a
// link or a button: nothing opens when it is clicked.
export default function AlbumImage({ item, variant = "preview", alt = "", className = "", style, eager = false, loader, sizes, rounded = false, transform, frameProps, children }) {
  const targetRef = useRef(null);
  // In the print view every photo loads at once, straight to its web preview (no blurred
  // thumbnail first - one fetch per photo), and reports when it has arrived.
  const print = useContext(AlbumPrintContext);
  const reported = useRef(false);
  const [visible, setVisible] = useState(eager || Boolean(print));
  const [ready, setReady] = useState(false);
  const [thumbUrl, setThumbUrl] = useState("");
  const [fullUrl, setFullUrl] = useState("");
  const src = variant === "thumbnail" ? item?.thumbnailUrl : item?.previewUrl;
  const thumb = print ? null : item?.thumbnailUrl;
  const remote = isRemoteImage(src);
  const remoteThumb = isRemoteImage(thumb);

  useEffect(() => {
    if (!print || !src) return undefined;
    reported.current = false;
    print.add();
    return () => { if (!reported.current) { reported.current = true; print.settle(); } };
  }, [print, src]);
  const settle = () => { if (print && !reported.current) { reported.current = true; print.settle(); } };

  useEffect(() => {
    if (eager || print) return undefined;
    const target = targetRef.current; if (!target) return undefined;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } }, { rootMargin: "500px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [eager, print]);

  // The two derivatives that are API routes rather than public objects come through the loader.
  useEffect(() => {
    if (!visible || !loader) return undefined;
    const controller = new AbortController();
    const urls = [];
    const load = (path, set) => loader(path, controller.signal).then((blob) => { const url = URL.createObjectURL(blob); urls.push(url); set(url); }).catch(() => {
      // A photo that cannot be fetched still counts as arrived, so the print view is not held up.
      if (path === src && print && !reported.current) { reported.current = true; print.settle(); }
    });
    if (thumb && !remoteThumb) load(thumb, setThumbUrl);
    if (src && !remote) load(src, setFullUrl);
    return () => { controller.abort(); urls.forEach((url) => URL.revokeObjectURL(url)); };
  }, [visible, loader, thumb, src, remote, remoteThumb, print]);

  const resolvedThumb = remoteThumb ? thumb : thumbUrl;
  const resolvedFull = remote ? src : fullUrl;
  const placement = imageStyle(transform);
  return <div
    ref={targetRef}
    {...frameProps}
    className={`sa-frame relative block w-full overflow-hidden ${rounded ? "rounded-sm" : ""} ${className}`}
    style={{ aspectRatio: aspectRatio(item), ...style }}
  >
    {visible && resolvedThumb && !ready && (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={resolvedThumb} alt="" aria-hidden="true" decoding="async" className="absolute inset-0 h-full w-full scale-105 object-cover blur-md" />
    )}
    {visible && resolvedFull && (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={resolvedFull} alt={alt} loading={eager || print ? "eager" : "lazy"} decoding="async" sizes={sizes} draggable={false} onLoad={() => { setReady(true); settle(); }} onError={settle} style={placement} className={`absolute inset-0 h-full w-full transition-opacity duration-700 ${ready ? "opacity-100" : "opacity-0"}`} />
    )}
    {children}
  </div>;
}
