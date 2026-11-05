"use client";

import Image from "next/image";

/*
 * Four colours, reused across everyone: enough that neighbours usually differ, few enough that
 * the palette reads as one design rather than confetti. Picked by a stable hash of the person's
 * id or name, so the same person wears the same colour on every screen and every visit.
 */
const PALETTE = [
  "bg-indigo-100 text-indigo-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-700",
];

const SIZES = {
  // A chip in a multi-select: the face inside the answer it names, no taller than the chip's text.
  "2xs": "h-5 w-5 text-[9px]",
  // The top bar's user control: the face beside the name, no taller than the line it sits on.
  xs: "h-6 w-6 text-[10px]",
  sm: "h-8 w-8 text-[11px]",
  md: "h-10 w-10 text-sm",
  lg: "h-14 w-14 text-lg",
};
const SIZE_PIXELS = { "2xs": 20, xs: 24, sm: 32, md: 40, lg: 56 };

function initialsOf(name) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((word) => word[0].toUpperCase()).join("");
  return letters || "?";
}

function colorFor(seed) {
  const text = String(seed || "");
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.codePointAt(0)) % 997;
  return PALETTE[hash % PALETTE.length];
}

/**
 * One person's face wherever the app shows people: their uploaded photo, or their initials on
 * one of four fixed colours. `seed` decides the colour and defaults to the name; pass something
 * stable like the employee id so a renamed person keeps their colour. `decorative` empties the
 * photo's alt where the name is already written beside it - a picker's row or chip - so a screen
 * reader does not say it twice.
 */
export default function EmployeeAvatar({ name, photoUrl, seed, size = "md", className = "", decorative = false }) {
  const pixels = SIZE_PIXELS[size] || SIZE_PIXELS.md;
  if (photoUrl) {
    return <Image src={photoUrl} alt={decorative ? "" : `${name || "Employee"}'s photo`} width={pixels} height={pixels} unoptimized className={`${SIZES[size] || SIZES.md} shrink-0 rounded-full border border-slate-200 object-cover ${className}`} />;
  }
  return (
    <span aria-hidden="true" className={`flex ${SIZES[size] || SIZES.md} shrink-0 items-center justify-center rounded-full font-bold ${colorFor(seed ?? name)} ${className}`}>
      {initialsOf(name)}
    </span>
  );
}
