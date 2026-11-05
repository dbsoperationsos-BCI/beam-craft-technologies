"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAlbumContent, listAlbumChapterItems, fetchAlbumImage } from "@/services/image-selection/signature-album-public.service";
import { designVariables } from "@/lib/signatureAlbum.mjs";
import AlbumPrintContext from "./AlbumPrintContext";
import SignatureAlbumView from "./SignatureAlbumView";

// The most a chapter is asked for in one call (the server's own ceiling).
const BATCH = 120;
// A photo that never answers must not hold the whole PDF: after this the album prints as it is.
const DEADLINE_MS = 5 * 60 * 1000;
// Everything must have been in place for two looks in a row, so a font arriving late is caught.
const CHECK_MS = 300;

/**
 * /a/<code>/print - the album as Download Album's PDF prints it. Opened only by the server's
 * headless browser (`signatureAlbum.pdf.service.js`), with a short-lived album session in the URL's
 * fragment, and read through the same public API the client's page uses.
 *
 * The client's own `SignatureAlbumView`, with every chapter's photos fetched up front rather than
 * as the reader scrolls, every photo loaded at once (`AlbumPrintContext`), and no controls. When
 * every photo, image and font has arrived it sets `data-album-print-state="ready"` on its root,
 * which is what the server waits for before printing; `error` when the album cannot be read.
 */
export default function SignatureAlbumPrint({ code }) {
  const [content, setContent] = useState(null);
  const [state, setState] = useState(null);
  const sessionRef = useRef(null);
  const counts = useRef({ added: 0, settled: 0 });
  const tracker = useMemo(() => ({ add: () => { counts.current.added += 1; }, settle: () => { counts.current.settled += 1; } }), []);
  const loader = useCallback((path, signal) => fetchAlbumImage(path, sessionRef.current, signal), []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const session = new URLSearchParams(window.location.hash.slice(1)).get("session");
        if (!session) throw new Error("No album session.");
        sessionRef.current = session;
        const album = (await getAlbumContent(code, session)).data;
        // Every chapter whole: the PDF is the album, not the first screenful of it.
        const chapters = [];
        for (const chapter of album.chapters) {
          const items = [...chapter.items];
          while (items.length < chapter.photoCount) {
            const page = (await listAlbumChapterItems(code, session, chapter.id, { offset: items.length, limit: BATCH })).data;
            const fresh = page.items.filter((item) => !items.some((existing) => existing.id === item.id));
            if (!fresh.length) break;
            items.push(...fresh);
          }
          chapters.push({ ...chapter, items });
        }
        if (active) setContent({ ...album, chapters });
      } catch {
        if (active) setState("error");
      }
    })();
    return () => { active = false; };
  }, [code]);

  // The last page's space below the ending is the page itself, not the album, so it is given the
  // album's background - otherwise it prints white under a dark album.
  useEffect(() => {
    if (!content) return undefined;
    const html = document.documentElement;
    const previous = html.style.backgroundColor;
    html.style.backgroundColor = designVariables(content.design)["--album-bg"];
    return () => { html.style.backgroundColor = previous; };
  }, [content]);

  // Once the album is drawn, wait for every photo to report and every image and font to arrive.
  useEffect(() => {
    if (!content) return undefined;
    const started = Date.now();
    let steady = 0;
    const timer = window.setInterval(() => {
      const photos = counts.current.settled >= counts.current.added;
      const images = Array.from(document.images).every((image) => image.complete);
      // The design's font sheet is added by the page itself, and until it has arrived no font is
      // pending, so `document.fonts` alone read "loaded" and the PDF could print in fallback fonts.
      const sheets = Array.from(document.querySelectorAll("link[data-signature-album-fonts]")).every((link) => link.dataset.fontState);
      const fonts = sheets && (!document.fonts || document.fonts.status === "loaded");
      steady = photos && images && fonts ? steady + 1 : 0;
      if (steady >= 2 || Date.now() - started > DEADLINE_MS) { window.clearInterval(timer); setState("ready"); }
    }, CHECK_MS);
    return () => window.clearInterval(timer);
  }, [content]);

  if (state === "error") return <main data-album-print-state="error" className="grid min-h-[100svh] place-items-center bg-white px-6 text-center text-sm text-slate-600">This album could not be prepared.</main>;
  if (!content) return null;
  return <div className="sa-print" data-album-print-state={state || undefined}>
    <AlbumPrintContext.Provider value={tracker}>
      <SignatureAlbumView content={content} loader={loader} print />
    </AlbumPrintContext.Provider>
  </div>;
}
