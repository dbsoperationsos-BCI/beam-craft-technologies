"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/*
 * A printable document shown the way it prints: A4 sheets, their margins included, scaled down to the
 * width they are given and never up - the payslip template's preview in Settings → Payroll rules, the
 * certificates' and the offer letter's.
 *
 * `html` is the very document the server prints to PDF, so the two cannot drift apart. A document
 * longer than a sheet goes on to a second sheet, and a third, as it prints - never a sheet that
 * scrolls, since what is printed and handed over is pages. To break it the way a printer does - between
 * lines, not through them - the document is laid out in sheet-sized columns (`paged`), each sheet
 * showing one column.
 *
 * Drawn in sandboxed frames that may run nothing - no scripts, no forms, no navigation - since all
 * they have to do is be looked at; the server writes the document with every value escaped as well.
 * One hidden copy is also same-origin, script-free still, so the page can count how many sheets it
 * fills.
 */

// A4 at 96 CSS pixels to the inch, and the 12mm margin the PDF prints with.
const SHEET_WIDTH = 794;
const SHEET_HEIGHT = 1123;
const MARGIN = 45;
const PAGE_WIDTH = SHEET_WIDTH - (2 * MARGIN);
/*
 * Blank space between the laid-out pages. A sheet shows its page by sliding the row of pages along,
 * and scaled down that slide can land a fraction of a pixel off - with no gap, the edge of the page
 * before showed through as a thin line down the left (the heading box's border, beside the first
 * sections of page 2). With a gap, all a fraction can show is blank.
 */
const PAGE_GAP = 48;
const PAGE_STEP = PAGE_WIDTH + PAGE_GAP;
const PAGE_HEIGHT = SHEET_HEIGHT - (2 * MARGIN);
const MAX_PAGES = 20;

/**
 * The document laid out as pages: its body cut into columns a page wide and a page tall, filled in
 * order, so page `n` is column `n`. What prints as one block - a row, a section's heading, the
 * signature - is kept from splitting across two.
 */
export function paged(html) {
  const style = `<style data-a4-preview>
  html, body { margin: 0 !important; padding: 0 !important; height: ${PAGE_HEIGHT}px !important; overflow: hidden !important; }
  body { column-width: ${PAGE_WIDTH}px; column-gap: ${PAGE_GAP}px; column-fill: auto; }
  tr, li > b, h1, h2, h3, img, .head, .sign { break-inside: avoid; }
  h1, h2, h3, li > b { break-after: avoid; }
</style>`;
  const source = String(html || "");
  return /<\/head>/i.test(source) ? source.replace(/<\/head>/i, `${style}</head>`) : `${style}${source}`;
}

export default function A4DocumentPreview({ html, title = "Document preview", className = "" }) {
  const frameRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [pages, setPages] = useState(1);
  const document = useMemo(() => paged(html), [html]);

  useEffect(() => {
    const node = frameRef.current;
    if (!node || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(([entry]) => setScale(Math.min(1, entry.contentRect.width / SHEET_WIDTH)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // How many columns - pages - the document filled, read off the hidden copy once it has drawn.
  const measure = useCallback((event) => {
    try {
      // The body's width, not the page's: the page clips what overflows, the body still spans every column.
      const body = event.currentTarget.contentDocument?.body;
      // n pages span n widths and the n - 1 gaps between them.
      const count = body ? Math.round((body.scrollWidth + PAGE_GAP) / PAGE_STEP) : 1;
      setPages(Math.min(MAX_PAGES, Math.max(1, count)));
    } catch {
      setPages(1);
    }
  }, []);

  // `relative overflow-hidden`: the hidden measuring copy below is placed - and clipped - inside this
  // box. Without it, it hung off the nearest positioned ancestor and, a page tall, could stretch a whole
  // screen past the window: a second scrollbar, and an empty band under the pane holding the preview.
  return <div ref={frameRef} className={`relative w-full min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100 p-2 sm:p-4 ${className}`}>
    {/* The hidden copy the pages are counted on: a page wide, never seen, never focused. */}
    <iframe title={`${title} (measuring)`} aria-hidden="true" tabIndex={-1} sandbox="allow-same-origin" srcDoc={document} onLoad={measure}
      className="pointer-events-none invisible absolute -left-[9999px] top-0 border-0" style={{ width: PAGE_WIDTH, height: PAGE_HEIGHT }} />
    <div className="flex flex-col gap-4">
      {Array.from({ length: pages }, (unused, page) => (
        /* Each sheet keeps its real size and is scaled as a whole; the box around it takes the scaled height. */
        <div key={page} className="mx-auto overflow-hidden" style={{ width: SHEET_WIDTH * scale, height: SHEET_HEIGHT * scale }}>
          {/* Paper white in every theme - set inline, since the dark theme repaints the white utility class - so the margin looks as it prints. */}
          <div className="origin-top-left shadow-md" style={{ width: SHEET_WIDTH, height: SHEET_HEIGHT, padding: MARGIN, transform: `scale(${scale})`, backgroundColor: "#ffffff", colorScheme: "light" }}>
            {/* The page's window: the document's pages sit side by side behind it, moved along to this one. */}
            <div className="overflow-hidden" style={{ width: PAGE_WIDTH, height: PAGE_HEIGHT }}>
              <iframe
                title={pages > 1 ? `${title}, page ${page + 1} of ${pages}` : title}
                sandbox=""
                srcDoc={document}
                tabIndex={page ? -1 : 0}
                className="border-0"
                style={{ width: (PAGE_STEP * pages) - PAGE_GAP, height: PAGE_HEIGHT, transform: `translateX(-${page * PAGE_STEP}px)` }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
    {pages > 1 && <p className="mt-2 text-center text-xs text-slate-500">{pages} pages, as it prints.</p>}
  </div>;
}
