"use client";
import { useEffect, useRef, useState } from "react";

/** A public R2 picture that only loads once it is near the viewport. */
export default function LazyImage({ src, alt = "", className = "", eager = false, onClick, style, photoIndex }) {
  const targetRef = useRef(null);
  const [visible, setVisible] = useState(eager);
  useEffect(() => {
    if (eager) return undefined;
    const target = targetRef.current; if (!target) return undefined;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } }, { rootMargin: "400px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [eager]);
  const Tag = onClick ? "button" : "div";
  return <Tag ref={targetRef} type={onClick ? "button" : undefined} onClick={onClick} style={style} data-photo-index={photoIndex} className={`relative block overflow-hidden bg-slate-100 ${className}`}>
    {visible && src
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={src} alt={alt} loading={eager ? "eager" : "lazy"} decoding="async" className="absolute inset-0 h-full w-full object-cover" />
      : <div className="absolute inset-0 animate-pulse bg-slate-100" aria-hidden="true" />}
  </Tag>;
}
