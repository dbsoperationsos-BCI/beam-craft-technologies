"use client";

import { useEffect } from "react";
import { designVariables, fontStylesheetUrl } from "@/lib/signatureAlbum.mjs";

/*
 * The `html:has(.sa-print)` rule is the PDF's: the app's `html, body { overflow-x: hidden }` makes
 * the body a scroll container (and the root layout makes it a flex column), and Chromium prints a
 * scrolling body onto the number of pages its unbroken height fills. Every row the page breaks push
 * down then runs past the last page and is cut off - the album ended mid-row, without its ending.
 * Printed as a plain block, the album is paginated whole. Only the print view carries `.sa-print`.
 *
 * The surface every album section is drawn on: the design as CSS custom properties, the chosen
 * fonts loaded from Google Fonts, and the handful of rules the sections share. Nothing in here
 * knows what an album holds - it only decides what the album looks like - so the client page and
 * the studio's live preview wrap the same sections in the same frame and cannot disagree.
 */
const STYLE_ID = "signature-album-frame-style";
const CSS = `
.sa-root{background:var(--album-bg);color:var(--album-text);font-family:var(--album-body-font);-webkit-font-smoothing:antialiased;min-height:100%}
.sa-root .sa-heading{font-family:var(--album-heading-font);font-weight:400;letter-spacing:0.02em}
.sa-root .sa-eyebrow{font-family:var(--album-body-font);font-size:11px;letter-spacing:0.32em;text-transform:uppercase;color:var(--album-muted)}
.sa-root .sa-muted{color:var(--album-muted)}
.sa-root .sa-accent{color:var(--album-accent)}
.sa-root .sa-line{border-color:var(--album-line)}
.sa-root .sa-frame{background:var(--album-frame)}
.sa-root .sa-gap{gap:var(--album-gap)}
.sa-root .sa-masonry{column-gap:var(--album-gap);column-count:1}
.sa-root .sa-masonry > *{break-inside:avoid;margin-bottom:var(--album-gap)}
@media (min-width:640px){.sa-root .sa-masonry{column-count:2}}
@media (min-width:1024px){.sa-root .sa-masonry{column-count:3}}
.sa-root .sa-btn{border:1px solid var(--album-line);color:var(--album-text);background:transparent;border-radius:9999px;padding:0.55rem 1.1rem;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;transition:background .2s,color .2s}
.sa-root .sa-btn:hover{background:var(--album-text);color:var(--album-bg)}
.sa-root .sa-chip{background:color-mix(in srgb, var(--album-bg) 72%, transparent);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border:1px solid var(--album-line)}
.sa-root[data-theme="LUXURY"] .sa-heading{letter-spacing:0.08em;text-transform:uppercase}
.sa-root[data-theme="LUXURY"] .sa-eyebrow{letter-spacing:0.42em}
.sa-root[data-theme="MODERN"] .sa-heading{font-weight:600;letter-spacing:-0.02em}
.sa-root[data-theme="ROMANTIC"] .sa-heading{font-style:italic;font-weight:300}
.sa-root[data-theme="VINTAGE"] .sa-frame{box-shadow:inset 0 0 0 1px var(--album-line)}
.sa-root[data-theme="VINTAGE"] .sa-heading{letter-spacing:0.04em}
.sa-fade-in{animation:sa-fade .9s ease both}
@keyframes sa-fade{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.sa-fade-in{animation:none}}
.sa-print *,.sa-print *::before,.sa-print *::after{animation:none !important;transition:none !important}
.sa-print .sa-frame,.sa-print h2,.sa-print header,.sa-print footer{break-inside:avoid}
.sa-print header{break-after:avoid}
html:has(.sa-print),html:has(.sa-print) body{overflow:visible !important;height:auto !important;display:block !important}
`;

function useFontStylesheet(url) {
  useEffect(() => {
    if (!url || typeof document === "undefined") return undefined;
    const existing = document.querySelector(`link[data-signature-album-fonts="${url}"]`);
    if (existing) return undefined;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = url;
    link.dataset.signatureAlbumFonts = url;
    // Read by the PDF print, which must not print before the sheet has arrived - nor wait for one
    // that never will.
    const settle = (event) => { link.dataset.fontState = event.type === "load" ? "loaded" : "failed"; };
    link.addEventListener("load", settle, { once: true });
    link.addEventListener("error", settle, { once: true });
    document.head.appendChild(link);
    // Left in place on unmount: a font sheet already fetched costs nothing to keep, and the
    // studio's Design panel switches fonts many times in one sitting.
    return undefined;
  }, [url]);
}

export default function AlbumFrame({ design, className = "", children, style }) {
  useFontStylesheet(fontStylesheetUrl(design));
  return <div className={`sa-root ${className}`} data-theme={design?.theme || "EDITORIAL"} style={{ ...designVariables(design), ...style }}>
    <style id={STYLE_ID} dangerouslySetInnerHTML={{ __html: CSS }} />
    {children}
  </div>;
}
