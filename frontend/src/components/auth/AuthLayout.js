"use client";

import { useEffect, useState } from "react";
import useStudioBranding from "@/components/shared/useStudioBranding";

// What the page turns through until an administrator has uploaded pictures under Settings → Login
// Slide: the same three plain cards it has always shown, so a fresh install looks as it did.
const placeholders = ["Slide 1", "Slide 2", "Slide 3"];

export default function AuthLayout({ children }) {
  const branding = useStudioBranding();
  const pictures = Array.isArray(branding?.loginSlides) ? branding.loginSlides.filter(Boolean) : [];
  const count = pictures.length || placeholders.length;
  const [slide, setSlide] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => setSlide((current) => (current + 1) % count), 3500);
    return () => window.clearInterval(interval);
  }, [count]);

  const current = slide % count;
  const dots = Array.from({ length: count }, (_, index) => (
    <span key={index} className={`h-2 rounded-full transition-all ${index === current ? "w-8 bg-slate-600" : "w-2 bg-slate-300"}`} />
  ));

  return <main className="grid min-h-[100dvh] max-w-full bg-slate-100 lg:grid-cols-2">
    <section className="hidden items-center justify-center bg-white p-12 lg:flex">
      {pictures.length
        ? <div className="flex aspect-square w-full max-w-xl flex-col items-center">
          {/* Every picture is in the document, one showing, so the next has already loaded when
              its turn comes and the change is a fade rather than a blank. */}
          <div className="relative min-h-0 w-full flex-1 overflow-hidden rounded-3xl bg-slate-100">
            {pictures.map((picture, index) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={picture} src={picture} alt="" aria-hidden={index !== current} className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${index === current ? "opacity-100" : "opacity-0"}`} />
            ))}
          </div>
          <div className="mt-6 flex gap-2">{dots}</div>
        </div>
        : <div className="flex aspect-square w-full max-w-xl flex-col items-center justify-center rounded-3xl bg-slate-100 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">DBS Operations OS</p>
          <p className="mt-4 text-3xl font-semibold text-slate-600">{placeholders[current]}</p>
          <div className="mt-8 flex gap-2">{dots}</div>
        </div>}
    </section>
    <section className="flex min-h-[100dvh] items-center justify-center px-4 py-8 sm:px-10 sm:py-10"><div className="w-full max-w-[420px]">{children}</div></section>
  </main>;
}
