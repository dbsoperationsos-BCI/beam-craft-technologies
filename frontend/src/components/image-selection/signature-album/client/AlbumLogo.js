"use client";

import { useState } from "react";
import { LOGO_VARIANTS } from "@/components/shared/AppLogo";
import { FALLBACK_LOGO_ALT } from "@/components/shared/BrandFallbackLogo";
import { BUNDLED_MARKS, logoToneFor } from "@/lib/signatureAlbum.mjs";

/**
 * The studio's mark on an album page - the ending, the PIN screen - in the tone the album's ground
 * asks for.
 *
 * `AppLogo` is not used here on purpose: it chooses between the two Global Logos by the
 * *application's* theme, and an album is painted in its own design, not the app's. A Cinematic
 * album is black whatever appearance the studio's browser is in, and the studio's preview sits
 * inside the light app, so the mark has to follow the album. The server names the mark for every
 * reader (`logo`: tone, url, ownMark) from the same rule for the client's page and the studio's
 * preview, so the two draw the same thing; `design` answers only for a payload that predates it.
 *
 * Three states, none of them an altered logo:
 * - the mark uploaded for this ground: drawn as it is;
 * - the mark for the other ground, borrowed because this one was never uploaded (`ownMark`
 *   false): drawn as it is, on a small plate of its own ground, so a dark-lettered mark still
 *   reads on a black album and nothing inverts, fades or recolours the artwork;
 * - no upload, or one that fails to load: the bundled mark in this tone, which ships in both.
 *
 * The box is `AppLogo`'s `clientSelectionBadge`: a stated height, a width cap, the mark contained
 * in it - never stretched, never cropped, a transparent PNG kept transparent.
 */
const BOX = LOGO_VARIANTS.clientSelectionBadge;
const PLATE = { DARK: "rgba(255,255,255,0.94)", LIGHT: "rgba(17,17,17,0.92)" };

export default function AlbumLogo({ logo, design, alt = "", className = "" }) {
  const [brokenSrc, setBrokenSrc] = useState("");
  const tone = logo?.tone === "DARK" || logo?.tone === "LIGHT" ? logo.tone : logoToneFor(design);
  const src = logo?.url || "";
  const style = { height: `${BOX.height}px`, maxWidth: `${BOX.maxWidth}px` };
  const sizing = `block w-auto object-contain object-center ${className}`;
  const label = alt || FALLBACK_LOGO_ALT;

  if (!src || src === brokenSrc) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={BUNDLED_MARKS[tone]} alt={label} height={BOX.height} style={style} className={sizing} data-logo-tone={tone} data-logo-source="bundled" />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  const image = <img src={src} alt={label} height={BOX.height} style={style} onError={() => setBrokenSrc(src)} className={sizing} data-logo-tone={tone} data-logo-source={logo?.ownMark === false ? "borrowed" : "own"} />;
  if (logo?.ownMark !== false) return image;
  // The borrowed mark sits on a plate of the ground it was drawn for. The plate is the only thing
  // added; the artwork inside it is untouched.
  return <span className="inline-flex max-w-full items-center justify-center rounded-lg px-4 py-2.5" style={{ background: PLATE[tone] }} data-logo-plate={tone}>{image}</span>;
}
