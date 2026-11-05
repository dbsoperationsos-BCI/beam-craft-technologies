"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import ImageNotSupportedOutlined from "@mui/icons-material/ImageNotSupportedOutlined";
import { fetchGalleryImage } from "@/services/image-selection/public-gallery.service";
import isRemoteImage from "@/lib/isRemoteImage";

export default function PublicGalleryLazyImage({ src, alt, sessionToken, className, eager = false }) {
  const targetRef = useRef(null);
  const [visible, setVisible] = useState(eager);
  const [objectUrl, setObjectUrl] = useState("");
  /*
   * The source that could not be loaded - a preview whose file is gone from storage answers 404.
   * Kept by source rather than as a flag, so a tile handed a new photo tries again by itself.
   * Without it a remote photo drew the browser's broken-image glyph with its file name over the
   * tile, and a fetched one pulsed as "loading" for good.
   */
  const [failedSrc, setFailedSrc] = useState("");
  const failed = Boolean(src) && failedSrc === src;
  const remote = isRemoteImage(src);

  useEffect(() => {
    if (eager) return;
    const target = targetRef.current; if (!target) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } }, { rootMargin: "300px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [eager]);

  useEffect(() => {
    if (!visible || remote) return;
    const controller = new AbortController(); let url = "";
    fetchGalleryImage(src, sessionToken, controller.signal).then((blob) => { url = URL.createObjectURL(blob); setObjectUrl(url); }).catch((error) => { if (error.name !== "AbortError") { setObjectUrl(""); setFailedSrc(src); } });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [remote, src, sessionToken, visible]);

  return (
    <div ref={targetRef} className={`relative overflow-hidden bg-slate-100 ${className || ""}`}>
      {/* R2 objects are plain <img>: next/image would demand the bucket hostname be
          declared in next.config, and it is only known from the environment at runtime. */}
      {failed
        ? <div role="img" aria-label={alt ? `Preview unavailable: ${alt}` : "Preview unavailable"} title="Preview unavailable" className="grid h-full w-full place-items-center text-slate-400"><ImageNotSupportedOutlined style={{ fontSize: 22 }} aria-hidden="true" /></div>
        : remote && visible
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={src} alt={alt} loading={eager ? "eager" : "lazy"} decoding="async" onError={() => setFailedSrc(src)} className="absolute inset-0 h-full w-full object-cover" />
        : objectUrl
          ? <Image src={objectUrl} alt={alt} fill unoptimized sizes="(max-width: 640px) 50vw, 25vw" className="object-cover" />
          : <div className="h-full w-full animate-pulse bg-slate-100" aria-label={`Loading ${alt}`} />}
    </div>
  );
}
