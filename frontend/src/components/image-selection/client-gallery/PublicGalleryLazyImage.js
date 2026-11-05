"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { fetchGalleryImage } from "@/services/image-selection/public-gallery.service";
import isRemoteImage from "@/lib/isRemoteImage";

export default function PublicGalleryLazyImage({ src, alt, sessionToken, className, eager = false }) {
  const targetRef = useRef(null);
  const [visible, setVisible] = useState(eager);
  const [objectUrl, setObjectUrl] = useState("");
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
    fetchGalleryImage(src, sessionToken, controller.signal).then((blob) => { url = URL.createObjectURL(blob); setObjectUrl(url); }).catch((error) => { if (error.name !== "AbortError") setObjectUrl(""); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [remote, src, sessionToken, visible]);

  return (
    <div ref={targetRef} className={`relative overflow-hidden bg-slate-100 ${className || ""}`}>
      {/* R2 objects are plain <img>: next/image would demand the bucket hostname be
          declared in next.config, and it is only known from the environment at runtime. */}
      {remote && visible
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={src} alt={alt} loading={eager ? "eager" : "lazy"} decoding="async" className="absolute inset-0 h-full w-full object-cover" />
        : objectUrl
          ? <Image src={objectUrl} alt={alt} fill unoptimized sizes="(max-width: 640px) 50vw, 25vw" className="object-cover" />
          : <div className="h-full w-full animate-pulse bg-slate-100" aria-label={`Loading ${alt}`} />}
    </div>
  );
}
