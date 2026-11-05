"use client";

import { useEffect } from "react";
import useStudioBranding from "@/components/shared/useStudioBranding";
import { faviconFor } from "@/lib/favicon.mjs";

/**
 * The studio's mark in the browser tab, on every page this application serves.
 *
 * Mounted once in the root layout rather than per page, which is what puts it on the client's tab
 * as well as the studio's: a proofing link, a gallery, a quotation and the signed-in application
 * are all the same tree, and the tab is the one piece of the studio a client sees before anything
 * has loaded.
 *
 * ── Why a link element rather than Next's metadata ──
 *
 * `metadata.icons` is decided when the page is rendered. The favicon here is a *setting*, changed
 * in the application and expected to show without a reload. So the tag is written here, and
 * rewritten when the setting changes: `useStudioBranding` hands every mounted reader the values
 * Settings has just saved, so the tab changes as the Save lands.
 *
 * One mark, whatever the browser's tab strip. This used to watch `prefers-color-scheme` and swap
 * between a pair, because bare lettering disappears on a strip of its own colour; the mark now
 * carries its own ground and reads either way, so there is nothing left for the query to decide.
 *
 * The bundled mark in `/brand` is what a studio that has uploaded nothing gets, and it is declared
 * in the layout's own metadata as well, so a tab has the right mark before this component has run.
 */
export default function StudioFavicon() {
  const branding = useStudioBranding();
  const href = faviconFor(branding);

  useEffect(() => {
    if (!href || typeof document === "undefined") return;
    /*
     * One tag, replaced rather than added to.
     *
     * Browsers keep every `rel="icon"` they are given and pick among them by their own rules, so
     * appending on each change would leave the old mark to win as often as not. The tag this
     * component owns is marked, so it can be found again without disturbing anything else in the
     * head.
     */
    const type = href.endsWith(".svg") || href.startsWith("data:image/svg") ? "image/svg+xml" : "image/png";
    for (const stale of document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]')) {
      if (stale.dataset.studioFavicon !== "true") stale.remove();
    }
    let link = document.querySelector('link[data-studio-favicon="true"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      link.dataset.studioFavicon = "true";
      document.head.appendChild(link);
    }
    if (link.getAttribute("href") !== href) link.setAttribute("href", href);
    link.setAttribute("type", type);
  }, [href]);

  return null;
}
