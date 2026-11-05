/**
 * An event's cover picture, or a soft placeholder carrying its initials. R2 objects are plain
 * <img>: next/image would want the bucket hostname declared, which is only known at runtime.
 */
export default function EventCover({ src, name, className = "" }) {
  const initials = String(name || "").split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase()).join("") || "AI";
  return <div className={`relative overflow-hidden bg-slate-100 ${className}`}>
    {src
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={src} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
      : <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-slate-200 to-slate-300 text-lg font-semibold text-slate-500">{initials}</div>}
  </div>;
}
